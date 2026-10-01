import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MINIMUM_VERIFIED_CASES,
  GOLD_SET_VERSION,
  DEFAULT_CASES_PATH,
  parseGoldSet,
} from "../evaluations/gold-set/schema.ts";
import {
  FlagError,
  GOLD_VALIDATE_VERSION,
  USAGE,
  formatIssues,
  formatReport,
  isIsoTimestamp,
  parseOptions,
  validateGoldFile,
  verificationGaps,
} from "../scripts/gold-validate.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const cli = promisify(execFile);

/** Run the command expecting a non-zero exit; an unexpected success has no code. */
type CliFailure = { code?: number; stdout?: string; stderr?: string };
function failing(args: string[]): Promise<CliFailure> {
  return cli(
    process.execPath,
    ["--experimental-strip-types", "scripts/gold-validate.ts", ...args],
    { cwd: ROOT },
  ).then(
    (ok): CliFailure => ({ stdout: ok.stdout, stderr: ok.stderr }),
    (e: CliFailure): CliFailure => e,
  );
}

function tempFile(name: string, text: string) {
  const dir = mkdtempSync(join(tmpdir(), "yti-gold-validate-"));
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

const ISO = "2026-09-01T00:00:00.000Z";

type Json = Record<string, unknown>;

const claim = (over: Json = {}): Json => ({
  id: "c1",
  ticker: "AAPL",
  stance: "long",
  creator_conviction: "medium",
  sentiment: "bullish",
  span: { startSeconds: 10, endSeconds: 20, text: "I am buying Apple here" },
  anchorVerified: true,
  reviewer: "jo",
  reviewedAt: ISO,
  ...over,
});

const goldCase = (over: Json = {}): Json => ({
  id: "case-1",
  videoId: "aaaaaaaaaaa",
  language: "en",
  split: "development",
  status: "pending",
  review: null,
  expectedClaims: [],
  expectedRejections: [],
  ...over,
});

/** One verified case, four pending cases that between them show every gap. */
const FIXTURE = {
  version: GOLD_SET_VERSION,
  cases: [
    // Fully verified: nothing missing.
    goldCase({
      id: "verified-en",
      videoId: "aaaaaaaaaaa",
      language: "en",
      status: "verified",
      review: { reviewer: "jo", reviewedAt: ISO },
      expectedClaims: [claim()],
      expectedRejections: [{ id: "r1", reason: "A disclosed holding is not a call." }],
    }),
    // Rejection only: no expected claims at all.
    goldCase({
      id: "rejection-only",
      videoId: "bbbbbbbbbbb",
      language: "zh",
      expectedRejections: [{ id: "r2", reason: "Macro commentary, no instrument." }],
    }),
    // A review date a person typed, and a claim nobody has anchored yet.
    goldCase({
      id: "unanchored",
      videoId: "ccccccccccc",
      language: "en",
      review: { reviewer: "jo", reviewedAt: "March 3, 2026" },
      expectedClaims: [
        claim({ id: "c-unanchored", span: null, anchorVerified: false, reviewer: "", reviewedAt: "" }),
      ],
    }),
    // A case-level reviewer that is only whitespace.
    goldCase({
      id: "blank-reviewer",
      videoId: "ddddddddddd",
      language: "zh",
      review: { reviewer: " ", reviewedAt: ISO },
      expectedClaims: [claim({ id: "c-anchored" })],
    }),
    // Nothing expected either way.
    goldCase({ id: "empty", videoId: "eeeeeeeeeee", language: "en" }),
  ],
};

const MALFORMED = {
  version: GOLD_SET_VERSION,
  cases: [
    goldCase({ id: "bad-video", videoId: "short" }),
    goldCase({
      id: "bad-span",
      videoId: "bbbbbbbbbbb",
      expectedClaims: [
        claim({ span: { startSeconds: 30, endSeconds: 30, text: "no duration" } }),
      ],
    }),
    goldCase({
      id: "duplicate-key",
      videoId: "ccccccccccc",
      expectedClaims: [claim({ id: "c1" }), claim({ id: "c2" })],
    }),
    goldCase({
      id: "bad-reviewedAt",
      videoId: "ddddddddddd",
      status: "verified",
      review: { reviewer: "jo", reviewedAt: "not a date" },
      expectedClaims: [claim()],
    }),
  ],
};

const byId = (result: ReturnType<typeof validateGoldFile>, id: string) => {
  const row = result.cases.find((c) => c.id === id);
  assert.ok(row, `no case ${id} in the summary`);
  return row;
};

test("a verified case reports no missing conditions", () => {
  const result = validateGoldFile(JSON.stringify(FIXTURE));
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.version, GOLD_VALIDATE_VERSION);
  assert.equal(result.goldSetVersion, GOLD_SET_VERSION);
  const row = byId(result, "verified-en");
  assert.deepEqual(row, {
    id: "verified-en",
    videoId: "aaaaaaaaaaa",
    language: "en",
    split: "development",
    status: "verified",
    claims: 1,
    anchoredClaims: 1,
    rejections: 1,
    verified: true,
    missing: [],
  });
});

