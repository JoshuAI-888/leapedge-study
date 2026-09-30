import { z } from "zod";
import { database, iso } from "./database.ts";
import { docs } from "./research-store.ts";
import { CANONICAL } from "./repos/research-query.ts";
import { priceSeries } from "./repos/prices.ts";
import {
  PINNABLE,
  assembleWatchlist,
  type PricePoint,
  type WatchCall,
  type Watchlist,
} from "../../features/youtube-intelligence/watchlist.ts";

/**
 * The Today watchlist read (F68). Pins are the team's `watchlist` documents
 * (written by research/watch); calls are canonical calls published in the last
 * week, narrowed to the current US session by the pure assembly; prices are the
 * stored adjusted closes, never fetched here. No new vendor, no writes.
 */
export const WatchlistInput = z.preprocess(
  (v) => v ?? {},
  z.strictObject({ now: z.iso.datetime({ offset: true }).optional() }),
);
const DAY = 86_400_000;
/** Calendar days of closes to read: 21 sessions with room for a lagging feed. */
const PRICE_LOOKBACK_DAYS = 60;

export async function watchlist(input: unknown = {}): Promise<Watchlist> {
  const { now = new Date().toISOString() } = WatchlistInput.parse(input);
  const end = Date.parse(now);
  const pins = (await docs<{ ticker?: string; enabled?: boolean }>("watchlist"))
    .filter((d) => d.enabled === true && typeof d.ticker === "string")
    .map((d) => d.ticker!.trim().toUpperCase())
    .filter((t) => PINNABLE.test(t));
  // A session is at most four calendar days long (a long weekend plus a
  // holiday); a week back keeps every call the session filter could want.
  const calls = (await database
    .prepare(
      `WITH canon AS MATERIALIZED (${CANONICAL})
       SELECT ticker, instrument, stance, published_at FROM claims
       WHERE run_id IN (SELECT id FROM canon)
         AND published_at > $1::timestamptz AND published_at <= $2::timestamptz
         AND COALESCE(trust_basis->>'latestReviewVerdict','') <> 'rejected'`,
    )
    .all(
      new Date(end - 7 * DAY).toISOString(),
      new Date(end).toISOString(),
    )) as {
    ticker: string | null;
    instrument: string | null;
    stance: string;
    published_at: unknown;
  }[];
  const rows: WatchCall[] = calls.map((c) => ({
    ticker: c.ticker,
    instrument: c.instrument,
    stance: c.stance,
    publishedAt: iso(c.published_at),
  }));
  const tickers = new Set([
    ...pins,
    ...rows
      .map((c) => c.ticker?.trim().toUpperCase())
      .filter((t): t is string => !!t && PINNABLE.test(t)),
  ]);
  const from = new Date(end - PRICE_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
  const to = new Date(end).toISOString().slice(0, 10);
  const prices = new Map<string, PricePoint[]>();
  for (const t of tickers) {
    const series = await priceSeries(t, from, to);
    if (series.length)
      prices.set(
        t,
        series.map((p) => ({ date: p.date, close: p.adjustedClose })),
      );
  }
  return assembleWatchlist({ pinned: pins, calls: rows, prices, now });
}
