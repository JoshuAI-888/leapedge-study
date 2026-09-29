/**
 * Trends (spec 7.6, F65): pure helpers behind the Trends page and its charts.
 * Periods are US trading sessions (`trading-day.ts`), never UTC days, so a
 * Friday-evening upload counts in Monday's column. Kept free of React and the
 * database so node:test covers the bucketing, the deltas, the scale and tick
 * generation, and where each call's dot lands.
 */
import {
  isTradingDay,
  nextSession,
  previousSession,
  sessionWindow,
} from "./trading-day.ts";

export const TREND_RANGES = ["1d", "7d", "30d", "90d", "1y", "all"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];
export const TREND_VIEWS = ["ticker", "channel", "sentiment"] as const;
export type TrendView = (typeof TREND_VIEWS)[number];
export type PeriodUnit = "session" | "week";
export type Counts = { bullish: number; neutral: number; bearish: number };
export type TrendBucket = Counts & {
  /** First session of the period (the Monday of a week, or the session). */
  start: string;
  /** Last calendar day of the period, inclusive. */
  end: string;
  calls: number;
};
/** Fewer calls than this and the page shows the list only. */
export const THIN_CALLS = 5;

const DAY_MS = 86_400_000;
const DAYS: Record<Exclude<TrendRange, "all">, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
/** Daily periods for ranges of seven days or less, weekly otherwise. */
export function periodUnit(range: TrendRange): PeriodUnit {
  return range === "1d" || range === "7d" ? "session" : "week";
}
/**
 * The sessions a range covers, ending at `current` (inclusive). "1d" is the
 * current session; "7d" the sessions in the seven days ending at it. "all"
 * has no lower bound.
 */
export function rangeSessions(range: TrendRange, current: string) {
  if (range === "all") return { from: null, to: current };
  let from = addDays(current, 1 - DAYS[range]);
  if (!isTradingDay(from)) from = nextSession(from);
  if (from > current) from = current;
  return { from, to: current };
}
/** The range of equal calendar length immediately before, for the change line. */
export function priorRange(range: TrendRange, current: string) {
  if (range === "all") return null;
  const { from } = rangeSessions(range, current);
  const to = previousSession(from!);
  return rangeSessions(range, to);
}
/** Instants for the F56 query window: the first session's open to the last session's close. */
export function sessionInstants(from: string | null, to: string) {
  return {
    ...(from ? { from: sessionWindow(from).from } : {}),
    to: sessionWindow(to).to,
  };
}
/**
 * The session a New York wall-clock hour belongs to (the close is on the
 * hour, so an hour never straddles it): before 16:00 on a trading day is that
 * day's session; from 16:00, a weekend or a holiday, the next session.
 */
export function sessionOfMarketHour(date: string, hour: number) {
  if (!isTradingDay(date)) return nextSession(date);
  return hour >= 16 ? nextSession(date) : date;
}
/** Monday of the week a session is in. */
export function weekOf(session: string) {
  const day = new Date(Date.parse(`${session}T00:00:00Z`)).getUTCDay();
  return addDays(session, -((day + 6) % 7));
}
export function periodStart(session: string, unit: PeriodUnit) {
  return unit === "week" ? weekOf(session) : session;
}
function periodEnd(start: string, unit: PeriodUnit) {
  return unit === "week" ? addDays(start, 6) : start;
}
/**
 * Counts per period, with every period between the ends filled with zeros so
 * a gap reads as a gap. Rows are per session (or per ET hour already mapped to
 * a session). `from`/`to` default to the first and last session seen.
 */
