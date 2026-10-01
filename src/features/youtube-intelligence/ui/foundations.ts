/**
 * Pure logic behind the shared phase-5 UI parts (F57): the sentiment split
 * bar, the hidden-by-filter notice, headline tiles and sparklines. Kept free of
 * React so node:test can exercise it directly.
 */
import type { SentimentData, StanceData } from "../contracts.ts";
import { STANCE_SENTIMENT, sentimentFromStance } from "../stance-sentiment.ts";
import { trustNames } from "./viewmodel.ts";

/** Display order: bullish first, always (never colour alone). */
export const SENTIMENTS = [
  "bullish",
  "neutral",
  "bearish",
] as const satisfies readonly SentimentData[];

export type SentimentSplit = Record<SentimentData, number>;

export const SENTIMENT_GLYPH: Record<SentimentData, string> = {
  bullish: "▲",
  neutral: "●",
  bearish: "▼",
};

/**
 * The aggregate sentiment of a stance, from the stance table in
 * `sentiment.ts` (spec 4.13). A conditional stance has no direction of its own
 * and grades neutral here; an unknown stance also grades neutral.
 * Re-exported by SplitBar.tsx.
 */
export function sentimentOf(stance: string): SentimentData {
  return stance in STANCE_SENTIMENT
    ? sentimentFromStance(stance as StanceData)
    : "neutral";
}

/** Counts rows by the sentiment their stance grades to. */
export function sentimentCounts(rows: { stance: string }[]): SentimentSplit {
  const counts: SentimentSplit = { bullish: 0, neutral: 0, bearish: 0 };
  for (const row of rows) counts[sentimentOf(row.stance)]++;
  return counts;
}

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Split-bar segments in the fixed bullish, neutral, bearish order. Percentages
 * are whole numbers by largest remainder so they always total exactly 100;
 * empty segments are dropped and a zero total yields no segments at all.
 */
export function splitSegments(counts: SentimentSplit) {
  const values = SENTIMENTS.map((sentiment) => ({
    sentiment,
    count: clean(counts[sentiment]),
  }));
  const total = values.reduce((sum, v) => sum + v.count, 0);
  if (!total) return [];
  const exact = values.map((v) => (v.count * 100) / total);
  const percents = exact.map(Math.floor);
  let missing = 100 - percents.reduce((sum, p) => sum + p, 0);
  const order = exact
    .map((e, i) => ({ i, remainder: e - Math.floor(e) }))
    .filter(({ i }) => values[i].count > 0)
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (missing <= 0) break;
    percents[i]++;
    missing--;
  }
  return values
    .map((v, i) => ({ ...v, percent: percents[i] }))
    .filter((v) => v.count > 0);
}

/** Visible count text, for example "12 ▲ · 3 ● · 1 ▼". */
export function splitCountText(counts: SentimentSplit) {
  return SENTIMENTS.map(
    (s) => `${clean(counts[s])} ${SENTIMENT_GLYPH[s]}`,
  ).join(" · ");
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Hover and accessible text: calls (or another noun, such as mentions) and,
 * when known, creators, per sentiment.
 */
export function splitTitle(
  calls: SentimentSplit,
  creators?: SentimentSplit,
  noun = "call",
) {
  if (!SENTIMENTS.some((s) => clean(calls[s]) > 0))
    return `No ${noun}s in this view`;
  return SENTIMENTS.map((s) => {
    const n = clean(calls[s]);
    const base = `${n} ${s} ${n === 1 ? noun : `${noun}s`}`;
    return creators
      ? `${base} from ${plural(clean(creators[s]), "creator")}`
      : base;
  }).join(" · ");
}

/** Rows a filter removed; never negative. */
export function hiddenByFilter(total: number, visible: number) {
  return Math.max(0, clean(total) - clean(visible));
}

/** "5 calls hidden by the Audio-agreed trust filter"; empty when nothing is hidden. */
export function hiddenByFilterText(
  count: number,
  filter: string,
  noun = "calls",
) {
  const n = clean(count);
  if (!n) return "";
  const singular = noun.endsWith("s") ? noun.slice(0, -1) : noun;
  return `${n} ${n === 1 ? singular : noun} hidden by ${filter}`;
}

/** The user-facing name for a trust level; select values stay L0–L3. */
export function trustOptionLabel(level: string) {
  return trustNames[level] ?? "Extracted";
}

/** Change against the prior period for a headline tile. */
export function statDelta(current: number, prior: number | null) {
  if (prior === null || !Number.isFinite(prior))
    return { direction: "flat" as const, text: "No prior period" };
  const change = current - prior;
  if (change === 0)
    return { direction: "flat" as const, text: "No change vs prior period" };
  return {
    direction: change > 0 ? ("up" as const) : ("down" as const),
    text: `${change > 0 ? "+" : "−"}${Math.abs(change).toLocaleString("en-US")} vs prior period`,
  };
}

/**
 * Sparkline coordinates inside a width × height box with `pad` kept clear top
 * and bottom. Non-finite values are skipped. A single point sits at the right
 * edge (the endpoint); a flat series draws at mid-height.
 */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  pad = 2,
) {
  const series = values.filter((v) => Number.isFinite(v));
  if (!series.length) return [];
  const min = Math.min(...series),
    max = Math.max(...series);
  const y = (v: number) =>
    max === min
      ? height / 2
      : pad + ((max - v) / (max - min)) * (height - 2 * pad);
  if (series.length === 1) return [{ x: width, y: y(series[0]) }];
  return series.map((v, i) => ({
    x: (i / (series.length - 1)) * width,
    y: y(v),
  }));
}

/**
 * Per-day counts for the `days` days ending at `end` (oldest first), for a
 * sparkline. Dates outside the window or unparseable are ignored.
 */
export function dailyCounts(dates: string[], end: string, days: number) {
  const endMs = Date.parse(end.length === 10 ? `${end}T23:59:59.999Z` : end);
  const counts = Array.from({ length: Math.max(0, Math.floor(days)) }, () => 0);
  if (!Number.isFinite(endMs)) return counts;
  for (const date of dates) {
    const at = Date.parse(date);
    if (!Number.isFinite(at) || at > endMs) continue;
    const back = Math.floor((endMs - at) / 86400000);
    if (back < counts.length) counts[counts.length - 1 - back]++;
  }
  return counts;
}