test("a pending case names every condition it still needs", () => {
  const result = validateGoldFile(JSON.stringify(FIXTURE));

  const empty = byId(result, "empty");
  assert.equal(empty.verified, false);
  assert.ok(empty.missing.some((m) => /status is pending, not verified/.test(m)));
  assert.ok(empty.missing.some((m) => /review is missing/.test(m)));
  assert.ok(empty.missing.some((m) => /no expected entries/.test(m)));

  const unanchored = byId(result, "unanchored");
  assert.equal(unanchored.verified, false);
  assert.equal(unanchored.anchoredClaims, 0);
  // A review date that parses but is not ISO 8601 is still a gap.
  assert.ok(unanchored.missing.some((m) => /review\.reviewedAt is not an ISO timestamp/.test(m)));
  assert.ok(unanchored.missing.some((m) => /claim c-unanchored is not anchorVerified/.test(m)));
  assert.ok(unanchored.missing.some((m) => /claim c-unanchored has no span/.test(m)));
  assert.ok(unanchored.missing.some((m) => /claim c-unanchored is missing a reviewer/.test(m)));
  assert.ok(unanchored.missing.some((m) => /claim c-unanchored is missing reviewedAt/.test(m)));
  // It has an expectation, so that condition is not reported.
  assert.ok(!unanchored.missing.some((m) => /no expected entries/.test(m)));

  const blank = byId(result, "blank-reviewer");
  assert.equal(blank.anchoredClaims, 1);
  assert.ok(blank.missing.some((m) => /review\.reviewer is empty/.test(m)));
  assert.ok(!blank.missing.some((m) => /claim c-anchored/.test(m)));

  // verificationGaps is the same function, applied to one parsed case.
  const parsed = parseGoldSet(JSON.parse(JSON.stringify(FIXTURE)));
  assert.deepEqual(verificationGaps(parsed.cases[4]), empty.missing);
});

test("totals count cases, verified cases, claims, anchors and rejection-only videos", () => {
  const result = validateGoldFile(JSON.stringify(FIXTURE));
  assert.deepEqual(result.totals, {
    cases: 5,
    verified: 1,
    pending: 4,
    minimumVerifiedCases: MINIMUM_VERIFIED_CASES,
    remainingToMinimum: MINIMUM_VERIFIED_CASES - 1,
    verifiedByLanguage: { en: 1, zh: 0 },
    claims: 3,
    anchoredClaims: 2,
    rejections: 2,
    rejectionOnlyVideos: 1,
  });
});

