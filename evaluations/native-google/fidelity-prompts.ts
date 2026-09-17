import { shadowPrompts } from "./shadow-prompts.ts";

export function fidelityPrompts() {
  const p = shadowPrompts(true);
  p.id = "evidence-first.web.v7-fidelity-candidate";
  p.rationale =
    "Experimental: exact single-segment quotes, explicit ticker evidence, instrument-view coverage and unchanged trigger conditions. Requires multi-video validation; not the default.";
  p.extraction += `
EVIDENCE FIDELITY:
- If assigning a ticker, include a separate exact quote containing that ticker and context tying it to this view. A ticker elsewhere in the video is not sufficient. Otherwise preserve instrument_as_spoken and set ticker=null, ticker_explicit=false. Do not drop a supported instrument view solely because its ticker cannot be evidenced.
- Preserve the exact execution condition. A break below is NOT a close below; touching is NOT confirmation; an intraday event is NOT a daily close. Never add timeframe, confirmation, closing-price, or candle requirements. Preserve negatives, exceptions and existing-position prerequisites in thesis_en and conditions_en.
- Before returning, account for every substantive instrument view in this source chunk, including holding, avoid, watch and conditional views, not only new entries. Keep distinct instruments and distinct position states. Do not drop QQQ or IWM merely because they are discussed together. Incidental mentions without a view need no claim.
- Re-read the source for omitted views and verify each retained field against its cited original-language evidence. Do not increase recall by inventing support. Separate evidence records may support instrument identity and the condition; never join their text into one quote.`;
  p.critique += `
ADVERSARIAL CONDITION AUDIT: Check thesis_en, conditions_en, horizon_en and quote_translation_en against the ORIGINAL quote and local source, not the draft's translation. Reject added close/candle/confirmation/timeframe requirements: "breaks below" cannot become "closes below". Check negations, already-holding prerequisites, and entry versus support/resistance. A correct quote does not make its interpretation correct. Explicitly identify the unsupported field on rejection. Do not accept an unrelated ticker quote as evidence for a different instrument's view.`;
  return p;
}
