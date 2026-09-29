/**
 * Pure logic behind the Search page (F62): the URL state, its mapping onto the
 * query API (F56), the active-filter chips, the "remove this filter" suggestion
 * for an empty result, and the trading-session date window (F58). Kept free of
 * React so tests/search-page.test.ts covers it directly.
 *
 * Every filter lives in the URL (decision D4). Scalars go through the shared
 * url-state-core parser; tickers, themes and channels are lists, written as
 * repeated keys (`ticker=NVDA&ticker=AVGO`), which the single-valued
 * `useUrlState` hook cannot carry.
 */
import { z } from "zod";
import { parseUrlState, serialiseUrlState } from "./url-state-core.ts";
import { INSTRUMENT_KINDS } from "../instrument-kind.ts";
import {
  previousSession,
  sessionBounds,
  sessionFor,
  type Instant,
} from "../trading-day.ts";
import { SENTIMENT_GLYPH, trustOptionLabel } from "./foundations.ts";
import type { SentimentData } from "../contracts.ts";

export const SEARCH_WINDOWS = ["1d", "7d", "30d", "90d", "all"] as const;
export type SearchWindow = (typeof SEARCH_WINDOWS)[number];
const WINDOW_SESSIONS: Record<Exclude<SearchWindow, "all">, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
export const WINDOW_LABELS: Record<SearchWindow, string> = {
  "1d": "1d",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  all: "All",
};
/** F59's Type filter ids (Stocks & ETFs is "equity"). */
export type SearchKind = (typeof INSTRUMENT_KINDS)[number]["id"];
/** The query API's instrument kinds. */
export type QueryKind = "stock" | "crypto" | "macro" | "sector" | "unresolved";
const TO_QUERY_KIND: Record<SearchKind, QueryKind> = {
  equity: "stock",
  crypto: "crypto",
  macro: "macro",
  sector: "sector",
};
/** The Type filter's id for a query kind; null for unresolved names. */
export function searchKind(kind: string): SearchKind | null {
  const found = (Object.keys(TO_QUERY_KIND) as SearchKind[]).find(
    (k) => TO_QUERY_KIND[k] === kind,
  );
  return found ?? null;
}
export const STANCE_OPTIONS = [
  "long",
  "short",
  "neutral",
  "avoid",
  "watch",
  "hold",
  "conditional",
] as const;
export const CONVICTION_OPTIONS = ["high", "medium", "low", "unspecified"] as const;
export const TRUST_OPTIONS = ["L0", "L1", "L2", "L3"] as const;
export const SENTIMENT_OPTIONS = ["bullish", "neutral", "bearish"] as const;
export const EXPIRY_WINDOWS = ["7d", "30d", "90d"] as const;
export type ExpiryWindow = (typeof EXPIRY_WINDOWS)[number];
const EXPIRY_DAYS: Record<ExpiryWindow, 7 | 30 | 90> = { "7d": 7, "30d": 30, "90d": 90 };
export const SORT_OPTIONS = ["newest", "conviction", "trust", "ideas"] as const;
export type SearchSort = (typeof SORT_OPTIONS)[number];

export type SearchState = {
  q: string;
  /** Tickers and crypto symbols (`ticker=`). */
  tickers: string[];
  /** Macro themes, sectors and other named instruments (`instrument=`). */
  instruments: string[];
  kind: SearchKind | "";
  sentiment: SentimentData | "";
  stance: (typeof STANCE_OPTIONS)[number] | "";
  conviction: (typeof CONVICTION_OPTIONS)[number] | "";
  trust: (typeof TRUST_OPTIONS)[number];
  channels: string[];
  window: SearchWindow;
  pinned: boolean;
  /** Only calls that state a price level (F60). */
  levels: boolean;
  /** Only calls whose stated expiry falls within this many days (F60). */
  expires: ExpiryWindow | "";
  tab: "calls" | "videos";
  sort: SearchSort;
};
export const SEARCH_DEFAULTS: SearchState = {
  q: "",
  tickers: [],
  instruments: [],
  kind: "",
  sentiment: "",
  stance: "",
  conviction: "",
  trust: "L1",
  channels: [],
  window: "all",
  pinned: false,
  levels: false,
  expires: "",
  tab: "calls",
  sort: "newest",
};
const kindIds = INSTRUMENT_KINDS.map((k) => k.id) as [SearchKind, ...SearchKind[]];
const Scalars = z.object({
  q: z.string().max(200),
  kind: z.enum(kindIds),
  sentiment: z.enum(SENTIMENT_OPTIONS),
  stance: z.enum(STANCE_OPTIONS),
  conviction: z.enum(CONVICTION_OPTIONS),
  trust: z.enum(TRUST_OPTIONS),
  window: z.enum(SEARCH_WINDOWS),
  pinned: z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true"),
  levels: z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true"),
  expires: z.enum(EXPIRY_WINDOWS),
  tab: z.enum(["calls", "videos"]),
  sort: z.enum(SORT_OPTIONS),
});
type ScalarKey = keyof z.output<typeof Scalars>;
const LISTS = { tickers: "ticker", instruments: "instrument", channels: "channel" } as const;
const MAX_LIST = 50;
type Readable = { get(key: string): string | null; getAll(key: string): string[] };

