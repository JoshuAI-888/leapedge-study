/**
 * The Today watchlist (F68): pinned instruments (the team watchlist, kept by
 * the `research/watch` action) and instruments with calls in the current US
 * session, each next to what its price has done. Pure, so node:test covers
 * it; the server gathers the rows (server/youtube-intelligence/watchlist.ts)
 * and the panel draws them (ui/Watchlist.tsx).
 *
 * Price change is a fact about the price, not an opinion, so it is text with
 * a sign and never green or red: colour in this product means sentiment.
 */
import { sessionFor } from "./trading-day.ts";
import { sentimentOf } from "./ui/foundations.ts";
import type { SentimentSplit } from "./ui/foundations.ts";

/** Sessions drawn in the sparkline. */
export const SPARK_SESSIONS = 20;
/** The divergence rule: a clear majority of calls against a clear move. */
export const DIVERGENCE_SHARE = 0.6;
export const DIVERGENCE_MOVE = 0.05;
export const DIVERGENCE_SESSIONS = 5;
/** Tickers the watch action accepts; anything else cannot be pinned. */
export const PINNABLE = /^[A-Z0-9.^=-]{1,20}$/;

export type PricePoint = { date: string; close: number };
export type WatchCall = {
  ticker: string | null;
  instrument: string | null;
  stance: string;
  publishedAt: string | null;
};
export type Divergence = {
  label: "Creators vs price";
  detail: string;
};
export type WatchRow = {
  /** Ticker, or the spoken instrument when there is none. */
  key: string;
  ticker: string | null;
  instrument: string | null;
  pinned: boolean;
  /** Up to 20 adjusted closes, oldest first. Empty when there is no price. */
  closes: number[];
  /** The session of the newest close ("Closes to <date>"). */
  closeDate: string | null;
  /** Newest close against the one before it, as a fraction. */
  dayChange: number | null;
  /** Newest close against the close five sessions earlier. */
  moveChange: number | null;
  /** Calls in the current session, by sentiment. */
  mentions: SentimentSplit;
  divergence: Divergence | null;
};
export type Watchlist = {
  /** The US session "today" refers to. */
  session: string;
  pinned: WatchRow[];
  mentioned: WatchRow[];
  /** The newest close date across priced rows, for the footnote. */
  closesTo: string | null;
};

/** Relative change from the close `back` sessions before the newest one. */
export function changeOver(closes: number[], back: number): number | null {
  if (!(back > 0) || closes.length <= back) return null;
  const last = closes[closes.length - 1],
    base = closes[closes.length - 1 - back];
  if (!Number.isFinite(last) || !Number.isFinite(base) || base <= 0) return null;
  return last / base - 1;
}
export const dayChange = (closes: number[]) => changeOver(closes, 1);

/** "+1.7%", "−18.5%", "0.0%"; "No price" when unknown. A real minus sign, no colour. */
export function formatChange(change: number | null) {
  if (change === null || !Number.isFinite(change)) return "No price";
  const pct = Math.abs(change * 100).toFixed(1);
  if (pct === "0.0") return "0.0%";
  return `${change > 0 ? "+" : "−"}${pct}%`;
}

/**
 * Creators vs price: at least 60% of today's calls bullish while the price
 * fell more than 5% over five sessions, or at least 60% bearish while it rose
 * more than 5%. Needs both calls and a price; never inferred from one alone.
 */
export function divergence(
  mentions: SentimentSplit,
  move: number | null,
): Divergence | null {
  const total = mentions.bullish + mentions.neutral + mentions.bearish;
  if (!total || move === null) return null;
  const pct = formatChange(move);
  if (mentions.bullish / total >= DIVERGENCE_SHARE && move < -DIVERGENCE_MOVE)
    return {
      label: "Creators vs price",
      detail: `${mentions.bullish} of ${total} calls today are bullish while the price moved ${pct} over ${DIVERGENCE_SESSIONS} sessions.`,
    };
  if (mentions.bearish / total >= DIVERGENCE_SHARE && move > DIVERGENCE_MOVE)
    return {
      label: "Creators vs price",
      detail: `${mentions.bearish} of ${total} calls today are bearish while the price moved ${pct} over ${DIVERGENCE_SESSIONS} sessions.`,
    };
  return null;
}