export function bucketBySession(
  rows: ({ session: string } & Counts)[],
  unit: PeriodUnit,
  from?: string | null,
  to?: string | null,
  maxPeriods = 600,
): TrendBucket[] {
  const map = new Map<string, TrendBucket>();
  for (const r of rows) {
    const start = periodStart(r.session, unit);
    const b = map.get(start) ?? {
      start,
      end: periodEnd(start, unit),
      calls: 0,
      bullish: 0,
      neutral: 0,
      bearish: 0,
    };
    b.bullish += r.bullish;
    b.neutral += r.neutral;
    b.bearish += r.bearish;
    b.calls += r.bullish + r.neutral + r.bearish;
    map.set(start, b);
  }
  const seen = [...map.keys()].sort();
  const first = from ?? seen[0],
    last = to ?? seen.at(-1);
  if (!first || !last) return [];
  const out: TrendBucket[] = [];
  let start = periodStart(isTradingDay(first) ? first : nextSession(first), unit);
  const stop = periodStart(last, unit);
  while (start <= stop && out.length < maxPeriods) {
    out.push(
      map.get(start) ?? {
        start,
        end: periodEnd(start, unit),
        calls: 0,
        bullish: 0,
        neutral: 0,
        bearish: 0,
      },
    );
    start = unit === "week" ? addDays(start, 7) : nextSession(start);
  }
  // Anything outside the requested window is still counted, never dropped.
  for (const b of map.values()) if (!out.some((o) => o.start === b.start)) out.push(b);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** "+18 vs prior 90d"; null when there is no prior period. */
export function trendDelta(current: number, prior: number | null, range: TrendRange) {
  if (prior === null) return null;
  const d = current - prior;
  const label = range === "1d" ? "prior session" : `prior ${range}`;
  return d === 0
    ? `No change vs ${label}`
    : `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString("en-US")} vs ${label}`;
}
/** The conviction most calls carry, with its share; unspecified is ignored. */
export function typicalConviction(counts: Record<string, number>) {
  const rated = (["high", "medium", "low"] as const).map((k) => [k, counts[k] ?? 0] as const);
  const total = rated.reduce((n, [, v]) => n + v, 0);
  if (!total) return null;
  const [level, n] = [...rated].sort((a, b) => b[1] - a[1])[0];
  return { level, share: n / total };
}

/**
 * Clean tick steps (1, 2, 5 × 10^n) so at most `target` ticks cover `max`.
 * The last tick is the first multiple at or above `max`, so the axis ends on
 * a tick the scale really reaches.
 */
export function niceTicks(max: number, target = 4) {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const whole = Math.max(1, Math.round(step));
  const s = max < 1 ? step : whole;
  const ticks: number[] = [];
  for (let v = 0; v < max + s; v += s) {
    ticks.push(Number(v.toFixed(6)));
    if (v >= max) break;
  }
  return ticks;
}
/**
 * One vertical scale for the diverging columns: bullish up, bearish down, the
 * same count per pixel on both sides. Each side ends on its own nice tick.
 */
export function divergingScale(buckets: Counts[], height: number) {
  const up = Math.max(0, ...buckets.map((b) => b.bullish));
  const down = Math.max(0, ...buckets.map((b) => b.bearish));
  const step = niceTicks(Math.max(up, down, 1))[1] ?? 1;
  const top = Math.ceil(up / step) * step || (down ? 0 : step);
  const bottom = Math.ceil(down / step) * step;
  const span = top + bottom || 1;
  const y = (v: number) => ((top - v) / span) * height;
  const ticks: number[] = [];
  // `+ 0` turns -0 into 0 when nothing is bearish.
  for (let v = -bottom; v <= top; v += step) ticks.push(v + 0);
  return { top, bottom, step, ticks, y, zero: y(0) };
}
/** A linear scale over a price series, padded to nice ticks. */
export function priceScale(values: number[], height: number) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  let lo = Math.min(...finite),
    hi = Math.max(...finite);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const min = Math.floor(lo / step) * step,
    max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 1e6; v += step) ticks.push(Number(v.toFixed(6)));
  return { min, max, ticks, y: (v: number) => ((max - v) / (max - min)) * height };
}
/** Day-resolution time scale shared by every chart on the page. */
export function timeScale(from: string, to: string, width: number) {
  const a = Date.parse(`${from}T00:00:00Z`),
    b = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  return (date: string) => ((Date.parse(`${date}T00:00:00Z`) - a) / (b - a || DAY_MS)) * width;
}
/** Up to `count` x-axis dates that fall inside the domain: month starts, or evenly spaced days. */
export function timeTicks(from: string, to: string, count = 6) {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > 62) {
    const months: string[] = [];
    let d = `${from.slice(0, 7)}-01`;
    if (d < from) d = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 1)).toISOString().slice(0, 10);
    while (d <= to) {
      months.push(d);
      d = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)).toISOString().slice(0, 10);
    }
    const every = Math.ceil(months.length / count);
    return months.filter((_, i) => i % every === 0);
  }
  const every = Math.max(1, Math.ceil(days / count));
  const out: string[] = [];
  for (let i = 0; i < days; i += every) out.push(addDays(from, i));
  return out;
}

export const CONVICTION_RADIUS: Record<string, number> = {
  high: 7,
  medium: 5.5,
  low: 4,
  unspecified: 4,
};
/**
 * Where each call sits on the price line: at its session's close, or the
 * latest close before it when that session has no bar (a call on a session
 * after the last stored bar uses nothing and is counted as unplaced).
 */
export function placeOnPrice<T extends { session: string }>(
  calls: T[],
  prices: { date: string; close: number }[],
) {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const placed: (T & { close: number; priceDate: string })[] = [];
  const unplaced: T[] = [];
  for (const c of calls) {
    let bar: { date: string; close: number } | undefined;
    for (const p of sorted) {
      if (p.date > c.session) break;
      bar = p;
    }
    if (bar && sorted.at(-1)!.date >= c.session) placed.push({ ...c, close: bar.close, priceDate: bar.date });
    else unplaced.push(c);
  }
  return { placed, unplaced };
}
/** The instants a period covers: its first session's window to its last session's close. */
export function periodInstants(b: { start: string; end: string }) {
  const first = isTradingDay(b.start) ? b.start : nextSession(b.start);
  let last = isTradingDay(b.end) ? b.end : previousSession(b.end);
  if (last < first) last = first;
  return { from: sessionWindow(first).from, to: sessionWindow(last).to };
}
/** "chart" at THIN_CALLS or more calls; "thin" below; "empty" at none. */
export function trendsState(total: number) {
  return total === 0 ? "empty" : total < THIN_CALLS ? "thin" : "chart";
}
/** "6 Jul" for a week, "Mon 28 Sep" for a session. */
export function periodLabel(start: string, unit: PeriodUnit) {
  const d = new Date(Date.parse(`${start}T00:00:00Z`));
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  if (unit === "week") return `Week of ${d.getUTCDate()} ${month}`;
  const day = d.toLocaleString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `${day} ${d.getUTCDate()} ${month}`;
}
export function shortDate(date: string) {
  const d = new Date(Date.parse(`${date}T00:00:00Z`));
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}
