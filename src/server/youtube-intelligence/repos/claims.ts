import { database, iso, json } from "../database.ts";
import { createHash } from "node:crypto";
import { spansForClaim, type EvidenceSpanRow } from "./evidence-spans.ts";
import { SignedReview } from "../../../features/youtube-intelligence/trust.ts";
import { reviewsForClaim } from "./reviews.ts";
import { z } from "zod";
import {
  parseLevel,
  type ParsedLevel,
} from "../../../features/youtube-intelligence/level-parse.ts";
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
  // Call fields v2 (F60, migration 0010). Optional on the type so rows built
  // before them still type-check; every row read from the table carries them.
  levels?: StoredLevel[];
  catalystsEn?: string[];
  actionEn?: string | null;
  expiryDate?: string | null;
  expiryOriginal?: string | null;
  macroTheme?: string | null;
};
/** A level as the creator said it, plus the application's parse (or null). */
export type StoredLevel = {
  kind: string;
  valueOriginal: string;
  parsed: ParsedLevel | null;
};
const StoredLevels = z.array(
  z.object({
    kind: z.string().min(1),
    valueOriginal: z.string(),
    parsed: z.unknown(),
  }),
);
/** Stored levels, re-parsed from the original wording so the parse is never stale. */
function levels(value: unknown): StoredLevel[] {
  const parsed = StoredLevels.safeParse(json(value) ?? []);
  return parsed.success
    ? parsed.data.map((l) => ({
        kind: l.kind,
        valueOriginal: l.valueOriginal,
        parsed: parseLevel(l.valueOriginal),
      }))
    : [];
}
export type ClaimInput = Omit<ClaimRow, "createdAt"> & { createdAt?: string };
const COLUMNS =
  "id,run_id,video_id,channel_id,instrument,ticker,ticker_explicit,stance,thesis_en,horizon_en,conditions_en,risks_en,creator_conviction,trust_level,trust_basis,config_hash,published_at,created_at,levels,catalysts_en,action_en,expiry_date,expiry_original,macro_theme";
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
    levels: levels(r.levels),
    catalystsEn: strings(r.catalysts_en),
    actionEn: r.action_en == null ? null : String(r.action_en),
    // date columns come back as a string from pg (parser) and PGlite.
    expiryDate:
      r.expiry_date == null
        ? null
        : String(iso(r.expiry_date) ?? r.expiry_date).slice(0, 10),
    expiryOriginal: r.expiry_original == null ? null : String(r.expiry_original),
    macroTheme: r.macro_theme == null ? null : String(r.macro_theme),
  };
}
/**
 * Reviews bind semantic content and the exact cited source, never only a
 * stable row id. The F60 call fields are deliberately outside the digest:
 * they were added after reviews were signed, and folding them in would revoke
 * every existing signature on a republish.
 */
export function claimContentDigest(
  claim: ClaimInput | ClaimRow,
  spans: EvidenceSpanRow[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
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
        claim.configHash,
        claim.publishedAt,
        [...spans]
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((s) => [
            s.ordinal,
            s.startId,
            s.endId,
            s.startSeconds,
            s.endSeconds,
            s.textOriginal,
            s.textHash,
            s.translationEn,
          ]),
      ]),
    )
    .digest("hex");
}
/** Preserve earned trust only for unchanged content; an explicit rejection revokes L3. */
export async function upsertClaim(
  claim: ClaimInput,
  evidence?: EvidenceSpanRow[],
) {
  return database.transaction(async () => {
    await database
      .prepare("SELECT id FROM claims WHERE id=$1 FOR UPDATE")
      .get(claim.id);
    return writeClaim(claim, evidence);
  });
}
async function writeClaim(claim: ClaimInput, evidence?: EvidenceSpanRow[]) {
  const spans = evidence ?? (await spansForClaim(claim.id));
  const contentDigest = claimContentDigest(claim, spans);
  const matching = (await reviewsForClaim(claim.id))
    .flatMap((r) => {
      const parsed = SignedReview.safeParse(r);
      return parsed.success &&
        parsed.data.listenedSpan.contentDigest === contentDigest
        ? [parsed.data]
        : [];
    })
    .sort(
      (a, b) =>
        a.signedAt.localeCompare(b.signedAt) ||
        (a.verdict === "rejected" ? 1 : -1),
    );
  const latestReviewVerdict = matching.at(-1)?.verdict ?? null;
  if (claim.trustLevel === "L3" && latestReviewVerdict !== "verified")
    throw Error(
      "L3 requires an appended signed human review of this exact content and evidence.",
    );
  const trustBasis = {
    ...(claim.trustBasis && typeof claim.trustBasis === "object"
      ? claim.trustBasis
      : {}),
    contentDigest,
    latestReviewVerdict,
    humanReviewReason:
      latestReviewVerdict === "rejected"
        ? "Human reviewer rejected this exact claim and evidence; excluded from scoring."
        : null,
  };
  const result = await database
    .prepare(
      `INSERT INTO claims(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24)
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
         trust_level=CASE WHEN claims.trust_basis->>'contentDigest'=excluded.trust_basis->>'contentDigest'
           AND excluded.trust_basis->>'latestReviewVerdict' IS DISTINCT FROM 'rejected'
           AND (claims.trust_level <> 'L3' OR excluded.trust_basis->>'latestReviewVerdict'='verified')
           THEN GREATEST(claims.trust_level,excluded.trust_level) ELSE excluded.trust_level END,
         trust_basis=CASE WHEN claims.trust_basis->>'contentDigest'=excluded.trust_basis->>'contentDigest'
           AND excluded.trust_basis->>'latestReviewVerdict' IS DISTINCT FROM 'rejected'
           AND (claims.trust_level <> 'L3' OR excluded.trust_basis->>'latestReviewVerdict'='verified')
           AND excluded.trust_level < claims.trust_level THEN claims.trust_basis ELSE excluded.trust_basis END,
         config_hash=excluded.config_hash,
         published_at=excluded.published_at,
         levels=excluded.levels,
         catalysts_en=excluded.catalysts_en,
         action_en=excluded.action_en,
         expiry_date=excluded.expiry_date,
         expiry_original=excluded.expiry_original,
         macro_theme=excluded.macro_theme`,
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
      latestReviewVerdict === "rejected" ? "L0" : claim.trustLevel,
      JSON.stringify(trustBasis),
      claim.configHash,
      claim.publishedAt,
      claim.createdAt ?? new Date().toISOString(),
      JSON.stringify(
        (claim.levels ?? []).map((l) => ({
          kind: l.kind,
          valueOriginal: l.valueOriginal,
          parsed: l.parsed,
        })),
      ),
      claim.catalystsEn ?? [],
      claim.actionEn ?? null,
      claim.expiryDate ?? null,
      claim.expiryOriginal ?? null,
      claim.macroTheme ?? null,
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
/**
 * Drop the run's claim rows that a pass did not produce, returning their ids so
 * their spans can go with them. A claim accepted once and rejected by a later
 * critique has to leave the record: `claims` is what the leaderboard reads, so
 * a republished run is authoritative rather than cumulative.
 */
export async function deleteClaimsForRunExcept(
  runId: string,
  keep: string[],
): Promise<string[]> {
  return (
    (await database
      .prepare(
        "DELETE FROM claims WHERE run_id=$1 AND id <> ALL($2) RETURNING id",
      )
      .all(runId, keep)) as Record<string, unknown>[]
  ).map((r) => String(r.id));
}
