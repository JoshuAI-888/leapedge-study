import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SENTIMENT_PERIODS,
  creatorChange,
  emptyTitle,
  periodFromDays,
  periodWindows,
  sentimentForPeriod,
  sessionWindows,
} from "../src/features/youtube-intelligence/metrics/sentiment-window.ts";
import { sentimentShift } from "../src/features/youtube-intelligence/metrics/sentiment-shift.ts";
import { sessionClose } from "../src/features/youtube-intelligence/trading-day.ts";

const mention = (
  id: string,
  channelId: string,
  sentiment: string,
  publishedAt: string,
  ticker = "NVDA",
) => ({
  id,
  runId: id,
  videoId: id,
  channelId,
  ticker,
  stance: sentiment === "bullish" ? "long" : sentiment === "bearish" ? "short" : "hold",
  sentiment,
  isCall: true,
  claimId: null,
  trustLevel: "L2" as const,
  spanId: "s",
  publishedAt,
});
const iso = (ms: number) => new Date(ms).toISOString();

test("24h comes first among the periods; a saved day count seeds the rest", () => {
  assert.deepEqual([...SENTIMENT_PERIODS], ["24h", "7d", "14d", "30d"]);
  assert.equal(periodFromDays(14), "14d");
  assert.equal(periodFromDays(30), "30d");
  assert.equal(periodFromDays(3), "7d");
  assert.equal(periodFromDays(undefined), "7d");
});

test("the session close is 16:00 New York time, across the DST change", () => {
  assert.equal(sessionClose("2026-09-25").toISOString(), "2026-09-25T20:00:00.000Z");
  assert.equal(sessionClose("2026-11-02").toISOString(), "2026-11-02T21:00:00.000Z");
  assert.throws(() => sessionClose("2026-02-30"));
});

test("24h on a Monday means since Friday's close, against Thursday close to Friday close", () => {
  const w = sessionWindows("2026-09-28T15:00:00Z");
  assert.equal(iso(w.current.start), "2026-09-25T20:00:00.000Z");
  assert.equal(iso(w.current.end), "2026-09-28T15:00:00.000Z");
  assert.equal(iso(w.previous.start), "2026-09-24T20:00:00.000Z");
  assert.equal(iso(w.previous.end), "2026-09-25T20:00:00.000Z");
  assert.equal(w.label, "since Fri 25 Sep close");
  assert.equal(w.priorLabel, "the Fri 25 Sep session");
});

test("after the close the window starts at today's close; a holiday is skipped", () => {
  // Monday 17:00 New York belongs to Tuesday's session: since Monday's close.
  const late = sessionWindows("2026-09-28T21:00:00Z");
  assert.equal(iso(late.current.start), "2026-09-28T20:00:00.000Z");
  assert.equal(late.label, "since Mon 28 Sep close");
  // Tuesday after Labor Day (Mon 7 Sep 2026): since Friday 4 Sep's close.
  const holiday = sessionWindows("2026-09-08T15:00:00Z");
  assert.equal(holiday.label, "since Fri 4 Sep close");
  assert.equal(iso(holiday.previous.start), "2026-09-03T20:00:00.000Z");
  // The first session after DST ends closes an hour later in UTC.
  const dst = sessionWindows("2026-11-03T15:00:00Z");
  assert.equal(iso(dst.current.start), "2026-11-02T21:00:00.000Z");
  assert.equal(iso(dst.previous.start), "2026-10-30T20:00:00.000Z");
});

