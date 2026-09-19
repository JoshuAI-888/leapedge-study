import { z } from "zod";
import { createHash } from "node:crypto";
import {
  Source,
  coverage,
  type Run,
  type CheckedClaim,
  type SourceData,
} from "../../features/youtube-intelligence/contracts.ts";
import {
  compareSpan,
  twoOfThree,
  type TimedText,
  type SpanAgreement,
} from "../../features/youtube-intelligence/agreement.ts";
import type { TeamPreferencesData } from "../../features/youtube-intelligence/settings.ts";
import type { modelCall } from "./pipeline.ts";
import { missingRanges } from "../../features/youtube-intelligence/chunking.ts";
import { insertTranscript } from "./repos/transcripts.ts";
import { managedTranscript } from "./transcripts.ts";

const Window = z
  .object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
  })
  .refine((w) => w.endSeconds > w.startSeconds);
type Window = z.infer<typeof Window>;
export function planWindows(
  duration: number,
  seconds: number,
  spans?: Array<{ startSeconds: number; endSeconds: number }>,
): Window[] {
  z.number().positive().max(86400).parse(duration);
  z.number().int().min(120).max(600).parse(seconds);
  const all = Array.from({ length: Math.ceil(duration / seconds) }, (_, i) => ({
    startSeconds: i * seconds,
    endSeconds: Math.min(duration, (i + 1) * seconds),
  }));
  return spans
    ? all.filter((w) =>
        spans.some(
          (s) => s.startSeconds < w.endSeconds && s.endSeconds > w.startSeconds,
        ),
      )
    : all;
}
const WindowResponse = z.object({
  audio_status: z.enum(["complete", "inaccessible"]).optional(),
  language: z.string().optional(),
  segments: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        start_seconds: z.number().nonnegative(),
        end_seconds: z.number().nonnegative(),
      }),
    )
    .max(3000),
});
export function parseWindow(value: unknown, window: Window, index: number) {
  const result = WindowResponse.parse(value);
  let priorStart = window.startSeconds;
  for (const s of result.segments) {
    if (
      s.start_seconds < priorStart ||
      s.start_seconds < window.startSeconds ||
      s.end_seconds > window.endSeconds ||
      s.end_seconds <= s.start_seconds
    )
      throw Error(
        "ASR returned invalid absolute window timestamps; no automatic timing repair.",
      );
    priorStart = s.start_seconds;
  }
  return {
    audioStatus: result.audio_status,
    language: result.language,
    segments: result.segments.map((s, i) => ({
      ...s,
      id: `asr-${index}-${i}`,
    })),
  };
}
const StoredWindow = z.object({
  ...Window.shape,
  segments: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      start_seconds: z.number(),
      end_seconds: z.number(),
    }),
  ),
  language: z.string().optional(),
  transcriptId: z.string(),
  audioStatus: z.enum(["complete", "inaccessible"]).optional(),
});
function evidenceSpans(run: Run): TimedText[] {
  return ((run.output.claims ?? []) as CheckedClaim[])
    .filter((c) => c.passed)
    .flatMap((c) =>
      c.claim.evidence.map((e) => ({
        text: e.quote_original,
        startSeconds: e.source_span?.start_seconds ?? null,
        endSeconds: e.source_span?.end_seconds ?? null,
      })),
    );
}
const PROMPT =
  "Listen independently to ONLY the supplied video window. Transcribe verbatim in the spoken language; do not translate, infer missing speech, or summarize. Return JSON {language:string,segments:[{text:string,start_seconds:number,end_seconds:number}]}. Use ABSOLUTE SECONDS (never milliseconds) from the beginning of the original video within the requested bounds. For example a clip starting at 1200 seconds uses 1200.5, NOT 1200500 or 0.5. Use short speech cues with accurate start and end times. Set audio_status to complete only when the entire supplied clip was accessible and transcribed, including silence; use inaccessible when audio could not be accessed. Return empty segments for genuine silence with complete status. Never invent speech.";

