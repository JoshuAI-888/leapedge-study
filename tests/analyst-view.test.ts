import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalystView, analystNote, atAGlance, excerpt, type AnalystViewInput } from "../src/features/youtube-intelligence/analyst-view.ts";
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
  assert.deepEqual(wynn[0].also, [], "the strongest thesis leads; a second thesis on the same card read as repetition");
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

test("also discussed covers instruments without a card; passing or unresolved names are one line", () => {
  const base = input();
  const v = buildAnalystView({
    ...base,
    mentions: [
      ...base.mentions,
      mention("Amazon", "bullish", 200),
      mention("Amazon", "bearish", 260),
      mention("Costco", "neutral", 300),
      mention("pound", "bullish", 310),
    ],
    mentionListings: [...base.mentionListings, ref("AMZN", "Amazon.com, Inc."), ref("AMZN", "Amazon.com, Inc."), ref("COST", "COSTCO WHOLESALE CORP"), null],
  });
  assert.deepEqual(v.sentiment.map((r) => [r.ticker, r.sentiment, r.mentions]), [["AMZN", "mixed", 2]]);
  assert.equal(v.sentiment.find((r) => r.ticker === "WYNN"), undefined, "an instrument with a card is not repeated");
  assert.deepEqual(v.otherMentions, ["COST"], "lowercase unresolved phrases are transcription noise");
  assert.ok(!v.otherMentions.includes("NKE"), "a critic-rejected mention is not shown at all");
});

