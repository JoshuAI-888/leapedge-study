import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalystView, analystNote, excerpt, type AnalystViewInput } from "../src/features/youtube-intelligence/analyst-view.ts";
import type { CheckedClaim, ClaimData, MentionData } from "../src/features/youtube-intelligence/contracts.ts";
import type { ListingRefData } from "../src/features/youtube-intelligence/listing-ref.ts";

const ref = (symbol: string, name: string): ListingRefData => ({ symbol, name, market: "us-stock", exchange: "NYSE", method: "alias", source: "sec" });
const claim = (over: Partial<ClaimData>, quote: string, at: number): ClaimData => ({
  thesis_en: "t",
  instrument_as_spoken: null,
  ticker: null,
  ticker_explicit: false,
  stance: "long",
  horizon_en: null,
  conditions_en: [],
  creator_conviction: "medium",
  risks_en: [],
  levels: [],
  evidence: [{ segment_id: "s1", quote_original: quote, quote_translation_en: quote, source_span: { start_id: "s1", end_id: "s1", start_seconds: at, end_seconds: at + 5, text_hash: "h" } }],
  ...over,
});
const checked = (id: string, c: ClaimData, passed = true): CheckedClaim => ({ id, claim: c, passed, reasons: [] });
const mention = (spoken: string, sentiment: "bullish" | "bearish" | "neutral", at: number, extra: Partial<MentionData> = {}): MentionData => ({
  ticker: null,
  instrument_as_spoken: spoken,
  market: "unknown",
  stance: "neutral",
  sentiment,
  rationale_en: `${spoken} is ${sentiment}.`,
  source_span: { start_id: `m${at}`, end_id: `m${at}`, start_seconds: at, end_seconds: at + 2, text_hash: "h" },
  is_call: false,
  claim_id: null,
  ...extra,
});

function input(over: Partial<AnalystViewInput> = {}): AnalystViewInput {
  const claims = [
    checked("c1", claim({ instrument_as_spoken: "win resorts", action: "view", stance: "conditional", thesis_en: "Wynn could rip once rates fall.", levels: [{ kind: "target", value_original: "200", condition_en: "once rates peak" }] }, "win will start ripping", 300)),
    checked("c2", claim({ instrument_as_spoken: "Winning Resorts", action: "bought", creator_conviction: "high", size_original: "$8,400", thesis_en: "Bought $8,400 of Wynn today." }, "I bought $8,400 of Winning Resorts here today.", 600)),
    checked("c3", claim({ instrument_as_spoken: "Tesla", action: "view", owner: "third_party", owner_name: "Morgan Stanley", thesis_en: "Morgan Stanley has a $475 target." }, "Morgan Stanley has a $475 target on Tesla.", 100)),
    checked("c4", claim({ instrument_as_spoken: "Nike", action: "bought", thesis_en: "Rejected by the critic." }, "Nike", 50), false),
    checked("c5", claim({ instrument_as_spoken: "Celsius", action: "watch", thesis_en: "Watching Celsius." }, "Watching Celsius.", 700)),
  ];
  return {
    title: "Fixture",
    channel: "Channel",
    publishedAt: "2026-09-28T00:00:00Z",
    claims,
    mentions: [
      mention("Wynn", "bullish", 610, { is_call: true, claim_id: "c2" }),
      mention("win resorts", "bearish", 320),
      mention("Winning Resorts", "bullish", 605),
      mention("Tesla", "bullish", 100, { claim_id: "c3" }),
      mention("Nike", "bullish", 40),
    ],
    mentionChecks: { "Nike:m40:m40": false },
    claimListings: { c1: ref("WYNN", "WYNN RESORTS LTD"), c2: ref("WYNN", "WYNN RESORTS LTD"), c3: ref("TSLA", "Tesla, Inc."), c4: ref("NKE", "NIKE, Inc."), c5: ref("CELH", "Celsius Holdings, Inc.") },
    mentionListings: [ref("WYNN", "WYNN RESORTS LTD"), ref("WYNN", "WYNN RESORTS LTD"), ref("WYNN", "WYNN RESORTS LTD"), ref("TSLA", "Tesla, Inc."), ref("NKE", "NIKE, Inc.")],
    brief: {
      sentences: [
        { id: "s1", text: "Wynn is the main new buy.", evidenceIds: ["c2"], externalIds: [], financialFacts: [], kind: "action", horizon: "tactical", topic: "Wynn", materiality: 3, importanceReason: "", speaker: "creator", timeMode: "video_date" },
        { id: "s2", text: "Rates are the key macro risk.", evidenceIds: ["k1"], externalIds: [], financialFacts: [], kind: "analysis", horizon: "general", topic: "Macro", materiality: 2, importanceReason: "", speaker: "creator", timeMode: "video_date" },
      ] as never,
      mainTopics: ["Wynn", "Macro", "Tesla", "Celsius", "Nike", "Sixth"],
      omissions: [
        "The video gives no price target for Celsius.",
        "s4: Proposed quantity withheld: the typed qualifier is missing.",
        "source-0: Full-source recall is a bounded model review.",
        "Prior baseline claims regarding Waymo were not referenced in this video run.",
        "s-6: Proposed numeric value/unit is not supported by the original rate literal.",
        "Model critique is not human verification.",
        "This transcript exceeded the configured single-pass token threshold.",
        "Specific external corroborating evidence is omitted as no external IDs were supplied.",
      ],
      evidence: [{ id: "c2", quotes: [{ startId: "s9" }] }] as never,
    },
    segmentSeconds: { s9: 600 },
    transcriptionDoubts: [
      { heard: "$1.85", likely: "$11.85", reason_en: "Breakeven implies it.", start_seconds: 90 },
      { heard: "Palanteer", likely: "Palantir", reason_en: "Spelling.", start_seconds: 10 },
      { heard: "Palanteer", likely: "Palantir", reason_en: "Spelling again.", start_seconds: 12 },
    ],
    ...over,
  };
}

