import { database } from "../database.ts";
/**
 * The only door to the `evidence_spans` table (spec 8). One row per range a
 * claim cites, keyed by (claim, ordinal): the claim's own order is what makes
 * a span addressable, since two entries may name the same range.
 */
export type EvidenceSpanRow = {
  claimId: string;
  ordinal: number;
  startId: string;
  endId: string;
  startSeconds: number | null;
  endSeconds: number | null;
  textOriginal: string;
  textHash: string | null;
  translationEn: string | null;
  agreementScore: number | null;
  anchorErrorSeconds: number | null;
  tieBreakSource: string | null;
};
const COLUMNS =
  "claim_id,ordinal,start_id,end_id,start_seconds,end_seconds,text_original,text_hash,translation_en,agreement_score,anchor_error_seconds,tie_break_source";
function number(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function convert(r: Record<string, unknown>): EvidenceSpanRow {
  return {
    claimId: String(r.claim_id),
    ordinal: Number(r.ordinal),
    startId: String(r.start_id),
    endId: String(r.end_id),
    startSeconds: number(r.start_seconds),
    endSeconds: number(r.end_seconds),
    textOriginal: String(r.text_original),
    textHash: r.text_hash === null ? null : String(r.text_hash),
    translationEn: r.translation_en === null ? null : String(r.translation_en),
    agreementScore: number(r.agreement_score),
    anchorErrorSeconds: number(r.anchor_error_seconds),
    tieBreakSource: r.tie_break_source === null ? null : String(r.tie_break_source),
  };
}
export async function upsertEvidenceSpan(span: EvidenceSpanRow) {
  const result = await database
    .prepare(
      `INSERT INTO evidence_spans(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(claim_id,ordinal) DO UPDATE SET
         start_id=excluded.start_id,
         end_id=excluded.end_id,
         start_seconds=excluded.start_seconds,
         end_seconds=excluded.end_seconds,
         text_original=excluded.text_original,
         text_hash=excluded.text_hash,
         translation_en=excluded.translation_en,
         agreement_score=COALESCE(excluded.agreement_score,evidence_spans.agreement_score),
         anchor_error_seconds=COALESCE(excluded.anchor_error_seconds,evidence_spans.anchor_error_seconds),
         tie_break_source=COALESCE(excluded.tie_break_source,evidence_spans.tie_break_source)`,
    )
    .run(
      span.claimId,
      span.ordinal,
      span.startId,
      span.endId,
      span.startSeconds,
      span.endSeconds,
      span.textOriginal,
      span.textHash,
      span.translationEn,
      span.agreementScore,
      span.anchorErrorSeconds,
      span.tieBreakSource,
    );
  return result.changes > 0;
}
export async function spansForClaim(claimId: string): Promise<EvidenceSpanRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM evidence_spans WHERE claim_id=$1 ORDER BY ordinal`,
      )
      .all(claimId)) as Record<string, unknown>[]
  ).map(convert);
}
export async function spansForClaims(
  claimIds: string[],
): Promise<EvidenceSpanRow[]> {
  if (!claimIds.length) return [];
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM evidence_spans WHERE claim_id = ANY($1) ORDER BY claim_id,ordinal`,
      )
      .all(claimIds)) as Record<string, unknown>[]
  ).map(convert);
}
export async function countEvidenceSpans(): Promise<number> {
  const r = (await database
    .prepare("SELECT COUNT(*) AS n FROM evidence_spans")
    .get()) as { n: unknown };
  return Number(r.n);
}