/** One paid window per checkpoint; the transport ledger replays retained responses after a crash. */
export async function windowedAsrStep(
  run: Run,
  settings: TeamPreferencesData,
  sourceMode: boolean,
  call: typeof modelCall,
) {
  if (settings.sources.asr !== "gemini-windowed")
    throw Error(
      "Windowed ASR is disabled; choose gemini-windowed before requesting audio verification.",
    );
  const duration = z
    .object({ duration: z.number().positive() })
    .parse(run.output.metadata).duration;
  const spans = evidenceSpans(run).filter(
    (s): s is TimedText & { startSeconds: number; endSeconds: number } =>
      s.startSeconds !== null && s.endSeconds !== null,
  );
  const windows = run.output.asrPlan
    ? z.array(Window).parse(run.output.asrPlan)
    : planWindows(
        duration,
        settings.sources.windowSeconds,
        sourceMode || settings.sources.asrPolicy === "always"
          ? undefined
          : spans,
      );
  run.output.asrPlan = windows;
  const done = z.array(StoredWindow).parse(run.output.asrWindows ?? []);
  let next = windows.find(
    (w) =>
      !done.some(
        (d) =>
          d.startSeconds === w.startSeconds && d.endSeconds === w.endSeconds,
      ),
  );
  // Speech occupancy is not transcript completeness. Re-listen to gaps longer
  // than three seconds once, recording actual silence separately from speech.
  const checks = z.array(StoredWindow).parse(run.output.asrGapChecks ?? []);
  let gapCheck = false;
  if (!next && sourceMode) {
    const source = Source.parse({
      source_kind: "google_windowed_asr",
      segments: [...done, ...checks].flatMap((w) => w.segments),
    });
    const gaps = missingRanges(source, duration);
    next = gaps
      .flatMap((g) => {
        const parts: Window[] = [];
        for (let start = g.start; start < g.end; start += 300)
          parts.push({
            startSeconds: start,
            endSeconds: Math.min(g.end, start + 300),
          });
        return parts;
      })
      .find(
        (g) =>
          !checks.some(
            (c) =>
              c.startSeconds <= g.startSeconds && c.endSeconds >= g.endSeconds,
          ),
      );
    gapCheck = !!next;
  }
  if (next) {
    const index = gapCheck
      ? windows.length + checks.length
      : windows.indexOf(next);
    const native = {
      ...settings,
      sources: { ...settings.sources, mediaResolution: "low" as const },
      transport: { ...settings.transport, fallbackToOpenRouter: false },
      models: {
        ...settings.models,
        transcription: {
          ...settings.models.transcription,
          transport: "google-native" as const,
        },
      },
    };
    let parsed: ReturnType<typeof parseWindow>;
    try {
      const raw = await call(
        run,
        `transcribe-asr-${next.startSeconds}-${next.endSeconds}${gapCheck ? "-gap" : ""}`,
        undefined,
        PROMPT,
        {
          window_start_seconds: next.startSeconds,
          window_end_seconds: next.endSeconds,
        },
        true,
        {
          settings: native,
          responseSchema: z.toJSONSchema(
            WindowResponse.extend({
              segments: z
                .array(
                  z.object({
                    text: z.string().trim().min(1),
                    start_seconds: z
                      .number()
                      .min(next.startSeconds)
                      .max(next.endSeconds),
                    end_seconds: z
                      .number()
                      .min(next.startSeconds)
                      .max(next.endSeconds),
                  }),
                )
                .max(3000),
            }),
          ),
          maxOutputTokens: 12000,
          reasoningEffort: "low",
        },
      );
      parsed = parseWindow(raw, next, index);
      if (
        parsed.audioStatus === "inaccessible" ||
        (!parsed.segments.length && parsed.audioStatus !== "complete")
      ) {
        run.status = "needs_review";
        run.error =
          "Audio window was inaccessible or silence was not explicitly confirmed.";
        return;
      }
    } catch (error) {
      if (
        !gapCheck &&
        error instanceof Error &&
        /invalid absolute window timestamps|response was incomplete|not valid JSON/.test(
          error.message,
        ) &&
        next.endSeconds - next.startSeconds > 30
      ) {
        const midpoint = (next.startSeconds + next.endSeconds) / 2;
        windows.splice(
          index,
          1,
          { ...next, endSeconds: midpoint },
          { ...next, startSeconds: midpoint },
        );
        run.output.asrPlan = windows;
        run.output.asrRecovery = [
          ...((run.output.asrRecovery ?? []) as unknown[]),
          { window: next, reason: error.message },
        ];
        return;
      }
      throw error;
    }
    const hash = createHash("sha256")
      .update(JSON.stringify(parsed.segments))
      .digest("hex");
    const transcriptId = `${run.id}:asr:${next.startSeconds}:${next.endSeconds}:${hash}`;
    await insertTranscript({
      id: transcriptId,
      videoId: run.videoId,
      kind: "asr-window",
      provider: "google-native",
      language: parsed.language ?? null,
      hash,
      segments: parsed.segments,
    });
    if (gapCheck) {
      checks.push({ ...next, ...parsed, transcriptId });
      run.output.asrGapChecks = checks;
    } else {
      done.push({ ...next, ...parsed, transcriptId });
      run.output.asrWindows = done;
    }
    if (done.length < windows.length || gapCheck) return;
    const merged = Source.parse({
      source_kind: "google_windowed_asr",
      segments: done.flatMap((w) => w.segments),
    });
    if (sourceMode && missingRanges(merged, duration).length) return;
  }
  if (sourceMode) {
    const segments = [...done, ...checks]
      .flatMap((w) => w.segments)
      .sort((a, b) => a.start_seconds - b.start_seconds);
    if (!segments.length) {
      run.status = "needs_review";
      run.error = "No speech was returned by windowed ASR.";
      return;
    }
    const source = Source.parse({
      video_id: run.videoId,
      language: done.find((w) => w.language)?.language,
      source_kind: "google_windowed_asr",
      segment_separator: " ",
      segments,
    });
    run.output.source = source;
    run.output.sourceHash = createHash("sha256")
      .update(JSON.stringify(source))
      .digest("hex");
    run.output.coverage = coverage(source, duration);
    run.output.audioTrustProcessed = true; // A source cannot independently verify itself.
    run.output.transcriptionCompleteness = {
      status: "windows_processed_gaps_checked",
      windowCount: done.length,
      gapCheckCount: checks.length,
      speechCoverage: coverage(source, duration),
      note: "All planned clips processed; gaps over three seconds re-listened. Model transcription, not human or independent-source verification.",
    };
    run.stage = "synthesis";
  } else run.stage = "agree";
}

