import { test } from "node:test";
import assert from "node:assert/strict";
import {
  YtiStance,
  YtiConviction,
  VcAction,
  VcDatasetAction,
  STANCE_TO_ACTION,
  DATASET_ACTION_TO_STANCE,
  CONVICTION_TO_SCORE,
  SCORE_TO_CONVICTION,
  MAPPING_TABLE,
  stanceToAction,
  datasetActionToStance,
  datasetActionToAction,
  convictionToScore,
  scoreToConviction,
  normalizeVcTicker,
} from "../src/features/youtube-intelligence/conviction-mapping.ts";

test("Every Claim stance maps to exactly one VideoConviction action", () => {
  for (const stance of YtiStance.options) {
    const action = stanceToAction(stance);
    assert.ok(VcAction.options.includes(action), `${stance} -> ${action}`);
    assert.equal(action, STANCE_TO_ACTION[stance]);
  }
  assert.equal(stanceToAction("long"), "buy");
  assert.equal(stanceToAction("short"), "sell");
  assert.equal(stanceToAction("avoid"), "sell");
  assert.equal(stanceToAction("hold"), "hold");
  assert.equal(stanceToAction("neutral"), "hold");
  // A watch-list mention or a conditional call is not a recommendation.
  assert.equal(stanceToAction("watch"), "none");
  assert.equal(stanceToAction("conditional"), "none");
  assert.deepEqual(Object.keys(STANCE_TO_ACTION).sort(), [...YtiStance.options].sort());
});

test("Every dataset label maps to a Claim stance, including the dataset's own spellings", () => {
  for (const label of VcDatasetAction.options) {
    const stance = datasetActionToStance(label);
    assert.ok(YtiStance.options.includes(stance), `${label} -> ${stance}`);
    assert.equal(stance, DATASET_ACTION_TO_STANCE[label]);
  }
  assert.equal(datasetActionToStance("Buy"), "long");
  assert.equal(datasetActionToStance("Sell"), "short");
  assert.equal(datasetActionToStance("Short sell"), "short");
  assert.equal(datasetActionToStance("Hold"), "hold");
  assert.equal(datasetActionToStance("Don't buy"), "avoid");
  // Unclear is lossy; it maps to the weakest stance so precision is under-counted, never inflated.
  assert.equal(datasetActionToStance("Unclear"), "watch");
  // Case and whitespace variants seen in the handoff versus the published CSV.
  assert.equal(datasetActionToStance("Don't Buy"), "avoid");
  assert.equal(datasetActionToStance("Short Sell "), "short");
  assert.equal(datasetActionToStance(" buy"), "long");
});

test("Dataset label to coarse action is consistent with the stance mapping", () => {
  for (const label of VcDatasetAction.options)
    assert.equal(
      datasetActionToAction(label),
      stanceToAction(datasetActionToStance(label)),
      label,
    );
  assert.equal(datasetActionToAction("Buy"), "buy");
  assert.equal(datasetActionToAction("Don't buy"), "sell");
  assert.equal(datasetActionToAction("Unclear"), "none");
});

test("Conviction buckets round-trip between our labels and the 1-3 score", () => {
  for (const c of YtiConviction.options) {
    const score = convictionToScore(c);
    assert.equal(score, CONVICTION_TO_SCORE[c]);
    if (score !== null) assert.equal(scoreToConviction(score), c);
  }
  assert.equal(convictionToScore("high"), 3);
  assert.equal(convictionToScore("medium"), 2);
  assert.equal(convictionToScore("low"), 1);
  assert.equal(convictionToScore("unspecified"), null);
  assert.equal(scoreToConviction(1), "low");
  assert.equal(scoreToConviction(2), "medium");
  assert.equal(scoreToConviction(3), "high");
  assert.equal(scoreToConviction(null), null);
  assert.equal(scoreToConviction(undefined), null);
  assert.deepEqual(SCORE_TO_CONVICTION, { 1: "low", 2: "medium", 3: "high" });
});

test("Unknown stances, labels, convictions and scores are rejected", () => {
  assert.throws(() => stanceToAction("bullish"), /stance/i);
  assert.throws(() => stanceToAction(""), /stance/i);
  assert.throws(() => stanceToAction(undefined), /stance/i);
  assert.throws(() => datasetActionToStance("Strong buy"), /label/i);
  assert.throws(() => datasetActionToStance(null), /label/i);
  assert.throws(() => datasetActionToAction("Maybe"), /label/i);
  assert.throws(() => convictionToScore("very high"), /conviction/i);
  assert.throws(() => scoreToConviction(0), /score/i);
  assert.throws(() => scoreToConviction(4), /score/i);
  assert.throws(() => scoreToConviction(2.5), /score/i);
  assert.throws(() => scoreToConviction("2"), /score/i);
});

test("The mapping table is exported as data and covers every enum value", () => {
  assert.deepEqual(
    MAPPING_TABLE.stanceToAction.map((r) => r.stance).sort(),
    [...YtiStance.options].sort(),
  );
  assert.deepEqual(
    MAPPING_TABLE.datasetActionToStance.map((r) => r.label).sort(),
    [...VcDatasetAction.options].sort(),
  );
  assert.deepEqual(
    MAPPING_TABLE.conviction.map((r) => r.conviction).sort(),
    [...YtiConviction.options].sort(),
  );
  for (const r of [
    ...MAPPING_TABLE.stanceToAction,
    ...MAPPING_TABLE.datasetActionToStance,
    ...MAPPING_TABLE.conviction,
  ])
    assert.ok(r.why.trim().length > 0, "every row carries a rationale");
});

test("Ticker normalisation is format-only and never repairs a wrong symbol", () => {
  assert.equal(normalizeVcTicker("NYSE: WMT"), "WMT");
  assert.equal(normalizeVcTicker("nasdaq:aapl "), "AAPL");
  assert.equal(normalizeVcTicker("BRK.B"), "BRK.B");
  assert.equal(normalizeVcTicker("APPL"), "APPL");
  assert.equal(normalizeVcTicker("AI†"), null);
  assert.equal(normalizeVcTicker(""), null);
  assert.equal(normalizeVcTicker(null), null);
  assert.equal(normalizeVcTicker(undefined), null);
});
