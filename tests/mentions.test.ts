import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.YTI_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "yti-mentions-")),
  "test.sqlite",
);
delete process.env.DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fixture";
process.env.YTI_BUDGET_USD = "10";
const { Claim, Mention, MARKETS, SENTIMENTS, Source } = await import(
  "../src/features/youtube-intelligence/contracts.ts"
);
const { STANCE_SENTIMENT, sentimentFromStance, mentionsFromClaims } =
  await import("../src/features/youtube-intelligence/sentiment.ts");
const { materializeEvidenceRanges } = await import(
  "../src/features/youtube-intelligence/evidence-selection.ts"
);
const { MentionExtraction, extractionResponseSchema } = await import(
  "../src/server/youtube-intelligence/schemas/extraction.ts"
);
const { FakeModelTransport } = await import(
  "../src/server/youtube-intelligence/transport/fake.ts"
);
const { injectTransport } = await import(
  "../src/server/youtube-intelligence/transport/index.ts"
);
const { create, db } = await import(
  "../src/server/youtube-intelligence/store.ts"
);
const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");

const source = Source.parse({
  source_kind: "imported_transcript",
  segment_separator: " ",
  segments: [
    { id: "a", text: "I am short SPY here.", start_seconds: 1, end_seconds: 5 },
    {
      id: "b",
      text: "It is too extended above 500.",
      start_seconds: 5,
      end_seconds: 9,
    },
    { id: "c", text: "QQQ is only a watch.", start_seconds: 9, end_seconds: 12 },
    { id: "d", text: "Gold keeps grinding higher.", start_seconds: 12, end_seconds: 16 },
  ],
});
const shortSpy = {
  thesis_en: "Short SPY while it stays extended above 500.",
  instrument_as_spoken: "SPY",
  ticker: "SPY",
  ticker_explicit: true,
  stance: "short" as const,
  horizon_en: null,
  conditions_en: [],
  creator_conviction: "unspecified" as const,
  risks_en: [],
  levels: [{ kind: "support" as const, value_original: "500" }],
  evidence_ranges: [{ start_id: "a", end_id: "b" }],
};
const spyMention = {
  ticker: "SPY",
  instrument_as_spoken: "SPY",
  market: "us-etf",
  stance: "long",
  sentiment: "bullish",
  rationale_en: "The creator says SPY is too extended above 500.",
  ranges: [{ start_id: "a", end_id: "b" }],
};
const qqqMention = {
  ticker: "QQQ",
  instrument_as_spoken: "QQQ",
  market: "us-etf",
  stance: "watch",
  sentiment: "neutral",
  rationale_en: "QQQ is named only as something to watch.",
  ranges: [{ start_id: "c", end_id: "c" }],
};
const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");

test("the stance to sentiment table answers every stance a claim can carry", () => {
  const stances = Claim.shape.stance.options;
  assert.deepEqual(
    Object.keys(STANCE_SENTIMENT).sort(),
    [...stances].sort(),
    "every stance needs a row in the table",
  );
  for (const stance of stances) {
    const value = STANCE_SENTIMENT[stance];
    assert.ok(
      value === null || SENTIMENTS.includes(value),
      `${stance} maps outside the sentiment enum`,
    );
    assert.ok(SENTIMENTS.includes(sentimentFromStance(stance)));
  }
  assert.equal(sentimentFromStance("long"), "bullish");
  assert.equal(sentimentFromStance("short"), "bearish");
  assert.equal(sentimentFromStance("avoid"), "bearish");
  for (const stance of ["neutral", "watch", "hold"] as const)
    assert.equal(sentimentFromStance(stance), "neutral");
  // Only `conditional` takes the direction of the condition; an unstated one is neutral.
  assert.equal(sentimentFromStance("conditional"), "neutral");
  assert.equal(sentimentFromStance("conditional", null), "neutral");
  assert.equal(sentimentFromStance("conditional", "bearish"), "bearish");
  assert.equal(sentimentFromStance("conditional", "bullish"), "bullish");
  assert.equal(sentimentFromStance("long", "bearish"), "bullish");
  assert.equal(sentimentFromStance("avoid", "bullish"), "bearish");
});

