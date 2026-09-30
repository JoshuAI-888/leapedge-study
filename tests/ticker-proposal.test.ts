import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReferences } from "../src/features/youtube-intelligence/claim-references.ts";
import { Claim, Source, validateClaim } from "../src/features/youtube-intelligence/contracts.ts";

test("a call on a company named but not ticker-spoken keeps the call and proposes the symbol", () => {
  // Observed in production: "I'm not going to be buying Vistra" drafted as VST.
  const source = Source.parse({
    source_kind: "imported_transcript",
    language: "en",
    segments: [{ id: "s1", text: "So, no, I'm not going to be buying Vistra.", start_seconds: 0, end_seconds: 3 }],
  });
  const claim = Claim.parse({
    thesis_en: "The creator is not buying Vistra.",
    instrument_as_spoken: "VST",
    ticker: "VST",
    ticker_explicit: true,
    stance: "avoid",
    horizon_en: null,
    conditions_en: [],
    creator_conviction: "high",
    risks_en: [],
    levels: [],
    evidence: [{ segment_id: "s1", quote_original: "So, no, I'm not going to be buying Vistra.", quote_translation_en: "" }],
  });
  assert.ok(validateClaim(claim, source).includes("Ticker is not explicit in its evidence."));
  const { claim: kept, tickerProposal } = normalizeReferences(claim, source);
  assert.equal(tickerProposal, "VST");
  assert.equal(kept.ticker, null);
  assert.deepEqual(validateClaim(kept, source), []);
  assert.equal(kept.stance, "avoid");
});
