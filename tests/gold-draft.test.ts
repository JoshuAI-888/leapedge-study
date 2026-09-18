import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOLD_SET_VERSION,
  parseGoldSet,
} from "../evaluations/gold-set/schema.ts";
import {
  DraftError,
  FlagError,
  GOLD_DRAFT_VERSION,
  USAGE,
  draftCase,
  draftGoldSet,
  formatReport,
  goldLanguage,
  parseOptions,
  readRunRows,
  recordedLanguage,
  summary,
  type RunRowData,
} from "../scripts/gold-draft.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const cli = promisify(execFile);

type CliFailure = { code?: number; stdout?: string; stderr?: string };
function failing(args: string[]): Promise<CliFailure> {
  return cli(
    process.execPath,
    ["--experimental-strip-types", "scripts/gold-draft.ts", ...args],
    { cwd: ROOT },
  ).then(
    (ok): CliFailure => ({ stdout: ok.stdout, stderr: ok.stderr }),
    (e: CliFailure): CliFailure => e,
  );
}

type Json = Record<string, unknown>;

/**
 * A minimal exported-run fixture: the fields scripts/export-runs.ts writes,
 * with the claim, mention and pointer shapes the contracts define. Nothing
 * here touches a database, so the fixture helpers are not needed.
 */
function span(text: string, start: number, end: number): Json {
  return {
    start_id: `s${start}`,
    end_id: `s${end}`,
    start_seconds: start,
    end_seconds: end,
    text_hash: createHash("sha256").update(text).digest("hex"),
  };
}

const APPLE_QUOTE = "I am buying Apple here";

function evidence(text: string, start: number, end: number, pointer = true): Json {
  return {
    segment_id: `s${start}`,
    end_segment_id: `s${end}`,
    quote_original: text,
    quote_translation_en: text,
    ...(pointer ? { source_span: span(text, start, end) } : {}),
  };
}

function checkedClaim(over: Json = {}, claimOver: Json = {}): Json {
  return {
    id: "c1",
    passed: true,
    reasons: [],
    ...over,
    claim: {
      thesis_en: "Buying Apple into the next product cycle.",
      instrument_as_spoken: "Apple",
      ticker: "AAPL",
      ticker_explicit: true,
      stance: "long",
      horizon_en: null,
      conditions_en: [],
      creator_conviction: "high",
      risks_en: [],
      levels: [],
      evidence: [evidence(APPLE_QUOTE, 10, 20)],
      ...claimOver,
    },
  };
}

function mention(over: Json = {}): Json {
  return {
    ticker: "TSLA",
    instrument_as_spoken: "Tesla",
    market: "us-stock",
    stance: "watch",
    sentiment: "neutral",
    rationale_en: "He is only watching Tesla, with no decision either way.",
    source_span: span("Tesla I am only watching", 40, 55),
    is_call: false,
    claim_id: null,
    ...over,
  };
}

function runRow(over: Partial<RunRowData> = {}): RunRowData {
  const videoId = over.videoId ?? "aaaaaaaaaaa";
  return {
    id: "run-1",
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    model: "fixture-model",
    promptVersion: "fixture.v1",
    title: "Fixture run",
    status: "completed",
    stage: "done",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:10:00.000Z",
    error: null,
    input: {},
    output: {
      source: {
        source_kind: "imported_transcript",
        language: "en",
        segments: [{ id: "s10", text: APPLE_QUOTE, start_seconds: 10, end_seconds: 20 }],
      },
      claims: [checkedClaim()],
      mentions: [mention()],
    },
    cost: 0.02,
    ...over,
  };
}

const draft = (rows: RunRowData[]) => draftGoldSet(rows, { split: "development" });

function tempDir() {
  return mkdtempSync(join(tmpdir(), "yti-gold-draft-"));
}

test("a drafted set parses, and every case is pending with no verified anchor", () => {
  const result = draft([
    runRow(),
    runRow({ id: "run-2", videoId: "bbbbbbbbbbb" }),
  ]);
  assert.equal(result.version, GOLD_DRAFT_VERSION);
  assert.equal(result.runsRead, 2);
  assert.equal(result.cases.length, 2);
  assert.deepEqual(result.skipped, []);

  const reparsed = parseGoldSet(JSON.parse(JSON.stringify(result.set)));
  assert.equal(reparsed.version, GOLD_SET_VERSION);
  assert.equal(reparsed.cases.length, 2);
  for (const c of reparsed.cases) {
    assert.equal(c.status, "pending");
    assert.equal(c.review ?? null, null);
    assert.equal(c.split, "development");
    assert.equal(c.language, "en");
    assert.ok(c.expectedClaims.length > 0);
    for (const claim of c.expectedClaims) {
      assert.equal(claim.anchorVerified, false);
      assert.equal(claim.reviewer, "");
      assert.equal(claim.reviewedAt, "");
    }
  }
});

