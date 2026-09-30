/**
 * Sentiment periods for the Sentiment panel (F57, F69): 24h · 7d · 14d · 30d.
 *
 * "24h" is not a rolling day. It is the US session window (spec 7.6 "Days"):
 * everything published since the previous session's 16:00 ET close, compared
 * with the whole session before it. On a Monday that is "since Friday's
 * close", against Thursday close → Friday close. The day periods keep their
 * rolling windows: the last N days against the N days before.
 *
 * Pure; the panel draws the rows and tests/sentiment-window.test.ts covers it.
 */
import type { MentionRow } from "../../../server/youtube-intelligence/repos/mentions.ts";
import {
  previousSession,
  sessionClose,
  sessionFor,
  sessionLabel,
} from "../trading-day.ts";
import { sentimentShiftWindow, type SentimentCounts } from "./sentiment-shift.ts";

export const SENTIMENT_PERIODS = ["24h", "7d", "14d", "30d"] as const;
export type SentimentPeriod = (typeof SENTIMENT_PERIODS)[number];

/** A half-open window (start, end] of epoch milliseconds. */
export type Window = { start: number; end: number };
export type PeriodWindows = {
  period: SentimentPeriod;
  current: Window;
  previous: Window;
  /** "since Fri 25 Sep close" or "last 7 days", for headings and empty states. */
  label: string;
  /** "the session before" or "the preceding 7 days". */
  priorLabel: string;
};

const DAY = 86_400_000;
const day = (date: string) => sessionLabel(date).replace(" · US session", "");

/** The saved setting is a number of days; anything unknown falls back to 7d. */
export function periodFromDays(days: number | undefined): SentimentPeriod {
  const p = `${days ?? 7}d`;
  return (SENTIMENT_PERIODS as readonly string[]).includes(p)
    ? (p as SentimentPeriod)
    : "7d";
}

/** The session window "24h" names, as of `asOf`. */
export function sessionWindows(asOf: string | number | Date): PeriodWindows {
  const end = new Date(asOf).getTime();
  const session = sessionFor(end).session;
  const since = previousSession(session);
  const before = previousSession(since);
  const sinceClose = sessionClose(since).getTime();
  return {
    period: "24h",
    current: { start: sinceClose, end },
    previous: { start: sessionClose(before).getTime(), end: sinceClose },
    label: `since ${day(since)} close`,
    priorLabel: `the ${day(since)} session`,
  };
}

/** Windows for any period. An `asOf` that is a bare date means its end of day (UTC). */
export function periodWindows(
  period: SentimentPeriod,
  asOf: string,
): PeriodWindows {
  const end = Date.parse(asOf.length === 10 ? `${asOf}T23:59:59.999Z` : asOf);
  if (!Number.isFinite(end)) throw Error("Choose a valid sentiment date and period.");
  if (period === "24h") return sessionWindows(end);
  const days = Number.parseInt(period, 10);
  const span = days * DAY;
  return {
    period,
    current: { start: end - span, end },
    previous: { start: end - 2 * span, end: end - span },
    label: `last ${days} days`,
    priorLabel: `the preceding ${days} days`,
  };
}

const creatorsIn = (c: SentimentCounts) =>
  c.bullish.creators + c.neutral.creators + c.bearish.creators;
const mentionsIn = (c: SentimentCounts) =>
  c.bullish.mentions + c.neutral.mentions + c.bearish.mentions;

/**
 * The change column: "new" for a ticker nobody mentioned in the prior window,
 * otherwise the change in distinct creators ("+4 creators", "−1 creator",
 * "no change"). A real minus sign; never coloured.
 */
export function creatorChange(row: {
  current: SentimentCounts;
  previous: SentimentCounts;
}): string {
  if (mentionsIn(row.previous) === 0 && mentionsIn(row.current) > 0) return "new";
  const d = creatorsIn(row.current) - creatorsIn(row.previous);
  if (d === 0) return "no change";
  const n = Math.abs(d);
  return `${d > 0 ? "+" : "−"}${n} creator${n === 1 ? "" : "s"}`;
}

/**
 * Rows for a period: the sentiment shift between the two windows, busiest
 * first (current creators, then current mentions), then A→Z.
 */
export function sentimentForPeriod(
  mentions: MentionRow[],
  options: {
    period: SentimentPeriod;
    asOf: string;
    minimumTrust?: string;
    callsOnly?: boolean;
  },
) {
  const windows = periodWindows(options.period, options.asOf);
  const rows = sentimentShiftWindow(mentions, {
    current: windows.current,
    previous: windows.previous,
    minimumTrust: options.minimumTrust,
    callsOnly: options.callsOnly,
  })
    .map((row) => ({
      ...row,
      creators: creatorsIn(row.current),
      change: creatorChange(row),
    }))
    .sort(
      (a, b) =>
        b.creators - a.creators ||
        mentionsIn(b.current) - mentionsIn(a.current) ||
        a.ticker.localeCompare(b.ticker),
    );
  return { windows, rows };
}

/** The empty state names the window: "No mentions since Fri 25 Sep close". */
export function emptyTitle(windows: PeriodWindows) {
  return windows.period === "24h"
    ? `No mentions ${windows.label}`
    : `No mentions in the ${windows.label}`;
}
