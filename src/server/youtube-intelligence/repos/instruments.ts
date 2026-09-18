import { database, iso } from "../database.ts";
/**
 * The only door to the `instruments` table. Resolution results are facts about
 * a symbol, so a repeated lookup refreshes the row it already has.
 */
export type InstrumentRow = {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  market: string | null;
  verifiedAt: string | null;
};
const COLUMNS = "symbol,name,currency,exchange,market,verified_at";
function convert(r: Record<string, unknown>): InstrumentRow {
  return {
    symbol: String(r.symbol),
    name: r.name === null ? null : String(r.name),
    currency: r.currency === null ? null : String(r.currency),
    exchange: r.exchange === null ? null : String(r.exchange),
    market: r.market === null ? null : String(r.market),
    verifiedAt: iso(r.verified_at),
  };
}
export async function upsertInstrument(instrument: InstrumentRow) {
  const result = await database
    .prepare(
      `INSERT INTO instruments(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(symbol) DO UPDATE SET
         name=excluded.name,
         currency=excluded.currency,
         exchange=excluded.exchange,
         market=COALESCE(excluded.market,instruments.market),
         verified_at=excluded.verified_at`,
    )
    .run(
      instrument.symbol,
      instrument.name,
      instrument.currency,
      instrument.exchange,
      instrument.market,
      instrument.verifiedAt,
    );
  return result.changes > 0;
}
export async function getInstrument(
  symbol: string,
): Promise<InstrumentRow | null> {
  const r = (await database
    .prepare(`SELECT ${COLUMNS} FROM instruments WHERE symbol=$1`)
    .get(symbol)) as Record<string, unknown> | undefined;
  return r ? convert(r) : null;
}
export async function listInstruments(): Promise<InstrumentRow[]> {
  return (
    (await database
      .prepare(`SELECT ${COLUMNS} FROM instruments ORDER BY symbol`)
      .all()) as Record<string, unknown>[]
  ).map(convert);
}
export async function countInstruments(): Promise<number> {
  const r = (await database
    .prepare("SELECT COUNT(*) AS n FROM instruments")
    .get()) as { n: unknown };
  return Number(r.n);
}