/** Trimmed, non-empty, first spelling of each value kept (case-insensitive). */
function list(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().slice(0, 100);
    if (!value || seen.has(value.toUpperCase())) continue;
    seen.add(value.toUpperCase());
    out.push(value);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}
function scalarDefaults(state: SearchState) {
  const { tickers: _t, instruments: _i, channels: _c, ...rest } = state;
  return rest as Pick<SearchState, ScalarKey>;
}
export function parseSearchState(params: Readable): SearchState {
  const scalars = parseUrlState(
    Scalars,
    scalarDefaults(SEARCH_DEFAULTS) as unknown as z.output<typeof Scalars>,
    params,
  ) as unknown as Pick<SearchState, ScalarKey>;
  return {
    ...SEARCH_DEFAULTS,
    ...scalars,
    tickers: list(params.getAll(LISTS.tickers)),
    instruments: list(params.getAll(LISTS.instruments)),
    channels: list(params.getAll(LISTS.channels)),
  };
}
/** The query string (no leading "?"), keeping keys other components own. */
export function serialiseSearchState(state: SearchState, current = "") {
  const next = new URLSearchParams(
    serialiseUrlState(
      scalarDefaults(state),
      scalarDefaults(SEARCH_DEFAULTS),
      current,
    ),
  );
  for (const [field, key] of Object.entries(LISTS)) {
    next.delete(key);
    for (const value of state[field as keyof typeof LISTS]) next.append(key, value);
  }
  return next.toString();
}

/**
 * The date window as instants. A window of N sessions ends with the session
 * `now` belongs to and opens at the close of the session before its first, so
 * weekend and after-close uploads count where the trading-day label puts them.
 */
export function windowBounds(window: SearchWindow, now: Instant): { from?: string } {
  if (window === "all") return {};
  let first = sessionFor(now).session;
  for (let i = 1; i < WINDOW_SESSIONS[window]; i++) first = previousSession(first);
  return { from: sessionBounds(first).from };
}

type Page = { limit: number; offset: number };
/** The UTC calendar date of an instant, YYYY-MM-DD. */
function utcDate(now: Instant) {
  return new Date(now).toISOString().slice(0, 10);
}
/** "Tue 20 Oct 2026" for a YYYY-MM-DD date; the input unchanged when unreadable. */
export function calendarDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
function filters(state: SearchState, now: Instant) {
  const input: Record<string, unknown> = {};
  const text = state.q.trim();
  if (text) input.text = text;
  const instruments = [...state.tickers, ...state.instruments];
  if (instruments.length) input.instruments = instruments;
  if (state.kind) input.kinds = [TO_QUERY_KIND[state.kind]];
  if (state.sentiment) input.sentiments = [state.sentiment];
  if (state.stance) input.stances = [state.stance];
  if (state.conviction) input.convictions = [state.conviction];
  if (state.trust !== "L0") input.minTrust = state.trust;
  if (state.channels.length) input.channels = state.channels;
  Object.assign(input, windowBounds(state.window, now));
  if (state.pinned) input.pinnedOnly = true;
  if (state.levels) input.hasLevels = true;
  if (state.expires) {
    input.expiresWithin = EXPIRY_DAYS[state.expires];
    input.today = utcDate(now);
  }
  return input;
}
export function callsQueryInput(state: SearchState, now: Instant, page: Page) {
  const sort = state.sort === "conviction" || state.sort === "trust" ? state.sort : "newest";
  return { ...filters(state, now), sort, ...page } as Record<string, unknown> & {
    sort: "newest" | "conviction" | "trust";
  };
}
export function videosQueryInput(state: SearchState, now: Instant, page: Page) {
  const sort = state.sort === "ideas" ? "ideas" : "newest";
  return { ...filters(state, now), sort, ...page } as Record<string, unknown> & {
    sort: "newest" | "ideas";
  };
}

