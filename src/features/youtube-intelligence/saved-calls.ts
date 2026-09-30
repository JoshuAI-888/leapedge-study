/**
 * Saved calls (F75): tabs, session grouping, the expiring-soonest sort, the
 * expiry badge and the price move since the call. Pure functions, shared by
 * the Saved page and the `research/savedSince` read, so node:test covers both.
 */
import { expiryStatus } from "./level-parse.ts";
import { sessionFor, sessionLabel } from "./trading-day.ts";

export const SAVED_TABS = ["open", "done", "dismissed", "all"] as const;
export type SavedTab = (typeof SAVED_TABS)[number];
/** The stored status values stay open/done/dismissed; the tabs rename them. */
export const SAVED_TAB_LABELS: Record<SavedTab, string> = {
  open: "Open",
  done: "Reviewed",
  dismissed: "Removed",
  all: "All",
};
export type SavedIdeaLike = {
  id: string;
  status?: unknown;
  savedAt?: unknown;
  publishedAt?: unknown;
};

export function inTab(idea: SavedIdeaLike, tab: SavedTab) {
  return tab === "all" || idea.status === tab;
}
export function tabCounts(ideas: SavedIdeaLike[]): Record<SavedTab, number> {
  const counts = { open: 0, done: 0, dismissed: 0, all: ideas.length };
  for (const i of ideas)
    if (i.status === "open" || i.status === "done" || i.status === "dismissed")
      counts[i.status] += 1;
  return counts;
}

export type DateBasis = "published" | "saved";
function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
/**
 * When the call was made: the video's publish time (stored on the idea since
 * F75, or read from the claim row), else the time it was saved.
 */
export function callDate(
  idea: SavedIdeaLike,
  claimPublishedAt?: string | null,
): { at: string | null; basis: DateBasis } {
  const published = text(idea.publishedAt) ?? text(claimPublishedAt);
  if (published) return { at: published, basis: "published" };
  return { at: text(idea.savedAt), basis: "saved" };
}
function sessionOf(at: string | null) {
  if (!at) return null;
  try {
    return sessionFor(at).session;
  } catch {
    return null;
  }
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type SessionGroup<T> = {
  /** YYYY-MM-DD, or null for calls without a readable date. */
  session: string | null;
  /** "Mon 28 Sep · US session · 3 calls". */
  heading: string;
  /** The hover: which date each call in the group was placed by. */
  basis: string;
  items: T[];
};
/** Group by the trading session of the call, newest session and call first. */
export function groupBySession<
  T extends { at: string | null; basis: DateBasis },
>(items: T[]): SessionGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const key = sessionOf(item.at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const time = (item: T) => {
    const t = item.at ? Date.parse(item.at) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === null ? 1 : b === null ? -1 : b.localeCompare(a),
    )
    .map(([session, list]) => {
      const sorted = [...list].sort((a, b) => time(b) - time(a));
      const published = sorted.filter((i) => i.basis === "published").length;
      const saved = sorted.length - published;
      const basis =
        published && saved
          ? `Grouped by trading session: ${published} by the video's publish date, ${saved} by the date you saved it (no publish date recorded).`
          : published
            ? "Grouped by the trading session of the video's publish date."
            : "Grouped by the trading session of the date you saved it (no publish date recorded).";
      return {
        session,
        heading: `${session ? sessionLabel(session) : "Date unknown"} · ${plural(sorted.length, "call")}`,
        basis,
        items: sorted,
      };
    });
}

/**
 * Nearest open expiry first (today counts as open), then expired calls from
 * the most recently expired, then calls with no readable expiry date. The
 * sort is stable, so ties keep the order they arrived in.
 */
export function expiringSoonest<T extends { expiryDate?: string | null }>(
  items: T[],
  today: string,
): T[] {
  const rank = (item: T) => {
    const s = expiryStatus(item.expiryDate, today);
    if (!s) return [2, 0];
    return s.days >= 0 ? [0, s.days] : [1, -s.days];
  };
  return items
    .map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map((x) => x.item);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Oct", fixed English month names so the server and browser agree. */
function shortDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "Expires in 4 days", "Expires today", "Expired 2 Oct"; null without a date. */
export function expiryBadgeText(
  date: string | null | undefined,
  today: string,
): { text: string; state: "open" | "soon" | "expired" } | null {
  const s = expiryStatus(date, today);
  if (!s || !date) return null;
  if (s.state === "expired")
    return { text: `Expired ${shortDate(date)}`, state: "expired" };
  return {
    text:
      s.days === 0 ? "Expires today" : `Expires in ${plural(s.days, "day")}`,
    state: s.state,
  };
}

export type PricePoint = { date: string; adjustedClose: number };
export type SinceSaved =
  | {
      state: "priced";
      baseDate: string;
      baseClose: number;
      latestDate: string;
      latestClose: number;
      /** Fractional change, 0.055 for +5.5%. */
      change: number;
    }
  | { state: "no-later"; baseDate: string }
  | { state: "no-price" };
/**
 * The move from the call's session close to the latest stored close. When the
 * session itself has no bar (a data gap, or it has not closed yet) the next
 * stored close is the base; nothing is interpolated or fetched.
 */
export function sinceSaved(series: PricePoint[], session: string): SinceSaved {
  const bars = series
    .filter((p) => Number.isFinite(p.adjustedClose) && p.adjustedClose > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!bars.length) return { state: "no-price" };
  const base = bars.find((p) => p.date >= session);
  // The series exists but stops before the call's session: its close has not landed yet.
  if (!base) return { state: "no-later", baseDate: session };
  const latest = bars.at(-1)!;
  if (latest.date === base.date)
    return { state: "no-later", baseDate: base.date };
  return {
    state: "priced",
    baseDate: base.date,
    baseClose: base.adjustedClose,
    latestDate: latest.date,
    latestClose: latest.adjustedClose,
    change: latest.adjustedClose / base.adjustedClose - 1,
  };
}
/** The hover for "since saved": both closes and their dates. */
export function sinceSavedDetail(s: SinceSaved, ticker: string) {
  if (s.state === "priced")
    return `${ticker} closed ${s.baseClose.toFixed(2)} on ${shortDate(s.baseDate)} and ${s.latestClose.toFixed(2)} on ${shortDate(s.latestDate)} (latest stored close). Adjusted closes; not a trading result.`;
  if (s.state === "no-later")
    return `${ticker} has no stored close after ${shortDate(s.baseDate)} yet.`;
  return `No stored ${ticker} closes from the call's session onwards.`;
}
/** "+5.5% since 25 Sep close" — ink text with a sign, never a colour. */
export function sinceSavedText(s: SinceSaved) {
  if (s.state === "no-price") return "No price";
  if (s.state === "no-later")
    return `No close since ${shortDate(s.baseDate)} yet`;
  const pct = (Math.abs(s.change) * 100).toFixed(1);
  const sign = s.change > 0 ? "+" : s.change < 0 ? "−" : "±";
  return `${sign}${pct}% since ${shortDate(s.baseDate)} close`;
}