test("a mention needs a rationale and a span, and a non-call keeps the model's sentiment", () => {
  const stored = {
    ...qqqMention,
    source_span: {
      start_id: "c",
      end_id: "c",
      start_seconds: 9,
      end_seconds: 12,
      text_hash: hash("QQQ is only a watch."),
    },
    is_call: false,
    claim_id: null,
  };
  const parsed = Mention.parse(stored);
  assert.equal(parsed.sentiment, "neutral");
  assert.equal(parsed.is_call, false);
  assert.equal(parsed.claim_id, null);
  const { source_span, ...withoutSpan } = stored;
  assert.equal(Mention.safeParse(withoutSpan).success, false);
  assert.equal(
    Mention.safeParse({ ...stored, rationale_en: "" }).success,
    false,
  );
  assert.equal(
    Mention.safeParse({ ...stored, rationale_en: "   " }).success,
    false,
  );
  // Display fields stay English, as everywhere else in the contract.
  assert.equal(
    Mention.safeParse({ ...stored, rationale_en: "只是观察" }).success,
    false,
  );
  assert.equal(Mention.safeParse({ ...stored, market: "lse" }).success, false);
  assert.equal(
    Mention.safeParse({ ...stored, sentiment: "positive" }).success,
    false,
  );
  assert.ok(MARKETS.includes(parsed.market));
  // Extraction returns ranges, never a span, is_call or claim_id.
  const { rationale_en, ...withoutRationale } = qqqMention;
  assert.equal(MentionExtraction.safeParse(withoutRationale).success, false);
  assert.equal(MentionExtraction.safeParse(qqqMention).success, true);
  const extracted = MentionExtraction.parse({
    ...qqqMention,
    is_call: true,
    claim_id: "c1",
  });
  assert.ok(!("is_call" in extracted));
  assert.ok(!("claim_id" in extracted));
  const mentions = (
    extractionResponseSchema.properties as Record<
      string,
      { items: { required: string[]; properties: Record<string, unknown> } }
    >
  ).mentions;
  assert.ok(extractionResponseSchema.required.includes("mentions"));
  for (const field of [
    "ticker",
    "instrument_as_spoken",
    "market",
    "stance",
    "sentiment",
    "rationale_en",
    "ranges",
  ])
    assert.ok(mentions.items.required.includes(field), `${field} not required`);
  assert.equal(
    (mentions.items.properties.ranges as { minItems: number }).minItems,
    1,
  );
  assert.equal(JSON.stringify(mentions).includes("quote"), false);
});

test("mentionsFromClaims derives one call mention per accepted claim", () => {
  const accepted = materializeEvidenceRanges(shortSpy, source);
  const rejected = materializeEvidenceRanges(
    { ...shortSpy, ticker: "QQQ", instrument_as_spoken: "QQQ", stance: "long" },
    source,
  );
  const unnamed = materializeEvidenceRanges(
    { ...shortSpy, ticker: null, instrument_as_spoken: null },
    source,
  );
  const legacy = Claim.parse({
    ...accepted,
    evidence: [
      {
        segment_id: "a",
        quote_original: "I am short SPY here.",
        quote_translation_en: "",
      },
    ],
  });
  const mentions = mentionsFromClaims([
    { id: "c1", claim: accepted, passed: true, reasons: [] },
    { id: "c2", claim: rejected, passed: false, reasons: ["unsupported"] },
    { id: "c3", claim: unnamed, passed: true, reasons: [] },
    { id: "c4", claim: legacy, passed: true, reasons: [] },
  ]);
  assert.equal(mentions.length, 1);
  const [mention] = mentions;
  assert.equal(mention.claim_id, "c1");
  assert.equal(mention.is_call, true);
  assert.equal(mention.ticker, "SPY");
  assert.equal(mention.stance, "short");
  assert.equal(mention.sentiment, "bearish");
  assert.equal(mention.rationale_en, accepted.thesis_en);
  assert.equal(mention.market, "unknown");
  assert.deepEqual(mention.source_span, accepted.evidence[0].source_span);
  assert.deepEqual(mentionsFromClaims([]), []);
});

