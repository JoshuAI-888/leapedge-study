import { db } from "./store.ts";
import { youtubeJsTranscript } from "./youtubejs.ts";
import { z } from "zod";
import {
  Source,
  type SourceData,
} from "../../features/youtube-intelligence/contracts.ts";
import { doc, put } from "./research-store.ts";
export class SourcePending extends Error {}
const Native = z.object({
  lang: z.string().optional(),
  content: z
    .array(
      z.object({
        text: z.string().min(1),
        offset: z.number().nonnegative(),
        duration: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export function normalizeNative(value: unknown, videoId: string): SourceData {
  const n = Native.parse(value);
  return Source.parse({
    video_id: videoId,
    language: n.lang,
    source_kind: "native_captions_supadata",
    segments: n.content.map((s, i) => ({
      id: `s${String(i + 1).padStart(5, "0")}`,
      text: s.text,
      start_seconds: s.offset / 1000,
      end_seconds: (s.offset + s.duration) / 1000,
    })),
  });
}
export async function nativeTranscript(
  videoId: string,
): Promise<SourceData | null> {
  const cached = await doc<{
    source: SourceData;
  }>("nativeTranscript", videoId);
  if (cached) return cached.source;
  const direct = await youtubeJsTranscript(videoId);
  if (direct) return direct;
  if (!process.env.SUPADATA_API_KEY) return null;
  // Native-only mode never silently purchases generated transcription. A submitted request is recorded before fetch.
  const prior = await doc("transcriptRequest", videoId);
  if (prior?.status === "unavailable") return null;
  if (prior?.status === "pending") {
    const jobId = String(prior.jobId || "");
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(jobId))
      throw Error("Invalid transcript job identifier.");
    if (Date.now() - Date.parse(String(prior.at)) > 50 * 60000)
      throw Error("Transcript job expired; review before resubmitting.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await fetch(
      `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`,
      {
        headers: { "x-api-key": process.env.SUPADATA_API_KEY },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw Error(`Transcript job status HTTP ${response.status}.`);
    const result = await response.json();
    if (result.status === "failed")
      throw Error(
        "Native transcript job failed; review before using fallback.",
      );
    if (result.status !== "completed")
      throw new SourcePending("Waiting for native transcript job.");
    const source = normalizeNative(result.result || result, videoId);
    await put("nativeTranscript", videoId, {
      source,
      fetchedAt: new Date().toISOString(),
    });
    await put("transcriptRequest", videoId, { ...prior, status: "completed" });
    return source;
  }
  if (prior)
    throw Error(
      "Previous transcript request recorded. Review its status before resubmitting.",
    );
  await db().transaction(async () => {
    if (await doc("transcriptRequest", videoId))
      throw new SourcePending(
        "A native transcript request is already recorded; wait for its result.",
      );
    await put("transcriptRequest", videoId, {
      status: "submitted",
      at: new Date().toISOString(),
    });
  });
  const u = new URL("https://api.supadata.ai/v1/transcript");
  u.search = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    text: "false",
    mode: "native",
  }).toString();
  let r: Response;
  try {
    r = await fetch(u, {
      headers: { "x-api-key": process.env.SUPADATA_API_KEY },
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw Error("Transcript request interrupted; status is uncertain.");
  }
  const usage = r.headers.get("x-billable-requests");
  if (r.status === 206) {
    await put("transcriptRequest", videoId, {
      status: "unavailable",
      credits: usage,
    });
    return null;
  }
  if (!r.ok) {
    await put("transcriptRequest", videoId, {
      status: "failed",
      http: r.status,
      credits: usage,
    });
    throw Error(`Transcript provider HTTP ${r.status}.`);
  }
  if (r.status === 202) {
    const job = await r.json();
    await put("transcriptRequest", videoId, {
      status: "pending",
      at: new Date().toISOString(),
      jobId: job.jobId,
      credits: usage,
    });
    throw new SourcePending("Waiting for native transcript job.");
  }
  const source = normalizeNative(await r.json(), videoId);
  await put("nativeTranscript", videoId, {
    source,
    fetchedAt: new Date().toISOString(),
  });
  await put("transcriptRequest", videoId, {
    status: "completed",
    credits: usage,
  });
  return source;
}
