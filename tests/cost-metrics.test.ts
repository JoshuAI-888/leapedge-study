import { test } from "node:test";
import assert from "node:assert/strict";
import {
  costProjection,
  budgetMeter,
} from "../src/features/youtube-intelligence/metrics/cost.ts";
const base = {
  now: "2026-09-19T00:00:00Z",
  selectedChannelIds: ["a"],
  uploads: [],
  observations: [],
  samples: [],
  calls: [],
  monthlyUsd: 100,
  hardCeilingUsd: 200,
  alertAtPercent: 70,
};
test("unobserved channels and absent measurements are unknown, not free", () => {
  const p = costProjection(base);
  assert.equal(p.projectedMonthlyUsd, null);
  assert.equal(p.measuredCostPerVideoUsd, null);
  assert.equal(p.channels[0].uploadsPerMonth, null);
  assert.equal(
    costProjection({ ...base, selectedChannelIds: [] }).projectedMonthlyUsd,
    0,
  );
});
test("90 day rate dedupes uploads and excludes future/outside window; zero accepted videos still cost money", () => {
  const p = costProjection({
    ...base,
    observations: [{ channelId: "a", complete: true }],
    uploads: [
      { channelId: "a", videoId: "one", publishedAt: "2026-06-21T00:00:00Z" },
      { channelId: "a", videoId: "one", publishedAt: "2026-06-21T00:00:00Z" },
      { channelId: "a", videoId: "two", publishedAt: "2026-09-19T00:00:00Z" },
      { channelId: "a", videoId: "old", publishedAt: "2026-06-20T23:59:59Z" },
      {
        channelId: "a",
        videoId: "future",
        publishedAt: "2026-09-20T00:00:00Z",
      },
    ],
    samples: [
      { videoId: "one", measuredUsd: 3, acceptedClaims: 0 },
      { videoId: "two", measuredUsd: null, acceptedClaims: 3 },
    ],
  });
  assert.equal(p.measuredCostPerVideoUsd, 3);
  assert.equal(p.sampleCount, 1);
  assert.equal(p.sampleCoverage, 0.5);
  assert.equal(p.channels[0].uploadsPerMonth, 2 / 3);
  assert.equal(p.projectedMonthlyUsd, 2);
});
test("complete empty discovery is zero even without a cost sample; partial discovery is an unknown total", () => {
  assert.equal(
    costProjection({
      ...base,
      observations: [{ channelId: "a", complete: true }],
    }).projectedMonthlyUsd,
    0,
  );
  assert.equal(
    costProjection({
      ...base,
      observations: [{ channelId: "a", complete: false }],
    }).projectedMonthlyUsd,
    null,
  );
});
test("budget uses UTC month and retains old unknown holds; unallocated costs remain explicit", () => {
  const b = budgetMeter({
    ...base,
    calls: [
      { status: "completed", amount: 60, settledAt: "2026-09-01T00:00:00Z" },
      { status: "completed", amount: 9, settledAt: "2026-08-31T23:59:59Z" },
      { status: "completed", amount: 11, settledAt: null },
      { status: "unknown", amount: 10, settledAt: null },
      { status: "released", amount: 1000, settledAt: null },
    ],
  });
  assert.equal(b.monthToDateSpentUsd, 60);
  assert.equal(b.openHoldsUsd, 10);
  assert.equal(b.unknownOutcomeHoldsUsd, 10);
  assert.equal(b.unallocatedSpentUsd, 11);
  assert.equal(b.committedUsd, 70);
  assert.equal(b.state, "warning");
  assert.equal(b.remainingUsd, 19);
});
test("budget exact thresholds distinguish team limit and environment ceiling", () => {
  const calls = [
    {
      status: "completed" as const,
      amount: 100,
      settledAt: "2026-09-02T00:00:00Z",
    },
  ];
  assert.equal(budgetMeter({ ...base, calls }).state, "budget-reached");
  assert.equal(
    budgetMeter({ ...base, calls, hardCeilingUsd: 100 }).state,
    "hard-ceiling-reached",
  );
  assert.equal(
    budgetMeter({ ...base, calls: [], monthlyUsd: 0 }).remainingUsd,
    0,
  );
});

test("registry exposes budget and projection figures using the same pure calculations", async () => {
  const { evaluate, MetricContext } =
    await import("../src/features/youtube-intelligence/metrics/registry.ts");
  const ctx = MetricContext.parse({
    asOf: "2026-09-19",
    horizonDays: 90,
    benchmark: "SPY",
    mode: "forward",
    claims: [],
    settlements: [],
    cost: base,
  });
  assert.equal(evaluate("cost.projectedMonthlyUsd", ctx), null);
  assert.equal(evaluate("cost.monthToDateSpentUsd", ctx), 0);
  assert.equal(evaluate("cost.remainingUsd", ctx), 100);
});