test("a malformed file reports one issue per problem with its JSON path", () => {
  const result = validateGoldFile(JSON.stringify(MALFORMED));
  assert.equal(result.ok, false);
  assert.deepEqual(result.cases, []);
  assert.equal(result.totals.cases, 0);
  const issues = new Map(result.issues.map((i) => [i.path, i.message]));
  assert.match(issues.get("cases.0.videoId") ?? "", /11-character YouTube id/);
  assert.match(issues.get("cases.1.expectedClaims.0.span") ?? "", /end after it starts/);
  assert.match(issues.get("cases.2") ?? "", /Duplicate \(ticker, stance\)/);
  assert.match(issues.get("cases.3.review.reviewedAt") ?? "", /must be a date/);
  // Printed exactly as "<json path>: <message>", one per line.
  const printed = formatIssues(result.issues).split("\n");
  assert.ok(printed.includes("cases.0.videoId: videoId must be an 11-character YouTube id"));
  assert.equal(printed.length, result.issues.length);
});

test("text that is not JSON is one root issue, not a crash", () => {
  const result = validateGoldFile("{ not json");
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].path, "<root>");
  assert.ok(result.issues[0].message.length > 0);
});

test("the report prints each case and the totals in plain language", () => {
  const text = formatReport(validateGoldFile(JSON.stringify(FIXTURE)));
  assert.match(text, /verified-en/);
  assert.match(text, /rejection-only/);
  assert.match(text, /status is pending, not verified/);
  assert.match(text, new RegExp(`1 of ${MINIMUM_VERIFIED_CASES}`));
  assert.match(text, /rejection-only videos/);
});

test("isIsoTimestamp accepts ISO dates and rejects prose", () => {
  assert.equal(isIsoTimestamp(ISO), true);
  assert.equal(isIsoTimestamp("2026-09-01"), true);
  assert.equal(isIsoTimestamp("2026-09-01T10:30:00+08:00"), true);
  assert.equal(isIsoTimestamp("March 3, 2026"), false);
  assert.equal(isIsoTimestamp("2026-13-01"), false);
  assert.equal(isIsoTimestamp(""), false);
});

test("parseOptions defaults to the gold cases file and rejects bad flags", () => {
  assert.deepEqual(parseOptions([]), {
    casesPath: DEFAULT_CASES_PATH,
    json: false,
    strict: false,
  });
  assert.deepEqual(parseOptions(["--cases", "a.json", "--json", "--strict"]), {
    casesPath: "a.json",
    json: true,
    strict: true,
  });
  assert.throws(() => parseOptions(["--cases"]), FlagError);
  assert.throws(() => parseOptions(["--nope"]), FlagError);
  assert.throws(() => parseOptions(["extra.json"]), FlagError);
  assert.match(USAGE, /--cases/);
  assert.match(USAGE, /--strict/);
});

test("the command validates the repository gold set and exits 0", async () => {
  const { stdout } = await cli(
    process.execPath,
    ["--experimental-strip-types", "scripts/gold-validate.ts"],
    { cwd: ROOT },
  );
  assert.match(stdout, new RegExp(`of ${MINIMUM_VERIFIED_CASES}`));
  assert.match(stdout, /leapedge-v824SHV6COE/);
});

test("--json prints the summary object", async () => {
  const path = tempFile("cases.json", JSON.stringify(FIXTURE));
  const { stdout } = await cli(
    process.execPath,
    ["--experimental-strip-types", "scripts/gold-validate.ts", "--cases", path, "--json"],
    { cwd: ROOT },
  );
  const summary = JSON.parse(stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.totals.verified, 1);
  assert.equal(summary.cases.length, 5);
});

test("--strict exits 1 below the minimum verified cases", async () => {
  const path = tempFile("cases.json", JSON.stringify(FIXTURE));
  const failed = await failing(["--cases", path, "--strict"]);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr ?? "", new RegExp(`${MINIMUM_VERIFIED_CASES}`));
});

test("a malformed file exits 1 and prints the issue lines", async () => {
  const path = tempFile("cases.json", JSON.stringify(MALFORMED));
  const failed = await failing(["--cases", path]);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr ?? "", /cases\.0\.videoId: videoId must be an 11-character/);
});

test("an unreadable cases file and a bad flag exit 2", async () => {
  const missing = await failing([
    "--cases",
    join(tmpdir(), "yti-gold-validate-absent.json"),
  ]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr ?? "", /--cases/);

  const bad = await failing(["--wat"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr ?? "", /unknown flag/);
});
