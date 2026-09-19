import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { seedFixture } from "./helpers/fixtures.ts";
import {
  registry,
  metric,
  evaluate,
  renderHover,
  wilsonInterval,
  type MetricContext,
} from "../src/features/youtube-intelligence/metrics/registry.ts";
import { uiColumns } from "../src/features/youtube-intelligence/metrics/ui-columns.ts";
import {
  loadMetricContext,
  emptyMetricContext,
  trustLevelOf,
} from "../src/features/youtube-intelligence/metrics/context.ts";
import { renderMethodology } from "../src/features/youtube-intelligence/metrics/methodology.ts";
import { docs } from "../src/server/youtube-intelligence/research-store.ts";
import {
  summarizeScores,
  type scoreCall,
} from "../src/features/youtube-intelligence/performance.ts";
import type { CheckedClaim } from "../src/features/youtube-intelligence/contracts.ts";

const ids = new Set(registry.map((m) => m.id));

test("registry ids are unique and every entry has a definition, steps and inputs", () => {
  assert.equal(ids.size, registry.length, "duplicate metric id");
  for (const m of registry) {
    assert.match(
      m.id,
      /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/,
      `${m.id}: dotted id`,
    );
    assert.ok(m.label.trim().length > 0, `${m.id}: label`);
    assert.ok(m.definition.trim().length > 0, `${m.id}: definition`);
    assert.match(
      m.definition.trim(),
      /[.!?]$/,
      `${m.id}: definition is a sentence`,
    );
    assert.ok(m.steps.length > 0, `${m.id}: steps`);
    for (const s of m.steps)
      assert.ok(s.trim().length > 0, `${m.id}: blank step`);
    assert.ok(m.inputs.length > 0, `${m.id}: inputs`);
    for (const i of m.inputs) {
      assert.ok(i.table.length > 0, `${m.id}: input table`);
      assert.ok(i.columns.length > 0, `${m.id}: input columns`);
    }
    assert.ok(Array.isArray(m.settingsUsed), `${m.id}: settingsUsed`);
    assert.equal(
      typeof m.implementation,
      "function",
      `${m.id}: implementation`,
    );
    assert.doesNotMatch(
      `${m.definition} ${m.steps.join(" ")}`,
      /TODO|TBD|placeholder|lorem/i,
      `${m.id}: placeholder text`,
    );
  }
});

test("every UI column maps to a registry id", () => {
  assert.ok(uiColumns.length > 0);
  for (const c of uiColumns) {
    assert.ok(
      ids.has(c.metricId),
      `${c.surface} / ${c.column} -> ${c.metricId} is not in the registry`,
    );
    assert.ok(c.surface.length > 0 && c.column.length > 0);
  }
  const seen = new Set<string>();
  for (const c of uiColumns) {
    const k = `${c.surface}\u0000${c.column}`;
    assert.ok(!seen.has(k), `duplicate column ${c.surface} / ${c.column}`);
    seen.add(k);
  }
  const performance = uiColumns
    .filter((c) => c.surface === "standalone.creator")
    .map((c) => c.column);
  assert.deepEqual(performance, [
    "Name",
    "Rank",
    "Settled calls",
    "Win rate",
    "Median excess",
    "Evidence",
  ]);
});

test("renderHover and renderMethodology share the registry text", () => {
  const m = metric("calls.winRate");
  const hover = renderHover("calls.winRate");
  assert.ok(hover.startsWith(m.definition), "hover starts with the definition");
  m.steps.forEach((s, i) =>
    assert.ok(hover.includes(`${i + 1}. ${s}`), `hover lists step ${i + 1}`),
  );
  const md = renderMethodology();
  assert.ok(md.startsWith("# Methodology"));
  for (const entry of registry) {
    assert.ok(md.includes(`## ${entry.label}`), `${entry.id}: heading`);
    assert.ok(md.includes(`\`${entry.id}\``), `${entry.id}: id`);
    assert.ok(md.includes(entry.definition), `${entry.id}: definition`);
    entry.steps.forEach((s, i) =>
      assert.ok(md.includes(`${i + 1}. ${s}`), `${entry.id}: step ${i + 1}`),
    );
  }
  assert.throws(() => renderHover("no.such.metric"), /Unknown metric/);
  assert.throws(
    () => evaluate("no.such.metric", emptyMetricContext()),
    /Unknown metric/,
  );
});

test("Wilson 95% interval matches known values", () => {
  assert.equal(wilsonInterval(0, 0), null);
  const half = wilsonInterval(5, 10)!;
  assert.ok(Math.abs(half.low - 0.2366) < 0.001, `low ${half.low}`);
  assert.ok(Math.abs(half.high - 0.7634) < 0.001, `high ${half.high}`);
  const all = wilsonInterval(10, 10)!;
  assert.ok(Math.abs(all.low - 0.7225) < 0.001, `low ${all.low}`);
  assert.equal(all.high, 1);
  const none = wilsonInterval(0, 4)!;
  assert.equal(none.low, 0);
  assert.ok(Math.abs(none.high - 0.4898) < 0.001, `high ${none.high}`);
});

