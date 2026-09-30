import {
  Mention,
  type CheckedClaim,
  type MentionData,
} from "./contracts.ts";
import { sentimentFromStance } from "./stance-sentiment.ts";

export { STANCE_SENTIMENT, sentimentFromStance } from "./stance-sentiment.ts";

/**
 * One mention per accepted claim (spec 4.3: calls are mentions too, and the
 * stricter subset). Sentiment comes from the stance table, the rationale is the
 * claim's own thesis and the span is the claim's first pointer evidence, so a
 * call mention is entirely derived — nothing here is model-written that the
 * claim did not already carry.
 *
 * Two kinds of claim yield no mention rather than a weaker row: one that names
 * no instrument at all, and one whose evidence is legacy quote evidence with no
 * pointer span, because a mention without a resolvable span is rejected.
 * `market` is "unknown": the claim contract records no market, and inferring
 * one from a ticker string belongs to the market map, not here.
 */
export function mentionsFromClaims(claims: CheckedClaim[]): MentionData[] {
  const mentions: MentionData[] = [];
  for (const { id, claim, passed } of claims) {
    const named = claim.instrument_as_spoken || claim.ticker;
    const span = claim.evidence.find((e) => e.source_span)?.source_span;
    if (!passed || !named || !span) continue;
    mentions.push(
      Mention.parse({
        ticker: claim.ticker,
        instrument_as_spoken: named,
        market: "unknown",
        stance: claim.stance,
        sentiment: sentimentFromStance(claim.stance),
        rationale_en: claim.thesis_en,
        source_span: span,
        is_call: true,
        claim_id: id,
      }),
    );
  }
  return mentions;
}
