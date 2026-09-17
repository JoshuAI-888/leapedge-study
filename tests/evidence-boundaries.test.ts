import test from "node:test";
import assert from "node:assert/strict";
import { splitExactBoundaryQuotes } from "../src/features/youtube-intelligence/evidence-boundaries.ts";
import {
  Claim,
  Source,
  validateClaim,
} from "../src/features/youtube-intelligence/contracts.ts";
test("Boundary serialization splits exact cues without inventing fragment translations or repairing changed words", () => {
  const source = Source.parse({
    segment_separator: "",
    segments: [
      { id: "a", text: "Do not buy QQQ", start_seconds: 0, end_seconds: 3 },
      {
        id: "b",
        text: "if it breaks below 150.",
        start_seconds: 3,
        end_seconds: 6,
      },
    ],
  });
  const base = Claim.parse({
    thesis_en: "Do not buy QQQ if it breaks below 150.",
    instrument_as_spoken: "QQQ",
    ticker: "QQQ",
    ticker_explicit: true,
    stance: "avoid",
    horizon_en: null,
    conditions_en: ["breaks below 150"],
    creator_conviction: "unspecified",
    risks_en: [],
    levels: [],
    evidence: [
      {
        segment_id: "a",
        quote_original: "Do not buy QQQ if it breaks below 150.",
        quote_translation_en: "Original grouped translation",
      },
    ],
  });
  assert.equal(validateClaim(base, source).length, 1);
  const result = splitExactBoundaryQuotes(base, source);
  assert.deepEqual(validateClaim(result.claim, source), []);
  assert.equal(result.repairs.length, 1);
  assert.ok(result.claim.evidence.every((e) => e.quote_translation_en === ""));
  assert.equal(
    result.repairs[0].groupTranslation,
    "Original grouped translation",
  );
  for (const changed of [
    "Do buy QQQ if it breaks below 150.",
    "Do not buy QQQ if it closes below 150.",
    "Do not buy QQQ if it breaks below 155.",
  ]) {
    const altered = {
      ...base,
      evidence: [{ ...base.evidence[0], quote_original: changed }],
    };
    assert.equal(splitExactBoundaryQuotes(altered, source).repairs.length, 0);
    assert.ok(validateClaim(altered, source).length);
  }
});
