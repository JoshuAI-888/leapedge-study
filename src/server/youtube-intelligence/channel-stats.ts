import { z } from "zod";
import { database, iso } from "./database.ts";
import { listChannels } from "./repos/channels.ts";
import { CANONICAL } from "./repos/research-query.ts";
import {
  ACTIVITY_WINDOW_DAYS,
  LEAN_WINDOW_DAYS,
  SILENT_AFTER_DAYS,
  type ChannelStat,
} from "../../features/youtube-intelligence/channel-list.ts";
import { sentimentOf } from "../../features/youtube-intelligence/ui/foundations.ts";

/**
 * Per followed channel figures for the Channels table (F67). Everything is
 * computed from stored rows when asked, never stored:
 *
 * - activity comes from video analyses (runs without a `task`), each tied to
 *   its channel by its calls, then its discovery row, then its metadata —
 *   the same order the research query API uses;
 * - lean and top instrument come from calls of canonical analyses published
 *   in the last 30 days, so a re-analysed video counts once;
 * - "silent" needs evidence: the newest known upload (discovered or
 *   analysed) at least 14 days old. A channel with no upload data is idle.
 *
 * The record column is the leaderboard's creator row, which the page already
 * reads with the viewer's benchmark and horizon; it is joined there.
 */
export const ChannelStatsInput = z.preprocess(
  (v) => v ?? {},
  z.strictObject({ now: z.iso.datetime({ offset: true }).optional() }),
);
const DAY = 86_400_000;

type RunRow = {
  id: string;
  video_id: string;
  status: string;
  created_at: string;
  channel_id: string | null;
};

export async function channelStats(input: unknown = {}): Promise<ChannelStat[]> {
  const { now = new Date().toISOString() } = ChannelStatsInput.parse(input);
  const end = Date.parse(now);
  const followed = (await listChannels()).filter((c) => c.active);
  if (!followed.length) return [];
  const ids = followed.map((c) => c.id);

  const runs = (await database
    .prepare(
      `SELECT * FROM (
        SELECT r.id, r.video_id, r.status, r.created_at,
          COALESCE(
            (SELECT x.channel_id FROM claims x WHERE x.run_id=r.id AND x.channel_id IS NOT NULL LIMIT 1),
            (SELECT d.channel_id FROM yi_discoveries d WHERE d.video_id=r.video_id),
            (r.output::jsonb->'metadata'->>'channelId')) AS channel_id
        FROM yi_runs r
        WHERE (r.input::jsonb->>'task') IS NULL
          AND r.status IN ('queued','running','completed')
      ) v WHERE v.channel_id = ANY($1::text[])`,
    )
    .all(ids)) as RunRow[];

  const leanFrom = new Date(end - LEAN_WINDOW_DAYS * DAY).toISOString();
  const calls = (await database
    .prepare(
      `WITH canon AS MATERIALIZED (${CANONICAL})
       SELECT channel_id, ticker, instrument, stance FROM claims
       WHERE channel_id = ANY($1::text[])
         AND run_id IN (SELECT id FROM canon)
         AND COALESCE(published_at, created_at) > $2::timestamptz
         AND COALESCE(published_at, created_at) <= $3::timestamptz`,
    )
    .all(ids, leanFrom, new Date(end).toISOString())) as {
    channel_id: string;
    ticker: string | null;
    instrument: string | null;
    stance: string;
  }[];

  const uploads = (await database
    .prepare(
      // Newest upload per channel, from both sources; compared as instants below.
      `SELECT channel_id, max(payload::jsonb->>'publishedAt') AS at FROM yi_discoveries
         WHERE channel_id = ANY($1::text[]) AND (payload::jsonb->>'publishedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         GROUP BY channel_id
       UNION ALL
       SELECT channel_id, max(published_at)::text AS at FROM claims
         WHERE channel_id = ANY($1::text[]) AND published_at IS NOT NULL
         GROUP BY channel_id`,
    )
    .all(ids)) as { channel_id: string; at: string | null }[];

  return followed.map((c): ChannelStat => {
    const mine = runs.filter((r) => r.channel_id === c.id);
    const done = mine
      .filter((r) => r.status === "completed" && Date.parse(r.created_at) <= end)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const active = mine.filter((r) => r.status === "queued" || r.status === "running").length;
    const recent = new Set(
      done
        .filter((r) => Date.parse(r.created_at) > end - ACTIVITY_WINDOW_DAYS * DAY)
        .map((r) => r.video_id),
    );
    const own = calls.filter((x) => x.channel_id === c.id);
    const lean = { bullish: 0, neutral: 0, bearish: 0 };
    const byInstrument = new Map<string, { ticker: string | null; instrument: string | null; calls: number }>();
    for (const x of own) {
      lean[sentimentOf(x.stance)]++;
      const key = x.ticker ?? x.instrument;
      if (!key) continue;
      const entry = byInstrument.get(key) ?? { ticker: x.ticker, instrument: x.instrument, calls: 0 };
      entry.calls++;
      byInstrument.set(key, entry);
    }
    const top =
      [...byInstrument.entries()].sort(
        (a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]),
      )[0]?.[1] ?? null;
    const newest = uploads
      .filter((u) => u.channel_id === c.id && u.at !== null)
      .map((u) => Date.parse(String(u.at)))
      .filter((t) => Number.isFinite(t) && t <= end)
      .sort((a, b) => b - a)[0];
    const lastUploadAt = newest === undefined ? null : new Date(newest).toISOString();
    const silentDays =
      lastUploadAt === null
        ? null
        : Math.max(0, Math.floor((end - Date.parse(lastUploadAt)) / DAY));
    return {
      channelId: c.id,
      title: c.title,
      handle: c.handle,
      followedAt: c.followedAt,
      favorite: c.favorite,
      status:
        active > 0
          ? "analysing"
          : silentDays !== null && silentDays >= SILENT_AFTER_DAYS
            ? "silent"
            : "idle",
      activeRuns: active,
      lastUploadAt,
      silentDays,
      lastAnalysedAt: done[0] ? iso(done[0].created_at) : null,
      lastRunId: done[0]?.id ?? null,
      videos7d: recent.size,
      calls30d: own.length,
      topInstrument: top,
      lean,
    };
  });
}
