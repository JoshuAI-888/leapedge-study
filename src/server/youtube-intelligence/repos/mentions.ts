import { database, iso } from "../database.ts";
import type { TrustLevel } from "./claims.ts";
/**
 * The only door to the `mentions` table (spec 8). The row id is
 * `<run id>:<positional mention id>`, the same convention the critique and
 * translation stages use, so a republished run rewrites its own rows.
 */
export type MentionRow = {
  id: string;
  runId: string;
  videoId: string;
  channelId: string | null;
  ticker: string | null;
  stance: string;
  sentiment: string;
  isCall: boolean;
  claimId: string | null;
  trustLevel: TrustLevel;
  spanId: string | null;
  publishedAt: string | null;
};
const COLUMNS =
  "id,run_id,video_id,channel_id,ticker,stance,sentiment,is_call,claim_id,trust_level,span_id,published_at";
function convert(r: Record<string, unknown>): MentionRow {
  const trust = String(r.trust_level ?? "L0");
  return {
    id: String(r.id),
    runId: String(r.run_id),
    videoId: String(r.video_id),
    channelId: r.channel_id === null ? null : String(r.channel_id),
    ticker: r.ticker === null ? null : String(r.ticker),
    stance: String(r.stance),
    sentiment: String(r.sentiment),
    isCall: r.is_call === true,
    claimId: r.claim_id === null ? null : String(r.claim_id),
    trustLevel:
      trust === "L1" || trust === "L2" || trust === "L3" ? trust : "L0",
    spanId: r.span_id === null ? null : String(r.span_id),
    publishedAt: iso(r.published_at),
  };
}
export async function upsertMention(mention: MentionRow) {
  const result = await database
    .prepare(
      `INSERT INTO mentions(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO UPDATE SET
         run_id=excluded.run_id,
         video_id=excluded.video_id,
         channel_id=excluded.channel_id,
         ticker=excluded.ticker,
         stance=excluded.stance,
         sentiment=excluded.sentiment,
         is_call=excluded.is_call,
         claim_id=excluded.claim_id,
         trust_level=GREATEST(mentions.trust_level,excluded.trust_level),
         span_id=excluded.span_id,
         published_at=excluded.published_at`,
    )
    .run(
      mention.id,
      mention.runId,
      mention.videoId,
      mention.channelId,
      mention.ticker,
      mention.stance,
      mention.sentiment,
      mention.isCall,
      mention.claimId,
      mention.trustLevel,
      mention.spanId,
      mention.publishedAt,
    );
  return result.changes > 0;
}
export async function mentionsForRun(runId: string): Promise<MentionRow[]> {
  return (
    (await database
      .prepare(`SELECT ${COLUMNS} FROM mentions WHERE run_id=$1 ORDER BY id`)
      .all(runId)) as Record<string, unknown>[]
  ).map(convert);
}
export async function listMentions(limit = 500): Promise<MentionRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM mentions ORDER BY published_at DESC NULLS LAST,id LIMIT $1`,
      )
      .all(limit)) as Record<string, unknown>[]
  ).map(convert);
}
export async function countMentions(): Promise<number> {
  const r = (await database
    .prepare("SELECT COUNT(*) AS n FROM mentions")
    .get()) as { n: unknown };
  return Number(r.n);
}
/** The mention half of the same reconciliation claims.ts performs. */
export async function deleteMentionsForRunExcept(runId: string, keep: string[]) {
  const result = await database
    .prepare("DELETE FROM mentions WHERE run_id=$1 AND id <> ALL($2)")
    .run(runId, keep);
  return result.changes;
}
