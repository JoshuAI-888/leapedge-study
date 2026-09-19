import { z } from "zod";
import { database, json, advisoryKey } from "./database.ts";
import { doc, put, queue, teamPreferences } from "./research-store.ts";
import { listChannels } from "./repos/channels.ts";
import { backfillChannel } from "./channels.ts";
export function durationSeconds(value: string) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
    value,
  );
  if (!m) return null;
  const n =
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0);
  return n > 0 ? n : null;
}
export function replayEligibility(input: {
  tier: string | null;
  publishedAt: string;
  followedAt: string | null;
  durationSeconds: number | null;
  title: string;
  from: string;
}) {
  if (!["1", "tier1"].includes(input.tier ?? ""))
    return "Only Tier 1 channels are selected.";
  if (!input.followedAt || !Number.isFinite(Date.parse(input.followedAt)))
    return "A real follow date is required.";
  const published = Date.parse(input.publishedAt);
  if (!Number.isFinite(published) || published < Date.parse(input.from))
    return "Outside the replay window.";
  if (published >= Date.parse(input.followedAt))
    return "Published on or after the follow date; use forward processing.";
  if (input.durationSeconds === null)
    return "Missing duration; review before replay.";
  // The API has no definitive Shorts flag. Conservatively exclude all videos
  // up to three minutes and explicit Shorts labels; never claim perfect detection.
  if (input.durationSeconds <= 180 || /#shorts\b/i.test(input.title))
    return "Short or short-form candidate excluded.";
  return null;
}
const VideoMetadata = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{11}$/),
        contentDetails: z.object({ duration: z.string() }),
        snippet: z.object({
          title: z.string(),
          publishedAt: z.string(),
          channelId: z.string(),
        }),
      }),
    )
    .default([]),
});
async function durations(ids: string[]) {
  if (!process.env.YOUTUBE_API_KEY)
    throw Error("YOUTUBE_API_KEY is not configured.");
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "contentDetails,snippet", id: ids.join(",") })}`,
    {
      headers: { "X-Goog-Api-Key": process.env.YOUTUBE_API_KEY },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw Error(`YouTube replay metadata HTTP ${response.status}.`);
  return VideoMetadata.parse(await response.json()).items;
}
export const ReplayRequest = z.strictObject({
  channelIds: z
    .array(z.string().regex(/^UC[\w-]{22}$/))
    .max(100)
    .optional(),
  maxVideos: z.number().int().min(1).max(50).default(5),
  pagesPerChannel: z.number().int().min(0).max(3).default(1),
});
export async function replayHistorical(input: unknown) {
  const request = ReplayRequest.parse(input),
    settings = await teamPreferences();
  const channels = (await listChannels()).filter(
    (c) =>
      c.active &&
      ["tier1", "1"].includes(c.tier ?? "") &&
      (!request.channelIds || request.channelIds.includes(c.id)),
  );
  const queued: { videoId: string; runId: string }[] = [],
    skipped: { videoId: string; reason: string }[] = [];
  for (const channel of channels) {
    if (queued.length >= request.maxVideos) break;
    if (request.pagesPerChannel > 0 && channel.uploads)
      await backfillChannel({ id: channel.id, pages: request.pagesPerChannel });
    const rows = await database
      .prepare(
        "SELECT video_id,payload FROM yi_discoveries WHERE channel_id=$1 ORDER BY discovered_at,video_id",
      )
      .all(channel.id);
    const candidates = rows.filter((r) => {
      const p = json(r.payload) as { publishedAt?: string };
      return (
        p.publishedAt &&
        p.publishedAt >= settings.channels.historicalReplay.from &&
        p.publishedAt < (channel.followedAt ?? "")
      );
    });
    for (
      let offset = 0;
      offset < candidates.length && queued.length < request.maxVideos;
      offset += 50
    ) {
      const ids = candidates
        .slice(offset, offset + 50)
        .map((r) => String(r.video_id));
      if (!ids.length) continue;
      const metadata = await durations(ids);
      const byId = new Map(metadata.map((v) => [v.id, v]));
      for (const id of ids) {
        if (queued.length >= request.maxVideos) break;
        const m = byId.get(id);
        const reason =
          m && m.snippet.channelId === channel.id
            ? replayEligibility({
                tier: channel.tier,
                publishedAt: m.snippet.publishedAt,
                followedAt: channel.followedAt,
                durationSeconds: durationSeconds(m.contentDetails.duration),
                title: m.snippet.title,
                from: settings.channels.historicalReplay.from,
              })
            : "Video metadata missing or channel mismatch.";
        if (reason) {
          skipped.push({ videoId: id, reason });
          continue;
        }
        const runId = await database.transaction(async () => {
          await database
            .prepare("SELECT pg_advisory_xact_lock($1::bigint)")
            .get(advisoryKey(`replay:${id}`));
          const prior = await doc<{ runId: string }>("historicalReplay", id);
          if (prior?.runId) return null;
          const run = await queue(id, undefined, undefined, false, {
            origin: "channel",
            record: "historical",
            processingMode: "batch",
          });
          await put("historicalReplay", id, {
            videoId: id,
            runId: run.id,
            channelId: channel.id,
            record: "historical",
            sourcePublishedAt: m!.snippet.publishedAt,
            queuedAt: new Date().toISOString(),
          });
          return run.id;
        });
        if (runId) queued.push({ videoId: id, runId });
        else
          skipped.push({
            videoId: id,
            reason: "Already included in historical replay.",
          });
      }
    }
  }
  return {
    queued,
    skipped,
    record: "historical",
    message:
      "Historical replay is retrospective, not a forward performance record. Repeat this bounded action to continue; saved playlist cursors and replay IDs prevent duplicates.",
  };
}
