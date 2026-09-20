import test from "node:test";
import assert from "node:assert/strict";
import { freezeEfficiency } from "../src/server/youtube-intelligence/efficiency.ts";
test("rollout defaults off and explicit frozen run flags survive later profiles", () => {
  const input = { origin: "manual" };
  assert.deepEqual(freezeEfficiency(input, {}), input);
  const frozen = freezeEfficiency(input, {YTI_EFFICIENCY_PROFILE:"conservative"});
  assert.equal(frozen.speculativeResearch, false);
  assert.equal(frozen.reuseResearchCache, true);
  assert.deepEqual(freezeEfficiency(frozen, {YTI_EFFICIENCY_PROFILE:"experimental-overlap"}), frozen);
  assert.deepEqual(freezeEfficiency({task:"research-brief"}, {YTI_EFFICIENCY_PROFILE:"experimental-overlap"}), {task:"research-brief"});
  assert.throws(() => freezeEfficiency(input, {YTI_EFFICIENCY_PROFILE:"typo"}));
});
