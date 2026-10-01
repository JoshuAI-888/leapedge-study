import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  assembleWatchlist,
  changeOver,
  dayChange,
  divergence,
  formatChange,
  sessionCalls,
  type PricePoint,
  type WatchCall,
} from "../src/features/youtube-intelligence/watchlist.ts";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
import { savePrices } from "../src/server/youtube-intelligence/repos/prices.ts";
import { watchlist } from "../src/server/youtube-intelligence/watchlist.ts";
import { RESOURCES, dispatch } from "../src/server/youtube-intelligence/actions/index.ts";

/**
 * F68. "Now" is Tuesday 29 September 2026, 11:00 ET (15:00 UTC), mid-session.
 * The current session is Tue 29 Sep; Monday's session closed at 16:00 ET
 * (20:00 UTC) on the 28th, so a call after that belongs to today.
 */
const NOW = "2026-09-29T15:00:00.000Z";
const call = (ticker: string | null, stance: string, publishedAt: string, instrument: string | null = ticker): WatchCall => ({
  ticker,
  instrument,
  stance,
  publishedAt,
});
/** Twenty-five weekday closes ending Fri 25 Sep, from a list of values. */
function series(values: number[], end = "2026-09-25"): PricePoint[] {
  const out: PricePoint[] = [];
  let d = new Date(`${end}T00:00:00Z`);
  for (let i = values.length - 1; i >= 0; i--) {
    while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86400000);
    out.unshift({ date: d.toISOString().slice(0, 10), close: values[i] });
    d = new Date(d.getTime() - 86400000);
  }
  return out;
}

test("the session filter keeps calls published into the current US session only", () => {
  const calls = [
    call("NVDA", "long", "2026-09-29T14:00:00Z"), // Tue 10:00 ET: today
    call("AAPL", "long", "2026-09-28T21:00:00Z"), // Mon 17:00 ET, after close: today
    call("TSLA", "long", "2026-09-28T19:00:00Z"), // Mon 15:00 ET: Monday's session
    call("AMD", "long", "2026-09-29T16:00:00Z"), // after "now": not yet
    call("MSFT", "long", "2026-09-29T20:30:00Z"), // after today's close: tomorrow
    call("META", "long", ""), // no publish time
  ];
  assert.deepEqual(sessionCalls(calls, NOW).map((c) => c.ticker), ["NVDA", "AAPL"]);
  // On a Monday morning the weekend rolls in: Saturday's upload is Monday's session.
  const monday = "2026-09-28T14:00:00.000Z";
  assert.deepEqual(
    sessionCalls(
      [
        call("NVDA", "long", "2026-09-26T15:00:00Z"),
        call("AAPL", "long", "2026-09-25T19:00:00Z"),
        call("TSLA", "long", "2026-09-25T20:30:00Z"),
      ],
      monday,
    ).map((c) => c.ticker),
    ["NVDA", "TSLA"],
  );
});

test("1-day and 5-session changes, formatted as signed text", () => {
  assert.ok(Math.abs(dayChange([100, 101.7])! - 0.017) < 1e-12);
  assert.equal(dayChange([100]), null);
  assert.equal(dayChange([]), null);
  assert.equal(changeOver([0, 50], 1), null, "a zero base is not a price");
  assert.ok(Math.abs(changeOver([100, 1, 1, 1, 1, 90], 5)! + 0.1) < 1e-12);
  assert.equal(formatChange(0.017), "+1.7%");
  assert.equal(formatChange(-0.185), "−18.5%");
  assert.equal(formatChange(0.00001), "0.0%");
  assert.equal(formatChange(null), "No price");
});

test("the divergence rule needs a 60% majority against a move of more than 5%", () => {
  const bull = { bullish: 3, neutral: 1, bearish: 1 }; // 60%
  assert.equal(divergence(bull, -0.051)?.label, "Creators vs price");
  assert.match(divergence(bull, -0.051)!.detail, /3 of 5 calls today are bullish.*−5\.1%/);
  assert.equal(divergence(bull, -0.05), null, "exactly 5% is not more than 5%");
  assert.equal(divergence(bull, 0.2), null, "bullish and rising agree");
  assert.equal(divergence({ bullish: 1, neutral: 1, bearish: 1 }, -0.3), null, "no majority");
  const bear = { bullish: 0, neutral: 1, bearish: 2 };
  assert.match(divergence(bear, 0.08)!.detail, /2 of 3 calls today are bearish/);
  assert.equal(divergence(bear, -0.08), null);
  assert.equal(divergence({ bullish: 0, neutral: 0, bearish: 0 }, -0.5), null, "no calls, no flag");
  assert.equal(divergence(bull, null), null, "no price, no flag");
});

