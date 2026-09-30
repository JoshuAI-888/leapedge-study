import { z } from "zod";

/**
 * Jev pre-screen for the v3 faithfulness check.
 *
 * Jev (TypeSafe, jev-1.13.0) is a judgment model: it answers typed questions
 * with a probability and writes no text. In front of the Claude critic it
 * settles the clear sentences on its own and sends only the uncertain ones to
 * the critic. The question set and the band below are the "r2 criteria" round
 * of the 29 September tuning sandbox: 40 constructed cases, about a quarter
 * escalated, no wrong automatic decision. That is agreement with labels Claude
 * wrote, not verified accuracy, and nothing here may present it as such.
 */

export const PRESCREEN_EXPLANATION = {
  what: "Before the Claude critic checks a brief, Jev reads each sentence next to the transcript quotes it cites and returns the probability that the sentence keeps their meaning. Sentences Jev is confident about are settled on the spot: accepted at or above the accept threshold with no error type found, withheld at or below the reject threshold. Everything in between goes to the Claude critic exactly as today, which also still judges evidence coverage.",
  why: [
    "Faster: every sentence is checked at once in well under a second, and the critic only reads the uncertain share, which was about a quarter of sentences in tuning.",
    "Cheaper: Jev costs about US$0.04 per million input tokens with free output, roughly a hundredth of the critic, so a whole brief costs a fraction of a cent to screen.",
    "Safer to inspect: each settled sentence records Jev's probability and the kind of error it saw (reversed direction, wrong number, dropped qualifier and so on), which a reviewer can filter and audit.",
  ],
  limits: [
    "It only affects the v3 faithful brief pipeline. Numbers, ratios and dates are still checked by code, as now.",
    "Its only mistakes in tuning were withholding correct sentences, never publishing a wrong one; a withheld sentence is listed with Jev's reason, not hidden.",
    "The tuning evidence is 40 short constructed cases, not real briefs. Use the comparison below on real briefs before relying on it.",
    "If the TYPESAFE_API_KEY is missing or Jev fails, every sentence goes to the critic, so a run is never checked less than it is today.",
  ],
} as const;

export const JEV_INPUT_USD_PER_TOKEN = 0.042 / 1_000_000;

export const ERROR_TYPES = {
  none: "No departure: the sentence is faithful to the quotes",
  reversed_direction: "Reverses a direction, dependence or causation",
  wrong_number_or_ratio: "States a wrong number, unit, percentage or ratio",
  dropped_qualifier: "Drops a qualifier or condition such as a ceiling, 'if', 'not funded', 'bull case'",
  misattribution: "Attributes a view or action to the wrong speaker",
  added_certainty: "Adds certainty or a recommendation the speaker did not make",
  added_claim: "Adds a claim the quotes do not contain",
} as const;
export const ErrorType = z.enum([
  "none",
  "reversed_direction",
  "wrong_number_or_ratio",
  "dropped_qualifier",
  "misattribution",
  "added_certainty",
  "added_claim",
]);

/** The r2 question set: explicit true/false criteria that allow rewording. */
export const FAITHFUL_QUESTIONS = {
  faithful: {
    type: "noul",
    instructions: "Is `sentence` a faithful account of `quotes`?",
    criteria: {
      true: "Every fact in the sentence has the same meaning in the quotes: same company, direction, numbers, ratios, conditions, hedges and speaker. Rewording, translation or explaining a term is fine.",
      false: "The sentence changes the meaning: a reversed direction or cause, a different number, unit or ratio, a dropped condition or hedge, a different speaker, or a claim or certainty the quotes do not contain.",
    },
  },
  error_type: {
    type: "choice",
    instructions: "Which best describes how `sentence` departs from `quotes`?",
    criteria: ERROR_TYPES,
  },
} as const;

/** What Jev returns for FAITHFUL_QUESTIONS; parsed at the boundary. */
export const FaithfulAnswers = z.object({
  faithful: z.object({ noul: z.number().min(0).max(1) }),
  error_type: z.object({
    choice: ErrorType,
    confidence: z.number().min(0).max(1).optional(),
  }),
});
export type FaithfulAnswersData = z.infer<typeof FaithfulAnswers>;

