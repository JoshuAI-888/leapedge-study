import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Claim } from "../../src/features/youtube-intelligence/contracts.ts";

/**
 * Gold set: human-verified claims per video, used as a promotion gate (spec 4.9).
 *
 * The shape follows evaluations/transcript-accuracy.ts AccuracyCase: every
 * expectation names its reviewer and review date, and an audio anchor counts
 * only when a person listened to it (anchorVerified). A case is "pending"
 * until that review happens; nothing in a pending case is ground truth.
 */
export const GOLD_SET_VERSION = "gold-set.v1";
/** Spec 4.9: at least fifty human-verified claims before the gate is binding. */
export const MINIMUM_VERIFIED_CASES = 50;
export const DEFAULT_CASES_PATH = "evaluations/gold-set/cases.json";

export const Stance = Claim.shape.stance;
export const Conviction = Claim.shape.creator_conviction;
export const Sentiment = z.enum(["bullish", "neutral", "bearish"]);
export const Language = z.enum(["en", "zh"]);
export const Split = z.enum(["development", "held_out"]);
export const CaseStatus = z.enum(["pending", "verified"]);

export const GoldSpan = z
  .object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    // The words spoken in the span, in the original language.
    text: z.string().min(1),
  })
  .refine((s) => s.endSeconds > s.startSeconds, {
    message: "A span must end after it starts",
  });

export const Review = z.object({
  reviewer: z.string().min(1),
  reviewedAt: z.string().refine((s) => Number.isFinite(Date.parse(s)), {
    message: "reviewedAt must be a date",
  }),
});

export const GoldClaim = z
  .object({
    id: z.string().min(1),
    ticker: z.string().min(1).max(12),
    stance: Stance,
    creator_conviction: Conviction,
    sentiment: Sentiment,
    // Null only while the case is pending: the reviewer has not located the audio yet.
    span: GoldSpan.nullable(),
    // True only after a person listened to the audio at span.startSeconds.
    anchorVerified: z.boolean(),
    reviewer: z.string(),
    reviewedAt: z.string(),
  })
  .superRefine((c, ctx) => {
    if (!c.anchorVerified) return;
    if (!c.span)
      ctx.addIssue({ code: "custom", message: "anchorVerified requires a span" });
    if (!c.reviewer.trim() || !Number.isFinite(Date.parse(c.reviewedAt)))
      ctx.addIssue({
        code: "custom",
        message: "anchorVerified requires a reviewer and a review date",
      });
  });

export const GoldRejection = z.object({
  id: z.string().min(1),
  // Why an accepted claim here would be wrong (invented call, holding, aside, education).
  reason: z.string().min(1),
  ticker: z.string().min(1).nullable().optional(),
});

export const GoldCase = z
  .object({
    id: z.string().min(1),
    videoId: z.string().regex(/^[\w-]{11}$/, "videoId must be an 11-character YouTube id"),
    language: Language,
    split: Split,
    status: CaseStatus,
    // Who verified the case as a whole (required once verified; covers rejections).
    review: Review.nullable().optional(),
    // Where the expectation came from, for the reviewer.
    source: z.string().optional(),
    notes: z.array(z.string()).optional(),
    expectedClaims: z.array(GoldClaim),
    expectedRejections: z.array(GoldRejection),
  })
  .superRefine((c, ctx) => {
    const ids = [...c.expectedClaims, ...c.expectedRejections].map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate annotation ID" });
    const keys = c.expectedClaims.map((x) => claimKey(x.ticker, x.stance));
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate (ticker, stance) expectation in one case",
      });
    if (c.status !== "verified") return;
    if (!c.review)
      ctx.addIssue({ code: "custom", message: "A verified case requires a review" });
    if (!c.expectedClaims.length && !c.expectedRejections.length)
      ctx.addIssue({
        code: "custom",
        message: "A verified case requires at least one expectation",
      });
    if (c.expectedClaims.some((x) => !x.anchorVerified || !x.span))
      ctx.addIssue({
        code: "custom",
        message: "A verified case requires every claim anchorVerified with a span",
      });
  });

export const GoldSet = z
  .object({
    version: z.literal(GOLD_SET_VERSION, { message: `version must be ${GOLD_SET_VERSION}` }),
    attribution: z.array(z.string()).optional(),
    cases: z.array(GoldCase),
  })
  .superRefine((s, ctx) => {
    const ids = s.cases.map((c) => c.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate case ID" });
    const videos = s.cases.map((c) => c.videoId);
    if (new Set(videos).size !== videos.length)
      ctx.addIssue({ code: "custom", message: "Duplicate videoId across cases" });
  });

export type GoldClaimData = z.infer<typeof GoldClaim>;
export type GoldRejectionData = z.infer<typeof GoldRejection>;
export type GoldCaseData = z.infer<typeof GoldCase>;
export type GoldSetData = z.infer<typeof GoldSet>;
export type SentimentValue = z.infer<typeof Sentiment>;
export type StanceValue = z.infer<typeof Stance>;

/** Matching key for claim precision and recall: ticker (case-insensitive) and stance. */
export function claimKey(ticker: string, stance: string) {
  return `${ticker.trim().toUpperCase()}|${stance}`;
}

export function parseGoldSet(input: unknown): GoldSetData {
  const parsed = GoldSet.safeParse(input);
  if (!parsed.success)
    throw Error(
      `Gold set is malformed: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join(" | ")}`,
    );
  return parsed.data;
}

export function loadGoldSet(path = DEFAULT_CASES_PATH): GoldSetData {
  return parseGoldSet(JSON.parse(readFileSync(resolve(path), "utf8")));
}
