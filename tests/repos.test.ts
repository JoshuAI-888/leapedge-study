import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  savePrices,
  priceSeries,
  type PriceRow,
} from "../src/server/youtube-intelligence/repos/prices.ts";
import {
  appendSettlement,
  settlementsFor,
  listSettlements,
} from "../src/server/youtube-intelligence/repos/settlements.ts";
import {
  HORIZONS,
  eligibleForSettlement,
  settleCall,
  type SettleableCall,
} from "../src/server/youtube-intelligence/settlement.ts";

/** Weekday closes from a start date, so a series has no weekend gaps to reason about. */
function series(
  ticker: string,
  from: string,
  closes: number[],
  source = "FMP dividend-adjusted",
): PriceRow[] {
  const rows: PriceRow[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  const fetchedAt = "2026-09-18T00:00:00.000Z";
  for (const close of closes) {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6)
      day.setUTCDate(day.getUTCDate() + 1);
    rows.push({
      ticker,
      date: day.toISOString().slice(0, 10),
      adjustedClose: close,
      source,
      fetchedAt,
    });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return rows;
}

const call: SettleableCall = {
  claimId: "claim-1",
  ticker: "NVDA",
  stance: "long",
  creatorConviction: "high",
  callDate: "2026-01-05",
  record: "forward",
};

// --- prices -----------------------------------------------------------------

test("A stored price bar carries its source and the time it was fetched", async () => {
  await freshDatabase();
  const rows = series("NVDA", "2026-01-05", [100, 101, 102]);
  assert.equal(await savePrices(rows), 3);

  const read = await priceSeries("NVDA", "2026-01-01", "2026-12-31");
  assert.equal(read.length, 3);
  assert.deepEqual(read[0], rows[0]);
  // Spec 4.11: FMP prices are external but not static, so any figure can be
  // recomputed and reproduced from the bar that produced it.
  for (const row of read) {
    assert.equal(row.source, "FMP dividend-adjusted");
    assert.match(row.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  }
  assert.deepEqual(
    read.map((r) => r.date),
    [...read.map((r) => r.date)].sort(),
    "a series reads back in date order",
  );
});

test("Re-fetching a bar refreshes its source and fetch time rather than duplicating it", async () => {
  await freshDatabase();
  await savePrices(series("NVDA", "2026-01-05", [100]));
  const corrected: PriceRow[] = [
    {
      ticker: "NVDA",
      date: (await priceSeries("NVDA", "2026-01-01", "2026-12-31"))[0]!.date,
      adjustedClose: 100.5,
      source: "FMP dividend-adjusted (restated)",
      fetchedAt: "2026-09-19T00:00:00.000Z",
    },
  ];
  await savePrices(corrected);

  const read = await priceSeries("NVDA", "2026-01-01", "2026-12-31");
  assert.equal(read.length, 1, "one bar per ticker and date");
  assert.equal(read[0]!.adjustedClose, 100.5);
  assert.equal(read[0]!.source, "FMP dividend-adjusted (restated)");
  assert.equal(read[0]!.fetchedAt, "2026-09-19T00:00:00.000Z");
});

test("A price series is scoped to its ticker and window", async () => {
  await freshDatabase();
  await savePrices(series("NVDA", "2026-01-05", [100, 101, 102, 103]));
  await savePrices(series("SPY", "2026-01-05", [500, 501, 502, 503]));

  const all = await priceSeries("NVDA", "2026-01-01", "2026-12-31");
  assert.equal(all.length, 4);
  assert.ok(all.every((r) => r.ticker === "NVDA"));
  const window = await priceSeries("NVDA", all[1]!.date, all[2]!.date);
  assert.deepEqual(
    window.map((r) => r.date),
    [all[1]!.date, all[2]!.date],
  );
});

// --- settlement scoring -----------------------------------------------------

test("Only medium and high conviction long and short calls are settleable", () => {
  assert.equal(eligibleForSettlement(call), true);
  assert.equal(eligibleForSettlement({ ...call, stance: "watch" }), false);
  assert.equal(eligibleForSettlement({ ...call, stance: "neutral" }), false);
  assert.equal(
    eligibleForSettlement({ ...call, creatorConviction: "low" }),
    false,
  );
  assert.equal(
    eligibleForSettlement({ ...call, creatorConviction: "unspecified" }),
    false,
  );
  assert.equal(
    eligibleForSettlement({ ...call, stance: "short", creatorConviction: "medium" }),
    true,
  );
  assert.deepEqual(HORIZONS, [90, 180, 365]);
});

test("A settled call stores its own entry and exit only; no benchmark, no excess", async () => {
  await freshDatabase();
  // 120 weekdays from the call date, rising 1% of the opening level per bar.
  const closes = Array.from({ length: 120 }, (_, i) => 100 + i);
  await savePrices(series("NVDA", "2026-01-05", closes));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");

  const settled = settleCall(call, bars, 90, "2026-12-31");
  assert.equal(settled.status, "settled");
  assert.equal(settled.claimId, "claim-1");
  assert.equal(settled.horizonDays, 90);
  assert.equal(settled.record, "forward");
  // Forward record enters the first session strictly after the call date, so a
  // same-day close cannot be read with hindsight.
  assert.ok(settled.entryDate! > call.callDate, "forward entry is after the call");
  assert.ok(settled.exitDate! > settled.entryDate!);
  const entry = bars.find((b) => b.date === settled.entryDate)!;
  const exit = bars.find((b) => b.date === settled.exitDate)!;
  assert.equal(settled.entryPrice, entry.adjustedClose);
  assert.equal(settled.exitPrice, exit.adjustedClose);
  assert.ok(
    Math.abs(settled.return! - (exit.adjustedClose / entry.adjustedClose - 1)) <
      1e-12,
  );
  // Spec 4.12: excess is computed against the viewer's benchmark at query
  // time, so nothing about a benchmark may appear on the row.
  for (const key of Object.keys(settled))
    assert.ok(
      !/excess|benchmark|spy/i.test(key),
      `settlement row carries "${key}", which belongs to a query-time comparison`,
    );
});

test("A short call's return is the inverse of the price move", async () => {
  await freshDatabase();
  const closes = Array.from({ length: 120 }, (_, i) => 100 + i);
  await savePrices(series("NVDA", "2026-01-05", closes));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");

  const long = settleCall(call, bars, 90, "2026-12-31");
  const short = settleCall({ ...call, stance: "short" }, bars, 90, "2026-12-31");
  assert.equal(short.status, "settled");
  assert.ok(Math.abs(short.return! + long.return!) < 1e-12, "sign is flipped");
  assert.equal(short.entryPrice, long.entryPrice, "the same bars are used");
  assert.equal(short.exitPrice, long.exitPrice);
});

test("A historical replay enters on the call date itself, a forward record does not", async () => {
  await freshDatabase();
  const closes = Array.from({ length: 120 }, (_, i) => 100 + i);
  await savePrices(series("NVDA", "2026-01-05", closes));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");
  const onTheDay = bars[0]!.date;

  const forward = settleCall(
    { ...call, callDate: onTheDay },
    bars,
    90,
    "2026-12-31",
  );
  const historical = settleCall(
    { ...call, callDate: onTheDay, record: "historical" },
    bars,
    90,
    "2026-12-31",
  );
  assert.ok(forward.entryDate! > onTheDay, "forward waits for the next session");
  assert.equal(historical.entryDate, onTheDay, "replay uses the session it has");
  assert.equal(historical.record, "historical");
});

test("A call with no price source is not settleable, and says so rather than disappearing", () => {
  // Spec 4.12: a market without an FMP series is listed with the label rather
  // than hidden, and the sweep picks it up if a source is added later.
  const nothing = settleCall({ ...call, ticker: "0700.HK" }, [], 90, "2026-12-31");
  assert.equal(nothing.status, "not-settleable");
  assert.equal(nothing.return, null);
  assert.equal(nothing.entryDate, null);
  assert.match(nothing.reason!, /price/i);
});

test("A horizon that has not elapsed yet settles nothing", async () => {
  await freshDatabase();
  await savePrices(series("NVDA", "2026-01-05", [100, 101, 102, 103, 104]));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");
  const early = settleCall(call, bars, 365, bars.at(-1)!.date);
  assert.equal(early.status, "pending");
  assert.equal(early.return, null);
  assert.match(early.reason!, /horizon/i);
});

// --- settlements table ------------------------------------------------------

test("Settlement rows are append-only: the database refuses an update or a delete", async () => {
  const db = await freshDatabase();
  await savePrices(series("NVDA", "2026-01-05", Array.from({ length: 120 }, (_, i) => 100 + i)));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");
  const row = await appendSettlement(settleCall(call, bars, 90, "2026-12-31"));

  await assert.rejects(
    () => db.prepare("UPDATE settlements SET return_pct=$1 WHERE id=$2").run(0, row.id),
    /append-only/i,
    "settlements accepted an UPDATE",
  );
  await assert.rejects(
    () => db.prepare("DELETE FROM settlements WHERE id=$1").run(row.id),
    /append-only/i,
    "settlements accepted a DELETE",
  );
  const after = await settlementsFor("claim-1");
  assert.equal(after.length, 1, "the row is still there and unchanged");
  assert.equal(after[0]!.return, row.return);
});

test("Reviews are append-only too, by the same rule", async () => {
  const db = await freshDatabase();
  await db
    .prepare(
      "INSERT INTO reviews(id,claim_id,reviewer_account_id,verdict,note,listened_span,signed_at) VALUES($1,$2,$3,$4,$5,$6,now())",
    )
    .run("r1", "claim-1", "account-1", "agree", null, null);
  await assert.rejects(
    () => db.prepare("UPDATE reviews SET verdict=$1 WHERE id=$2").run("disagree", "r1"),
    /append-only/i,
  );
  await assert.rejects(
    () => db.prepare("DELETE FROM reviews WHERE id=$1").run("r1"),
    /append-only/i,
  );
});

test("A re-run sweep appends a second dated row rather than rewriting the first", async () => {
  await freshDatabase();
  await savePrices(series("NVDA", "2026-01-05", Array.from({ length: 200 }, (_, i) => 100 + i)));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");

  const first = await appendSettlement(settleCall(call, bars, 90, bars[100]!.date));
  const second = await appendSettlement(settleCall(call, bars, 90, bars[150]!.date));
  assert.notEqual(first.id, second.id);

  const rows = await settlementsFor("claim-1");
  assert.equal(rows.length, 2, "history is kept, so a board as-of any date is computable");
  assert.deepEqual(
    rows.map((r) => r.createdAt),
    [...rows.map((r) => r.createdAt)].sort(),
    "rows read back oldest first",
  );
});

test("Settlements are listed by record and horizon, which the record selector needs", async () => {
  await freshDatabase();
  await savePrices(series("NVDA", "2026-01-05", Array.from({ length: 300 }, (_, i) => 100 + i)));
  const bars = await priceSeries("NVDA", "2026-01-01", "2026-12-31");

  await appendSettlement(settleCall(call, bars, 90, "2026-12-31"));
  await appendSettlement(settleCall(call, bars, 180, "2026-12-31"));
  await appendSettlement(
    await Promise.resolve(
      settleCall({ ...call, claimId: "claim-2", record: "historical" }, bars, 90, "2026-12-31"),
    ),
  );

  // Spec 4.12: forward record and historical replay are never mixed.
  const forward = await listSettlements({ record: "forward" });
  assert.equal(forward.length, 2);
  assert.ok(forward.every((r) => r.record === "forward"));
  const historical = await listSettlements({ record: "historical" });
  assert.equal(historical.length, 1);
  const ninety = await listSettlements({ horizonDays: 90 });
  assert.equal(ninety.length, 2);
  assert.ok(ninety.every((r) => r.horizonDays === 90));
});
