import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GoldCase,
  GoldSet,
  parseGoldSet,
  loadGoldSet,
  GOLD_SET_VERSION,
  MINIMUM_VERIFIED_CASES,
} from "../evaluations/gold-set/schema.ts";
import { goldReport, sentimentFromStance } from "../evaluations/gold-set/report.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";

const review = { reviewer: "test fixture", reviewedAt: "2026-09-16T00:00:00Z" };
const claim = (
  id: string,
  ticker: string,
  stance: string,
  sentiment: string,
  startSeconds: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  ticker,
  stance,
  creator_conviction: "high",
  sentiment,
  span: { startSeconds, endSeconds: startSeconds + 10, text: `${ticker} span` },
  anchorVerified: true,
  ...review,
  ...extra,
});
const fixtureSet = (): { version: string; cases: Record<string, unknown>[] } => ({
  version: GOLD_SET_VERSION,
  cases: [
    {
      id: "case-a",
      videoId: "aaaaaaaaaaa",
      language: "en",
      split: "development",
      status: "verified",
      review,
      expectedClaims: [
        claim("a-nvda", "NVDA", "long", "bullish", 100),
        claim("a-tsla", "TSLA", "short", "bearish", 200, { creator_conviction: "low" }),
      ],
      expectedRejections: [{ id: "a-spy", reason: "SPY is a benchmark aside, not a call.", ticker: "SPY" }],
    },
    {
      id: "case-b",
      videoId: "bbbbbbbbbbb",
      language: "zh",
      split: "held_out",
      status: "verified",
      review,
      expectedClaims: [
        // Creator holds but sounds negative: the derived sentiment (neutral) must disagree.
        claim("b-aapl", "AAPL", "hold", "bearish", 50, { creator_conviction: "medium" }),
        claim("b-msft", "MSFT", "long", "bullish", 300),
      ],
      expectedRejections: [],
    },
    {
      id: "case-c",
      videoId: "ccccccccccc",
      language: "en",
      split: "development",
      status: "pending",
      review: null,
      expectedClaims: [],
      expectedRejections: [{ id: "c-none", reason: "Educational video; no trade ideas expected." }],
    },
  ],
});
const source = (segments: [string, string, number][]) => ({
  video_id: "x",
  source_kind: "imported_transcript",
  segment_separator: " ",
  segments: segments.map(([id, text, start]) => ({
    id,
    text,
    start_seconds: start,
    end_seconds: start + 5,
  })),
});
const checked = (
  id: string,
  ticker: string,
  stance: string,
  segment: string,
  quote: string,
  passed: boolean,
  verdict: string,
) => ({
  id,
  passed,
  reasons: [],
  audit: { verdict, reason_en: verdict },
  claim: {
    thesis_en: `${ticker} thesis`,
    instrument_as_spoken: ticker,
    ticker,
    ticker_explicit: true,
    stance,
    horizon_en: null,
    conditions_en: [],
    creator_conviction: "high",
    risks_en: [],
    levels: [],
    evidence: [{ segment_id: segment, quote_original: quote, quote_translation_en: quote }],
  },
});
const run = (
  id: string,
  videoId: string,
  cost: number,
  src: ReturnType<typeof source>,
  claims: ReturnType<typeof checked>[],
): Run => ({
  id,
  videoId,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  model: "google/gemini-3.5-flash",
  promptVersion: "v5",
  title: videoId,
  status: "completed",
  stage: "complete",
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: "2026-09-16T00:00:00Z",
  error: null,
  input: {},
  output: { sourceHash: `hash-${id}`, source: src, claims, keyPoints: [] },
  cost,
});
const fixtureRuns = () => [
  run(
    "run-a",
    "aaaaaaaaaaa",
    0.125,
    source([
      ["s1", "I am buying NVDA here", 101],
      ["s2", "I am short TSLA", 205],
      ["s3", "SPY is fine", 300],
      ["s4", "AMD is a buy", 400],
    ]),
    [
      checked("c1", "NVDA", "long", "s1", "buying NVDA", true, "accept"),
      checked("c2", "TSLA", "short", "s2", "short TSLA", true, "accept"),
      checked("c3", "SPY", "long", "s3", "SPY is fine", true, "accept"),
      // The critic accepted it but a structural check dropped it: a critic false positive.
      checked("c4", "AMD", "long", "s4", "AMD is a buy", false, "accept"),
    ],
  ),
  run(
    "run-b",
    "bbbbbbbbbbb",
    0.125,
    source([
      ["t1", "I still hold AAPL", 50.5],
      ["t2", "MSFT looks strong", 300],
    ]),
    [
      checked("c1", "AAPL", "hold", "t1", "hold AAPL", true, "accept"),
      // A real call the critic rejected: a critic false negative and a claim false negative.
      checked("c2", "MSFT", "long", "t2", "MSFT looks strong", false, "reject"),
    ],
  ),
];