/** Compare original-language copied spans; translations and model critique never participate. */
export async function agreeRun(
  run: Run,
  settings: TeamPreferencesData,
  generate: typeof managedTranscript = managedTranscript,
) {
  const source = Source.parse(run.output.source);
  const google = z
    .array(StoredWindow)
    .parse(run.output.asrWindows ?? [])
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .flatMap((w) => w.segments);
  const independent = !/google_windowed_asr|native_google|model_generated/.test(
    source.source_kind,
  );
  const claims = ((run.output.claims ?? []) as CheckedClaim[]).filter(
    (c) => c.passed,
  );
  const result: Record<string, SpanAgreement[]> = {};
  let whisper: SourceData | null = run.output.tieBreakTranscript
    ? Source.parse(run.output.tieBreakTranscript)
    : null;
  for (const claim of claims) {
    result[claim.id] = [];
    for (const evidence of claim.claim.evidence) {
      const span = {
        text: evidence.quote_original,
        startSeconds: evidence.source_span?.start_seconds ?? null,
        endSeconds: evidence.source_span?.end_seconds ?? null,
      };
      let agreement = {
        ...compareSpan(span, google, settings.sources.agreementThreshold),
        independent,
      };
      if (
        independent &&
        !agreement.agreed &&
        settings.sources.tieBreakWithStandby &&
        settings.sources.standby === "supadata"
      ) {
        if (!whisper && !run.output.tieBreakAttempted) {
          // Adapter durably deduplicates generation, including pending and uncertain attempts.
          whisper = await generate(run.videoId, "supadata", {
            generate: true,
            duration: (run.output.metadata as { duration: number }).duration,
            settings,
          });
          run.output.tieBreakAttempted = true;
          if (whisper) {
            run.output.tieBreakTranscript = whisper;
            const hash = createHash("sha256")
              .update(JSON.stringify(whisper))
              .digest("hex");
            await insertTranscript({
              id: `${run.id}:whisper:${hash}`,
              videoId: run.videoId,
              kind: "whisper",
              provider: "supadata-generate",
              language: whisper.language ?? null,
              hash,
              segments: whisper.segments,
            });
          }
        }
        if (whisper)
          agreement = {
            ...twoOfThree(
              span,
              google,
              whisper.segments,
              settings.sources.agreementThreshold,
            ),
            independent: true,
          };
      }
      result[claim.id].push(agreement);
    }
  }
  run.output.spanAgreement = result;
  run.output.audioTrustProcessed = true;
  run.stage = "publish";
}