test("24h rows count the session window, with creators and the change against the prior session", () => {
  const rows = [
    mention("a", "ch-a", "bullish", "2026-09-26T12:00:00Z"), // Saturday: current
    mention("b", "ch-b", "bullish", "2026-09-28T13:00:00Z"), // Monday pre-market: current
    mention("h", "ch-h", "neutral", "2026-09-28T14:00:00Z"), // current
    mention("c", "ch-c", "bearish", "2026-09-25T15:00:00Z"), // Friday session: prior
    mention("d", "ch-d", "bullish", "2026-09-25T20:00:00Z"), // exactly Friday's close: prior
    mention("e", "ch-e", "bullish", "2026-09-24T20:00:00Z"), // exactly Thursday's close: outside
    mention("f", "ch-f", "bullish", "2026-09-28T16:00:00Z"), // after asOf: outside
    mention("g", "ch-g", "bearish", "2026-09-27T09:00:00Z", "AMD"), // new ticker
    { ...mention("l0", "ch-z", "bullish", "2026-09-28T14:00:00Z"), trustLevel: "L0" as const },
  ];
  const { windows, rows: out } = sentimentForPeriod(rows, {
    period: "24h",
    asOf: "2026-09-28T15:00:00Z",
  });
  assert.equal(windows.label, "since Fri 25 Sep close");
  assert.deepEqual(out.map((r) => r.ticker), ["NVDA", "AMD"]);
  const nvda = out[0];
  assert.equal(nvda.current.bullish.mentions, 2);
  assert.equal(nvda.current.neutral.mentions, 1);
  assert.equal(nvda.previous.bearish.mentions, 1);
  assert.equal(nvda.previous.bullish.mentions, 1);
  assert.equal(nvda.creators, 3);
  assert.equal(nvda.change, "+1 creator");
  assert.deepEqual(nvda.mentionIds.sort(), ["a", "b", "c", "d", "h"]);
  assert.equal(out[1].change, "new");
  assert.equal(out[1].creators, 1);
});

test("the change reads new, +N creators, −N creators or no change", () => {
  const counts = (bullish: number, bearish: number) => ({
    bullish: { mentions: bullish, creators: bullish },
    neutral: { mentions: 0, creators: 0 },
    bearish: { mentions: bearish, creators: bearish },
  });
  assert.equal(creatorChange({ current: counts(2, 0), previous: counts(0, 0) }), "new");
  assert.equal(creatorChange({ current: counts(4, 2), previous: counts(1, 1) }), "+4 creators");
  assert.equal(creatorChange({ current: counts(1, 0), previous: counts(1, 1) }), "−1 creator");
  assert.equal(creatorChange({ current: counts(0, 0), previous: counts(2, 0) }), "−2 creators");
  assert.equal(creatorChange({ current: counts(1, 1), previous: counts(2, 0) }), "no change");
});

test("day periods keep their rolling windows and match the existing sentiment shift", () => {
  const rows = [
    mention("1", "a", "bullish", "2026-09-18T00:00:00Z"),
    mention("2", "a", "bullish", "2026-09-17T00:00:00Z"),
    mention("3", "b", "bearish", "2026-09-09T00:00:00Z"),
    mention("4", "c", "bearish", "2026-09-18T00:00:00Z", "AMD"),
  ];
  const asOf = "2026-09-19T00:00:00Z";
  const w = periodWindows("7d", asOf);
  assert.equal(w.label, "last 7 days");
  assert.equal(iso(w.current.start), "2026-09-12T00:00:00.000Z");
  assert.equal(iso(w.previous.start), "2026-09-05T00:00:00.000Z");
  const { rows: out } = sentimentForPeriod(rows, { period: "7d", asOf, minimumTrust: "L1" });
  const old = sentimentShift(rows, { asOf, periodDays: 7, minimumTrust: "L1" });
  for (const r of out) {
    const same = old.find((o) => o.ticker === r.ticker)!;
    assert.deepEqual(r.current, same.current);
    assert.deepEqual(r.previous, same.previous);
    assert.equal(r.direction, same.direction);
  }
  assert.equal(out.length, old.length);
  assert.throws(() => periodWindows("7d", "not a date"));
});

test("the empty state names the window", () => {
  assert.equal(
    emptyTitle(periodWindows("24h", "2026-09-28T15:00:00Z")),
    "No mentions since Fri 25 Sep close",
  );
  assert.equal(
    emptyTitle(periodWindows("30d", "2026-09-28T15:00:00Z")),
    "No mentions in the last 30 days",
  );
  const { rows } = sentimentForPeriod([], { period: "24h", asOf: "2026-09-28T15:00:00Z" });
  assert.deepEqual(rows, []);
});
