import { test } from "node:test";
import assert from "node:assert/strict";
import {
  wilsonInterval,
  statistics,
  benjaminiHochberg,
} from "../src/features/youtube-intelligence/significance.ts";
test("Wilson interval and sample statistics agree with hand-calculated values", () => {
  const interval = wilsonInterval(5, 10)!;
  assert.ok(Math.abs(interval.low - 0.236593) < 0.00001);
  assert.ok(Math.abs(interval.high - 0.763407) < 0.00001);
  const s = statistics([1, 2, 3, 4, 5]);
  assert.equal(s.meanExcess, 3);
  assert.equal(s.medianExcess, 3);
  assert.ok(Math.abs(s.stddev! - Math.sqrt(2.5)) < 1e-10);
  assert.ok(Math.abs(s.t! - 4.242640687) < 1e-8);
  assert.ok(Math.abs(s.p! - 0.0132356) < 0.000001);
});
test("BH uses eligible hypotheses, monotone adjusted probabilities, and leaves missing p untested", () => {
  assert.deepEqual(benjaminiHochberg([0.01, 0.04, 0.03, null]), [
    0.03,
    0.04,
    0.04,
    null,
  ]);
  assert.equal(statistics([]).p, null);
  assert.equal(statistics([1]).p, null);
  assert.equal(statistics([0, 0]).p, 1);
});