test("one card per instrument and owner: the strongest action leads, other theses and levels stay on it", () => {
  const v = buildAnalystView(input());
  const wynn = v.ideas.filter((i) => i.ticker === "WYNN");
  assert.equal(wynn.length, 1);
  assert.equal(wynn[0].action, "bought");
  assert.equal(wynn[0].size, "$8,400");
  assert.deepEqual(wynn[0].also, ["Wynn could rip once rates fall."]);
  assert.deepEqual(wynn[0].levels, [{ kind: "target", value: "200", condition: "once rates peak" }]);
  assert.deepEqual(wynn[0].claimIds, ["c2", "c1"]);
});

test("ideas rank executed trades first and third-party views last; rejected calls never appear", () => {
  const v = buildAnalystView(input());
  assert.deepEqual(v.ideas.map((i) => i.ticker), ["WYNN", "CELH", "TSLA"]);
  const tesla = v.ideas.find((i) => i.ticker === "TSLA")!;
  assert.equal(tesla.owner, "third_party");
  assert.equal(tesla.ownerName, "Morgan Stanley");
  assert.equal(v.stance.bullish, 2, "a third party's view is not counted as the creator's stance");
});

test("sentiment has one row per resolved instrument, marks disagreement as mixed, and drops critic-rejected mentions", () => {
  const v = buildAnalystView(input());
  const wynn = v.sentiment.find((r) => r.ticker === "WYNN")!;
  assert.equal(wynn.mentions, 3);
  assert.equal(wynn.sentiment, "mixed");
  assert.equal(wynn.isCall, true);
  assert.equal(wynn.firstAt, 320);
  assert.equal(v.sentiment.find((r) => r.ticker === "NKE"), undefined);
  assert.equal(v.sentiment.find((r) => r.ticker === "TSLA")?.owner, "third_party");
  assert.equal(v.sentiment[0].ticker, "WYNN", "calls sort first");
});

test("pipeline bookkeeping goes to processing notes; content gaps and misheard numbers are shown", () => {
  const v = buildAnalystView(input());
  assert.deepEqual(v.notStated, ["The video gives no price target for Celsius."]);
  assert.equal(v.diagnostics.filter((d) => !/Palanteer/.test(d)).length, 7);
  assert.equal(v.watchOuts.length, 1);
  assert.match(v.watchOuts[0].text, /\$1\.85.*\$11\.85/);
  assert.equal(v.diagnostics.filter((d) => /Palanteer/.test(d)).length, 1, "a repeated spelling note appears once");
  assert.deepEqual(v.themes, ["Wynn", "Macro", "Tesla", "Celsius", "Nike"]);
  assert.equal(v.summary[0].text, "Wynn is the main new buy.");
  assert.equal(v.summary[0].at, 600);
});

test("the note a PM copies has the ideas and none of the pipeline text", () => {
  const note = analystNote(buildAnalystView(input()));
  assert.match(note, /### WYNN \(WYNN RESORTS LTD\) · Bought · long · conviction high/);
  assert.match(note, /- Size: \$8,400/);
  assert.match(note, /third party: Morgan Stanley/);
  assert.match(note, /> "I bought \$8,400 of Winning Resorts here today\." \[10:00\]/);
  assert.doesNotMatch(note, /withheld|source-0|baseline/);
});

test("a quote excerpt keeps whole sentences exactly as said, starting at the instrument", () => {
  const text = "We talked about rates for a while and the market in general terms. ".repeat(4) + "Celsius is my top holding. It is cheap. " + "Unrelated closing remarks follow here. ".repeat(6);
  const cut = excerpt(text, ["Celsius"]);
  assert.ok(cut.startsWith("… Celsius is my top holding."));
  assert.ok(cut.length <= 290);
  assert.ok(text.includes(cut.replace(/^… /, "").replace(/ …$/, "")));
  assert.equal(excerpt("Short quote.", ["x"]), "Short quote.");
});
