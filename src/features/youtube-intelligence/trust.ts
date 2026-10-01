import { z } from "zod";
export const TrustLevel = z.enum(["L0", "L1", "L2", "L3"]);
export type TrustLevel = z.infer<typeof TrustLevel>;
export const TrustChecks = z.object({
  structural: z.boolean(),
  pointerEvidence: z.boolean(),
  priceTicker: z.boolean(),
  criticAccepted: z.boolean(),
});
const ListenedSpan = z
  .object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    contentDigest: z.string().min(1).optional(),
  })
  .refine((s) => s.endSeconds > s.startSeconds);
export const SignedReview = z.object({
  reviewerAccountId: z.string().trim().min(1),
  verdict: z.enum(["verified", "rejected"]),
  signedAt: z.iso.datetime({ offset: true }),
  listenedSpan: ListenedSpan,
});
export type AgreementCheck = {
  agreed: boolean;
  agreementScore: number;
  anchorErrorSeconds: number | null;
  independent: boolean;
};
export function computeTrustLevel(
  checks: z.infer<typeof TrustChecks>,
  agreement: AgreementCheck[],
  reviews: unknown[],
  contentDigest?: string,
) {
  const parsed = TrustChecks.parse(checks);
  let trustLevel: TrustLevel = "L0";
  const textChecked = Object.values(parsed).every(Boolean);
  if (textChecked) trustLevel = "L1";
  if (
    textChecked &&
    agreement.length > 0 &&
    agreement.every(
      (a) =>
        a.agreed &&
        a.independent &&
        a.anchorErrorSeconds !== null &&
        a.anchorErrorSeconds <= 2,
    )
  )
    trustLevel = "L2";
  const signed = reviews.flatMap((r) => {
    const result = SignedReview.safeParse(r);
    return result.success ? [result.data] : [];
  });
  // Signing requires text checks, but a human can independently verify a span ASR could not hear.
  const matching = signed
    .filter(
      (r) => contentDigest && r.listenedSpan.contentDigest === contentDigest,
    )
    .sort(
      (a, b) =>
        a.signedAt.localeCompare(b.signedAt) ||
        (a.verdict === "rejected" ? 1 : -1),
    );
  const latestReviewVerdict = matching.at(-1)?.verdict ?? null;
  if (textChecked && latestReviewVerdict === "verified") trustLevel = "L3";
  if (latestReviewVerdict === "rejected") trustLevel = "L0";
  const humanReviewReason =
    latestReviewVerdict === "rejected"
      ? "Human reviewer rejected this exact claim and evidence; excluded from scoring."
      : null;
  return {
    trustLevel,
    trustBasis: {
      version: "trust.v2",
      contentDigest,
      latestReviewVerdict,
      humanReviewReason,
      ...parsed,
      evidenceCount: agreement.length,
      agreement,
      reviews: signed,
    },
  };
}
