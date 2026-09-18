import { database, iso, json } from "../database.ts";
/**
 * The only door to the `claims` table (spec 8). The row id is
 * `<run id>:<claim id within the run>`, so re-publishing a run rewrites the
 * rows it wrote before instead of adding a second set: the primary key is the
 * guard, and no lock is held across the write.
 */
export type TrustLevel = "L0" | "L1" | "L2" | "L3";
export type ClaimRow = {
  id: string;
  runId: string;
  videoId: string;
  channelId: string | null;
  instrument: string | null;
  ticker: string | null;
  tickerExplicit: boolean;
  stance: string;
  thesisEn: string;
  horizonEn: string | null;
  conditionsEn: string[];
  risksEn: string[];
  creatorConviction: string;
  trustLevel: TrustLevel;
  trustBasis: unknown;
  configHash: string | null;
  publishedAt: string | null;
  createdAt: string | null;
};
export type ClaimInput = Omit<ClaimRow, "createdAt"> & { createdAt?: string };
const COLUMNS =
  "id,run_id,video_id,channel_id,instrument,ticker,ticker_explicit,stance,thesis_en,horizon_en,conditions_en,risks_en,creator_conviction,trust_level,trust_basis,config_hash,published_at,created_at";
function strings(value: unknown): string[] {
  const parsed = json(value);
  return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
}
function level(value: unknown): TrustLevel {
  const text = String(value ?? "L0");
  return text === "L1" || text === "L2" || text === "L3" ? text : "L0";
}
function convert(r: Record<string, unknown>): ClaimRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    videoId: String(r.video_id),
    channelId: r.channel_id === null ? null : String(r.channel_id),
    instrument: r.instrument === null ? null : String(r.instrument),
    ticker: r.ticker === null ? null : String(r.ticker),
    tickerExplicit: r.ticker_explicit === true,
    stance: String(r.stance),
    thesisEn: String(r.thesis_en),
    horizonEn: r.horizon_en === null ? null : String(r.horizon_en),
    conditionsEn: strings(r.conditions_en),
    risksEn: strings(r.risks_en),
    creatorConviction: String(r.creator_conviction),
    trustLevel: level(r.trust_level),
    trustBasis: json(r.trust_basis),
    configHash: r.config_hash === null ? null : String(r.config_hash),
    publishedAt: iso(r.published_at),
    createdAt: iso(r.created_at),
  };
}
/**
 * Write one claim. The trust level is never lowered by a rewrite: 4.6 says a
 * recompute may raise it and a human review signs the top of the ladder, so a
 * republished run must not undo either.
 */
export async function upsertClaim(claim: ClaimInput) {
  const result = await database
    .prepare(
      `INSERT INTO claims(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
       ON CONFLICT(id) DO UPDATE SET
         run_id=excluded.run_id,
         video_id=excluded.video_id,
         channel_id=excluded.channel_id,
         instrument=excluded.instrument,
         ticker=excluded.ticker,
         ticker_explicit=excluded.ticker_explicit,
         stance=excluded.stance,
         thesis_en=excluded.thesis_en,
         horizon_en=excluded.horizon_en,
         conditions_en=excluded.conditions_en,
         risks_en=excluded.risks_en,
         creator_conviction=excluded.creator_conviction,
         trust_level=GREATEST(claims.trust_level,excluded.trust_level),
         trust_basis=excluded.trust_basis,
         config_hash=excluded.config_hash,
         published_at=excluded.published_at`,
    )
    .run(
      claim.id,
      claim.runId,
      claim.videoId,
      claim.channelId,
      claim.instrument,
      claim.ticker,
      claim.tickerExplicit,
      claim.stance,
      claim.thesisEn,
      claim.horizonEn,
      claim.conditionsEn,
      claim.risksEn,
      claim.creatorConviction,
      claim.trustLevel,
      JSON.stringify(claim.trustBasis ?? {}),
      claim.configHash,
      claim.publishedAt,
      claim.createdAt ?? new Date().toISOString(),
    );
  return result.changes > 0;
}
export async function claimsForRun(runId: string): Promise<ClaimRow[]> {
  return (
    (await database
      .prepare(`SELECT ${COLUMNS} FROM claims WHERE run_id=$1 ORDER BY id`)
      .all(runId)) as Record<string, unknown>[]
  ).map(convert);
}
export async function listClaims(limit = 500): Promise<ClaimRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM claims ORDER BY published_at DESC NULLS LAST,created_at DESC,id LIMIT $1`,
      )
      .all(limit)) as Record<string, unknown>[]
  ).map(convert);
}
export async function countClaims(): Promise<number> {
  const r = (await database
    .prepare("SELECT COUNT(*) AS n FROM claims")
    .get()) as { n: unknown };
  return Number(r.n);
}
