import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callUsageRows,
  costText,
  secondsText,
  tokenText,
  usageByStep,
  usageOf,
  usageTotals,
  type LedgerRow,
} from "../src/features/youtube-intelligence/call-usage.ts";

const extract: LedgerRow = {
  id: "c2",
  run_id: "r1",
  stage: "synthesis",
  status: "completed",
  amount: 0.021,
  attempt: 2,
  metrics: {
    model: "google/gemini-3.8-flash",
    seconds: 41,
    tokens: { inputTokens: 84210, outputTokens: 3902, costUsd: 0.021 },
    usage: { prompt_tokens: 84210, completion_tokens: 3902, prompt_tokens_details: { cached_tokens: 0 } },
  },
};
const failedFirst: LedgerRow = {
  id: "c1",
  run_id: "r1",
  stage: "synthesis",
  status: "released",
  amount: 0,
  attempt: 1,
  metrics: { model: "google/gemini-3.8-flash", error: "HTTP 503" },
};
const check: LedgerRow = {
  id: "c3",
  run_id: "r1",
  stage: "critique",
  status: "completed",
  amount: "0.006",
  attempt: 1,
  // Stored as text, as a legacy row might be; native usage names the cache.
  metrics: JSON.stringify({
    model: "google/gemini-3.5-flash",
    seconds: 18,
    tokens: { inputTokens: 61044, outputTokens: 1120 },
    usage: { prompt_tokens: 61044, completion_tokens: 1120, cachedContentTokenCount: 58300 },
  }),
};
const captions: LedgerRow = {
  id: "c0",
  run_id: "r1",
  stage: "transcribe",
  status: "completed",
  amount: 0.004,
  attempt: 1,
  metrics: {},
};

test("rows are assembled from ledger rows in step order, retries marked", () => {
  const rows = callUsageRows([check, extract, failedFirst, captions]);
  assert.deepEqual(
    rows.map((r) => [r.stepLabel, r.attempt, r.retry, r.status]),
    [
      ["Transcript", 1, false, "completed"],
      ["Extract", 1, false, "released"],
      ["Extract", 2, true, "completed"],
      ["Check", 1, false, "completed"],
    ],
  );
  const e = rows[2];
  assert.equal(e.model, "google/gemini-3.8-flash");
  assert.equal(e.inputTokens, 84210);
  assert.equal(e.cachedTokens, 0);
  assert.equal(e.outputTokens, 3902);
  assert.equal(e.seconds, 41);
  assert.equal(e.costUsd, 0.021);
  assert.equal(rows[1].note, "Failed, not charged");
  assert.equal(rows[1].costUsd, 0);
  assert.equal(rows[3].cachedTokens, 58300);
  assert.equal(rows[3].costUsd, 0.006);
});

test("missing usage stays null and shows as a dash, never an estimate", () => {
  const [row] = callUsageRows([captions]);
  assert.equal(row.model, null);
  assert.equal(row.inputTokens, null);
  assert.equal(row.cachedTokens, null);
  assert.equal(row.outputTokens, null);
  assert.equal(row.seconds, null);
  assert.equal(tokenText(row.inputTokens), "—");
  assert.equal(secondsText(row.seconds), "—");
  assert.equal(costText(null), "—");
  assert.deepEqual(usageOf("not json"), {
    model: null,
    inputTokens: null,
    cachedTokens: null,
    outputTokens: null,
    seconds: null,
  });
  // A negative or non-numeric figure is not a count.
  assert.equal(usageOf({ tokens: { inputTokens: -3 } }).inputTokens, null);
});

test("totals add what was recorded and leave an unrecorded column empty", () => {
  const rows = callUsageRows([check, extract, failedFirst, captions]);
  const t = usageTotals(rows);
  assert.equal(t.calls, 4);
  assert.equal(t.inputTokens, 145254);
  assert.equal(t.cachedTokens, 58300);
  assert.equal(t.outputTokens, 5022);
  assert.equal(t.seconds, 59);
  assert.ok(Math.abs(t.costUsd! - 0.031) < 1e-12);
  assert.deepEqual(usageTotals(callUsageRows([captions])), {
    calls: 1,
    inputTokens: null,
    cachedTokens: null,
    outputTokens: null,
    seconds: null,
    costUsd: 0.004,
  });
  assert.deepEqual(usageTotals([]), {
    calls: 0,
    inputTokens: null,
    cachedTokens: null,
    outputTokens: null,
    seconds: null,
    costUsd: null,
  });
});

test("held and unknown outcomes are labelled and keep the amount held", () => {
  const rows = callUsageRows([
    { stage: "critique-chunk-0", status: "reserved", amount: 0.05, metrics: {} },
    { stage: "critique-chunk-1", status: "unknown", amount: 0.05, attempt: null, metrics: null },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.note, r.costUsd, r.attempt]),
    [
      ["In progress, amount held", 0.05, 1],
      ["Outcome unknown, amount held", 0.05, 1],
    ],
  );
});

test("the Lab aggregate has the same columns per step across runs", () => {
  const second = { ...extract, id: "d2", run_id: "r2", attempt: 1, amount: 0.019 };
  const other = { id: "x", run_id: "r3", stage: "research-synthesis", status: "completed", amount: 0.1, metrics: {} };
  const steps = usageByStep([check, extract, failedFirst, captions, second, other]);
  assert.deepEqual(
    steps.map((s) => [s.stepLabel, s.calls, s.retries, s.runs]),
    [
      ["Transcript", 1, 0, 1],
      ["Extract", 3, 1, 2],
      ["Check", 1, 0, 1],
      ["Other", 1, 0, 1],
    ],
  );
  const e = steps[1];
  assert.equal(e.inputTokens, 84210 * 2);
  assert.ok(Math.abs(e.costUsd! - 0.04) < 1e-12);
  assert.ok(Math.abs(e.costPerRunUsd! - 0.02) < 1e-12);
  assert.deepEqual(usageByStep([]), []);
});
