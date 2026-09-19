import {
  Claim,
  validateClaim,
  type ClaimData,
  type SourceData,
} from "./contracts.ts";
/** Keep a proposed listing out of the literal ticker field. The original model
 * draft and proposal remain retained; the critic must still validate the company
 * thesis. Never repair prices, quotes, source timing, or a nameless instrument. */
export function normalizeReferences(claim: ClaimData, source: SourceData) {
  let tickerProposal: string | null = null;
  let result = claim;
  if (
    claim.ticker &&
    claim.instrument_as_spoken &&
    validateClaim(claim, source).includes(
      "Ticker is not explicit in its evidence.",
    )
  ) {
    tickerProposal = claim.ticker;
    result = Claim.parse({ ...claim, ticker: null, ticker_explicit: false });
  }
  return { claim: result, tickerProposal };
}