test("market caps are not levels, key points do not repeat the cards, a catalyst said twice appears once", () => {
  const base = input();
  base.claims[1].claim.levels = [{ kind: "target", value_original: "$1 trillion plus", condition_en: null }, { kind: "target", value_original: "120", condition_en: null }];
  base.claims[1].claim.catalysts = [{ text_en: "Middle East property opening", date_original: null }, { text_en: "Middle East property opening next year", date_original: "next year" }];
  const v = buildAnalystView(base);
  const wynn = v.ideas.find((i) => i.ticker === "WYNN")!;
  assert.deepEqual(wynn.levels.map((l) => l.value), ["120", "200"]);
  assert.deepEqual(wynn.catalysts, [{ text: "Middle East property opening next year", date: "next year" }]);
  assert.ok(!v.keyPoints.some((k) => k.kind === "action"), "an action sentence is already a card");
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
  assert.match(note, /## Summary\nWynn is the main new buy\. Rates are the key macro risk\.\n/, "the summary is one paragraph");
  assert.doesNotMatch(note, /At a glance|Also discussed|Also mentioned|Watch-outs|Creator stance|## Numbers|## Themes/, "the note is summary, ideas and context only");
  assert.equal(atAGlance(buildAnalystView(input())), "Bought: WYNN · Watching: CELH · Third-party view: TSLA", "the page keeps the glance line");
  assert.match(note, /- Size: \$8,400/);
  assert.match(note, /third party: Morgan Stanley/);
  assert.match(note, /> "I bought \$8,400 of Winning Resorts here today\." \[10:00\]/);
  assert.doesNotMatch(note, /withheld|source-0|baseline/);
});

test("a quote excerpt keeps whole sentences exactly as said, starting at the instrument", () => {
  const text = "We talked about rates for a while and the market in general terms. ".repeat(4) + "Celsius is my top holding. It is cheap. " + "Unrelated closing remarks follow here. ".repeat(6);
  const cut = excerpt(text, ["Celsius"]);
  assert.ok(cut.startsWith("… Celsius is my top holding."));
  assert.ok(cut.length <= 190);
  assert.ok(text.includes(cut.replace(/^… /, "").replace(/ …$/, "")));
  assert.equal(excerpt("Short quote.", ["x"]), "Short quote.");
});

test("one third party's views on several tickers are one card, and a translation that changes a number is not shown", () => {
  const base = input();
  base.claims.push(
    checked("c6", claim({ instrument_as_spoken: "Micron", stance: "short", action: "view", owner: "third_party", owner_name: "Michael Burry", thesis_en: "Burry is short Micron." }, "Burry shorted Micron.", 800)),
    checked("c7", claim({ instrument_as_spoken: "Palantir", stance: "short", action: "view", owner: "third_party", owner_name: "Michael Burry", thesis_en: "Burry is short Palantir." }, "Burry shorted Palantir.", 810)),
  );
  base.claimListings.c6 = ref("MU", "Micron Technology");
  base.claimListings.c7 = ref("PLTR", "Palantir Technologies Inc.");
  base.claims[0].claim.evidence[0].quote_original = "存款利率只有0.01%";
  base.claims[0].claim.evidence[0].quote_translation_en = "Deposit rates are only 0.07%";
  const v = buildAnalystView({ ...base, mentions: [...base.mentions, mention("Micron", "bearish", 805)], mentionListings: [...base.mentionListings, ref("MU", "Micron Technology")] });
  const burry = v.ideas.filter((i) => i.ownerName === "Michael Burry");
  assert.equal(burry.length, 1);
  assert.equal(burry[0].ticker, "MU, PLTR");
  assert.equal(v.sentiment.find((r) => r.ticker === "MU"), undefined, "a merged ticker is not repeated under also discussed");
  const only = buildAnalystView({ ...base, claims: [base.claims[0]] }).ideas[0];
  assert.equal(only.quote?.text, "存款利率只有0.01%");
  assert.equal(only.quote?.translation, null, "0.07% is not what was said");
});

test("key points never cite a card's evidence, filler conditions go, the creator leads, and the quote fits the thesis", () => {
  const base = input();
  base.claims[2].claim.action = "bought"; // a third party's executed trade still ranks after the creator's ideas
  base.claims[1].claim.conditions_en = ["if long-term", "Oil prices peak and rates start heading down"];
  base.claims[1].claim.evidence = [
    { segment_id: "s0", quote_original: "The chart colours are green today.", quote_translation_en: "The chart colours are green today." },
    ...base.claims[1].claim.evidence,
  ];
  const brief = base.brief!;
  brief.sentences = [
    ...brief.sentences,
    { ...brief.sentences[1], id: "s3", text: "The creator repeats the Wynn purchase in other words.", kind: "analysis", evidenceIds: ["c2"] },
  ] as never;
  const v = buildAnalystView(base);
  assert.equal(v.ideas.at(-1)?.owner, "third_party");
  const wynn = v.ideas.find((i) => i.ticker === "WYNN")!;
  assert.deepEqual(wynn.conditions, ["Oil prices peak and rates start heading down"]);
  assert.match(wynn.quote!.text, /bought \$8,400/);
  assert.ok(!v.keyPoints.some((k) => /repeats the Wynn purchase/.test(k.text)));
  assert.doesNotMatch(analystNote(v), /## Key points[\s\S]*\[\d+:\d{2}\]\n?$/, "key points carry no approximate timestamps");
});

test("a checked bottom line replaces the selected summary, its sources leave key points, and a header never restates its action", () => {
  const view = buildAnalystView(input({ bottomLine: [{ text: "The creator's thesis is Wynn, bought on the rates view.", statementIds: ["s1", "s2"] }] }));
  assert.deepEqual(view.summary, [{ text: "The creator's thesis is Wynn, bought on the rates view.", at: 600 }]);
  assert.equal(view.keyPoints.some((k) => k.text.startsWith("Rates are")), false, "a statement the bottom line condensed is not repeated");
  const watching = input();
  watching.claims = watching.claims.map((c) => (c.id === "c5" ? { ...c, claim: { ...c.claim, stance: "watch" } } : c));
  const note = analystNote(buildAnalystView(watching));
  assert.match(note, /### CELH \(Celsius Holdings, Inc\.\) · Watching · conviction/, "Watching · watch shows once");
  assert.match(note, /### WYNN \(WYNN RESORTS LTD\) · Bought · long ·/, "a stance that adds to the action stays");
  assert.deepEqual(buildAnalystView(input({ bottomLine: [] })).summary.map((s) => s.text), ["Wynn is the main new buy.", "Rates are the key macro risk."], "no bottom line falls back to the brief");
});
