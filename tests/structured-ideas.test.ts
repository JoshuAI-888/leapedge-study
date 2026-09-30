import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YTI_DB = "pglite";
delete process.env.DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fixture";
process.env.YTI_BUDGET_USD = "10";
const { Source } = await import("../src/features/youtube-intelligence/contracts.ts");
const { structuredExtractionResponseSchema, extractionResponseSchema } = await import(
  "../src/server/youtube-intelligence/schemas/extraction.ts"
);
const { FakeModelTransport } = await import("../src/server/youtube-intelligence/transport/fake.ts");
const { injectTransport } = await import("../src/server/youtube-intelligence/transport/index.ts");
const { create } = await import("../src/server/youtube-intelligence/store.ts");
const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");

const source = Source.parse({
  source_kind: "imported_transcript",
  segment_separator: " ",
  segments: [
    { id: "a", text: "I bought a $70 call on Uber expiring in January.", start_seconds: 0, end_seconds: 6 },
    { id: "b", text: "The premium was $1.85 and breakeven is $81.85.", start_seconds: 6, end_seconds: 12 },
    { id: "c", text: "Morgan Stanley has a $475 target on Tesla.", start_seconds: 12, end_seconds: 18 },
  ],
});
const uberCall = {
  thesis_en: "The creator bought a January $70 call on Uber.",
  instrument_as_spoken: "Uber",
  ticker: null,
  ticker_explicit: false,
  stance: "long",
  horizon_en: "January",
  conditions_en: [],
  creator_conviction: "high",
  risks_en: [],
  levels: [{ kind: "strike", value_original: "$70", condition_en: null }],
  evidence_ranges: [{ start_id: "a", end_id: "b" }],
  action: "bought",
  owner: "creator",
  owner_name: null,
  option: { right: "call", side: "long", strike_original: "$70", expiry_original: "January", premium_original: "$1.85" },
  size_original: "$5,000",
  catalysts: [],
};
const teslaTarget = {
  thesis_en: "Morgan Stanley has a $475 target on Tesla.",
  instrument_as_spoken: "Tesla",
  ticker: null,
  ticker_explicit: false,
  stance: "long",
  horizon_en: null,
  conditions_en: [],
  creator_conviction: "unspecified",
  risks_en: [],
  levels: [{ kind: "target", value_original: "$475", condition_en: null }],
  evidence_ranges: [{ start_id: "c", end_id: "c" }],
  action: "view",
  owner: "third_party",
  owner_name: "Morgan Stanley",
  option: null,
  size_original: null,
  catalysts: [],
};

let runCount = 0;
async function run(structuredIdeas: boolean, reply: unknown) {
  const snapshot = {
    id: structuredIdeas ? "structured.test.v9" : "structured.test.v8",
    rationale: "Fixture prompt snapshot for the structured ideas test.",
    transcribe: "Transcribe the supplied source fixture.",
    extraction: "Extract claims and mentions from the supplied source fixture.",
    synthesis: "Summarise the supplied claims from the source fixture.",
    critique: "Audit the supplied claim against the source fixture.",
    pointerEvidence: true,
    ...(structuredIdeas ? { structuredIdeas: true } : {}),
  };
  const r = await create(`structured-${structuredIdeas}-${++runCount}`, "google/gemini-3.8-flash", { promptSnapshot: snapshot }, snapshot.id);
  r.stage = "synthesis";
  r.output.metadata = { duration: 18 };
  r.output.source = source;
  const fake = new FakeModelTransport({ responses: { synthesis: { json: reply } } });
  const restore = injectTransport(fake);
  try {
    await step(r);
  } finally {
    restore();
  }
  return { r, fake };
}

test("v9 asks for structured ideas, keeps what was said, removes what was not, and records doubts", async () => {
  const { r, fake } = await run(true, {
    claims: [uberCall, teslaTarget],
    key_points: [],
    mentions: [],
    transcription_doubts: [
      { start_id: "b", end_id: "b", heard: "$1.85", likely: "$11.85", reason_en: "A $70 strike with an $81.85 breakeven implies an $11.85 premium." },
      { start_id: "c", end_id: "c", heard: "$9.99", likely: "$99", reason_en: "Not in this range, so it is dropped." },
    ],
  });
  assert.deepEqual(fake.requestsFor("synthesis")[0].responseSchema, structuredExtractionResponseSchema);
  const claims = r.output.claims as { id: string; claim: Record<string, any> }[];
  const uber = claims.find((c) => c.claim.instrument_as_spoken === "Uber")!.claim;
  assert.equal(uber.action, "bought");
  assert.equal(uber.option.strike_original, "$70");
  assert.equal(uber.option.premium_original, "$1.85", "kept as heard, not corrected");
  assert.equal(uber.size_original, null, "a size that was never said is removed");
  const tesla = claims.find((c) => c.claim.instrument_as_spoken === "Tesla")!.claim;
  assert.equal(tesla.owner, "third_party");
  assert.equal(tesla.owner_name, "Morgan Stanley");
  const removals = r.output.ideaDetailRemovals as { id: string; field: string; value: string }[];
  assert.deepEqual(removals.map((x) => [x.field, x.value]), [["size_original", "$5,000"]]);
  const doubts = r.output.transcriptionDoubts as { heard: string; likely: string; start_seconds: number }[];
  assert.equal(doubts.length, 1);
  assert.equal(doubts[0].likely, "$11.85");
  assert.equal(doubts[0].start_seconds, 6);
});

test("earlier prompt versions keep the earlier schema and output", async () => {
  const { r, fake } = await run(false, { claims: [], key_points: [], mentions: [] });
  assert.deepEqual(fake.requestsFor("synthesis")[0].responseSchema, extractionResponseSchema);
  assert.equal(r.output.transcriptionDoubts, undefined);
  assert.equal(r.output.ideaDetailRemovals, undefined);
});

test("one malformed item drops that item with its reason instead of failing the extraction", async () => {
  const badKeyPoint = { ...teslaTarget, horizon_en: "长期", action: undefined, owner: undefined, owner_name: undefined, option: undefined, size_original: undefined, catalysts: undefined, levels: [] };
  const { r } = await run(true, { claims: [uberCall], key_points: [badKeyPoint], mentions: [], transcription_doubts: [] });
  assert.equal(r.status === "failed", false);
  assert.equal(r.stage, "critique");
  assert.equal((r.output.claims as unknown[]).length, 1);
  const dropped = r.output.rejectedEvidence as { kind: string; reason: string }[];
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].kind, "key_point");
  assert.match(dropped[0].reason, /horizon_en.*English/);
});
