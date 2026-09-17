// Uses real retained claims only; never invents eligible calls or backdates observations.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  canonicalRuns,
  docs,
} from "../src/server/youtube-intelligence/research-store.ts";
import { performance } from "../src/server/youtube-intelligence/market.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const before = await docs<any>("forwardObservation");
const current = await canonicalRuns();
const first = await docs<any>("forwardObservation");
for (const row of before)
  assert.equal(hash(first.find((x) => x.videoId === row.videoId)), hash(row));
await canonicalRuns();
const second = await docs<any>("forwardObservation");
assert.equal(hash(first), hash(second));
const results = [];
for (const mode of ["historical", "forward"] as const) {
  const result = await performance(mode);
  const arithmetic = result.rows
    .filter((r) => "stockReturn" in r)
    .map((r) => {
      if (!("stockReturn" in r)) throw Error("Missing arithmetic");
      const signed =
        ((r.exitPrice! - r.entryPrice!) / r.entryPrice!) *
        (r.stance === "short" ? -1 : 1);
      const spy = (r.spyExit! - r.spyEntry!) / r.spyEntry!;
      assert.ok(Math.abs(signed - r.stockReturn!) < 1e-12);
      assert.ok(Math.abs(signed - spy - r.excessReturn!) < 1e-12);
      return { id: r.id, checked: true };
    });
  results.push({ ...result, independentArithmetic: arithmetic });
}
const report = {
  at: new Date().toISOString(),
  canonicalVideos: current.length,
  existingFrozen: before.length,
  newlyFrozen: first.length - before.length,
  freezeHashStable: true,
  observations: first.map((o) => ({
    videoId: o.videoId,
    observedAt: o.observedAt,
    runId: o.run.id,
    sourceHash: o.run.output.sourceHash,
  })),
  results,
  limitations: [
    "Actual audio fidelity is unverified; return arithmetic does not establish claim accuracy.",
    "No calls synthesized or conviction inflated to populate a cohort.",
    "Equal-weight claim averages are not investable portfolio returns; short borrow fees and trading costs excluded.",
    "90-day forward maturity requires elapsed time.",
  ],
};
writeFileSync(
  "docs/completion-cohort-20260915.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    canonicalVideos: current.length,
    frozen: first.length,
    newlyFrozen: first.length - before.length,
    results: results.map((r) => ({
      mode: r.mode,
      summary: r.summary,
      arithmeticChecked: r.independentArithmetic.length,
    })),
  }),
);
await db().close();