test("claims and mentions are copied from the run output, nothing invented", () => {
  const result = draft([runRow()]);
  const [c] = result.cases;
  assert.equal(c.videoId, "aaaaaaaaaaa");
  // Run id and prompt version only: a drafted case is committed, so it names
  // no model.
  assert.equal(c.source, "run run-1 (fixture.v1)");
  assert.deepEqual(c.expectedClaims, [
    {
      id: "c1",
      ticker: "AAPL",
      stance: "long",
      creator_conviction: "high",
      sentiment: "bullish",
      span: { startSeconds: 10, endSeconds: 20, text: APPLE_QUOTE },
      anchorVerified: false,
      reviewer: "",
      reviewedAt: "",
    },
  ]);
  assert.equal(c.expectedRejections.length, 1);
  assert.equal(c.expectedRejections[0].ticker, "TSLA");
  assert.match(c.expectedRejections[0].reason, /Tesla/);
  assert.match(
    c.expectedRejections[0].reason,
    /He is only watching Tesla, with no decision either way\./,
  );
});

test("a run that is not completed is skipped, not half-drafted", () => {
  const result = draft([
    runRow(),
    runRow({ id: "run-2", videoId: "bbbbbbbbbbb", status: "running", stage: "extract" }),
  ]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].videoId, "aaaaaaaaaaa");
  assert.deepEqual(result.skipped, [
    { runId: "run-2", videoId: "bbbbbbbbbbb", reason: "status is running, not completed" },
  ]);
  assert.ok(!JSON.stringify(result.set).includes("bbbbbbbbbbb"));
  parseGoldSet(JSON.parse(JSON.stringify(result.set)));
});

test("a failed run is skipped whatever its output holds", () => {
  const result = draft([runRow({ status: "failed", error: "provider refused" })]);
  assert.deepEqual(result.cases, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /not completed/);
});

test("a run with an untickered accepted claim is skipped whole", () => {
  const result = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [
          checkedClaim(),
          checkedClaim({ id: "c2" }, { ticker: null, instrument_as_spoken: "that miner" }),
        ],
        mentions: [],
      },
    }),
  ]);
  assert.deepEqual(result.cases, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /claim c2 names no ticker/);
});

test("a rejected candidate claim is not drafted as an expectation", () => {
  const result = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [
          checkedClaim(),
          checkedClaim({ id: "c2", passed: false, reasons: ["Quote not in source"] }, {
            ticker: "MSFT",
          }),
        ],
        mentions: [],
      },
    }),
  ]);
  assert.deepEqual(
    result.cases[0].expectedClaims.map((x) => x.id),
    ["c1"],
  );
  assert.deepEqual(result.cases[0].expectedRejections, []);
});

test("a claim with no pointer evidence keeps a null span and says so", () => {
  const result = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [checkedClaim({}, { evidence: [evidence(APPLE_QUOTE, 10, 20, false)] })],
        mentions: [],
      },
    }),
  ]);
  const [c] = result.cases;
  assert.equal(c.expectedClaims[0].span, null);
  assert.equal(c.expectedClaims[0].anchorVerified, false);
  assert.ok(c.notes?.some((n) => /Claim c1 has no pointer span/.test(n)));
  parseGoldSet(JSON.parse(JSON.stringify(result.set)));
});

test("a call's sentiment is read the way the evaluator reads it, not from the mention", () => {
  const result = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [checkedClaim({}, { stance: "conditional" })],
        mentions: [mention({ ticker: "AAPL", instrument_as_spoken: "Apple", stance: "conditional", sentiment: "bearish", is_call: true, claim_id: "c1" })],
      },
    }),
  ]);
  // evaluations/gold-set/report.ts reads a claim's own sentiment, else the stance
  // table — it never consults the linked mention. The drafter must agree, or every
  // drafted expectation disagrees with the run it came from. Here the claim
  // carries no sentiment, so "conditional" resolves through the stance table and
  // the mention's "bearish" is deliberately ignored.
  assert.equal(result.cases[0].expectedClaims[0].sentiment, "neutral");
  // A call mention whose claim was drafted is already covered by that claim.
  assert.deepEqual(result.cases[0].expectedRejections, []);
});