const keyOf = (c: { ticker: string | null; instrument: string | null }) =>
  c.ticker?.trim().toUpperCase() || c.instrument?.trim() || null;

/** Calls published into the session that `now` belongs to. */
export function sessionCalls<T extends WatchCall>(calls: T[], now: string): T[] {
  const session = sessionFor(now).session;
  const end = Date.parse(now);
  return calls.filter((c) => {
    if (!c.publishedAt) return false;
    const at = Date.parse(c.publishedAt);
    if (!Number.isFinite(at) || at > end) return false;
    return sessionFor(c.publishedAt).session === session;
  });
}

function row(
  key: string,
  ticker: string | null,
  instrument: string | null,
  pinned: boolean,
  calls: WatchCall[],
  prices: PricePoint[] | undefined,
): WatchRow {
  const series = [...(prices ?? [])]
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const closes = series.slice(-SPARK_SESSIONS).map((p) => p.close);
  // The move needs one more close than the sessions it spans.
  const tail = series.slice(-(DIVERGENCE_SESSIONS + 1)).map((p) => p.close);
  const mentions: SentimentSplit = { bullish: 0, neutral: 0, bearish: 0 };
  for (const c of calls) mentions[sentimentOf(c.stance)]++;
  const move = changeOver(tail, DIVERGENCE_SESSIONS);
  return {
    key,
    ticker,
    instrument,
    pinned,
    closes,
    closeDate: series.at(-1)?.date ?? null,
    dayChange: dayChange(closes),
    moveChange: move,
    mentions,
    divergence: divergence(mentions, move),
  };
}

/**
 * Both tabs. Pinned rows follow the watch documents (enabled only), A→Z.
 * Mentioned rows are every instrument with a call in the current session,
 * most calls first. `prices` is keyed by ticker; a row without a ticker, or
 * whose ticker has no stored series, has no price.
 */
export function assembleWatchlist(input: {
  pinned: string[];
  calls: WatchCall[];
  prices: Map<string, PricePoint[]>;
  now: string;
}): Watchlist {
  const today = sessionCalls(input.calls, input.now);
  const pinned = new Set(input.pinned.map((t) => t.trim().toUpperCase()));
  const groups = new Map<string, { ticker: string | null; instrument: string | null; calls: WatchCall[] }>();
  for (const c of today) {
    const key = keyOf(c);
    if (!key) continue;
    const g = groups.get(key) ?? {
      ticker: c.ticker?.trim().toUpperCase() || null,
      instrument: c.instrument,
      calls: [],
    };
    g.calls.push(c);
    groups.set(key, g);
  }
  const pinnedRows = [...pinned]
    .sort()
    .map((t) =>
      row(t, t, groups.get(t)?.instrument ?? t, true, groups.get(t)?.calls ?? [], input.prices.get(t)),
    );
  const mentioned = [...groups.entries()]
    .map(([key, g]) =>
      row(key, g.ticker, g.instrument, g.ticker !== null && pinned.has(g.ticker), g.calls, g.ticker ? input.prices.get(g.ticker) : undefined),
    )
    .sort(
      (a, b) =>
        total(b.mentions) - total(a.mentions) || a.key.localeCompare(b.key),
    );
  const closesTo =
    [...pinnedRows, ...mentioned]
      .map((r) => r.closeDate)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;
  return {
    session: sessionFor(input.now).session,
    pinned: pinnedRows,
    mentioned,
    closesTo,
  };
}
const total = (s: SentimentSplit) => s.bullish + s.neutral + s.bearish;
