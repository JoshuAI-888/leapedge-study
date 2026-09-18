import { z } from "zod";
import { doc, put, researchDB, queue } from "./research-store.ts";
import { json } from "./database.ts";
import {
  getChannel,
  listChannels,
  upsertChannel,
  type ChannelRow,
} from "./repos/channels.ts";
/**
 * The `channels` table is where a channel lives (F28). Every read and write
 * below goes through repos/channels.ts, and no `channel` document is written
 * any more: the only reader the document had left was
 * scripts/migrate-documents.ts, which moves what an earlier build already
 * stored and keeps working on exactly that.
 */
export type Channel = ChannelRow;
export function channelQuery(raw: string): Record<string, string> {
  let text = raw.trim();
  if (text.startsWith("http")) {
    const u = new URL(text);
    if (
      !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
        u.hostname,
      ) ||
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password
    )
      throw Error("Use a YouTube channel URL.");
    text = decodeURIComponent(u.pathname)
      .replace(/^\//, "")
      .replace(/\/(videos|featured|streams|shorts)\/?$/, "");
    if (text.startsWith("channel/")) text = text.slice(8);
  }
  if (/^UC[\w-]{22}$/.test(text)) return { id: text };
  if (/^@[^/?#\s]{2,100}$/.test(text)) return { forHandle: text };
  throw Error("Use a channel ID, @handle, or channel URL.");
}
async function youtube(endpoint: string, params: Record<string, string>) {
  if (!process.env.YOUTUBE_API_KEY)
    throw Error("YouTube key is not configured.");
  const r = await fetch(
    `https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams(params)}`,
    {
      headers: { "X-Goog-Api-Key": process.env.YOUTUBE_API_KEY },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw Error(`YouTube metadata HTTP ${r.status}.`);
  return r.json();
}
export async function follow(raw: string) {
  const q = channelQuery(raw),
    data = await youtube("channels", { part: "snippet,contentDetails", ...q }),
    c = data.items?.[0];
  if (!c?.contentDetails?.relatedPlaylists?.uploads)
    throw Error("Channel not found.");
  const old = await getChannel(c.id);
  await upsertChannel({
    ...old,
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl || old?.handle || "",
    uploads: c.contentDetails.relatedPlaylists.uploads,
    active: true,
    favorite: old?.favorite || false,
    // Following a channel does not buy anything: automatic analysis stays
    // whatever it was, which for a channel nobody has chosen is off.
    autoAnalyze: old?.autoAnalyze || false,
    createdAt: old?.createdAt || new Date().toISOString(),
    lastPull: old?.lastPull || null,
    error: null,
  });
  return (await getChannel(c.id))!;
}
export async function updateChannel(input: unknown) {
  const p = z
      .object({
        id: z.string(),
        active: z.boolean().optional(),
        favorite: z.boolean().optional(),
        autoAnalyze: z.boolean().optional(),
      })
      .parse(input),
    c = await getChannel(p.id);
  if (!c) throw Error("Channel not found.");
  // autoAnalyze is the spending switch and is changed here one channel at a
  // time, by a person. Nothing that turns discovery on may set it in bulk.
  await upsertChannel({ ...c, ...p });
  return (await getChannel(p.id))!;
}
export async function pull(id: string, older = false) {
  const c = await getChannel(id);
  if (!c?.active) throw Error("Channel is not followed.");
  if (older && !c.nextPageToken)
    throw Error("No older page is available. Discover latest uploads first.");
  const attempt = new Date().toISOString();
  try {
    const data = await youtube("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: c.uploads,
      maxResults: "50",
      ...(older ? { pageToken: c.nextPageToken! } : {}),
    });
    let added = 0;
    for (const v of data.items || []) {
      const videoId = v.contentDetails?.videoId;
      if (!/^[\w-]{11}$/.test(videoId || "")) continue;
      const payload = {
        title: v.snippet.title,
        videoId,
        channelId: id,
        publishedAt: v.contentDetails.videoPublishedAt || v.snippet.publishedAt,
      };
      const r = await (
        await researchDB()
      )
        .prepare(
          "INSERT INTO yi_discoveries(video_id,channel_id,payload,discovered_at,run_id) VALUES($1,$2,$3,$4,NULL) ON CONFLICT DO NOTHING",
        )
        .run(videoId, id, JSON.stringify(payload), new Date().toISOString());
      added += Number(r.changes);
    }
    await upsertChannel({
      ...c,
      lastPull: new Date().toISOString(),
      lastAttempt: attempt,
      nextPullAt: new Date(Date.now() + 3600000).toISOString(),
      nextPageToken:
        older || !c.historyStarted
          ? data.nextPageToken || null
          : c.nextPageToken,
      historyStarted: true,
      error: null,
    });
    return {
      added,
      window: data.nextPageToken
        ? "More uploads available. Load the next page without running analysis."
        : "End of available uploads.",
    };
  } catch (e) {
    await upsertChannel({
      ...c,
      lastAttempt: attempt,
      nextPullAt: new Date(Date.now() + 3600000).toISOString(),
      error: e instanceof Error ? e.message : "Channel pull failed",
    });
    throw e;
  }
}
export async function analyzeDiscovery(id: string) {
  const d = await researchDB(),
    v = await d
      .prepare("SELECT * FROM yi_discoveries WHERE video_id=$1")
      .get(id);
  if (!v) throw Error("Upload not found.");
  if (v.run_id) return { id: v.run_id };
  const run = await queue(id);
  await d
    .prepare(
      "UPDATE yi_discoveries SET run_id=$1 WHERE video_id=$2 AND run_id IS NULL",
    )
    .run(run.id, id);
  return run;
}
export async function pullDue() {
  for (const c of (await listChannels())
    .filter(
      (c) =>
        // A seeded channel has no uploads playlist until somebody follows it
        // and the API resolves one, so discovery skips it rather than failing
        // on it every sweep.
        c.active &&
        !!c.uploads &&
        (!c.nextPullAt || Date.parse(c.nextPullAt) <= Date.now()),
    )
    .slice(0, 3)) {
    if (c.lastPull && Date.now() - Date.parse(c.lastPull) < 3600000) continue;
    try {
      await pull(c.id);
      if (c.autoAnalyze) {
        const v = (
          await (
            await researchDB()
          )
            .prepare(
              "SELECT * FROM yi_discoveries WHERE channel_id=$1 AND run_id IS NULL ORDER BY discovered_at DESC",
            )
            .all(c.id)
        )
          .filter(
            (v) =>
              Date.parse(
                (json(v.payload) as { publishedAt: string }).publishedAt,
              ) >= Date.parse(c.followedAt ?? c.createdAt ?? ""),
          )
          .slice(0, 3);
        for (const x of v) await analyzeDiscovery(String(x.video_id));
      }
    } catch {
      /* Error persisted on channel; retry next scheduled sweep. */
    }
  }
}

export async function discoverChannels(input: unknown) {
  const q = z
    .object({
      query: z.string().trim().min(3).max(150),
      language: z.enum(["en", "zh-Hans", "zh-Hant"]).default("en"),
    })
    .parse(input);
  const cacheId = `${q.language}:${q.query.toLowerCase()}`;
  const cached = await doc<{ at: string; items: unknown[] }>(
    "channelSearch",
    cacheId,
  );
  if (cached && Date.now() - Date.parse(cached.at) < 86400000)
    return { items: cached.items, cached: true };
  const result = await youtube("search", {
    part: "snippet",
    type: "video",
    q: q.query,
    maxResults: "20",
    relevanceLanguage: q.language,
    order: "relevance",
  });
  const candidates = new Map<
    string,
    {
      id: string;
      sourceTitle: string;
      query: string;
      language: string;
      examples: { videoId: string; sourceTitle: string }[];
      at: string;
      reasonEn: string;
    }
  >();
  for (const v of result.items || []) {
    const id = v.snippet?.channelId,
      videoId = v.id?.videoId;
    if (!/^UC[\w-]{22}$/.test(id || "") || !/^[\w-]{11}$/.test(videoId || ""))
      continue;
    const c = candidates.get(id) || {
      id,
      sourceTitle: v.snippet.channelTitle,
      query: q.query,
      language: q.language,
      examples: [] as { videoId: string; sourceTitle: string }[],
      at: new Date().toISOString(),
      reasonEn:
        "Found through your investment search. Relevance and research quality require review; this is not a performance endorsement.",
    };
    c.examples.push({ videoId, sourceTitle: v.snippet.title });
    candidates.set(id, c);
  }
  for (const c of candidates.values()) await put("channelCandidate", c.id, c);
  const items = [...candidates.values()];
  await put("channelSearch", cacheId, { at: new Date().toISOString(), items });
  return { items, cached: false };
}

export async function backfillChannel(input: unknown) {
  const spec = z
    .object({ id: z.string().min(1), pages: z.number().int().min(1).max(3) })
    .parse(input);
  let added = 0,
    pages = 0;
  for (let i = 0; i < spec.pages; i++) {
    const c = await getChannel(spec.id);
    if (!c?.active) throw Error("Channel is not followed.");
    if (c.historyStarted && !c.nextPageToken) break;
    const result = await pull(c.id, !!c.historyStarted);
    added += result.added;
    pages++;
  }
  return {
    added,
    pages,
    message:
      "Metadata only. Analysis requires a separate action. Continue from the saved cursor for more history.",
  };
}