test("rows: pinned A→Z, mentioned by calls, prices joined by ticker, missing prices are explicit", () => {
  const nvda = series([...Array(19).fill(100), 110, 120, 118, 110, 105, 100]); // 25 closes
  const w = assembleWatchlist({
    pinned: ["TSLA", "nvda"],
    calls: [
      call("NVDA", "long", "2026-09-29T14:00:00Z"),
      call("NVDA", "long", "2026-09-29T14:10:00Z"),
      call("NVDA", "short", "2026-09-29T14:20:00Z"),
      call(null, "short", "2026-09-29T13:00:00Z", "MACRO · RATES"),
      call("AAPL", "long", "2026-09-28T19:00:00Z"), // yesterday
    ],
    prices: new Map([["NVDA", nvda]]),
    now: NOW,
  });
  assert.equal(w.session, "2026-09-29");
  assert.deepEqual(w.pinned.map((r) => r.key), ["NVDA", "TSLA"]);
  const n = w.pinned[0];
  assert.equal(n.pinned, true);
  assert.equal(n.closes.length, 20);
  assert.equal(n.closes.at(-1), 100);
  assert.equal(n.closeDate, "2026-09-25");
  assert.ok(Math.abs(n.dayChange! - (100 / 105 - 1)) < 1e-12);
  assert.ok(Math.abs(n.moveChange! - (100 / 110 - 1)) < 1e-12, "five sessions back is the 110 close");
  assert.deepEqual(n.mentions, { bullish: 2, neutral: 0, bearish: 1 });
  assert.equal(n.divergence?.label, "Creators vs price", "67% bullish, price −9.1%");
  const t = w.pinned[1];
  assert.deepEqual(t.closes, []);
  assert.equal(t.dayChange, null);
  assert.equal(t.closeDate, null);
  assert.equal(t.divergence, null);
  assert.deepEqual(w.mentioned.map((r) => [r.key, r.pinned]), [
    ["NVDA", true],
    ["MACRO · RATES", false],
  ]);
  const macro = w.mentioned[1];
  assert.equal(macro.ticker, null);
  assert.deepEqual(macro.closes, [], "a macro theme has no price");
  assert.equal(w.closesTo, "2026-09-25");
});

test("an empty watchlist on a quiet day", () => {
  const w = assembleWatchlist({ pinned: [], calls: [], prices: new Map(), now: NOW });
  assert.deepEqual(w, { session: "2026-09-29", pinned: [], mentioned: [], closesTo: null });
});

// --- Server read ---------------------------------------------------------------

before(async () => {
  await freshDatabase();
});

test("market/watchlist reads pins, today's canonical calls and stored closes", async () => {
  assert.equal(RESOURCES.market.watchlist.mutating, false);
  assert.deepEqual(await dispatch("market", "watchlist", undefined).then((w) => (w as { pinned: unknown[] }).pinned), []);
  await put("watchlist", "NVDA", { ticker: "NVDA", enabled: true });
  await put("watchlist", "AMD", { ticker: "AMD", enabled: false });
  await savePrices(
    series([100, 101, 102, 103, 104, 105, 106]).map((p) => ({
      ticker: "NVDA",
      date: p.date,
      adjustedClose: p.close,
      source: "test",
      fetchedAt: "2026-09-26T00:00:00.000Z",
    })),
  );
  const insertRun = (id: string, videoId: string, status = "completed") =>
    database
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,'u','m','v1','t',$3,'publish',$4,$4,'{}','{}')",
      )
      .run(id, videoId, status, "2026-09-29T14:30:00.000Z");
  const insertCall = (id: string, runId: string, ticker: string, stance: string, at: string) =>
    database
      .prepare(
        "INSERT INTO claims(id,run_id,video_id,ticker,instrument,stance,thesis_en,published_at) VALUES($1,$2,'v',$3,$3,$4,'t',$5)",
      )
      .run(id, runId, ticker, stance, at);
  await insertRun("r1", "v");
  await insertRun("r0", "v-old");
  await insertCall("r1:c1", "r1", "NVDA", "long", "2026-09-29T14:00:00Z");
  await insertCall("r1:c2", "r1", "AAPL", "short", "2026-09-29T14:00:00Z");
  await insertCall("r0:c1", "r0", "TSLA", "long", "2026-09-25T15:00:00Z");
  const w = (await watchlist({ now: NOW }));
  assert.deepEqual(w.pinned.map((r) => r.key), ["NVDA"], "a disabled pin is not listed");
  assert.equal(w.pinned[0].closes.length, 7);
  assert.equal(w.pinned[0].closeDate, "2026-09-25");
  assert.deepEqual(w.pinned[0].mentions, { bullish: 1, neutral: 0, bearish: 0 });
  assert.deepEqual(w.mentioned.map((r) => r.key).sort(), ["AAPL", "NVDA"]);
  assert.equal(w.mentioned.find((r) => r.key === "AAPL")!.closes.length, 0);
});
