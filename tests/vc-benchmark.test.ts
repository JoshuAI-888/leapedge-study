import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  VC_BENCHMARK_VERSION,
  FIXTURE_PATH,
  parseFixture,
  loadFixture,
  benchmark,
  oracleExtraction,
  fakeExtraction,
  predictionsFromClaims,
  writeVcBenchmark,
  type VcFixtureData,
  type VcExtraction,
} from "../src/server/youtube-intelligence/vc-benchmark.ts";
import { doc } from "../src/server/youtube-intelligence/research-store.ts";
import type { ClaimData } from "../src/features/youtube-intelligence/contracts.ts";

const header = {
  dataset: "gtfintechlab/VideoConviction",
  split: "train",
  license: "CC BY-NC 4.0",
  attribution: "test attribution",
  source: "https://datasets-server.huggingface.co/rows?dataset=gtfintechlab%2FVideoConviction",
  fetchedAt: "2026-09-17T00:00:00Z",
  placeholder: false,
};
const row = (
  id: string,
  expected: {
    isRecPresent: "Yes" | "No";
    action: string | null;
    convictionScore: number | null;
    ticker: string | null;
  },
  transcript = `segment ${id}`,
) => ({
  id,
  videoId: "0CJU8R4oNFk",
  start: 10,
  end: 20,
  actionSource: expected.isRecPresent === "Yes" ? "Selected region" : null,
  expected,
  transcript,
});
const five = (): VcFixtureData =>
  parseFixture({
    ...header,
    rows: [
      row("r1", { isRecPresent: "Yes", action: "Buy", convictionScore: 2, ticker: "VERI" }),
      row("r2", { isRecPresent: "Yes", action: "Sell", convictionScore: 3, ticker: "NYSE: WYNN" }),
      row("r3", { isRecPresent: "Yes", action: "Don't buy", convictionScore: 1, ticker: "SPY" }),
      row("r4", { isRecPresent: "No", action: null, convictionScore: null, ticker: null }, ""),
      row("r5", { isRecPresent: "Yes", action: "Buy", convictionScore: 3, ticker: "ZM" }),
    ],
  });
const p = (
  ticker: string | null,
  stance: string,
  conviction: string,
  tickerExplicit = true,
) => ({ ticker, tickerExplicit, stance, conviction });
const extraction = (): VcExtraction => ({
  r1: [p("VERI", "long", "medium")],
  r2: [p("WYNN", "avoid", "high")],
  r3: [],
  r4: [p("TSLA", "long", "high")],
  r5: [p("NET", "long", "low"), p("ZM", "long", "high", false)],
});

test("Benchmark reports ticker, stance, action, conviction and no-rec agreement on a 5-row fixture", () => {
  const report = benchmark(five(), extraction(), { model: "fake", promptVersion: "test.v1", arm: "text" });
  assert.equal(report.version, VC_BENCHMARK_VERSION);
  assert.match(report.id, /^vcBenchmark:/);
  assert.deepEqual(report.counts, {
    rows: 5,
    scored: 5,
    missing: 0,
    rec: 4,
    noRec: 1,
    predictions: 5,
  });
  assert.deepEqual(report.agreement.ticker, { agree: 2, total: 4, rate: 0.5 });
  assert.deepEqual(report.agreement.stance, { agree: 2, total: 4, rate: 0.5 });
  assert.deepEqual(report.agreement.action, { agree: 3, total: 5, rate: 0.6 });
  assert.deepEqual(report.agreement.conviction, { agree: 3, total: 4, rate: 0.75 });
  assert.deepEqual(report.agreement.noRec, { agree: 0, total: 1, rate: 0 });
  const byId = Object.fromEntries(report.rows.map((r) => [r.rowId, r]));
  // Format-only ticker normalisation: "NYSE: WYNN" matches WYNN.
  assert.equal(byId.r2.expected.ticker, "WYNN");
  assert.equal(byId.r2.tickerMatch, true);
  assert.equal(byId.r2.stanceMatch, false, "avoid is not short in the 7-way space");
  assert.equal(byId.r2.actionMatch, true, "but both are sell in the coarse space");
  // No prediction at all for a labelled recommendation counts against every field.
  assert.equal(byId.r3.predicted, null);
  assert.deepEqual(
    [byId.r3.tickerMatch, byId.r3.stanceMatch, byId.r3.convictionMatch, byId.r3.actionMatch],
    [false, false, false, false],
  );
  // A no-rec row with a predicted claim is a violation, and only that metric applies.
  assert.equal(byId.r4.noRecRespected, false);
  assert.equal(byId.r4.tickerMatch, null);
  assert.equal(byId.r4.convictionMatch, null);
  assert.equal(byId.r4.actionMatch, false);
  // The prediction naming the expected ticker is preferred over the first claim,
  // but an implicit ticker never earns ticker agreement.
  assert.equal(byId.r5.predicted?.ticker, "ZM");
  assert.equal(byId.r5.tickerMatch, false);
  assert.equal(byId.r5.stanceMatch, true);
  assert.equal(byId.r5.convictionMatch, true);
  assert.equal(report.config.model, "fake");
  assert.equal(report.fixture.rowCount, 5);
  assert.equal(report.attribution, "test attribution");
});

