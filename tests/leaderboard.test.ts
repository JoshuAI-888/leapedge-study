import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardAsOf,
  diffBoards,
  type BoardSnapshot,
} from "../src/features/youtube-intelligence/leaderboard.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { freshDatabase } from "./helpers/db.ts";
import {
  savePrices,
  priceHistory,
  priceSeries,
} from "../src/server/youtube-intelligence/repos/prices.ts";
import { upsertClaim } from "../src/server/youtube-intelligence/repos/claims.ts";
import { create } from "../src/server/youtube-intelligence/store.ts";
import {
  settlementSweep,
  loadBoardSnapshot,
} from "../src/server/youtube-intelligence/leaderboard.ts";
import { listSettlements } from "../src/server/youtube-intelligence/repos/settlements.ts";
import pg from "pg";
test("Real pg DATE parser preserves calendar dates independently of machine timezone", () => {
  assert.equal(
    pg.types.getTypeParser(pg.types.builtins.DATE)("2026-01-02"),
    "2026-01-02",
  );
});
function fixture(): BoardSnapshot {
  const claims = [1, 2].map((i) => ({
    id: `c${i}`,
    runId: `r${i}`,
    videoId: `video${i}`,
    channelId: "creator",
    instrument: "NVDA",
    ticker: "NVDA",
    tickerExplicit: true,
    stance: "long",
    thesisEn: "Fixture",
    horizonEn: null,
    conditionsEn: [],
    risksEn: [],
    creatorConviction: "high",
    trustLevel: "L2" as const,
    trustBasis: {},
    configHash: null,
    publishedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
  }));
  return {
    claims,
    runs: claims.map((c) => ({
      id: c.runId,
      record: "forward",
      createdAt: c.createdAt,
    })),
    channels: [{ id: "creator", title: "Creator" }],
    mentions: [],
    settings: teamDefaults(),
    asOf: "2026-09-19T00:00:00Z",
    instruments: [
      {
        symbol: "NVDA",
        name: "Nvidia",
        currency: "USD",
        exchange: "NASDAQ",
        market: "us-stock",
        verifiedAt: "2026-01-01T00:00:00Z",
        sector: "Technology",
      },
    ],
    settlements: claims.map((c, i) => ({
      id: `s${i}`,
      claimId: c.id,
      horizonDays: 90,
      entryDate: "2026-01-02",
      entryPrice: 100,
      exitDate: "2026-04-01",
      exitPrice: i ? 110 : 120,
      return: i ? 0.1 : 0.2,
      status: "settled",
      reason: null,
      record: "forward",
      createdAt: "2026-04-02T00:00:00Z",
    })),
    prices: ["SPY", "QQQ"].flatMap((ticker) => [
      {
        ticker,
        date: "2026-01-02",
        adjustedClose: 100,
        source: "fixture",
        fetchedAt: "2026-04-02T00:00:00Z",
      },
      {
        ticker,
        date: "2026-04-01",
        adjustedClose: ticker === "SPY" ? 105 : 110,
        source: "fixture",
        fetchedAt: "2026-04-02T00:00:00Z",
      },
    ]),
  };
}
test("Changing benchmark recomputes excess without writes while preserving raw win rate", () => {
  const data = fixture(),
    before = JSON.stringify(data);
  const spy = boardAsOf(data, { benchmark: "SPY" }),
    qqq = boardAsOf(data, { benchmark: "QQQ" });
  assert.ok(Math.abs(spy.creators[0].meanExcess! - 0.1) < 1e-12);
  assert.ok(Math.abs(qqq.creators[0].meanExcess! - 0.05) < 1e-12);
  assert.equal(spy.creators[0].winRate, 1);
  assert.equal(spy.creators[0].status, "not-yet");
  assert.equal(spy.creators[0].q, null);
  assert.equal(JSON.stringify(data), before);
});
test("As-of selects latest eligible settlement and price revision without future leakage", () => {
  const data = fixture();
  data.settlements.push({
    ...data.settlements[0],
    id: "correction",
    return: -0.2,
    createdAt: "2026-08-01T00:00:00Z",
  });
  data.prices.push({
    ...data.prices[1],
    adjustedClose: 200,
    fetchedAt: "2026-08-01T00:00:00Z",
  });
  const before = boardAsOf(data, { asOf: "2026-05-01", benchmark: "SPY" });
  assert.ok(Math.abs(before.creators[0].meanExcess! - 0.1) < 1e-12);
  const after = boardAsOf(data, { benchmark: "SPY" });
  assert.ok(after.creators[0].meanExcess! < -0.9);
  assert.equal(diffBoards(before, after)[0].meaningful, false);
  assert.equal(boardAsOf(data, { record: "historical" }).creators.length, 0);
  data.claims[0].trustLevel = "L0" as "L2";
  assert.equal(boardAsOf(data).creators[0].n, 1);
});
test("Monotonic settlement revisions resolve corrections even when timestamps tie", () => {
  const data = fixture();
  data.settlements[0].revision = 1;
  data.settlements.push({
    ...data.settlements[0],
    id: "a-before-random-original-id",
    revision: 2,
    return: -0.2,
  });
  const board = boardAsOf(data, { benchmark: "none" });
  assert.equal(
    board.scored.find((s) => s.claim.id === "c1")?.settlement.return,
    -0.2,
  );
});
test("Twenty-call significance gates, BH adjustment, and Changes distinguish supported evidence from early noise", () => {
  const data = fixture(),
    base = data.claims[0],
    settlement = data.settlements[0];
  data.claims = Array.from({ length: 40 }, (_, i) => ({
    ...base,
    id: `claim-${i}`,
    runId: `run-${i}`,
    channelId: i < 20 ? "positive" : "negative",
  }));
  data.runs = data.claims.map((c) => ({
    id: c.runId,
    record: "forward",
    createdAt: "2026-01-01T00:00:00Z",
  }));
  data.settlements = data.claims.map((c, i) => ({
    ...settlement,
    id: `settle-${i}`,
    claimId: c.id,
    return: (i < 20 ? 0.1 : -0.1) + (i % 2 ? 0.01 : -0.01),
    createdAt: i % 20 < 10 ? "2026-04-02T00:00:00Z" : "2026-07-01T00:00:00Z",
  }));
  const before = boardAsOf(data, { asOf: "2026-06-01", benchmark: "none" }),
    after = boardAsOf(data, { benchmark: "none" });
  assert.ok(
    before.creators.every(
      (c) => c.rank === null && c.q === null && c.status === "not-yet",
    ),
  );
  assert.equal(
    after.creators.find((c) => c.id === "positive")!.status,
    "supported",
  );
  assert.equal(
    after.creators.find((c) => c.id === "negative")!.status,
    "negative",
  );
  assert.equal(after.creators[0].id, "positive");
  assert.ok(after.creators.every((c) => c.q !== null && c.q < 0.05));
  const movement = diffBoards(before, after).find(
    (c) => c.kind === "creator" && c.id === "positive",
  )!;
  assert.equal(movement.callsAdded, 10);
  assert.equal(movement.meaningful, false);
  assert.equal(movement.reason, "Reached 20 settled calls");
  assert.equal(movement.claimIds.length, 10);
});
test("Price revisions are append-only and settlement sweeps are idempotent and separated by record", async () => {
  const db = await freshDatabase();
  const run = await create(
    "abcdefghijk",
    "fixture",
    { record: "historical" },
    "fixture",
  );
  await db
    .prepare("UPDATE yi_runs SET status='completed' WHERE id=$1")
    .run(run.id);
  await upsertClaim({
    ...fixture().claims[0],
    id: `${run.id}:c1`,
    runId: run.id,
    createdAt: "2026-01-01T00:00:00Z",
  });
  const bars = [
    {
      ticker: "NVDA",
      date: "2026-01-01",
      adjustedClose: 100,
      source: "fixture",
      fetchedAt: "2026-04-02T00:00:00Z",
    },
    {
      ticker: "NVDA",
      date: "2026-04-01",
      adjustedClose: 120,
      source: "fixture",
      fetchedAt: "2026-04-02T00:00:00Z",
    },
  ];
  await savePrices(bars);
  await savePrices([
    { ...bars[1], adjustedClose: 121, fetchedAt: "2026-05-01T00:00:00Z" },
  ]);
  assert.equal((await priceHistory()).length, 3);
  await savePrices([
    { ...bars[1], adjustedClose: 90, fetchedAt: "2026-03-01T00:00:00Z" },
  ]);
  assert.equal(
    (await priceSeries("NVDA", "2026-04-01", "2026-04-01"))[0].adjustedClose,
    121,
  );
  await assert.rejects(
    () => db.prepare("DELETE FROM price_history").run(),
    /append-only/,
  );
  assert.equal((await settlementSweep("2026-06-01")).appended, 3);
  assert.equal((await settlementSweep("2026-06-01")).appended, 0);
  const rows = await listSettlements();
  assert.ok(rows.every((r) => r.record === "historical"));
  const snapshot = await loadBoardSnapshot();
  assert.equal(snapshot.runs[0].record, "historical");
  assert.equal(
    boardAsOf(snapshot, { record: "forward", benchmark: "none" }).scored.length,
    0,
  );
});

test("A signed rejection is never scored even if an older row still reports L2", () => {
  const data = fixture();
  data.claims[0].trustBasis = { latestReviewVerdict: "rejected" };
  const board = boardAsOf(data);
  assert.equal(board.scored.length, 1);
  assert.equal(
    board.scored.some((s) => s.claim.id === "c1"),
    false,
  );
  assert.match(
    board.excluded.find((c) => c.claimId === "c1")!.reason,
    /Human reviewer rejected/,
  );
});
