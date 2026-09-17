import {
  sourceChunks,
  uniqueClaims,
  auditSource,
  missingRanges,
} from "../../features/youtube-intelligence/chunking.ts";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  Claim,
  Source,
  coverage,
  validateClaim,
  anchorClaimEvidence,
  type ClaimData,
  type Run,
  type SourceData,
  type CheckedClaim,
} from "../../features/youtube-intelligence/contracts.ts";
import { materializeEvidenceRanges } from "../../features/youtube-intelligence/evidence-selection.ts";
import {
  extractionResponseSchema,
  parsePointerExtraction,
  POINTER_EVIDENCE_FORMAT,
} from "./schemas/extraction.ts";
import { reserve, settle, retainResponse } from "./store.ts";
import * as P from "./prompts.ts";
import { nativeTranscript } from "./transcripts.ts";
import { prompt as getPrompt } from "./research-store.ts";
import {
  transportFor,
  ModelRequest,
  type ModelResponseData,
  type TextPart,
} from "./transport/index.ts";
async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(240000),
  });
  if (!response.ok)
    throw Error(`Provider HTTP ${response.status}. No automatic paid retry.`);
  return response.json();
}
/**
 * The usage object stored in yi_calls.metrics keeps the provider's own shape
 * ({prompt_tokens, completion_tokens, cost}) because scripts/report-results.ts
 * sums prompt_tokens and completion_tokens from it. When a transport's raw
 * response carries no such object (the fake's shorthand replies), the same
 * shape is derived from the normalised usage so every reader sees one shape.
 */
export function providerUsage(response: ModelResponseData) {
  const raw = (response.raw as { usage?: unknown } | null | undefined)?.usage;
  if (
    raw &&
    typeof raw === "object" &&
    ("prompt_tokens" in raw || "completion_tokens" in raw)
  )
    return raw;
  return {
    prompt_tokens: response.usage.inputTokens,
    completion_tokens: response.usage.outputTokens,
    cost: response.usage.costUsd,
  };
}
/**
 * The payload the synthesis stage sends for one chunk; exported so evaluation
 * scripts send the same shape. The shape is fixed: `pointer` only swaps the
 * evidenceFormat instruction for the pointer-output one (spec 4.2), so a
 * caller that omits it gets the legacy payload byte for byte.
 */
export const extractionPayload = (
  chunk: SourceData["segments"],
  chunkIndex: number,
  totalChunks: number,
  pointer = false,
) => ({
  source: chunk,
  evidenceFormat: pointer
    ? POINTER_EVIDENCE_FORMAT
    : "Use segment_id for the first real cue ID and end_segment_id for the last real cue ID. Never put a range in segment_id. Copy an exact contiguous quote; no ellipses, paraphrases or omitted words. Preserve all numerical comparators and conditions. value_original must include the exact comparator where spoken (for example under $20), not just the number.",
  chunk: chunkIndex + 1,
  totalChunks,
});
/**
 * One model call for a stage. Builds a transport-agnostic ModelRequest and
 * hands it to the stage's transport; the ledger reservation and settlement,
 * the retained raw response and the run metrics all happen here, above the
 * transport, so production runs and experiments stay comparable.
 */