test("Gold-set report computes claim, critic, anchor, sentiment and cost metrics", () => {
  const report = goldReport(parseGoldSet(fixtureSet()), fixtureRuns());
  assert.equal(report.cases.total, 3);
  assert.equal(report.cases.verified, 2);
  assert.equal(report.cases.pending, 1);
  assert.equal(report.cases.scored, 2);
  assert.deepEqual(report.cases.missingRun, ["ccccccccccc"]);
  // Accepted: NVDA long, TSLA short, SPY long, AAPL hold. Expected: NVDA, TSLA, AAPL, MSFT.
  assert.equal(report.claims.truePositives, 3);
  assert.equal(report.claims.falsePositives, 1);
  assert.equal(report.claims.falseNegatives, 1);
  assert.equal(report.claims.precision, 0.75);
  assert.equal(report.claims.recall, 0.75);
  // Critic verdicts: accept NVDA, TSLA, SPY, AMD, AAPL; reject MSFT.
  assert.equal(report.critic.verdicts, 6);
  assert.equal(report.critic.truePositives, 3);
  assert.equal(report.critic.falsePositives, 2);
  assert.equal(report.critic.falseNegatives, 1);
  assert.equal(report.critic.precision, 0.6);
  assert.equal(report.critic.recall, 0.75);
  // Anchors: NVDA 101 vs 100 (in), TSLA 205 vs 200 (out), AAPL 50.5 vs 50 (in); MSFT unmatched.
  assert.equal(report.anchors.toleranceSeconds, 2);
  assert.equal(report.anchors.verified, 4);
  assert.equal(report.anchors.compared, 3);
  assert.equal(report.anchors.withinTolerance, 2);
  assert.equal(report.anchors.accuracy, 2 / 3);
  // Sentiment on matched claims: NVDA bullish, TSLA bearish agree; AAPL hold-derived neutral vs bearish disagrees.
  assert.equal(report.sentiment.compared, 3);
  assert.equal(report.sentiment.agreed, 2);
  assert.equal(report.sentiment.agreement, 2 / 3);
  // Cost: 0.25 over four accepted claims.
  assert.equal(report.cost.totalUsd, 0.25);
  assert.equal(report.cost.acceptedClaims, 4);
  assert.equal(report.cost.perAcceptedClaimUsd, 0.0625);
  // gradeRun ran on both scored runs.
  assert.equal(report.validity.graded, 2);
  assert.equal(report.validity.passed, 2);
  const rowA = report.rows.find((r) => r.caseId === "case-a");
  assert.equal(rowA?.runId, "run-a");
  assert.deepEqual(
    rowA?.matched.map((m) => `${m.expectedId}:${m.claimId}`),
    ["a-nvda:c1", "a-tsla:c2"],
  );
  assert.deepEqual(rowA?.unexpected.map((u) => u.claimId), ["c3"]);
  const rowB = report.rows.find((r) => r.caseId === "case-b");
  assert.deepEqual(rowB?.missing.map((m) => m.expectedId), ["b-msft"]);
  const rowC = report.rows.find((r) => r.caseId === "case-c");
  assert.equal(rowC?.runId, null);
});

test("Gold-set report is advisory below the verified-case minimum and not at it", () => {
  const small = goldReport(parseGoldSet(fixtureSet()), fixtureRuns());
  assert.equal(small.advisory, true);
  assert.equal(small.verifiedCases, 2);
  assert.equal(small.minimumVerifiedCases, MINIMUM_VERIFIED_CASES);
  assert.match(small.advisoryReason ?? "", /2 of 50/);
  const many = fixtureSet();
  for (let i = 0; i < MINIMUM_VERIFIED_CASES; i++)
    many.cases.push({
      ...many.cases[0],
      id: `bulk-${i}`,
      videoId: `bulk${String(i).padStart(7, "0")}`,
      expectedClaims: [claim(`bulk-${i}-nvda`, "NVDA", "long", "bullish", 10)],
      expectedRejections: [],
    });
  const large = goldReport(parseGoldSet(many), fixtureRuns());
  assert.equal(large.advisory, false);
  assert.equal(large.advisoryReason, null);
  assert.equal(large.verifiedCases, MINIMUM_VERIFIED_CASES + 2);
});

