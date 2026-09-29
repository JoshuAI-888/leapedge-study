import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { querySeries } from "../src/server/youtube-intelligence/repos/research-query.ts";
import {
  bucketBySession,
  divergingScale,
  niceTicks,
  periodInstants,
  periodUnit,
  placeOnPrice,
  priceScale,
  priorRange,
  rangeSessions,
  sessionInstants,
  sessionOfMarketHour,
  timeTicks,
  trendDelta,
  trendsState,
  typicalConviction,
  weekOf,
} from "../src/features/youtube-intelligence/trends-series.ts";

const zero = { bullish: 0, neutral: 0, bearish: 0 };

test("A New York hour maps to its trading session: after the close and weekends roll forward", () => {
  assert.equal(sessionOfMarketHour("2026-09-25", 10), "2026-09-25");
  assert.equal(sessionOfMarketHour("2026-09-25", 15), "2026-09-25");
  assert.equal(sessionOfMarketHour("2026-09-25", 16), "2026-09-28", "Friday 16:00 is Monday");
  assert.equal(sessionOfMarketHour("2026-09-26", 9), "2026-09-28", "Saturday");
  assert.equal(sessionOfMarketHour("2026-09-04", 17), "2026-09-08", "Labor Day Monday is skipped");
  assert.equal(weekOf("2026-09-30"), "2026-09-28");
  assert.equal(weekOf("2026-09-28"), "2026-09-28");
});

test("Sessions bucket into weeks or sessions, with empty periods filled and nothing dropped", () => {
  const rows = [
    { session: "2026-09-08", bullish: 2, neutral: 1, bearish: 0 },
    { session: "2026-09-11", bullish: 1, neutral: 0, bearish: 3 },
    { session: "2026-09-28", bullish: 4, neutral: 0, bearish: 1 },
  ];
  const weeks = bucketBySession(rows, "week", "2026-09-01", "2026-09-30");
  assert.deepEqual(
    weeks.map((w) => [w.start, w.calls]),
    [
      ["2026-08-31", 0],
      ["2026-09-07", 7],
      ["2026-09-14", 0],
      ["2026-09-21", 0],
      ["2026-09-28", 5],
    ],
  );
  assert.equal(weeks[1].end, "2026-09-13");
  assert.deepEqual({ b: weeks[1].bullish, n: weeks[1].neutral, r: weeks[1].bearish }, { b: 3, n: 1, r: 3 });
  const sessions = bucketBySession(rows.slice(0, 2), "session", "2026-09-04", "2026-09-11");
  assert.deepEqual(
    sessions.map((s) => s.start),
    ["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"],
    "weekends and the holiday are not periods",
  );
  assert.deepEqual(bucketBySession([], "week"), []);
  // A row outside the requested window is still shown, never silently dropped.
  assert.equal(bucketBySession(rows, "week", "2026-09-14", "2026-09-21").reduce((n, b) => n + b.calls, 0), 12);
});

test("Ranges end at the current session; the prior range has the same length and comes just before", () => {
  assert.deepEqual(rangeSessions("1d", "2026-09-28"), { from: "2026-09-28", to: "2026-09-28" });
  assert.deepEqual(rangeSessions("7d", "2026-09-28"), { from: "2026-09-22", to: "2026-09-28" });
  assert.deepEqual(rangeSessions("all", "2026-09-28"), { from: null, to: "2026-09-28" });
  assert.deepEqual(priorRange("1d", "2026-09-28"), { from: "2026-09-25", to: "2026-09-25" });
  assert.deepEqual(priorRange("7d", "2026-09-28"), { from: "2026-09-15", to: "2026-09-21" });
  assert.equal(priorRange("all", "2026-09-28"), null);
  assert.equal(periodUnit("7d"), "session");
  // A week's drill-down window runs from the Friday close before it to its Friday close.
  assert.deepEqual(periodInstants({ start: "2026-09-21", end: "2026-09-27" }), {
    from: "2026-09-18T20:00:00.000Z",
    to: "2026-09-25T20:00:00.000Z",
  });
  assert.equal(periodUnit("30d"), "week");
  assert.deepEqual(sessionInstants("2026-09-28", "2026-09-28"), {
    from: "2026-09-25T20:00:00.000Z",
    to: "2026-09-28T20:00:00.000Z",
  });
});

test("Change against the prior period and the typical conviction", () => {
  assert.equal(trendDelta(79, 61, "90d"), "+18 vs prior 90d");
  assert.equal(trendDelta(3, 5, "1d"), "−2 vs prior session");
  assert.equal(trendDelta(4, 4, "30d"), "No change vs prior 30d");
  assert.equal(trendDelta(4, null, "all"), null);
  assert.deepEqual(typicalConviction({ high: 6, medium: 3, low: 1, unspecified: 9 }), { level: "high", share: 0.6 });
  assert.equal(typicalConviction({ unspecified: 3 }), null);
});