export type PreScreenBand = { acceptAtOrAbove: number; rejectAtOrBelow: number };
export type PreScreenRoute = "accept" | "reject" | "escalate";

export function routeSentence(answers: FaithfulAnswersData, band: PreScreenBand): PreScreenRoute {
  const p = answers.faithful.noul;
  if (p >= band.acceptAtOrAbove && answers.error_type.choice === "none") return "accept";
  if (p <= band.rejectAtOrBelow) return "reject";
  return "escalate";
}

export const ScreenedSentence = z.object({
  id: z.string(),
  pFaithful: z.number(),
  errorType: ErrorType,
  route: z.enum(["accept", "reject", "escalate"]),
  ms: z.number(),
  inputTokens: z.number(),
});
export type ScreenedSentenceData = z.infer<typeof ScreenedSentence>;

export function preScreenReason(s: ScreenedSentenceData, model: string): string {
  const p = s.pFaithful.toFixed(2);
  return s.route === "accept"
    ? `Pre-screen (${model}) accepted: probability faithful ${p}, no error type found. Not read by the Claude critic.`
    : `Pre-screen (${model}) withheld: probability faithful ${p}; likely ${ERROR_TYPES[s.errorType].toLowerCase()}. Withheld, not disproven.`;
}

/** One sentence of an ad hoc Jev vs LLM comparison. */
export const ComparisonRow = z.object({
  id: z.string(),
  text: z.string(),
  jev: ScreenedSentence.nullable(),
  critic: z.object({ accepted: z.boolean(), reason: z.string() }).nullable(),
});
export type ComparisonRowData = z.infer<typeof ComparisonRow>;

export function summariseComparison(rows: ComparisonRowData[]) {
  const both = rows.filter((r) => r.jev && r.critic);
  const settled = both.filter((r) => r.jev!.route !== "escalate");
  const agree = settled.filter((r) => (r.jev!.route === "accept") === r.critic!.accepted);
  const wrongAccepts = settled.filter((r) => r.jev!.route === "accept" && !r.critic!.accepted).length;
  const wrongRejects = settled.filter((r) => r.jev!.route === "reject" && r.critic!.accepted).length;
  return {
    sentences: rows.length,
    compared: both.length,
    jevAccepted: both.filter((r) => r.jev!.route === "accept").length,
    jevRejected: both.filter((r) => r.jev!.route === "reject").length,
    escalated: both.filter((r) => r.jev!.route === "escalate").length,
    settledAgreeing: agree.length,
    /** Jev accepted what the critic rejected: the direction that would publish a wrong sentence. */
    jevAcceptedCriticRejected: wrongAccepts,
    /** Jev withheld what the critic accepted: costs coverage, never publishes a wrong sentence. */
    jevRejectedCriticAccepted: wrongRejects,
    criticAccepted: both.filter((r) => r.critic!.accepted).length,
  };
}

export const JevComparison = z.object({
  id: z.string(),
  runId: z.string(),
  briefId: z.string(),
  briefTitle: z.string(),
  createdAt: z.string(),
  jevModel: z.string(),
  criticModel: z.string(),
  band: z.object({ acceptAtOrAbove: z.number(), rejectAtOrBelow: z.number() }),
  rows: z.array(ComparisonRow),
  summary: z.object({
    sentences: z.number(),
    compared: z.number(),
    jevAccepted: z.number(),
    jevRejected: z.number(),
    escalated: z.number(),
    settledAgreeing: z.number(),
    jevAcceptedCriticRejected: z.number(),
    jevRejectedCriticAccepted: z.number(),
    criticAccepted: z.number(),
  }),
  jev: z.object({ wallMs: z.number(), costUsd: z.number(), error: z.string().nullable() }),
  critic: z.object({ wallMs: z.number(), costUsd: z.number(), calls: z.number(), failures: z.number() }),
  caveat: z.string(),
});
export type JevComparisonData = z.infer<typeof JevComparison>;

export const COMPARISON_CAVEAT =
  "Agreement with the Claude critic on one brief, not verified accuracy. Neither model is ground truth.";
