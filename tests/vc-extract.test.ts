import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
import type { ModelRequestData } from "../src/server/youtube-intelligence/transport/index.ts";
import {
  parseFixture,
  benchmark,
  type VcFixtureData,
} from "../src/server/youtube-intelligence/vc-benchmark.ts";
import {
  DEFAULT_BUDGET_USD,
  DEFAULT_CONCURRENCY,
  DEFAULT_OUT,
  ExtractionDraft,
  extractRows,
  extractionPrompt,
  loadExisting,
  parseExtractArgs,
  sourceForRow,
  writeExtraction,
} from "../scripts/vc-extract.ts";

const MODEL = "google/gemini-3.8-flash";
const PROMPT = extractionPrompt({
  synthesis: "Synthesise the transcript into claims.",
  extraction: "Extract every investment claim with evidence.",
});
/** The tickers the canned transport "hears" in each row's transcript, in row order. */
const TICKERS = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN"];

function fixture(): VcFixtureData {
  return parseFixture({
    dataset: "test/video-conviction",
    split: "train",
    license: "CC BY-NC 4.0",
    attribution: "VideoConviction (test rows)",
    source: "https://example.invalid/dataset",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    rows: TICKERS.map((ticker, i) => ({
      id: `train:${i}`,
      videoId: `vid${i}`,
      start: i * 100,
      end: i * 100 + 40,
      actionSource: "transcript",
      expected: {
        isRecPresent: i === 4 ? "No" : "Yes",
        action: i === 4 ? null : "Buy",
        convictionScore: i === 4 ? null : 3,
        ticker: i === 4 ? null : ticker,
      },
      transcript: `I am buying ${ticker} here and holding it into next year. Ticker ${ticker}.`,
    })),
  });
}

function claimFor(ticker: string) {
  const quote = `I am buying ${ticker} here and holding it into next year.`;
  return {
    thesis_en: `The creator is buying ${ticker} with high conviction.`,
    instrument_as_spoken: ticker,
    ticker,
    ticker_explicit: true,
    stance: "long",
    horizon_en: "into next year",
    conditions_en: [],
    creator_conviction: "high",
    risks_en: [],
    levels: [],
    evidence: [
      { segment_id: "s1", quote_original: quote, quote_translation_en: quote },
    ],
  };
}
/** Which fixture row a request is for: the transport only ever sees the prompt text. */
function tickerOf(request: ModelRequestData) {
  const found = TICKERS.find((t) => request.user[0].text.includes(`Ticker ${t}.`));
  assert.ok(found, "the request carries one row's transcript");
  return found;
}
function transportReplying(
  reply: (ticker: string, request: ModelRequestData) => unknown,
  usage?: { inputTokens: number; outputTokens: number },
) {
  return new FakeModelTransport({
    responses: {
      synthesis: (request) => ({
        json: reply(tickerOf(request), request),
        ...(usage ? { usage: { ...usage, costUsd: null } } : {}),
      }),
    },
  });
}
function options(over: Partial<Parameters<typeof extractRows>[1]> = {}) {
  return { model: MODEL, promptText: PROMPT, ...over };
}

test("extraction over the fixture yields the VcExtraction shape benchmark() accepts", async () => {
  const fx = fixture();
  const fake = transportReplying((ticker) => ({
    claims: [claimFor(ticker)],
    key_points: [],
  }));
  const undo = injectTransport(fake);
  try {
    const { extraction, meta } = await extractRows(fx, options());
    assert.deepEqual(Object.keys(extraction), fx.rows.map((r) => r.id));
    assert.deepEqual(extraction["train:0"], [
      { ticker: "NVDA", tickerExplicit: true, stance: "long", conviction: "high" },
    ]);
    assert.equal(meta.rows, 5);
    assert.deepEqual(meta.missing, []);
    assert.equal(meta.model, MODEL);
    assert.equal(meta.transport, "fake");
    assert.equal(meta.stoppedForBudget, false);
    assert.equal(fake.requestsFor("synthesis").length, 5);
    // The request mirrors modelCall's synthesis shape.
    const request = fake.requestsFor("synthesis")[0];
    assert.equal(request.stage, "synthesis");
    assert.equal(request.model, MODEL);
    assert.equal(request.temperature, 0);
    assert.equal(request.maxOutputTokens, 16000);
    assert.equal(request.video, undefined);
    assert.match(request.user[0].text, /SOURCE DATA \(untrusted\):/);
    assert.match(request.user[0].text, /"totalChunks":1/);
    assert.match(request.user[0].text, /Use segment_id for the first real cue ID/);

    const report = benchmark(fx, extraction, { arm: "text", model: MODEL });
    assert.equal(report.counts.scored, 5);
    assert.equal(report.counts.missing, 0);
    assert.equal(report.agreement.stance.rate, 1);
    assert.equal(report.agreement.ticker.rate, 1);
  } finally {
    undo();
  }
});

