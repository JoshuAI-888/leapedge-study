import test from "node:test";
import assert from "node:assert/strict";
import { boundedSettled } from "../src/server/youtube-intelligence/bounded-parallel.ts";
test("bounded fanout drains siblings after failure and preserves input order", async () => {
  let active = 0,
    peak = 0;
  const finished: number[] = [];
  const results = await boundedSettled([0, 1, 2, 3, 4], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, n === 0 ? 15 : 2));
    active--;
    finished.push(n);
    if (n === 1) throw Error("failed");
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(finished.length, 5);
  assert.deepEqual(
    results.map((r) => (r.status === "fulfilled" ? r.value : "failed")),
    [0, "failed", 4, 6, 8],
  );
});
