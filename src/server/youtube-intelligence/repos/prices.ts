import { database, iso } from "../database.ts";

/**
 * The only door to the `prices` table (spec 8).
 *
 * A bar is a fact about a session, so a re-fetch refreshes the row it already
 * has rather than adding a second one: FMP restates adjusted closes after a
 * dividend or a split, and two rows for one session would make the same figure
 * compute two ways. What is kept from the newer fetch is `source` and
 * `fetched_at`, which is what spec 4.11 relies on to say a price-derived figure
 * can be reproduced or shown to have moved.
 *
 * Benchmarks live here too. SPY, QQQ, a sector ETF and a team's custom ticker
 * are all just tickers, which is what lets spec 4.12 choose the benchmark when
 * the page is requested instead of when the row is written.
 */
export type PriceRow = {
  ticker: string;
  /** YYYY-MM-DD, the session the close belongs to. */
  date: string;
  adjustedClose: number;
  /** Where the bar came from, verbatim, e.g. "FMP dividend-adjusted". */
  source: string;
  fetchedAt: string;
};

const COLUMNS = "ticker,date,adjusted_close,source,fetched_at";

function convert(r: Record<string, unknown>): PriceRow {
  return {
    ticker: String(r.ticker),
    // date columns come back as a Date from pg and as a string from PGlite.
    date: String(iso(r.date) ?? r.date).slice(0, 10),
    adjustedClose: Number(r.adjusted_close),
    source: String(r.source),
    fetchedAt: iso(r.fetched_at)!,
  };
}

/** Upsert bars keyed on (ticker, date). Returns how many rows were written. */
export async function savePrices(rows: PriceRow[]): Promise<number> {
  if (!rows.length) return 0;
  let written = 0;
  await database.transaction(async () => {
    for (const row of rows) {
      await database
        .prepare(
          `INSERT INTO price_history(${COLUMNS}) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ticker,date,fetched_at) DO NOTHING`,
        )
        .run(
          row.ticker,
          row.date,
          row.adjustedClose,
          row.source,
          row.fetchedAt,
        );
      await database
        .prepare(
          `INSERT INTO prices(${COLUMNS}) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(ticker,date) DO UPDATE SET
             adjusted_close=excluded.adjusted_close,
             source=excluded.source,
             fetched_at=excluded.fetched_at
           WHERE excluded.fetched_at > prices.fetched_at`,
        )
        .run(
          row.ticker,
          row.date,
          row.adjustedClose,
          row.source,
          row.fetchedAt,
        );
      written += 1;
    }
  });
  return written;
}

/** One ticker's sessions between two dates inclusive, oldest first. */
export async function priceSeries(
  ticker: string,
  from: string,
  to: string,
): Promise<PriceRow[]> {
  const rows = (await database
    .prepare(
      `SELECT ${COLUMNS} FROM prices WHERE ticker=$1 AND date>=$2 AND date<=$3 ORDER BY date`,
    )
    .all(ticker, from, to)) as Record<string, unknown>[];
  return rows.map(convert);
}

/** The tickers that have any stored bar, for the sweep and for coverage reporting. */
export async function pricedTickers(): Promise<string[]> {
  const rows = (await database
    .prepare("SELECT DISTINCT ticker FROM prices ORDER BY ticker")
    .all()) as { ticker: string }[];
  return rows.map((r) => String(r.ticker));
}

/** All retained revisions for query-time benchmark selection and historical cutoffs. */
export async function priceHistory(): Promise<PriceRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM price_history ORDER BY ticker,date,fetched_at`,
      )
      .all()) as Record<string, unknown>[]
  ).map(convert);
}