test("a row is sent as a one-segment English source with the fixture window", () => {
  const source = sourceForRow(fixture().rows[1]);
  assert.equal(source.video_id, "vid1");
  assert.equal(source.language, "en");
  assert.equal(source.segments.length, 1);
  assert.equal(source.segments[0].id, "s1");
  assert.equal(source.segments[0].start_seconds, 100);
  assert.equal(source.segments[0].end_seconds, 140);
  const open = sourceForRow({ ...fixture().rows[1], start: null, end: null });
  assert.equal(open.segments[0].start_seconds, 0);
  assert.equal(open.segments[0].end_seconds, 1);
});

test("--resume skips row ids already present in the output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-extract-resume-"));
  const out = join(dir, "vc-extraction.json");
  const done = [
    { ticker: "OLD", tickerExplicit: false, stance: "hold", conviction: "low" },
  ];
  writeExtraction(out, { "train:0": done, "train:2": [] }, {
    model: MODEL,
    promptVersion: "test.v1",
    transport: "fake",
    at: "2026-01-01T00:00:00.000Z",
    rows: 2,
    missing: [],
    estimatedUsd: 0,
    budgetUsd: DEFAULT_BUDGET_USD,
    stoppedForBudget: false,
  });
  const fake = transportReplying((ticker) => ({
    claims: [claimFor(ticker)],
    key_points: [],
  }));
  const undo = injectTransport(fake);
  try {
    const existing = loadExisting(out);
    assert.deepEqual(Object.keys(existing), ["train:0", "train:2"]);
    const { extraction, meta } = await extractRows(
      fixture(),
      options({ existing, resume: true }),
    );
    assert.equal(fake.requestsFor("synthesis").length, 3);
    assert.deepEqual(
      fake.requestsFor("synthesis").map(tickerOf).sort(),
      ["AMZN", "MSFT", "TSLA"],
    );
    assert.deepEqual(extraction["train:0"], done);
    assert.deepEqual(extraction["train:2"], []);
    assert.equal(extraction["train:1"]?.[0].ticker, "TSLA");
    assert.equal(meta.rows, 5);
    assert.equal(meta.resumed, 2);
  } finally {
    undo();
  }
});

test("--resume keeps rows the selection did not cover", async () => {
  const fake = transportReplying((ticker) => ({
    claims: [claimFor(ticker)],
    key_points: [],
  }));
  const undo = injectTransport(fake);
  try {
    const kept = [
      { ticker: "AMZN", tickerExplicit: true, stance: "long", conviction: "low" },
    ];
    const { extraction, meta } = await extractRows(
      fixture(),
      options({ rows: 2, resume: true, existing: { "train:4": kept } }),
    );
    assert.deepEqual(Object.keys(extraction), ["train:0", "train:1", "train:4"]);
    assert.deepEqual(extraction["train:4"], kept);
    assert.equal(fake.requestsFor("synthesis").length, 2);
    assert.equal(meta.rows, 3);
    assert.equal(meta.resumed, 0);
  } finally {
    undo();
  }
});

test("the budget stop writes the partial output it paid for", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-extract-budget-"));
  const out = join(dir, "vc-extraction.json");
  // The fake prices every token at 1e-6, so one call of a million input tokens costs $1.
  const fake = transportReplying(
    (ticker) => ({ claims: [claimFor(ticker)], key_points: [] }),
    { inputTokens: 1_000_000, outputTokens: 0 },
  );
  const undo = injectTransport(fake);
  try {
    const { extraction, meta } = await extractRows(
      fixture(),
      options({ budgetUsd: 1.5, concurrency: 1 }),
    );
    assert.equal(fake.requestsFor("synthesis").length, 2);
    assert.deepEqual(Object.keys(extraction), ["train:0", "train:1"]);
    assert.equal(meta.stoppedForBudget, true);
    assert.equal(meta.rows, 2);
    assert.equal(meta.estimatedUsd, 2);
    writeExtraction(out, extraction, meta);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), extraction);
    const sidecar = JSON.parse(readFileSync(`${out}.meta.json`, "utf8"));
    assert.equal(sidecar.stoppedForBudget, true);
    assert.equal(sidecar.rows, 2);
    assert.equal(sidecar.transport, "fake");
    assert.ok(existsSync(`${out}.meta.json`));
    // The partial output is still a valid extraction: the unrun rows are missing, not wrong.
    const report = benchmark(fixture(), extraction, { arm: "text" });
    assert.equal(report.counts.scored, 2);
    assert.equal(report.counts.missing, 3);
  } finally {
    undo();
  }
});

