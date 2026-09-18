import { z } from "zod";
import * as R from "../research-store.ts";
import { queueAudioReview } from "../audio-review.ts";
import { startExperiment } from "../experiments.ts";
import { managedTranscript, SourcePending } from "../transcripts.ts";
import { MODELS } from "../../../features/youtube-intelligence/contracts.ts";
import { writes, type ActionTable } from "./types.ts";
const CaptionProbe = z.strictObject({
  videoId: z.string().regex(/^[\w-]{11}$/),
  provider: z.enum(["supadata", "transcriptapi"]),
  language: z
    .string()
    .regex(/^[a-zA-Z-]{2,12}$/)
    .optional(),
});
async function captionProbe(v: z.output<typeof CaptionProbe>) {
  try {
    const source = await managedTranscript(v.videoId, v.provider, {
      language: v.language,
    });
    const attempt = await R.doc<{
      status: string;
      http?: number;
      providerError?: string;
    }>(
      "managedCaptionAttempt",
      `${v.provider}:native:${v.videoId}:${v.language?.split("-")[0] || "original"}`,
    );
    return {
      provider: v.provider,
      providerHttp: attempt?.http,
      providerError: attempt?.providerError,
      videoId: v.videoId,
      status: source ? "completed" : attempt?.status || "unavailable",
      sourceKind: source?.source_kind,
      language: source?.language,
      segments: source?.segments.length,
      lastEnd: source
        ? Math.max(...source.segments.map((s) => s.end_seconds || 0))
        : null,
      runtime: process.env.VERCEL ? "vercel" : "local",
    };
  } catch (e) {
    if (e instanceof SourcePending)
      return { status: "pending", videoId: v.videoId, provider: v.provider };
    throw e;
  }
}
export const runs: ActionTable = {
  captionProbe: writes(CaptionProbe, captionProbe),
  audioReview: writes(z.string(), (id) => queueAudioReview(id)),
  experiment: writes(
    z.strictObject({
      baselineId: z.string(),
      hypothesis: z.string().min(10).max(3000),
      variants: z
        .array(
          z.strictObject({
            model: z.enum(MODELS),
            criticModel: z.enum(MODELS),
            promptVersion: z.string(),
          }),
        )
        .min(2)
        .max(4),
    }),
    (v) => startExperiment(v),
  ),
  recoverAudit: writes(z.string(), (id) => R.continueAfterAuditFailure(id)),
  publishRun: writes(z.string(), (id) => R.publishRun(id)),
};
