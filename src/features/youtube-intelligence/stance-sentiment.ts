import type { SentimentData, StanceData } from "./contracts.ts";

// Kept apart from sentiment.ts, with type-only imports, so client components
// can grade stances without bundling the contract parsers (spec 4.13).

/**
 * Stance to sentiment, as data (spec 4.13). An actionable call is never graded
 * by a model: long is bullish, short and avoid are bearish, neutral, watch and
 * hold are neutral. `conditional` is the one stance the table cannot answer on
 * its own — the sentiment is the direction of the condition — so it maps to
 * null and the direction is supplied by the caller.
 */
export const STANCE_SENTIMENT: Record<StanceData, SentimentData | null> = {
  long: "bullish",
  short: "bearish",
  avoid: "bearish",
  neutral: "neutral",
  watch: "neutral",
  hold: "neutral",
  conditional: null,
};

/**
 * The deterministic sentiment for a stance. `conditionDirection` is consulted
 * only where the table has no answer, so a stance the table covers cannot be
 * talked out of its sentiment by a model; an unstated condition direction
 * grades neutral rather than guessing.
 */
export function sentimentFromStance(
  stance: StanceData,
  conditionDirection?: SentimentData | null,
): SentimentData {
  return STANCE_SENTIMENT[stance] ?? conditionDirection ?? "neutral";
}