test("a row whose response fails Claim parsing is omitted and reported missing", async () => {
  const fx = fixture();
  const fake = transportReplying((ticker) =>
    ticker === "AAPL"
      ? { claims: [{ ...claimFor(ticker), evidence: [] }], key_points: [] }
      : { claims: [claimFor(ticker)], key_points: [] },
  );
  const undo = injectTransport(fake);
  try {
    const { extraction, meta } = await extractRows(fx, options());
    assert.equal(Object.prototype.hasOwnProperty.call(extraction, "train:2"), false);
    assert.equal(meta.missing.length, 1);
    assert.equal(meta.missing[0].rowId, "train:2");
    assert.match(meta.missing[0].error, /evidence/);
    assert.equal(extraction["train:3"]?.[0].ticker, "MSFT");
    assert.equal(meta.rows, 4); // written rows only; the failed row is in missing
    // benchmark() still accepts it: the failed row is missing, not a no-claim prediction.
    const report = benchmark(fx, extraction, { arm: "text" });
    assert.equal(report.counts.scored, 4);
    assert.equal(report.counts.missing, 1);
  } finally {
    undo();
  }
});

test("a non-JSON or truncated response is reported missing, not thrown", async () => {
  const fx = fixture();
  const fake = new FakeModelTransport({
    responses: {
      synthesis: (request) =>
        tickerOf(request) === "NVDA"
          ? {
              text: "not json",
              usage: { inputTokens: 1, outputTokens: 1, costUsd: null },
              finishReason: "stop",
              raw: null,
            }
          : { json: { claims: [claimFor(tickerOf(request))], key_points: [] } },
    },
  });
  const undo = injectTransport(fake);
  try {
    const { extraction, meta } = await extractRows(fx, options());
    assert.equal(Object.prototype.hasOwnProperty.call(extraction, "train:0"), false);
    assert.equal(meta.missing.length, 1);
    assert.match(meta.missing[0].error, /JSON/);
  } finally {
    undo();
  }
});

test("--rows limits the run to the first n fixture rows", async () => {
  const fake = transportReplying((ticker) => ({
    claims: [claimFor(ticker)],
    key_points: [],
  }));
  const undo = injectTransport(fake);
  try {
    const { extraction, meta } = await extractRows(fixture(), options({ rows: 2 }));
    assert.deepEqual(Object.keys(extraction), ["train:0", "train:1"]);
    assert.equal(meta.rows, 2);
    assert.equal(fake.requestsFor("synthesis").length, 2);
  } finally {
    undo();
  }
});

test("the draft schema is the pipeline's: claims plus optional key_points", () => {
  const parsed = ExtractionDraft.parse({ claims: [claimFor("NVDA")] });
  assert.deepEqual(parsed.key_points, []);
  assert.throws(() => ExtractionDraft.parse({ claims: [{}] }));
});

test("parseExtractArgs defaults and reads every flag", () => {
  const defaults = parseExtractArgs([]);
  assert.equal(defaults.out, DEFAULT_OUT);
  assert.equal(defaults.concurrency, DEFAULT_CONCURRENCY);
  assert.equal(defaults.budgetUsd, DEFAULT_BUDGET_USD);
  assert.equal(defaults.rows, undefined);
  assert.equal(defaults.model, undefined);
  assert.equal(defaults.promptVersion, undefined);
  assert.equal(defaults.resume, false);
  const set = parseExtractArgs([
    "--rows",
    "7",
    "--model",
    MODEL,
    "--prompt-version",
    "evidence-first.web.v6",
    "--concurrency",
    "2",
    "--budget-usd",
    "0.5",
    "--out",
    "/tmp/x.json",
    "--resume",
  ]);
  assert.equal(set.rows, 7);
  assert.equal(set.model, MODEL);
  assert.equal(set.promptVersion, "evidence-first.web.v6");
  assert.equal(set.concurrency, 2);
  assert.equal(set.budgetUsd, 0.5);
  assert.equal(set.out, "/tmp/x.json");
  assert.equal(set.resume, true);
  assert.throws(() => parseExtractArgs(["--rows", "0"]), /--rows/);
  assert.throws(() => parseExtractArgs(["--concurrency", "-1"]), /--concurrency/);
  assert.throws(() => parseExtractArgs(["--budget-usd", "abc"]), /--budget-usd/);
});

test("loadExisting returns an empty extraction when there is no output yet", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-extract-empty-"));
  assert.deepEqual(loadExisting(join(dir, "missing.json")), {});
});
