import test from "node:test";
import assert from "node:assert/strict";
import { Claim } from "../src/features/youtube-intelligence/contracts.ts";
import { normalizeIdeaDetail } from "../src/features/youtube-intelligence/idea-detail.ts";

const quote = "So, I actually bought a $70 call on Uber, expiring in January of next year. Morgan Stanley has a $475 target on Tesla.";
const base = Claim.parse({
  thesis_en: "The creator bought a January $70 call on Uber.",
  instrument_as_spoken: "Uber",
  ticker: null,
  ticker_explicit: false,
  stance: "long",
  horizon_en: "January of next year",
  conditions_en: [],
  creator_conviction: "high",
  risks_en: [],
  levels: [{ kind: "strike", value_original: "$70", condition_en: null }],
  evidence: [{ segment_id: "s1", quote_original: quote, quote_translation_en: quote }],
  action: "bought",
  owner: "creator",
  owner_name: null,
  option: { right: "call", side: "long", strike_original: "$70", expiry_original: "January of next year", premium_original: null },
  size_original: null,
  catalysts: [],
});

test("detail copied from the evidence is kept unchanged", () => {
  const { claim, removed } = normalizeIdeaDetail(base);
  assert.deepEqual(removed, []);
  assert.deepEqual(claim, base);
});

test("detail absent from the evidence is removed and recorded; the call is kept", () => {
  const { claim, removed } = normalizeIdeaDetail({
    ...base,
    size_original: "$5,000",
    option: { ...base.option!, premium_original: "$4.20", expiry_original: "january of NEXT year" },
    catalysts: [{ text_en: "Earnings", date_original: "Sep 30" }],
  });
  assert.equal(claim.size_original, null);
  assert.equal(claim.option?.premium_original, null);
  assert.equal(claim.option?.expiry_original, "january of NEXT year", "case and spacing do not matter");
  assert.equal(claim.catalysts?.[0].date_original, null);
  assert.equal(claim.catalysts?.[0].text_en, "Earnings");
  assert.deepEqual(removed.map((r) => r.field).sort(), ["catalysts[0].date_original", "option.premium_original", "size_original"]);
  assert.equal(claim.thesis_en, base.thesis_en);
});

test("a third-party view needs a name that was said; otherwise ownership is unknown, never the creator's", () => {
  const named = normalizeIdeaDetail({ ...base, owner: "third_party", owner_name: "Morgan Stanley" });
  assert.equal(named.claim.owner, "third_party");
  assert.equal(named.claim.owner_name, "Morgan Stanley");
  const unnamed = normalizeIdeaDetail({ ...base, owner: "third_party", owner_name: "Goldman" });
  assert.equal(unnamed.claim.owner, "third_party");
  assert.equal(unnamed.claim.owner_name, null);
  assert.equal(unnamed.removed[0].field, "owner_name");
});

test("a claim from before prompt v9 passes through untouched", () => {
  const { action, owner, owner_name, option, size_original, catalysts, ...legacy } = base;
  void [action, owner, owner_name, option, size_original, catalysts];
  const parsed = Claim.parse(legacy);
  const { claim, removed } = normalizeIdeaDetail(parsed);
  assert.deepEqual(removed, []);
  assert.deepEqual(claim, parsed);
});