test("Gold-set report accepts claims with no run and reports empty metrics as null", () => {
  const report = goldReport(parseGoldSet(fixtureSet()), []);
  assert.equal(report.cases.scored, 0);
  assert.equal(report.claims.precision, null);
  assert.equal(report.claims.recall, null);
  assert.equal(report.critic.precision, null);
  assert.equal(report.anchors.accuracy, null);
  assert.equal(report.sentiment.agreement, null);
  assert.equal(report.cost.perAcceptedClaimUsd, null);
  assert.equal(report.advisory, true);
});

test("Gold-set schema rejects malformed cases", () => {
  const base = fixtureSet().cases[0];
  const reject = (patch: Record<string, unknown>, message: RegExp) => {
    const r = GoldCase.safeParse({ ...base, ...patch });
    assert.equal(r.success, false);
    assert.match(r.error?.issues.map((i) => i.message).join(" | ") ?? "", message);
  };
  assert.equal(GoldCase.safeParse(base).success, true);
  reject({ videoId: "short" }, /videoId/i);
  reject({ language: "fr" }, /Invalid option/);
  reject(
    { expectedClaims: [claim("x", "NVDA", "long", "positive", 1)] },
    /Invalid option/,
  );
  reject(
    {
      expectedClaims: [
        { ...claim("x", "NVDA", "long", "bullish", 10), span: { startSeconds: 10, endSeconds: 10, text: "t" } },
      ],
    },
    /span must end after it starts/,
  );
  reject(
    { expectedClaims: [{ ...claim("x", "NVDA", "long", "bullish", 10), span: null }] },
    /anchorVerified requires a span/,
  );
  reject(
    { expectedClaims: [{ ...claim("x", "NVDA", "long", "bullish", 10), reviewer: "" }] },
    /anchorVerified requires a reviewer/,
  );
  reject(
    { expectedClaims: [{ ...claim("x", "NVDA", "long", "bullish", 10), reviewedAt: "yesterday" }] },
    /anchorVerified requires a reviewer/,
  );
  reject(
    { expectedClaims: [{ ...claim("x", "NVDA", "long", "bullish", 10), anchorVerified: false }] },
    /verified case requires every claim anchorVerified/,
  );
  reject({ review: null }, /verified case requires a review/);
  reject({ expectedClaims: [], expectedRejections: [] }, /verified case requires at least one expectation/);
  reject(
    {
      expectedClaims: [claim("x", "NVDA", "long", "bullish", 1), claim("y", "nvda", "long", "bullish", 2)],
    },
    /Duplicate \(ticker, stance\)/,
  );
  reject(
    {
      expectedClaims: [claim("x", "NVDA", "long", "bullish", 1), claim("x", "TSLA", "long", "bullish", 2)],
    },
    /Duplicate annotation ID/,
  );
  // A pending case may carry a claim without a span, but it must not claim a verified anchor.
  const pending = GoldCase.safeParse({
    ...base,
    status: "pending",
    review: null,
    expectedClaims: [
      { ...claim("p", "NVDA", "long", "bullish", 1), span: null, anchorVerified: false, reviewer: "", reviewedAt: "" },
    ],
  });
  assert.equal(pending.success, true);
  const dupSet = GoldSet.safeParse({ version: GOLD_SET_VERSION, cases: [base, base] });
  assert.equal(dupSet.success, false);
  assert.throws(() => parseGoldSet({ version: "other", cases: [] }), /version/);
});

test("Committed gold cases parse and carry no unverified audio anchors", () => {
  const set = loadGoldSet();
  assert.ok(set.cases.length >= 5);
  const videos = set.cases.map((c) => c.videoId);
  assert.equal(new Set(videos).size, videos.length);
  for (const c of set.cases) {
    assert.equal(c.status, "pending");
    for (const claim of c.expectedClaims) assert.equal(claim.anchorVerified, false);
    assert.ok(c.expectedClaims.length + c.expectedRejections.length > 0, c.id);
  }
  for (const id of ["v824SHV6COE", "J25UuUqHT3Y", "3u24qyWjSVM", "wkAqHlYL7bQ", "kXYvRR7gV2E"])
    assert.ok(videos.includes(id), id);
  const report = goldReport(set, []);
  assert.equal(report.advisory, true);
  assert.equal(report.verifiedCases, 0);
});

test("Sentiment derived from stance follows the call direction", () => {
  assert.equal(sentimentFromStance("long"), "bullish");
  assert.equal(sentimentFromStance("short"), "bearish");
  assert.equal(sentimentFromStance("avoid"), "bearish");
  for (const s of ["hold", "watch", "neutral", "conditional"] as const)
    assert.equal(sentimentFromStance(s), "neutral");
});