test("database loader distinguishes measured zero from open holds and supports unsaved selection", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { loadCostMetrics } =
    await import("../src/server/youtube-intelligence/cost-metrics.ts");
  const { create, reserve, settle } =
    await import("../src/server/youtube-intelligence/store.ts");
  const { upsertChannel } =
    await import("../src/server/youtube-intelligence/repos/channels.ts");
  const db = await freshDatabase();
  const { put } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  await put("channelCoverage", "a", { latestMetadataAt: base.now });
  await upsertChannel({
    id: "a",
    lastPull: base.now,
    historyStarted: true,
    nextPageToken: null,
    autoAnalyze: false,
  });
  const run = await create("abcdefghijk", "fixture", {}, "test");
  const call = await reserve(run.id, "test", 0.1);
  await settle(call, 0, { settledAt: base.now });
  await db
    .prepare("UPDATE yi_runs SET status='completed' WHERE id=$1")
    .run(run.id);
  await db
    .prepare(
      "INSERT INTO yi_discoveries(video_id,channel_id,payload,discovered_at) VALUES($1,$2,$3,$4)",
    )
    .run(
      "abcdefghijk",
      "a",
      JSON.stringify({
        videoId: "abcdefghijk",
        channelId: "a",
        publishedAt: base.now,
      }),
      base.now,
    );
  const result = await loadCostMetrics({
    now: base.now,
    selectedChannelIds: ["a"],
  });
  assert.equal(result.projection.measuredCostPerVideoUsd, 0);
  assert.equal(result.projection.projectedMonthlyUsd, 0);
  assert.equal(result.projection.sampleCount, 1);
  assert.deepEqual(
    (await loadCostMetrics({ now: base.now })).context.selectedChannelIds,
    [],
  );
  await put("channelCoverage", "a", {
    latestMetadataAt: "2026-09-16T00:00:00Z",
  });
  assert.equal(
    (await loadCostMetrics({ now: base.now, selectedChannelIds: ["a"] }))
      .projection.projectedMonthlyUsd,
    null,
    "old pagination cannot stand in for fresh latest metadata",
  );
});

test("projection exceeding the team budget is advisory and preserves the unsaved selection", () => {
  const p = costProjection({
    ...base,
    monthlyUsd: 0.5,
    observations: [{ channelId: "a", complete: true }],
    uploads: [{ videoId: "one", channelId: "a", publishedAt: base.now }],
    samples: [{ videoId: "one", measuredUsd: 3, acceptedClaims: 0 }],
  });
  assert.equal(p.projectedMonthlyUsd, 1);
  assert.equal(p.exceedsBudget, true);
  assert.equal(p.channels[0].channelId, "a");
});

test("budget excludes future-dated settlements and rejects corrupt amounts instead of showing free usage", () => {
  assert.equal(
    budgetMeter({
      ...base,
      calls: [
        { status: "completed", amount: 999, settledAt: "2026-09-20T00:00:00Z" },
      ],
    }).monthToDateSpentUsd,
    0,
  );
  assert.throws(() =>
    budgetMeter({
      ...base,
      calls: [{ status: "unknown", amount: -1, settledAt: null }],
    }),
  );
});

test("manual channel selection is atomic, versioned, and never enables discovery as a side effect", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { upsertChannel, getChannel } =
    await import("../src/server/youtube-intelligence/repos/channels.ts");
  const { saveProcessingSelection } =
    await import("../src/server/youtube-intelligence/channels.ts");
  const { docs } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  await freshDatabase();
  await upsertChannel({ id: "a", active: false, autoAnalyze: false });
  await assert.rejects(
    () => saveProcessingSelection(["a", "missing"]),
    /Unknown channel/,
  );
  assert.equal((await getChannel("a"))?.autoAnalyze, false);
  await saveProcessingSelection(["a"]);
  assert.equal((await getChannel("a"))?.autoAnalyze, true);
  assert.equal((await getChannel("a"))?.active, false);
  await saveProcessingSelection([]);
  assert.equal((await getChannel("a"))?.autoAnalyze, false);
  assert.equal((await docs("channelSelection")).length, 2);
});

test("explicit analyse-and-process opts in only the upload channel and records the selection", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { upsertChannel, getChannel } =
    await import("../src/server/youtube-intelligence/repos/channels.ts");
  const { analyzeUploadAndProcess } =
    await import("../src/server/youtube-intelligence/channels.ts");
  const { docs } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const db = await freshDatabase();
  await upsertChannel({ id: "a", active: true, autoAnalyze: false });
  await upsertChannel({ id: "b", active: true, autoAnalyze: false });
  await db
    .prepare(
      "INSERT INTO yi_discoveries(video_id,channel_id,payload,discovered_at) VALUES($1,$2,$3,$4)",
    )
    .run("abcdefghijk", "a", "{}", base.now);
  await analyzeUploadAndProcess("abcdefghijk");
  assert.equal((await getChannel("a"))?.autoAnalyze, true);
  assert.equal((await getChannel("b"))?.autoAnalyze, false);
  assert.equal((await docs("channelSelection")).length, 1);
  await assert.rejects(
    () => analyzeUploadAndProcess("missing"),
    /Upload not found/,
  );
  assert.equal((await docs("channelSelection")).length, 1);
});

test("saving an unchanged processing selection preserves its explicit batch or immediate mode", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { upsertChannel, getChannel } =
    await import("../src/server/youtube-intelligence/repos/channels.ts");
  const { saveProcessingSelection } =
    await import("../src/server/youtube-intelligence/channels.ts");
  const { loadCostMetrics } =
    await import("../src/server/youtube-intelligence/cost-metrics.ts");
  await freshDatabase();
  for (const mode of ["immediate", "batch"])
    await upsertChannel({ id: mode, autoAnalyze: true, processing: mode });
  await saveProcessingSelection(["immediate", "batch"]);
  assert.equal((await getChannel("immediate"))?.processing, "immediate");
  assert.equal((await getChannel("batch"))?.processing, "batch");
  assert.deepEqual(
    (
      await loadCostMetrics({ now: base.now })
    ).context.selectedChannelIds.sort(),
    ["batch", "immediate"],
  );
});
