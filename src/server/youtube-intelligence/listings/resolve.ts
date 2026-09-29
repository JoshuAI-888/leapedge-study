import { type ListingRefData } from "../../../features/youtube-intelligence/listing-ref.ts";
import sec from "./sec-tickers.json" with { type: "json" };
import { US_ALIASES, CURATED, type Market } from "./curated.ts";

/**
 * Which listed instrument a spoken name refers to, decided by lookup, never by
 * a model alone. In order: a ticker the speaker said (or an explicit caption
 * ticker) that is a real listing; a curated alias; a model-proposed ticker whose
 * SEC-registered name matches what was said; an exact SEC company name. Anything
 * else stays unresolved, and the literal words are kept by the caller.
 */
export const LISTINGS_VERSION = `listings.v1:sec-${sec.fetchedAt}`;

type SecRow = [string, string, string | null];
const secRows = sec.data as SecRow[];
const secByTicker = new Map(secRows.map((r) => [r[0], r]));

/** Case, width, punctuation and "&" versus "and" do not distinguish a name. */
export function aliasKey(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
  "plc", "holdings", "holding", "group", "llc", "lp", "the", "nv", "sa", "ag", "se",
  "spa", "technologies", "technology", "platforms",
]);
/** A company name without its legal form, for comparing what was said with a registered name. */
function nameKey(name: string) {
  const tokens = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\/[a-z]{2}\//g, " ")
    .replace(/\b([a-z])\.([a-z])\.(?:([a-z])\.)?/g, "$1$2$3")
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  while (tokens.length > 1 && (SUFFIXES.has(tokens.at(-1)!) || tokens.at(-1)!.length === 1)) tokens.pop();
  return tokens.filter((t, i) => i === 0 || !SUFFIXES.has(t)).join("");
}
const firstWord = (name: string) =>
  name.normalize("NFKC").toLowerCase().replace(/&/g, " and ").split(/[^\p{L}\p{N}]+/u).find(Boolean) ?? "";

function fromSec(row: SecRow, method: ListingRefData["method"]): ListingRefData {
  return {
    symbol: row[0],
    name: row[1],
    market: /\bETF\b/i.test(row[1]) ? "us-etf" : "us-stock",
    exchange: row[2],
    method,
    source: "sec",
  };
}
function fromCurated(c: (typeof CURATED)[number], method: ListingRefData["method"]): ListingRefData {
  return { symbol: c.symbol, name: c.name, market: c.market satisfies Market, exchange: c.exchange, method, source: "curated" };
}

const aliases = new Map<string, () => ListingRefData>();
for (const [ticker, names] of Object.entries(US_ALIASES))
  for (const n of names) aliases.set(aliasKey(n), () => fromSec(secByTicker.get(ticker)!, "alias"));
for (const c of CURATED) for (const n of c.aliases) aliases.set(aliasKey(n), () => fromCurated(c, "alias"));
const curatedBySymbol = new Map(CURATED.filter((c) => c.symbol).map((c) => [c.symbol!, c]));

/** Registered names that identify exactly one ordinary ticker. */
const byName = new Map<string, SecRow | null>();
for (const row of secRows) {
  if (row[0].includes("-")) continue;
  const k = nameKey(row[1]);
  if (k.length < 4) continue;
  const prior = byName.get(k);
  byName.set(k, prior === undefined || prior?.[0] === row[0] ? row : null);
}

/** Words that name a market or index more often than the company of that name. */
const MARKET_WORDS = new Set(["nasdaq", "dow", "nyse", "cboe", "russell", "sandp"]);

export function secListing(ticker: string) {
  return secByTicker.get(ticker) ?? null;
}

function listing(symbol: string, method: ListingRefData["method"]) {
  const s = symbol.replace(/^\$/, "").toUpperCase();
  const curated = curatedBySymbol.get(s);
  if (curated) return fromCurated(curated, method);
  const row = secByTicker.get(s) ?? secByTicker.get(s.replace(".", "-"));
  return row ? fromSec(row, method) : null;
}

export function resolveReference(
  spoken: string | null,
  ticker: string | null,
  options: { explicit?: boolean } = {},
): ListingRefData | null {
  const said = spoken?.trim() ?? "";
  // 1. A ticker the speaker said: the spoken words are an upper-case symbol, or
  //    the claim's ticker was verified as explicit in its evidence.
  if (/^\$?[A-Z][A-Z0-9.-]{0,9}$/.test(said)) {
    const hit = listing(said, "spoken_ticker");
    if (hit) return hit;
  }
  if (/^[A-Z]{2,6}s$/.test(said)) {
    const hit = listing(said.slice(0, -1), "spoken_ticker");
    if (hit) return hit;
  }
  // The ticker appears as its own token inside the words ("长债ETF TLT").
  if (ticker && new RegExp(`(^|[^A-Za-z0-9])\\$?${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`).test(said)) {
    const hit = listing(ticker, "spoken_ticker");
    if (hit) return hit;
  }
  if (ticker && options.explicit) {
    const hit = listing(ticker, "spoken_ticker");
    if (hit) return hit;
  }
  // 2. A curated alias.
  const alias = said ? aliases.get(aliasKey(said)) : undefined;
  if (alias) return alias();
  // 3. A proposed ticker whose registered name begins with the word that was said.
  if (ticker && said) {
    const hit = listing(ticker, "verified_proposal");
    if (hit && hit.symbol && firstWord(hit.name) === firstWord(said) && firstWord(said).length >= 3 && !MARKET_WORDS.has(aliasKey(said)))
      return hit;
  }
  // 4. An exact registered company name, of two words or more: a single word
  //    ("Nasdaq", "Dow", "Target") is too often a market or a common noun.
  if (said && said.split(/\s+/).filter(Boolean).length >= 2) {
    const row = byName.get(nameKey(said));
    if (row) return fromSec(row, "registry_name");
  }
  return null;
}

/** The key two references share when they are the same instrument. */
export function instrumentKey(spoken: string, ref: ListingRefData | null) {
  return ref ? (ref.symbol ?? `private:${aliasKey(ref.name)}`) : `said:${aliasKey(spoken)}`;
}
