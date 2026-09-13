import { z } from "zod";
import { doc, docs, put, researchDB, queue } from "./research-store.ts";
export type Channel = {
  id: string;
  title: string;
  handle: string;
  uploads: string;
  active: boolean;
  favorite: boolean;
  autoAnalyze: boolean;
  createdAt: string;
  lastPull: string | null;
  lastAttempt?: string;
  nextPullAt?: string;
  nextPageToken?: string | null;
  error: string | null;
};
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
  const old = await doc<Channel>("channel", c.id);
  return (await put("channel", c.id, {
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl || "",
    uploads: c.contentDetails.relatedPlaylists.uploads,
    active: true,
    favorite: old?.favorite || false,
    autoAnalyze: old?.autoAnalyze || false,
    createdAt: old?.createdAt || new Date().toISOString(),
    lastPull: old?.lastPull || null,
    error: null,
  })) as Channel;
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
    c = await doc<Channel>("channel", p.id);
  if (!c) throw Error("Channel not found.");
  return await put("channel", p.id, { ...c, ...p });
}
export async function pull(id: string, older = false) {
  const c = await doc<Channel>("channel", id);
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
        .prepare("INSERT OR IGNORE INTO yi_discoveries VALUES(?,?,?,?,NULL)")
        .run(videoId, id, JSON.stringify(payload), new Date().toISOString());
      added += Number(r.changes);
    }
    await put("channel", id, {
      ...c,
      lastPull: new Date().toISOString(),
      lastAttempt: attempt,
      nextPullAt: new Date(Date.now() + 3600000).toISOString(),
      nextPageToken: data.nextPageToken || null,
      error: null,
    });
    return {
      added,
      window: data.nextPageToken
        ? "More uploads available. Load the next page without running analysis."
        : "End of available uploads.",
    };
  } catch (e) {
    await put("channel", id, {
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
      .prepare("SELECT * FROM yi_discoveries WHERE video_id=?")
      .get(id);
  if (!v) throw Error("Upload not found.");
  if (v.run_id) return { id: v.run_id };
  const run = await queue(id);
  await d
    .prepare(
      "UPDATE yi_discoveries SET run_id=? WHERE video_id=? AND run_id IS NULL",
    )
    .run(run.id, id);
  return run;
}
export async function pullDue() {
  for (const c of (await docs<Channel>("channel"))
    .filter(
      (c) =>
        c.active && (!c.nextPullAt || Date.parse(c.nextPullAt) <= Date.now()),
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
              "SELECT * FROM yi_discoveries WHERE channel_id=? AND run_id IS NULL ORDER BY discovered_at DESC",
            )
            .all(c.id)
        )
          .filter(
            (v) =>
              Date.parse(JSON.parse(String(v.payload)).publishedAt) >=
              Date.parse(c.createdAt),
          )
          .slice(0, 3);
        for (const x of v) await analyzeDiscovery(String(x.video_id));
      }
    } catch {
      /* Error persisted on channel; retry next scheduled sweep. */
    }
  }
}
