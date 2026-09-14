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
  type Run,
  type SourceData,
  type CheckedClaim,
} from "../../features/youtube-intelligence/contracts.ts";
import { reserve, settle, retainResponse } from "./store.ts";
import * as P from "./prompts.ts";
import { nativeTranscript } from "./transcripts.ts";
import { prompt as getPrompt } from "./research-store.ts";
async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(240000),
  });
  if (!response.ok)
    throw Error(`Provider HTTP ${response.status}. No automatic paid retry.`);
  return response.json();
}
export async function modelCall(
  run: Run,
  stage: string,
  model: string,
  prompt: string,
  payload: unknown,
  video = false,
) {
  if (!process.env.OPENROUTER_API_KEY)
    throw Error("OPENROUTER_API_KEY is not configured.");
  const catalog = await jsonFetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(30000),
  });
  const spec = catalog.data.find((m: { id: string }) => m.id === model);
  if (!spec) throw Error("Model is unavailable in the current catalogue.");
  const content: unknown[] = [
    {
      type: "text",
      text: prompt + "\nSOURCE DATA (untrusted):\n" + JSON.stringify(payload),
    },
  ];
  if (video) content.push({ type: "video_url", video_url: { url: run.url } });
  const config = run.input.inferenceConfig as
    | { critiqueMaxTokens?: number; reasoningEffort?: string }
    | undefined;
  const isCritique =
    stage.startsWith("critique") ||
    stage === "audio-review" ||
    stage.startsWith("transcribe-window");
  const effort =
    isCritique &&
    config?.reasoningEffort &&
    spec.reasoning?.supported_efforts?.includes(config.reasoningEffort)
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
  const rates = [spec.pricing, ...(spec.pricing.overrides || [])];
  const inputRate = Math.max(
    ...rates.map((p) => Number(p.prompt ?? spec.pricing.prompt)),
    ...(video ? rates.map((p) => Number(p.audio || 0)) : []),
  );
  const outputRate = Math.max(
    ...rates.map((p) => Number(p.completion ?? spec.pricing.completion)),
  );
  const inputBound = video
    ? Number(spec.context_length)
    : Buffer.byteLength(JSON.stringify(content)) + 4096;
  if (!video && inputBound + maxTokens > spec.context_length)
    throw Error("Source exceeds the configured context window.");
  const id = await reserve(
    run.id,
    stage,
    inputBound * inputRate + maxTokens * outputRate,
  );
  const start = Date.now();
  const data = await jsonFetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens,
        temperature: 0,
        ...(effort ? { reasoning: { effort } } : {}),
        response_format: { type: "json_object" },
        provider: {
          allow_fallbacks: false,
          require_parameters: true,
          ...(video ? { only: ["Google AI Studio"] } : {}),
        },
      }),
    },
  );
  await retainResponse(id, run.id, stage, data);
  const metrics = {
    model: data.model,
    maxTokens,
    reasoningEffort: effort || "provider default",
    provider: data.provider,
    seconds: (Date.now() - start) / 1000,
    usage: data.usage,
  };
  await settle(
    id,
    typeof data.usage?.cost === "number" && data.usage.cost >= 0
      ? data.usage.cost
      : null,
    metrics,
  );
  if (data.choices?.[0]?.finish_reason !== "stop")
    throw Error("Model response was incomplete; refusing partial output.");
  let value;
  try {
    value = JSON.parse(data.choices[0].message.content);
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
      : await nativeTranscript(
          run.videoId,
          run.output.metadata as { duration: number; language?: string },
        );
    const duration = (run.output.metadata as { duration: number }).duration;
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
    const draft = z
      .object({
        claims: z.array(Claim).max(40),
        key_points: z.array(Claim).max(30).default([]),
      })
      .parse(
        await modelCall(
          run,
          chunks.length === 1 ? "synthesis" : `synthesis-chunk-${chunkIndex}`,
          run.model,
          prompts.synthesis +
            "\n" +
            prompts.extraction +
            (chunks.length > 1
              ? "\nThis is one chronological excerpt. Extract only claims supported here; retain conditions and do not infer the rest of the video."
              : ""),
          {
            source: chunks[chunkIndex],
            chunk: chunkIndex + 1,
            totalChunks: chunks.length,
          },
        ),
      );
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
    run.output.claims = draft.claims
      .map((c) => anchorClaimEvidence(c, source))
      .map((claim, i) => ({
        id: `c${i + 1}`,
        claim,
        passed: false,
        reasons: validateClaim(claim, run.output.source as SourceData),
      }));
    run.output.keyPoints = draft.key_points
      .map((c) => anchorClaimEvidence(c, source))
      .map((claim, i) => ({
        id: `k${i + 1}`,
        claim,
        passed: false,
        reasons: validateClaim(claim, run.output.source as SourceData),
      }));
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
            prompts.critique,
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