test("a call whose claim the critique rejected is kept as an expected rejection", () => {
  const result = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [checkedClaim({ passed: false }, { stance: "long", ticker: "AAPL" })],
        mentions: [mention({ ticker: "AAPL", instrument_as_spoken: "Apple", stance: "long", sentiment: "bullish", is_call: true, claim_id: "c1" })],
      },
    }),
  ]);
  // The claim did not pass, so it is not an expectation; the mention must not
  // vanish with it, or the case silently omits something the run recorded.
  assert.deepEqual(result.cases[0].expectedClaims, []);
  assert.equal(result.cases[0].expectedRejections.length, 1);
  assert.equal(result.cases[0].expectedRejections[0].ticker, "AAPL");
  assert.match(
    result.cases[0].expectedRejections[0].reason,
    /did not accept as a claim/,
  );
});

test("sentiment falls back to the stance table when no mention links the claim", () => {
  const avoid = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [checkedClaim({}, { stance: "avoid" })],
        mentions: [],
      },
    }),
  ]);
  assert.equal(avoid.cases[0].expectedClaims[0].sentiment, "bearish");
  const watch = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [checkedClaim({}, { stance: "watch" })],
        mentions: [],
      },
    }),
  ]);
  assert.equal(watch.cases[0].expectedClaims[0].sentiment, "neutral");
});

test("a run with nothing to draft is skipped rather than drafted empty", () => {
  const result = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "en", segments: [] },
        claims: [],
        mentions: [],
      },
    }),
  ]);
  assert.deepEqual(result.cases, []);
  assert.match(result.skipped[0].reason, /no accepted claim and no mention/);
});

test("two completed runs of one video draft one case, the newer one", () => {
  const result = draft([
    runRow({ id: "old", createdAt: "2026-08-01T00:00:00.000Z" }),
    runRow({ id: "new", createdAt: "2026-09-02T00:00:00.000Z" }),
  ]);
  assert.equal(result.cases.length, 1);
  assert.match(result.cases[0].source ?? "", /run new/);
  assert.deepEqual(
    result.skipped.map((s) => s.runId),
    ["old"],
  );
  parseGoldSet(JSON.parse(JSON.stringify(result.set)));
});

test("language comes from the run, and an unusable one skips the run", () => {
  assert.equal(recordedLanguage({ source: { language: "zh-Hans" } }), "zh-Hans");
  assert.equal(recordedLanguage({ metadata: { language: "en-US" } }), "en-US");
  assert.equal(recordedLanguage({}), null);
  assert.equal(goldLanguage("zh-Hans"), "zh");
  assert.equal(goldLanguage("EN-GB"), "en");
  assert.equal(goldLanguage("ja"), null);
  assert.equal(goldLanguage(null), null);

  const chinese = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "zh-Hans", segments: [] },
        claims: [checkedClaim()],
        mentions: [],
      },
    }),
  ]);
  assert.equal(chinese.cases[0].language, "zh");
  const unknown = draft([
    runRow({
      output: {
        source: { source_kind: "imported_transcript", language: "ja", segments: [] },
        claims: [checkedClaim()],
        mentions: [],
      },
    }),
  ]);
  assert.deepEqual(unknown.cases, []);
  assert.match(unknown.skipped[0].reason, /neither en nor zh/);
  const missing = draft([
    runRow({ output: { claims: [checkedClaim()], mentions: [] } }),
  ]);
  assert.match(missing.skipped[0].reason, /no language/);
});

test("a run whose videoId is not a YouTube id is skipped", () => {
  const result = draft([runRow({ videoId: "short" })]);
  assert.deepEqual(result.cases, []);
  assert.match(result.skipped[0].reason, /not an 11-character YouTube id/);
});

test("draftCase reports one reason and no case, or one case and no reason", () => {
  const drafted = draftCase(runRow(), { split: "held_out" });
  assert.equal(drafted.reason, null);
  assert.equal(drafted.case?.split, "held_out");
  const skipped = draftCase(runRow({ status: "queued" }), { split: "development" });
  assert.equal(skipped.case, null);
  assert.equal(skipped.reason, "status is queued, not completed");
});

test("the same runs always draft the same file", () => {
  const rows = [runRow(), runRow({ id: "run-2", videoId: "bbbbbbbbbbb" })];
  const first = draftGoldSet(rows, { split: "development", runsPath: "runs.json" });
  const second = draftGoldSet(rows, { split: "development", runsPath: "runs.json" });
  assert.equal(JSON.stringify(first.set), JSON.stringify(second.set));
});

test("the summary and the report count runs, cases and skips with reasons", () => {
  const result = draft([
    runRow(),
    runRow({ id: "run-2", videoId: "bbbbbbbbbbb", status: "running" }),
  ]);
  const counts = summary(result, "out.json");
  assert.equal(counts.runsRead, 2);
  assert.equal(counts.casesDrafted, 1);
  assert.equal(counts.runsSkipped, 1);
  assert.equal(counts.expectedClaims, 1);
  assert.equal(counts.claimsWithSpan, 1);
  assert.equal(counts.expectedRejections, 1);
  const report = formatReport(result, "out.json");
  assert.match(report, /runs read {2,}2/);
  assert.match(report, /cases drafted {2,}1/);
  assert.match(report, /runs skipped {2,}1/);
  assert.match(report, /run-2 \(bbbbbbbbbbb\): status is running, not completed/);
  assert.match(report, /wrote {2,}out\.json/);
});