test("trust level derives from the checks a claim has passed until a stored level exists", () => {
  const claim: CheckedClaim = {
    id: "c1",
    claim: {} as CheckedClaim["claim"],
    passed: true,
    reasons: [],
  };
  assert.equal(trustLevelOf(claim), "L0");
  assert.equal(
    trustLevelOf({ ...claim, audit: { verdict: "accept", reason_en: "" } }),
    "L1",
  );
  assert.equal(
    trustLevelOf({
      ...claim,
      passed: false,
      audit: { verdict: "reject", reason_en: "" },
    }),
    null,
  );
  assert.equal(trustLevelOf({ ...claim, trust: "L2" } as CheckedClaim), "L2");
  assert.equal(
    trustLevelOf({ ...claim, trust: "bogus" } as CheckedClaim),
    "L0",
  );
});

test("every entry evaluates on an empty context without throwing", () => {
  const ctx = emptyMetricContext();
  for (const m of registry) {
    const value = evaluate(m.id, ctx);
    assert.ok(
      value === null || typeof value === "number" || Array.isArray(value),
      `${m.id}: ${JSON.stringify(value)}`,
    );
  }
  assert.equal(evaluate("calls.count", ctx), 0);
  assert.equal(evaluate("calls.winRate", ctx), null);
  assert.equal(evaluate("calls.winRateInterval", ctx), null);
});

test("every entry evaluates on the baseline fixture and equals the direct computation", async () => {
  await freshDatabase();
  const seeded = await seedFixture("baseline");
  const ctx: MetricContext = await loadMetricContext({
    asOf: "2026-09-01",
    horizonDays: 90,
    benchmark: "SPY",
    mode: "leapedge",
  });
  assert.equal(ctx.settlements.length, Object.keys(seeded.settlements).length);
  for (const m of registry) {
    let value: unknown;
    assert.doesNotThrow(() => {
      value = evaluate(m.id, ctx);
    }, `${m.id} threw`);
    assert.notEqual(value, undefined, `${m.id} returned undefined`);
  }
  // The rendered figure and the computation share one source: summarizeScores over the stored rows.
  const stored = (
    await docs<ReturnType<typeof scoreCall>>("settlement")
  ).filter((r) =>
    Object.values(seeded.settlements).includes(`${r.id}:leapedge:90`),
  );
  const direct = summarizeScores(stored);
  assert.equal(evaluate("calls.count", ctx), direct.total);
  assert.equal(evaluate("calls.priced", ctx), direct.priced);
  assert.equal(evaluate("calls.completed", ctx), direct.completed);
  assert.equal(evaluate("calls.ongoing", ctx), direct.ongoing);
  assert.equal(evaluate("calls.meanReturn", ctx), direct.meanReturn);
  assert.equal(evaluate("calls.meanBenchmarkReturn", ctx), direct.meanSpy);
  assert.equal(evaluate("calls.meanExcessReturn", ctx), direct.meanExcess);
  assert.equal(evaluate("calls.winRate", ctx), direct.winRate);
  assert.equal(evaluate("calls.beatsBenchmarkRate", ctx), direct.beatsSpyRate);
  // Baseline: 6 calls, 2 priced (one completed, one ongoing), 3 ineligible, 1 unpriced.
  assert.equal(direct.total, 6);
  assert.equal(direct.priced, 2);
  assert.equal(direct.completed, 1);
  assert.equal(direct.ongoing, 1);
  const interval = evaluate("calls.winRateInterval", ctx) as {
    low: number;
    high: number;
    n: number;
  };
  assert.equal(interval.n, 2);
  assert.ok(
    interval.low >= 0 && interval.high <= 1 && interval.low <= interval.high,
  );
  // Trust ladder: every accepted fixture claim carries a critic verdict, so all sit at L1 today.
  const acceptedClaims = ctx.claims.filter((c) => c.trust !== null).length;
  assert.equal(evaluate("trust.l0Count", ctx), 0);
  assert.equal(evaluate("trust.l1Count", ctx), acceptedClaims);
  assert.equal(evaluate("trust.l2Count", ctx), 0);
  assert.equal(evaluate("trust.l3Count", ctx), 0);
  assert.ok(acceptedClaims >= 5, `accepted claims ${acceptedClaims}`);
  assert.deepEqual(
    evaluate("channel.title", ctx),
    [...new Set(ctx.settlements.map((s) => s.channel))].sort(),
  );
});
