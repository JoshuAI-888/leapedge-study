// Lab only (spec 12): another model's opinion, never a trust input or a pipeline stage — queueAudioReview runs solely from the explicit "audioReview" action.
import { z } from "zod";
import { create, get } from "./store.ts";
import { put, preferences } from "./research-store.ts";
import { modelCall } from "./pipeline.ts";
import type {
  Run,
  CheckedClaim,
  SourceData,
} from "../../features/youtube-intelligence/contracts.ts";
const AudioResult = z.object({
  video_accessible: z.boolean(),
  verdicts: z.array(
    z.object({
      id: z.string(),
      quote_matches_audio: z.boolean(),
      timestamp_supported: z.boolean(),
      thesis_supported: z.boolean(),
      heard_quote_original: z.string(),
      actual_start_seconds: z.number().nonnegative().nullable(),
      reason_en: z.string(),
    }),
  ),
});
export function normalizeAudioReview(value: unknown) {
  const r = AudioResult.parse(value);
  return {
    ...r,
    verdicts: r.verdicts.map((v) => ({
      ...v,
      review_status:
        r.video_accessible &&
        v.reason_en.trim() &&
        v.heard_quote_original.trim() &&
        v.actual_start_seconds !== null &&
        v.quote_matches_audio &&
        v.timestamp_supported &&
        v.thesis_supported
          ? "model_supported"
          : "needs_review",
      reason_en:
        v.reason_en.trim() ||
        "Provider returned no explanation; manual review required.",
    })),
  };
}
/**
 * Queue one Lab audio review of an already completed analysis. Nothing in the
 * pipeline or the trust computation calls this: the only caller is the
 * explicit `audioReview` action on the research route, and the run it creates
 * carries `experiment: true` so its cost is never attributed to the analysis.
 */
export async function queueAudioReview(id: string) {
  const run = await get(id);
  if (!run || run.status !== "completed" || run.input.task)
    throw Error("Choose a completed video analysis.");
  const p = await preferences();
  return create(
    run.videoId,
    p.criticModel,
    {
      task: "audio-review",
      baseline: run,
      experiment: true,
      pipelineVersion: "audio-review.v2",
      inferenceConfig: { critiqueMaxTokens: 12000, reasoningEffort: "low" },
    },
    run.promptVersion,
  );
}
export async function audioReviewStep(run: Run) {
  const base = run.input.baseline as Run;
  const source = base.output.source as SourceData;
  const samples = [
    ...((base.output.claims || []) as CheckedClaim[]),
    ...((base.output.keyPoints || []) as CheckedClaim[]),
  ]
    .filter((c) => c.passed)
    .slice(0, 8)
    .map((c) => ({
      id: c.id,
      thesis: c.claim.thesis_en,
      levels: c.claim.levels,
      evidence: c.claim.evidence.map((e) => ({
        ...e,
        segment: source.segments.find((s) => s.id === e.segment_id),
      })),
    }));
  if (!samples.length)
    throw Error("No accepted evidence available for audio review.");
  const result = normalizeAudioReview(
    await modelCall(
      run,
      "audio-review",
      run.model,
      "Independently examine the supplied YouTube video audio. The transcript and draft may be wrong; never assume they are ground truth. Navigate to every cited moment and compare the actual speech, original-language quote, timestamp, numeric role and English thesis. Quote what you actually hear verbatim. If audio is inaccessible or a timestamp cannot be checked, mark the relevant booleans false. Do not infer ETF tickers from indexes or an entry from a stop. Return JSON {video_accessible:boolean,verdicts:[{id,quote_matches_audio:boolean,timestamp_supported:boolean,thesis_supported:boolean,heard_quote_original:string,actual_start_seconds:number|null,reason_en:string}]}, one verdict per supplied ID.",
      { samples },
      true,
    ),
  );
  if (
    result.verdicts.length !== samples.length ||
    new Set(result.verdicts.map((v) => v.id)).size !== samples.length ||
    result.verdicts.some((v) => !samples.some((s) => s.id === v.id))
  )
    throw Error("Audio audit omitted or duplicated evidence.");
  const record = {
    id: run.id,
    baselineId: base.id,
    videoId: base.videoId,
    at: new Date().toISOString(),
    model: run.model,
    sourceHash: base.output.sourceHash,
    ...result,
    limitation:
      "Independent multimodal model review, not human listening or a guarantee of audio fidelity.",
  };
  await put("audioReview", run.id, record);
  run.output.audioReview = record;
  run.title = `Audio evidence review: ${base.title}`;
  run.stage = "complete";
  run.status = "completed";
}