test("parseOptions requires both flags and validates the split", () => {
  const options = parseOptions(["--runs", "runs.json", "--out", "draft.json"]);
  assert.deepEqual(options, {
    runsPath: "runs.json",
    out: "draft.json",
    split: "development",
    json: false,
  });
  assert.equal(
    parseOptions(["--runs", "r.json", "--out", "d.json", "--split", "held_out"]).split,
    "held_out",
  );
  assert.equal(parseOptions(["--runs", "r.json", "--out", "d.json", "--json"]).json, true);
  for (const argv of [
    [],
    ["--runs", "runs.json"],
    ["--out", "draft.json"],
    ["--runs"],
    ["--runs", "r.json", "--out", "d.json", "--split", "later"],
    ["--runs", "r.json", "--out", "d.json", "--unknown"],
    ["--runs", "r.json", "--runs", "other.json", "--out", "d.json"],
    ["runs.json"],
  ])
    assert.throws(() => parseOptions(argv), FlagError, argv.join(" "));
});

test("an unreadable or malformed runs file is a FlagError, not a crash", () => {
  const dir = tempDir();
  assert.throws(() => readRunRows(join(dir, "absent.json")), FlagError);
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{not json");
  assert.throws(() => readRunRows(broken), FlagError);
  const wrong = join(dir, "wrong.json");
  writeFileSync(wrong, JSON.stringify([{ id: "run-1" }]));
  assert.throws(() => readRunRows(wrong), FlagError);
  const good = join(dir, "runs.json");
  writeFileSync(good, JSON.stringify([runRow()]));
  assert.equal(readRunRows(good).length, 1);
});

test("the draft is validated before a caller ever sees it", () => {
  const result = draft([runRow(), runRow({ id: "run-2", videoId: "bbbbbbbbbbb" })]);
  assert.deepEqual(parseGoldSet(JSON.parse(JSON.stringify(result.set))), result.set);
  const rejected = new DraftError("Gold set is malformed");
  assert.ok(rejected instanceof Error);
  assert.equal(rejected.name, "DraftError");
});

test("the command writes a draft the gold-set schema accepts", async () => {
  const dir = tempDir();
  const runs = join(dir, "runs.json");
  const out = join(dir, "gold-draft.json");
  writeFileSync(
    runs,
    JSON.stringify([
      runRow(),
      runRow({ id: "run-2", videoId: "bbbbbbbbbbb", status: "running" }),
    ]),
  );
  const { stdout } = await cli(
    process.execPath,
    ["--experimental-strip-types", "scripts/gold-draft.ts", "--runs", runs, "--out", out],
    { cwd: ROOT },
  );
  const set = parseGoldSet(JSON.parse(readFileSync(out, "utf8")));
  assert.equal(set.cases.length, 1);
  assert.equal(set.cases[0].status, "pending");
  assert.deepEqual(
    set.cases[0].expectedClaims.map((x) => x.anchorVerified),
    [false],
  );
  assert.match(stdout, /runs read {2,}2/);
  assert.match(stdout, /cases drafted {2,}1/);
  assert.match(stdout, /status is running, not completed/);

  const json = await cli(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/gold-draft.ts",
      "--runs",
      runs,
      "--out",
      out,
      "--json",
    ],
    { cwd: ROOT },
  );
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.version, GOLD_DRAFT_VERSION);
  assert.equal(parsed.runsRead, 2);
  assert.equal(parsed.casesDrafted, 1);
  assert.equal(parsed.skipped.length, 1);
  assert.match(parsed.skipped[0].reason, /not completed/);
});

test("a missing flag or an unreadable runs file exits 2 with the usage", async () => {
  const noFlags = await failing([]);
  assert.equal(noFlags.code, 2);
  assert.match(noFlags.stderr ?? "", /--runs <runs\.json> is required\./);
  assert.ok((noFlags.stderr ?? "").includes(USAGE));
  const absent = await failing([
    "--runs",
    join(tempDir(), "absent.json"),
    "--out",
    join(tempDir(), "draft.json"),
  ]);
  assert.equal(absent.code, 2);
  assert.match(absent.stderr ?? "", /scripts\/gold-draft\.ts: --runs /);
  // A clear message, not a stack trace.
  assert.doesNotMatch(absent.stderr ?? "", /\n\s+at /);
});