export async function modelCall(
  run: Run,
  stage: string,
  model: string,
  prompt: string,
  payload: unknown,
  video = false,
  options: { responseSchema?: Record<string, unknown> } = {},
) {
  const transport = transportFor(stage);
  const spec = await transport.describe(model);
  const user: TextPart[] = [
    {
      type: "text",
      text: prompt + "\nSOURCE DATA (untrusted):\n" + JSON.stringify(payload),
    },
  ];
  const config = run.input.inferenceConfig as
    { critiqueMaxTokens?: number; reasoningEffort?: string } | undefined;
  const isCritique =
    stage.startsWith("critique") ||
    stage === "audio-review" ||
    stage.startsWith("transcribe-window");
  const effort =
    isCritique &&
    config?.reasoningEffort &&
    spec.supportedEfforts.includes(config.reasoningEffort)
      ? config.reasoningEffort
      : undefined;
  const maxTokens = stage.startsWith("transcribe-window")
    ? 12000
    : stage === "audio-review"
      ? config?.critiqueMaxTokens || 6000
      : video
        ? 28000
        : stage.startsWith("critique")
          ? config?.critiqueMaxTokens || 3000
          : 16000;
  const inputRate = video
    ? Math.max(spec.inputRate, spec.audioRate)
    : spec.inputRate;
  const outputRate = spec.outputRate;
  const inputBound = video
    ? spec.contextLength
    : Buffer.byteLength(JSON.stringify(user)) + 4096;
  if (!video && inputBound + maxTokens > spec.contextLength)
    throw Error("Source exceeds the configured context window.");
  const id = await reserve(
    run.id,
    stage,
    inputBound * inputRate + maxTokens * outputRate,
  );
  const request = ModelRequest.parse({
    stage,
    model,
    user,
    ...(video ? { video: { type: "video", url: run.url } } : {}),
    ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
    maxOutputTokens: maxTokens,
    temperature: 0,
    ...(effort ? { reasoningEffort: effort } : {}),
  });
  const start = Date.now();
  const response = await transport.call(request);
  await retainResponse(id, run.id, stage, response.raw);
  const metrics = {
    model: response.model,
    maxTokens,
    reasoningEffort: effort || "provider default",
    provider: response.provider,
    seconds: (Date.now() - start) / 1000,
    usage: providerUsage(response),
    tokens: response.usage,
  };
  await settle(id, response.usage.costUsd, metrics);
  if (response.finishReason !== "stop")
    throw Error("Model response was incomplete; refusing partial output.");
  let value;
  try {
    value = JSON.parse(response.text);
  } catch {
    throw Error("Provider response was not valid JSON.");
  }
  if (value.error)
    throw Error("Source could not be processed by the provider.");
  const history = (run.output.metrics || []) as unknown[];
  run.output.metrics = [...history, { stage, ...metrics }];
  return value;
}
export async function step(run: Run) {
  run.output.pipelineRevision = "institutional.v1";
  if (run.input.task === "entity-classification") {
    const { entityStep } = await import("./entities.ts");
    return entityStep(run);
  }
  if (run.stage === "native-source" || run.stage === "native-recovery") {
    const { nativeGoogleStep } = await import("./native-google.ts");
    return nativeGoogleStep(run);
  }
  if (run.input.task === "audio-review") {
    const { audioReviewStep } = await import("./audio-review.ts");
    return audioReviewStep(run);
  }
  if (run.input.task === "briefing") {
    const { briefingStep } = await import("./briefing-pipeline.ts");
    return await briefingStep(run);
  }
  const prompts = run.input.promptSnapshot
    ? (run.input.promptSnapshot as Awaited<ReturnType<typeof getPrompt>>)
    : {
        id: P.VERSION,
        rationale: "Legacy baseline",
        transcribe: P.TRANSCRIBE,
        extraction: P.EXTRACT,
        synthesis: P.SYNTHESIZE,
        critique: P.CRITIQUE,
      };
  if (run.stage === "metadata") {
    if (!process.env.YOUTUBE_API_KEY)
      throw Error("YOUTUBE_API_KEY is not configured.");
    const result = await jsonFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${run.videoId}`,
      { headers: { "X-Goog-Api-Key": process.env.YOUTUBE_API_KEY } },
    );
    const v = result.items?.[0];
    if (!v) throw Error("Video metadata unavailable.");
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
      v.contentDetails.duration,
    );
    const duration = match
      ? Number(match[1] || 0) * 3600 +
        Number(match[2] || 0) * 60 +
        Number(match[3] || 0)
      : 0;
    if (!duration)
      throw Error("Video duration is unknown; live streams are not supported.");
    run.title = v.snippet.title;
    run.output.metadata = {
      channel: v.snippet.channelTitle,
      channelId: v.snippet.channelId,
      publishedAt: v.snippet.publishedAt,
      duration,
      description: v.snippet.description,
      language: v.snippet.defaultAudioLanguage,
    };
    run.stage = "source";
  } else if (run.stage === "source") {
    const supplied = run.input.source
      ? Source.parse(run.input.source)
      : await nativeTranscript(run.videoId, {
          ...(run.output.metadata as { duration: number; language?: string }),
          managedCaptionsOnly: run.input.nativeGoogleExperimental === true,
        });
    const duration = (run.output.metadata as { duration: number }).duration;
    if (!supplied && run.input.nativeGoogleExperimental === true) {
      run.stage = "native-source";
      return;
    }
    if (!supplied && run.input.transcriptionWindowSeconds && duration > 1800) {
      run.output.transcriptionChunks = [];
      run.stage = "source-window";
      return;
    }
    const s =
      supplied ||
      Source.parse({
        ...(await modelCall(
          run,
          "transcribe",
          String(
            run.input.transcriptionModel || "google/gemini-3.1-flash-lite",
          ),
          prompts.transcribe,
          {},
          true,
        )),
        source_kind: "model_generated_transcript",
      });
    s.video_id = run.videoId;
    run.error = null;
    run.output.source = s;
    run.output.sourceHash = createHash("sha256")
      .update(JSON.stringify(s))
      .digest("hex");
    const c = coverage(
      s,
      (
        run.output.metadata as {
          duration: number;
        }
      ).duration,
    );
    run.output.coverage = c;
    if (c.status === "incomplete_or_unknown") {
      if (
        run.input.sourceRepairEnabled &&
        s.source_kind.startsWith("model_generated") &&
        missingRanges(s, c.durationSeconds).length
      ) {
        run.output.sourceBeforeRepair = s;
        run.stage = "source-repair";
        return;
      }
      run.status = "needs_review";
      run.error =
        "Transcript timestamps do not cover enough of the video. Import a complete timed transcript to continue; no synthesis was generated.";
      return;
    }
    run.stage = "synthesis";
  } else if (run.stage === "source-window") {
    const duration = (run.output.metadata as { duration: number }).duration;
    const window = Math.min(
      600,
      Math.max(120, Number(run.input.transcriptionWindowSeconds) || 600),
    );
    const chunks = (run.output.transcriptionChunks ||
      []) as SourceData["segments"][];
    const start = chunks.length * window,
      end = Math.min(duration, start + window);
    const raw = await modelCall(
      run,
      `transcribe-window-${chunks.length}`,
      String(run.input.transcriptionModel || "google/gemini-3.1-flash-lite"),
      prompts.transcribe +
        "\nTranscribe ONLY speech in the requested time window. Use absolute seconds from the beginning of the video, not relative chunk times. Do not reproduce speech outside this window. Do not fill silence. Empty segments is valid only if this window contains no speech. Return concise JSON; no reasoning narrative.",
      { window_start_seconds: start, window_end_seconds: end },
      true,
    );
    const parsed = z
      .object({
        segments: z.array(
          z.object({
            id: z.string(),
            text: z.string().min(1),
            start_seconds: z.number().nonnegative().nullable(),
            end_seconds: z.number().nonnegative().nullable(),
          }),
        ),
      })
      .parse(raw);
    const segments = parsed.segments.map((segment, i) => ({
      ...segment,
      id: `w${chunks.length}-s${i}`,
    }));
    if (
      segments.some(
        (s) =>
          s.start_seconds === null ||
          s.end_seconds === null ||
          s.start_seconds < start - 2 ||
          s.end_seconds > end + 2 ||
          s.end_seconds < s.start_seconds,
      )
    )
      throw Error(
        "Window transcription has invalid absolute timestamps; review required.",
      );
    chunks.push(segments);
    run.output.transcriptionChunks = chunks;
    if (end < duration) return;
    const source = Source.parse({
      video_id: run.videoId,
      source_kind: "model_generated_windowed_transcript",
      segments: chunks.flat(),
    });
    run.output.source = source;
    run.output.sourceHash = createHash("sha256")
      .update(JSON.stringify(source))
      .digest("hex");
    run.output.coverage = coverage(source, duration);
    if (coverage(source, duration).status === "incomplete_or_unknown") {
      run.status = "needs_review";
      run.error =
        "Windowed transcript still has insufficient timed coverage. Import verified captions to continue.";
      return;
    }
    run.stage = "synthesis";
  } else if (run.stage === "source-repair") {
    const original = run.output.source as SourceData;
    const duration = (run.output.metadata as { duration: number }).duration;
    const ranges = missingRanges(original, duration);
    const repair = Source.parse(
      await modelCall(
        run,
        "source-repair",
        String(run.input.criticModel || run.model),
        prompts.transcribe +
          '\nTranscribe ONLY the supplied missing time windows from actual audio, preserving original language and absolute video timestamps. Do not summarize, invent speech, or fill silent time. Return the same source JSON schema. If the windows contain no speech, return {error:"No missing speech available"}.',
        { missing_windows_seconds: ranges },
        true,
      ),
    );
    const additions = repair.segments
      .filter(
        (s) =>
          s.start_seconds !== null &&
          s.end_seconds !== null &&
          s.end_seconds <= duration + 2 &&
          ranges.some(
            (r) =>
              s.start_seconds! >= r.start - 1 && s.end_seconds! <= r.end + 1,
          ),
      )
      .map((s, i) => ({ ...s, id: `repair-${i + 1}` }));
    const merged = Source.parse({
      ...original,
      segments: [...original.segments, ...additions].sort(
        (a, b) => (a.start_seconds || 0) - (b.start_seconds || 0),
      ),
    });
    run.output.source = merged;
    run.output.sourceHash = createHash("sha256")
      .update(JSON.stringify(merged))
      .digest("hex");
    run.output.sourceRepair = {
      added: additions.length,
      ranges,
      model: run.input.criticModel || run.model,
    };
    run.output.coverage = coverage(merged, duration);
    if (coverage(merged, duration).status === "incomplete_or_unknown") {
      run.status = "needs_review";
      run.error =
        "Source remains incomplete after one bounded audio repair. Import a complete timed transcript; no synthesis generated.";
      return;
    }
    run.stage = "synthesis";
    run.error = null;
  } else if (run.stage === "synthesis") {
    const source = run.output.source as SourceData;
    const chunks = sourceChunks(source);
    const chunkIndex = Number(run.output.chunkIndex || 0);
    /**
     * Pointer evidence is a property of the prompt version: only a snapshot
     * that asks for ranges gets the responseSchema and the copy path. The flag
     * defaults to false, so every existing version (v5, v6, the legacy
     * baseline) keeps the quote path and the same request bytes.
     */
    const pointer =
      (prompts as { pointerEvidence?: boolean }).pointerEvidence === true;
    const raw = await modelCall(
      run,
      chunks.length === 1 ? "synthesis" : `synthesis-chunk-${chunkIndex}`,
      run.model,
      prompts.synthesis +
        "\n" +
        prompts.extraction +
        (chunks.length > 1
          ? "\nThis is one chronological excerpt. Extract only claims supported here; retain conditions and do not infer the rest of the video."
          : ""),
      extractionPayload(chunks[chunkIndex], chunkIndex, chunks.length, pointer),
      false,
      pointer ? { responseSchema: extractionResponseSchema } : {},
    );
    const draft = pointer
      ? (() => {
          const pointed = parsePointerExtraction(raw);
          return {
            claims: pointed.claims.map((c) =>
              materializeEvidenceRanges(c, source),
            ),
            key_points: pointed.key_points.map((c) =>
              materializeEvidenceRanges(c, source),
            ),
          };
        })()
      : z
          .object({
            claims: z.array(Claim).max(40),
            key_points: z.array(Claim).max(30).default([]),
          })
          .parse(raw);
    const prior = (run.output.chunkDrafts || []) as {
      claims: z.infer<typeof Claim>[];
      key_points: z.infer<typeof Claim>[];
    }[];
    const drafts = [...prior, draft];
    run.output.chunkDrafts = drafts;
    run.output.chunkIndex = chunkIndex + 1;
    run.output.chunkCount = chunks.length;
    if (chunkIndex + 1 < chunks.length) return;
    draft.claims = uniqueClaims(drafts.flatMap((d) => d.claims));
    draft.key_points = uniqueClaims(drafts.flatMap((d) => d.key_points));
    run.output.validationVersion = pointer
      ? "pointer-evidence.v1"
      : "caption-alignment.v2";
    /**
     * With pointer evidence the quote was copied here, so anchoring has
     * nothing to search for and the string match is an assertion: a mismatch
     * is a warning on the run, not a rejected claim.
     */
    const warnings = [...((run.output.warnings || []) as string[])];
    const checked = (claim: ClaimData, prefix: string, i: number) => {
      const anchored = pointer ? claim : anchorClaimEvidence(claim, source);
      return {
        id: `${prefix}${i + 1}`,
        claim: anchored,
        passed: false,
        reasons: validateClaim(anchored, source, warnings),
      };
    };
    run.output.claims = draft.claims.map((c, i) => checked(c, "c", i));
    run.output.keyPoints = draft.key_points.map((c, i) => checked(c, "k", i));
    if (warnings.length) run.output.warnings = warnings;
    run.output.auditIndex = 0;
    run.stage = "critique";
  } else if (run.stage === "critique") {
    const claims = [
      ...(run.output.claims as CheckedClaim[]),
      ...((run.output.keyPoints || []) as CheckedClaim[]),
    ];
    const i = Number(run.output.auditIndex || 0);
    if (i >= claims.length) {
      run.stage = "publish";
      return;
    }
    const item = claims[i];
    if (!item.reasons.length) {
      const audit = z
        .object({
          verdict: z.enum(["accept", "reject"]),
          reason_en: z.string().min(1),
          unsupported_fields: z.array(z.string()),
          requires_audio_review: z.boolean(),
        })
        .parse(
          await modelCall(
            run,
            `critique-${i}`,
            String(run.input.criticModel || run.model),
            prompts.critique +
              (item.id.startsWith("k")
                ? "\nThis is a contextual key point. It need not recommend a trade. Audit evidence, attribution and meaning; do not reject solely for absence of an action."
                : ""),
            {
              claim: item.claim,
              source: auditSource(run.output.source as SourceData, item.claim),
              otherDrafts: claims.map((c) => ({
                thesis: c.claim.thesis_en,
                stance: c.claim.stance,
                horizon: c.claim.horizon_en,
              })),
            },
          ),
        );
      item.audit = audit;
      item.passed =
        audit.verdict === "accept" &&
        audit.unsupported_fields.length === 0 &&
        !audit.requires_audio_review;
      if (!item.passed) item.reasons.push(audit.reason_en);
    }
    run.output.auditIndex = i + 1;
  } else if (run.stage === "publish") {
    run.status = "completed";
    run.stage = "complete";
    run.output.limitations = [
      "Quotes checked against retained text; audio and timestamp accuracy have not been independently verified.",
      "Model critique is not human verification.",
      ...(Number(run.output.chunkCount) > 1
        ? [
            "Long transcripts are extracted in overlapping chronological chunks. Large-source critiques use cited segments and their surrounding context; review cross-section qualifications.",
          ]
        : []),
    ];
  } else throw Error("Unknown processing stage.");
}