async function runSynthesis(reply: unknown, name: string) {
  const snapshot = {
    id: "mentions.test.v1",
    rationale: "Fixture prompt snapshot for the mentions test.",
    transcribe: "Transcribe the supplied source fixture.",
    extraction: "Extract claims and mentions from the supplied source fixture.",
    synthesis: "Summarise the supplied claims from the source fixture.",
    critique: "Audit the supplied claim against the source fixture.",
    pointerEvidence: true,
  };
  const run = await create(
    name,
    "google/gemini-3.8-flash",
    { promptSnapshot: snapshot },
    snapshot.id,
  );
  run.stage = "synthesis";
  run.output.metadata = { duration: 16 };
  run.output.source = source;
  const fake = new FakeModelTransport({
    responses: { synthesis: { json: reply } },
  });
  const restore = injectTransport(fake);
  try {
    await step(run);
  } finally {
    restore();
  }
  return { run, fake };
}

test("a fake extraction reply yields stored mentions whose hashes match the source", async () => {
  const { run, fake } = await runSynthesis(
    { claims: [shortSpy], key_points: [], mentions: [spyMention, qqqMention] },
    "mentions-run",
  );
  assert.deepEqual(
    fake.requestsFor("synthesis")[0].responseSchema,
    extractionResponseSchema,
  );
  const mentions = run.output.mentions as Awaited<
    ReturnType<typeof Mention.parse>
  >[];
  assert.equal(mentions.length, 2);
  const [spy, qqq] = mentions;
  // The call: the claim's stance decides, so the model's "long"/"bullish" loses.
  assert.equal(spy.is_call, true);
  assert.equal(spy.claim_id, "c1");
  assert.equal(spy.stance, "short");
  assert.equal(spy.sentiment, "bearish");
  assert.equal(
    spy.source_span.text_hash,
    hash("I am short SPY here. It is too extended above 500."),
  );
  assert.equal(spy.source_span.start_seconds, 1);
  assert.equal(spy.source_span.end_seconds, 9);
  // The non-call keeps what the model graded, with its rationale and span.
  assert.equal(qqq.is_call, false);
  assert.equal(qqq.claim_id, null);
  assert.equal(qqq.sentiment, "neutral");
  assert.equal(qqq.rationale_en, qqqMention.rationale_en);
  assert.equal(qqq.source_span.text_hash, hash("QQQ is only a watch."));
  for (const mention of mentions)
    assert.deepEqual(Mention.parse(mention), mention);
  assert.equal(run.output.rejectedMentions, undefined);
  assert.equal(run.stage, "critique");
});

test("a mention whose span does not resolve is rejected and recorded, never stored", async () => {
  const unknownRange = {
    ...qqqMention,
    rationale_en: "A mention that points at a segment the source never had.",
    ranges: [{ start_id: "zz", end_id: "zz" }],
  };
  const reversed = {
    ...qqqMention,
    ticker: "GLD",
    instrument_as_spoken: "gold",
    rationale_en: "Gold is named with a reversed range.",
    ranges: [{ start_id: "d", end_id: "a" }],
  };
  const noRange = {
    ...qqqMention,
    ticker: null,
    instrument_as_spoken: "the whole market",
    rationale_en: "A mention that cites nothing at all.",
    ranges: [],
  };
  const { run } = await runSynthesis(
    {
      claims: [shortSpy],
      key_points: [],
      mentions: [qqqMention, unknownRange, reversed, noRange],
    },
    "rejected-mentions-run",
  );
  const mentions = run.output.mentions as { ticker: string | null }[];
  assert.deepEqual(
    mentions.map((m) => m.ticker),
    ["QQQ"],
  );
  const rejected = run.output.rejectedMentions as {
    mention: { rationale_en: string };
    reason: string;
  }[];
  assert.equal(rejected.length, 3);
  assert.deepEqual(
    rejected.map((r) => r.mention.rationale_en),
    [unknownRange.rationale_en, reversed.rationale_en, noRange.rationale_en],
  );
  for (const entry of rejected) assert.ok(entry.reason.length > 0);
  assert.match(rejected[0].reason, /range/i);
  assert.match(rejected[2].reason, /cites no source range/);
  await db().close();
});