test("Ticks are clean numbers and the scale ends on a tick it reaches", () => {
  assert.deepEqual(niceTicks(9), [0, 5, 10]);
  assert.deepEqual(niceTicks(10), [0, 5, 10]);
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(0), [0]);
  const s = divergingScale([{ bullish: 9, neutral: 4, bearish: 3 }], 200);
  assert.equal(s.step, 5);
  assert.equal(s.top, 10);
  assert.equal(s.bottom, 5);
  assert.deepEqual(s.ticks, [-5, 0, 5, 10]);
  assert.equal(s.y(10), 0);
  assert.equal(s.y(-5), 200);
  // One scale: a bullish and a bearish count of the same size are the same height.
  assert.ok(Math.abs(s.zero - s.y(5) - (s.y(-5) - s.zero)) < 1e-9);
  const flat = divergingScale([zero], 100);
  assert.deepEqual(flat.ticks, [0, 1]);
  const p = priceScale([171.2, 188.9, 180], 100)!;
  assert.ok(p.min <= 171.2 && p.max >= 188.9);
  assert.equal(p.ticks[0], p.min);
  assert.equal(p.ticks.at(-1), p.max);
  assert.equal(priceScale([], 100), null);
  assert.deepEqual(timeTicks("2026-07-01", "2026-09-28", 6), ["2026-07-01", "2026-08-01", "2026-09-01"]);
  assert.ok(timeTicks("2026-09-22", "2026-09-28", 4).every((t) => t >= "2026-09-22" && t <= "2026-09-28"));
});

test("Each call is placed on its session's close, or the last close before it", () => {
  const prices = [
    { date: "2026-09-24", close: 100 },
    { date: "2026-09-25", close: 102 },
    { date: "2026-09-29", close: 105 },
  ];
  const { placed, unplaced } = placeOnPrice(
    [
      { id: "a", session: "2026-09-25" },
      { id: "b", session: "2026-09-28" },
      { id: "c", session: "2026-09-23" },
      { id: "d", session: "2026-09-30" },
    ],
    prices,
  );
  assert.deepEqual(
    placed.map((c) => [c.id, c.priceDate, c.close]),
    [
      ["a", "2026-09-25", 102],
      ["b", "2026-09-25", 102],
    ],
  );
  assert.deepEqual(unplaced.map((c) => c.id), ["c", "d"], "before the first bar or after the last one");
});

test("Empty, thin and chart states", () => {
  assert.equal(trendsState(0), "empty");
  assert.equal(trendsState(4), "thin");
  assert.equal(trendsState(5), "chart");
});

test("The series action buckets by trading session when asked", async () => {
  await freshDatabase();
  await database.prepare("INSERT INTO channels(id,title) VALUES('UCa','Alpha')").run();
  const insertRun = async (id: string, at: string, stances: string[]) => {
    await database
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$1,'u','m','v1',$1,'completed','publish',$2,$2,'{}','{}')",
      )
      .run(id, at);
    for (const [i, stance] of stances.entries())
      await database
        .prepare(
          "INSERT INTO claims(id,run_id,video_id,channel_id,instrument,ticker,stance,thesis_en,creator_conviction,trust_level,published_at,created_at) VALUES($1,$2,$2,'UCa','NVDA','NVDA',$3,'t','high','L1',$4,$4)",
        )
        .run(`${id}:c${i}`, id, stance, at);
  };
  await insertRun("fri-am", "2026-09-25T14:00:00Z", ["long"]); // Friday session
  await insertRun("fri-pm", "2026-09-25T21:30:00Z", ["long", "short"]); // Monday
  await insertRun("sun", "2026-09-27T15:00:00Z", ["watch"]); // Monday
  await insertRun("tue", "2026-09-29T13:00:00Z", ["long"]); // Tuesday
  const window = sessionInstants("2026-09-24", "2026-09-29");
  const days = await querySeries({ ...window, bucket: "day", sessions: true });
  assert.deepEqual(
    days.buckets.map((b) => [b.start, b.calls, b.bullish, b.neutral, b.bearish]),
    [
      ["2026-09-24", 0, 0, 0, 0],
      ["2026-09-25", 1, 1, 0, 0],
      ["2026-09-28", 3, 1, 1, 1],
      ["2026-09-29", 1, 1, 0, 0],
    ],
  );
  assert.equal(days.total, 5);
  const monday = days.points.filter((p) => p.session === "2026-09-28");
  assert.equal(monday.length, 3, "each point carries its session");
  assert.ok(days.points.every((p) => typeof p.at === "string"));
  const weeks = await querySeries({ ...window, bucket: "week", sessions: true });
  assert.deepEqual(
    weeks.buckets.map((b) => [b.start, b.calls]),
    [
      ["2026-09-21", 1],
      ["2026-09-28", 4],
    ],
  );
  // Without the option the UTC-day behaviour is unchanged.
  const utc = await querySeries({ ...window, bucket: "day" });
  assert.equal(utc.buckets.find((b) => b.start === "2026-09-25")?.calls, 3);
});

test("The price series read returns one ticker's adjusted closes in the window, and nothing without a ticker", async () => {
  await freshDatabase();
  const { savePrices } = await import("../src/server/youtube-intelligence/repos/prices.ts");
  const { market } = await import("../src/server/youtube-intelligence/actions/market.ts");
  await savePrices(
    ["2026-09-24", "2026-09-25", "2026-09-28"].map((date, i) => ({
      ticker: "NVDA",
      date,
      adjustedClose: 100 + i,
      source: "fixture",
      fetchedAt: "2026-09-29T00:00:00.000Z",
    })),
  );
  const read = (input: unknown) =>
    market.priceSeries.handler(input) as Promise<{
      ticker: string | null;
      prices: { date: string; close: number }[];
    }>;
  const found = await read({ ticker: "nvda", from: "2026-09-25", to: "2026-09-28" });
  assert.equal(found.ticker, "NVDA");
  assert.deepEqual(found.prices, [
    { date: "2026-09-25", close: 101 },
    { date: "2026-09-28", close: 102 },
  ]);
  assert.deepEqual((await read({ ticker: "AAPL", to: "2026-09-28" })).prices, []);
  assert.deepEqual(await read(undefined), { ticker: null, prices: [] });
});