/** Add or remove an instrument: tickers go in `ticker=`, themes in `instrument=`. */
export function toggleInstrument(
  state: SearchState,
  key: string,
  kind: string,
): SearchState {
  const field = kind === "stock" || kind === "crypto" || kind === "equity" ? "tickers" : "instruments";
  const upper = key.toUpperCase();
  const without = (values: string[]) => values.filter((v) => v.toUpperCase() !== upper);
  const present = [...state.tickers, ...state.instruments].some((v) => v.toUpperCase() === upper);
  if (present)
    return { ...state, tickers: without(state.tickers), instruments: without(state.instruments) };
  return { ...state, [field]: [...state[field], key] };
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------
export type Chip = { id: string; label: string; remove: Partial<SearchState> };
export type ChipLabels = {
  channels?: Map<string, string | null>;
  instruments?: Map<string, string | null>;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function windowLabel(window: SearchWindow) {
  if (window === "all") return "All dates";
  const n = WINDOW_SESSIONS[window];
  return n === 1 ? "Latest session" : `Last ${n} sessions`;
}
export function kindLabel(kind: string) {
  return INSTRUMENT_KINDS.find((k) => k.id === kind)?.label ?? cap(kind);
}
/** The active filters, in reading order, each with the patch that removes it. */
export function activeChips(state: SearchState, labels: ChipLabels = {}): Chip[] {
  const chips: Chip[] = [];
  if (state.q.trim()) chips.push({ id: "q", label: `“${state.q.trim()}”`, remove: { q: "" } });
  for (const t of state.tickers)
    chips.push({
      id: `ticker:${t}`,
      label: labels.instruments?.get(t) ?? t,
      remove: { tickers: state.tickers.filter((x) => x !== t) },
    });
  for (const i of state.instruments)
    chips.push({
      id: `instrument:${i}`,
      label: labels.instruments?.get(i) ?? i,
      remove: { instruments: state.instruments.filter((x) => x !== i) },
    });
  if (state.kind) chips.push({ id: "kind", label: `Type: ${kindLabel(state.kind)}`, remove: { kind: "" } });
  if (state.sentiment)
    chips.push({
      id: "sentiment",
      label: `${SENTIMENT_GLYPH[state.sentiment]} ${cap(state.sentiment)}`,
      remove: { sentiment: "" },
    });
  if (state.stance) chips.push({ id: "stance", label: `Stance: ${state.stance}`, remove: { stance: "" } });
  if (state.conviction)
    chips.push({ id: "conviction", label: `Conviction: ${state.conviction}`, remove: { conviction: "" } });
  for (const c of state.channels)
    chips.push({
      id: `channel:${c}`,
      label: labels.channels?.get(c) ?? c,
      remove: { channels: state.channels.filter((x) => x !== c) },
    });
  if (state.window !== "all")
    chips.push({ id: "window", label: windowLabel(state.window), remove: { window: "all" } });
  if (state.trust !== "L0")
    chips.push({ id: "trust", label: `Trust ≥ ${trustOptionLabel(state.trust)}`, remove: { trust: "L0" } });
  if (state.levels) chips.push({ id: "levels", label: "Has levels", remove: { levels: false } });
  if (state.expires)
    chips.push({ id: "expires", label: `Expires within ${EXPIRY_DAYS[state.expires]} days`, remove: { expires: "" } });
  if (state.pinned) chips.push({ id: "pinned", label: "Pinned only", remove: { pinned: false } });
  return chips;
}
/** Every filter off, including trust, so the whole archive shows; the tab and sort stay. */
export function clearAllFilters(state: SearchState): SearchState {
  return { ...SEARCH_DEFAULTS, trust: "L0", tab: state.tab, sort: state.sort };
}

// ---------------------------------------------------------------------------
// Facets and the empty-state suggestion
// ---------------------------------------------------------------------------
export type FacetValue = {
  value: string;
  count: number;
  label?: string | null;
  /** Instrument facet: the query kind, which decides `ticker=` or `instrument=`. */
  kind?: string;
};
export type SearchFacets = Record<
  | "instrument"
  | "kind"
  | "channel"
  | "stance"
  | "sentiment"
  | "conviction"
  | "trust"
  | "levels"
  | "expiry",
  FacetValue[]
>;
/**
 * Facets whose counts ignore their own filter and cover every call, so the
 * sum is exactly the total with that filter removed.
 */
const CLOSED_FACETS: Record<string, keyof SearchFacets> = {
  kind: "kind",
  sentiment: "sentiment",
  stance: "stance",
  conviction: "conviction",
  trust: "trust",
};
const sum = (values: FacetValue[]) => values.reduce((n, v) => n + v.count, 0);
/**
 * The single chip whose removal returns the most rows. Closed facets answer
 * from their counts; any other chip needs one count query, and its id is in
 * `needs` until `extra` carries that count. `best` is null when no removal
 * would return anything.
 */
export function suggestRemoval(
  chips: Chip[],
  facets: SearchFacets,
  extra: Record<string, number>,
) {
  const needs: string[] = [];
  let best: { chip: Chip; count: number } | null = null;
  for (const chip of chips) {
    const facet = CLOSED_FACETS[chip.id];
    const count = facet ? sum(facets[facet]) : extra[chip.id];
    if (count === undefined) {
      needs.push(chip.id);
      continue;
    }
    if (count > 0 && (!best || count > best.count)) best = { chip, count };
  }
  return { best, needs };
}
/** "Remove “Last 7 sessions” to see 12 calls"; a quoted text chip is not quoted twice. */
export function removalText(best: { chip: Chip; count: number }) {
  const label = best.chip.label.startsWith("“") ? best.chip.label : `“${best.chip.label}”`;
  return `Remove ${label} to see ${best.count.toLocaleString("en-US")} ${best.count === 1 ? "call" : "calls"}`;
}
/** Calls below the minimum trust level, from the trust facet (which ignores that filter). */
export function hiddenByTrust(trust: FacetValue[], minimum: string) {
  return trust.filter((t) => t.value < minimum).reduce((n, t) => n + t.count, 0);
}
/**
 * The values a facet list shows: the top `limit` plus anything selected, or
 * every value matching `filter` when expanded. Zero counts stay listed.
 */
export function facetView(
  values: FacetValue[],
  selected: string[],
  o: { limit: number; expanded?: boolean; filter?: string },
) {
  const needle = o.filter?.trim().toLowerCase() ?? "";
  const candidates = needle
    ? values.filter(
        (v) =>
          v.value.toLowerCase().includes(needle) ||
          (v.label ?? "").toLowerCase().includes(needle),
      )
    : values;
  if (o.expanded) return { shown: candidates, more: 0 };
  const picked = new Set(selected.map((s) => s.toUpperCase()));
  const shown = candidates.filter(
    (v, i) => i < o.limit || picked.has(v.value.toUpperCase()),
  );
  return { shown, more: candidates.length - shown.length };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
/** Split text into matched and unmatched runs, case-insensitively. */
export function highlightParts(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  // Lower-casing can change length for a few scripts; then no highlight rather than a wrong one.
  if (haystack.length !== text.length) return [{ text, match: false }];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), match: false });
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    at = i + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
/** "4 ideas · 3 ▲ 1 ●": zero sentiments are left out, the order is fixed. */
export function verdictLine(video: {
  ideas: number;
  sentiment: Record<SentimentData, number>;
}) {
  if (!video.ideas) return "No ideas";
  const counts = SENTIMENT_OPTIONS.filter((s) => video.sentiment[s] > 0)
    .map((s) => `${video.sentiment[s]} ${SENTIMENT_GLYPH[s]}`)
    .join(" ");
  return `${video.ideas} ${video.ideas === 1 ? "idea" : "ideas"}${counts ? ` · ${counts}` : ""}`;
}
