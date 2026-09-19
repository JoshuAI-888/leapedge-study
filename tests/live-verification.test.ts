import test from "node:test";
import assert from "node:assert/strict";
import { liveSpendPlan } from "../scripts/live-verification.ts";
test("live pilot reserves caption USD separately and subtracts every earlier task API charge from the US$25 cap", () => {
  const plan = liveSpendPlan(0.05, 3, 4);
  assert.equal(plan.captionHoldUsd, 0.15000000000000002);
  assert.equal(
    plan.modelCapUsd + plan.captionHoldUsd + plan.alreadyExternalUsd,
    25,
  );
  for (const bad of [0, -1, NaN, Infinity])
    assert.throws(() => liveSpendPlan(bad));
  assert.throws(() => liveSpendPlan(10, 3));
  assert.throws(() => liveSpendPlan(1, 3, 23));
  assert.throws(() => liveSpendPlan(1, 11));
  assert.throws(() => liveSpendPlan(1, 3, -1));
});