test("Confusion matrices are expected-by-predicted over the coarse action, stance and conviction spaces", () => {
  const report = benchmark(five(), extraction(), { arm: "text" });
  const { action, stance, conviction } = report.confusion;
  assert.deepEqual(action.labels, ["buy", "sell", "hold", "none"]);
  assert.deepEqual(action.counts, {
    buy: { buy: 2, sell: 0, hold: 0, none: 0 },
    sell: { buy: 0, sell: 1, hold: 0, none: 1 },
    hold: { buy: 0, sell: 0, hold: 0, none: 0 },
    none: { buy: 1, sell: 0, hold: 0, none: 0 },
  });
  const cell = (m: typeof stance, e: string, pr: string) => m.counts[e]?.[pr] ?? 0;
  assert.equal(cell(stance, "long", "long"), 2);
  assert.equal(cell(stance, "short", "avoid"), 1);
  assert.equal(cell(stance, "avoid", "none"), 1);
  assert.equal(cell(stance, "none", "long"), 1);
  assert.equal(
    stance.labels.reduce((n, e) => n + stance.labels.reduce((m, q) => m + cell(stance, e, q), 0), 0),
    5,
  );
  assert.deepEqual(conviction.labels, ["low", "medium", "high", "unspecified", "none"]);
  assert.equal(cell(conviction, "medium", "medium"), 1);
  assert.equal(cell(conviction, "high", "high"), 2);
  assert.equal(cell(conviction, "low", "none"), 1);
  assert.equal(
    conviction.labels.reduce((n, e) => n + conviction.labels.reduce((m, q) => m + cell(conviction, e, q), 0), 0),
    4,
    "no-rec rows carry no conviction label and stay out of the conviction matrix",
  );
});

test("Rows absent from the extraction are reported as missing and excluded from every denominator", () => {
  const partial = extraction();
  delete partial.r5;
  const report = benchmark(five(), partial, { arm: "text" });
  assert.equal(report.counts.missing, 1);
  assert.equal(report.counts.scored, 4);
  assert.equal(report.rows.find((r) => r.rowId === "r5")?.status, "missing");
  assert.deepEqual(report.agreement.ticker, { agree: 2, total: 3, rate: 2 / 3 });
  assert.deepEqual(report.agreement.stance, { agree: 1, total: 3, rate: 1 / 3 });
  assert.deepEqual(report.agreement.conviction, { agree: 2, total: 3, rate: 2 / 3 });
  assert.deepEqual(report.agreement.action, { agree: 2, total: 4, rate: 0.5 });
  const empty = benchmark(five(), {}, { arm: "text" });
  assert.equal(empty.counts.missing, 5);
  assert.deepEqual(empty.agreement.ticker, { agree: 0, total: 0, rate: null });
});

test("The oracle extraction scores 100% and the fake extraction is deterministic and imperfect", () => {
  const fx = five();
  const perfect = benchmark(fx, oracleExtraction(fx), { arm: "text" });
  for (const k of ["ticker", "stance", "action", "conviction", "noRec"] as const)
    assert.equal(perfect.agreement[k].rate, 1, k);
  const a = fakeExtraction(fx);
  assert.deepEqual(a, fakeExtraction(fx));
  const imperfect = benchmark(fx, a, { arm: "text" });
  assert.ok(
    imperfect.agreement.stance.rate! < 1 || imperfect.agreement.ticker.rate! < 1,
    "the fake extraction perturbs at least one field",
  );
});

test("Predictions derive from Claim rows without touching evidence", () => {
  const claim = {
    thesis_en: "Buy NVDA",
    instrument_as_spoken: "Nvidia",
    ticker: "NVDA",
    ticker_explicit: true,
    stance: "long",
    horizon_en: null,
    conditions_en: [],
    creator_conviction: "high",
    risks_en: [],
    levels: [],
    evidence: [{ segment_id: "s00001", quote_original: "buy nvidia", quote_translation_en: "buy nvidia" }],
  } satisfies ClaimData;
  assert.deepEqual(predictionsFromClaims([claim]), [
    { ticker: "NVDA", tickerExplicit: true, stance: "long", conviction: "high" },
  ]);
});

test("Fixture parsing rejects unknown labels, bad scores and predictions with unknown stances", () => {
  const bad = { ...header, rows: [row("x", { isRecPresent: "Yes", action: "Strong buy", convictionScore: 2, ticker: "A" })] };
  assert.throws(() => parseFixture(bad));
  const badScore = { ...header, rows: [row("x", { isRecPresent: "Yes", action: "Buy", convictionScore: 5, ticker: "A" })] };
  assert.throws(() => parseFixture(badScore));
  assert.throws(() => benchmark(five(), { r1: [p("VERI", "bullish", "high")] }, { arm: "text" }), /stance/i);
});

test("The committed fixture is real data with the expected header and 60 labelled rows", () => {
  const fx = loadFixture();
  assert.equal(FIXTURE_PATH, "evaluations/vc-benchmark-fixture.json");
  assert.equal(fx.dataset, "gtfintechlab/VideoConviction");
  assert.equal(fx.license, "CC BY-NC 4.0");
  assert.match(fx.attribution, /VideoConviction/);
  assert.match(fx.attribution, /huggingface\.co\/datasets\/gtfintechlab\/VideoConviction/);
  assert.equal(fx.placeholder, false);
  assert.equal(fx.rows.length, 60);
  assert.equal(new Set(fx.rows.map((r) => r.id)).size, 60, "row ids are unique");
  for (const r of fx.rows) {
    assert.ok(!("videoDescription" in r) && !("comments" in r) && !("channelTitle" in r), "only label and transcript columns");
    if (r.expected.isRecPresent === "Yes") assert.ok(r.transcript.trim().length > 0, `${r.id} has a segment transcript`);
  }
});

test("writeVcBenchmark stores the report as a vcBenchmark document", async () => {
  await freshDatabase();
  const report = benchmark(five(), extraction(), { model: "fake", promptVersion: "test.v1", arm: "text" });
  const stored = await writeVcBenchmark(report);
  assert.equal(stored.id, report.id);
  const read = await doc<typeof report>("vcBenchmark", report.id);
  assert.ok(read);
  assert.deepEqual(read.agreement, report.agreement);
  assert.equal(read.rows.length, 5);
});
