import { database, iso, json } from "../database.ts";
/**
 * The only door to the `reviews` table (spec 8). Append-only: a verdict is
 * signed once and never edited, so there is no update here at all.
 *
 * Nothing writes a row yet. Signing an L3 needs the reviewer's account, which
 * arrives with the multi-user work in 4.18; until then this is the read side
 * the trust ladder will consult.
 */
export type ReviewRow = {
  id: string;
  claimId: string;
  reviewerAccountId: string;
  verdict: string;
  note: string | null;
  listenedSpan: unknown;
  signedAt: string | null;
};
const COLUMNS =
  "id,claim_id,reviewer_account_id,verdict,note,listened_span,signed_at";
function convert(r: Record<string, unknown>): ReviewRow {
  return {
    id: String(r.id),
    claimId: String(r.claim_id),
    reviewerAccountId: String(r.reviewer_account_id),
    verdict: String(r.verdict),
    note: r.note === null ? null : String(r.note),
    listenedSpan: json(r.listened_span),
    signedAt: iso(r.signed_at),
  };
}
/** Append one signed review. A repeated id is ignored rather than overwritten. */
export async function appendReview(review: ReviewRow) {
  const result = await database
    .prepare(
      `INSERT INTO reviews(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      review.id,
      review.claimId,
      review.reviewerAccountId,
      review.verdict,
      review.note,
      JSON.stringify(review.listenedSpan ?? null),
      review.signedAt ?? new Date().toISOString(),
    );
  return result.changes > 0;
}
export async function reviewsForClaim(claimId: string): Promise<ReviewRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM reviews WHERE claim_id=$1 ORDER BY signed_at,id`,
      )
      .all(claimId)) as Record<string, unknown>[]
  ).map(convert);
}
export async function countReviews(): Promise<number> {
  const r = (await database
    .prepare("SELECT COUNT(*) AS n FROM reviews")
    .get()) as { n: unknown };
  return Number(r.n);
}
