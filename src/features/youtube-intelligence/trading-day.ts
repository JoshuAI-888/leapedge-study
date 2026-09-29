/**
 * US trading-day sessions (spec 7.6 "Days", F58).
 *
 * Every "day" in the product is a US equity session in America/New_York. A
 * publish instant belongs to the session whose regular close (16:00 ET) it
 * precedes or falls in: before or during Monday's session is Monday, from
 * 16:00:00 ET on Monday it is Tuesday, and a weekend or NYSE full-day holiday
 * rolls forward to the next trading day. Early-close half days are ordinary
 * sessions here; the table below lists full closures only.
 *
 * Pure functions with no dependencies. Time zones are handled by the built-in
 * Intl API, so DST changes in New York and in the viewer's zone need no table.
 * Dates are "YYYY-MM-DD" strings naming a calendar day in New York.
 */

/**
 * NYSE full-day closures, 2025–2027.
 *
 * Source: NYSE "Holidays & Trading Hours" (nyse.com/markets/hours-calendars),
 * as published for 2025, 2026 and 2027, checked 29 September 2026. Observed-date
 * rules: a holiday on a Saturday is observed the Friday before, one on a Sunday
 * the Monday after — except New Year's Day, which NYSE does not observe on the
 * preceding Friday (so 31 December 2027 trades although 1 January 2028 is a
 * Saturday). 9 January 2025 is the one-off closure for the national day of
 * mourning for President Carter. Outside these years every weekday counts as a
 * trading day; extend the table before relying on holiday handling there.
 */
export const NYSE_HOLIDAYS: Readonly<Record<string, string>> = {
  "2025-01-01": "New Year's Day",
  "2025-01-09": "National Day of Mourning",
  "2025-01-20": "Martin Luther King Jr. Day",
  "2025-02-17": "Presidents' Day",
  "2025-04-18": "Good Friday",
  "2025-05-26": "Memorial Day",
  "2025-06-19": "Juneteenth",
  "2025-07-04": "Independence Day",
  "2025-09-01": "Labor Day",
  "2025-11-27": "Thanksgiving Day",
  "2025-12-25": "Christmas Day",
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Presidents' Day",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
  "2027-01-18": "Martin Luther King Jr. Day",
  "2027-02-15": "Presidents' Day",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (observed)",
  "2027-07-05": "Independence Day (observed)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day",
  "2027-12-24": "Christmas Day (observed)",
};

export const MARKET_TIME_ZONE = "America/New_York";
export const DEFAULT_TIME_ZONE = "Pacific/Auckland";
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;
const PRE_MARKET_MINUTES = 4 * 60;
const AFTER_HOURS_END_MINUTES = 20 * 60;
const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type Instant = string | number | Date;
export type SessionReason =
  | "pre-market"
  | "in-session"
  | "after-close"
  | "weekend"
  | "holiday";
export type SessionAssignment = {
  /** The session date, YYYY-MM-DD in New York. */
  session: string;
  reason: SessionReason;
  /** The holiday that pushed the instant forward, when that is the reason. */
  holiday: string | null;
};
export type MarketState = "pre-market" | "open" | "after-hours" | "closed";
export type MarketStatus = {
  state: MarketState;
  /** The session that is open, or the next one to open. */
  session: string;
  /** Minutes until the close while open; otherwise until the next open. */
  minutesToChange: number;
  holiday: string | null;
  label: string;
};

function toDate(instant: Instant): Date {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime()))
    throw new RangeError(`Not a valid instant: ${String(instant)}`);
  return date;
}
function parseDay(date: string) {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== date)
    throw new RangeError(`Not a calendar date: ${date}`);
  return ms;
}
function addDays(date: string, days: number) {
  return new Date(parseDay(date) + days * DAY_MS).toISOString().slice(0, 10);
}
const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(date: Date, timeZone: string) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(
    f.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second),
  };
}
/** The UTC instant of a wall-clock time on a New York calendar day. */
function marketInstant(date: string, minutes: number): Date {
  const guess = parseDay(date) + minutes * 60_000;
  let at = guess;
  // Two passes settle any offset, including a DST change on that day.
  for (let i = 0; i < 2; i++) {
    const wall = wallClock(new Date(at), MARKET_TIME_ZONE);
    const wallMs =
      parseDay(wall.date) + wall.minutes * 60_000 + wall.seconds * 1000;
    at += guess - wallMs;
  }
  return new Date(at);
}

export function holidayName(date: string): string | null {
  parseDay(date);
  return NYSE_HOLIDAYS[date] ?? null;
}
/** A weekday that is not an NYSE full-day closure. Half days are trading days. */
export function isTradingDay(date: string): boolean {
  const day = new Date(parseDay(date)).getUTCDay();
  return day !== 0 && day !== 6 && !NYSE_HOLIDAYS[date];
}
/** The first trading day strictly after `date`. */
export function nextSession(date: string): string {
  let d = addDays(date, 1);
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}
/** The last trading day strictly before `date`. */
export function previousSession(date: string): string {
  let d = addDays(date, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}
/** Trading days from `from` to `to`, both inclusive; empty when reversed. */
export function sessionsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = parseDay(to);
  for (let d = from; parseDay(d) <= end; d = addDays(d, 1))
    if (isTradingDay(d)) out.push(d);
  return out;
}
/** The session a publish instant belongs to, and why. */
export function sessionFor(instant: Instant): SessionAssignment {
  const et = wallClock(toDate(instant), MARKET_TIME_ZONE);
  if (!isTradingDay(et.date)) {
    const holiday = NYSE_HOLIDAYS[et.date] ?? null;
    return {
      session: nextSession(et.date),
      reason: holiday ? "holiday" : "weekend",
      holiday,
    };
  }
  if (et.minutes >= CLOSE_MINUTES)
    return { session: nextSession(et.date), reason: "after-close", holiday: null };
  return {
    session: et.date,
    reason: et.minutes < OPEN_MINUTES ? "pre-market" : "in-session",
    holiday: null,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function shortDay(date: string, year = false) {
  const d = new Date(parseDay(date));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
}
/** "Mon 28 Sep · US session". */
export function sessionLabel(date: string, options: { year?: boolean } = {}) {
  return `${shortDay(date, options.year)} · US session`;
}

const ZONE_LOCALES = ["en-US", "en-NZ", "en-GB", "en-AU", "en-CA", "en-IN"];
/** The short zone name ("NZDT", "EST", "BST"), or a GMT offset when none exists. */
function zoneAbbreviation(date: Date, timeZone: string) {
  let fallback = "";
  for (const locale of ZONE_LOCALES) {
    const name =
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    if (name && !/^GMT[+-]/.test(name)) return name;
    fallback ||= name;
  }
  return fallback || timeZone;
}
/** "Sat 26 Sep 14:00 NZST": the instant on the team's clock. */
export function localTime(instant: Instant, timeZone: string) {
  const date = toDate(instant);
  const wall = wallClock(date, timeZone);
  const hh = String(Math.floor(wall.minutes / 60)).padStart(2, "0");
  const mm = String(wall.minutes % 60).padStart(2, "0");
  return `${shortDay(wall.date)} ${hh}:${mm} ${zoneAbbreviation(date, timeZone)}`;
}
/** The hover text: local publish time, the session, and the rule applied. */
export function assignmentReason(instant: Instant, timeZone: string) {
  const s = sessionFor(instant);
  const et = wallClock(toDate(instant), MARKET_TIME_ZONE);
  const why =
    s.reason === "weekend"
      ? "weekend"
      : s.reason === "holiday"
        ? (s.holiday ?? "market holiday")
        : s.reason === "after-close"
          ? `after ${shortDay(et.date)} close`
          : s.reason === "pre-market"
            ? "before the open"
            : "during the session";
  return `Published ${localTime(instant, timeZone)} → ${shortDay(s.session)} session (${why})`;
}

function duration(minutes: number) {
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    mins = minutes % 60;
  return days > 0 ? `${days} d ${hours} h ${mins} m` : `${hours} h ${mins} m`;
}
/** Pre-market (04:00–09:30 ET), open, after-hours (16:00–20:00 ET) or closed. */
export function marketStatus(now: Instant): MarketStatus {
  const at = toDate(now);
  const et = wallClock(at, MARKET_TIME_ZONE);
  const until = (target: Date) =>
    Math.max(0, Math.ceil((target.getTime() - at.getTime()) / 60_000));
  const trading = isTradingDay(et.date);
  if (trading && et.minutes >= OPEN_MINUTES && et.minutes < CLOSE_MINUTES) {
    const minutes = until(marketInstant(et.date, CLOSE_MINUTES));
    return {
      state: "open",
      session: et.date,
      minutesToChange: minutes,
      holiday: null,
      label: `US market: open · closes in ${duration(minutes)}`,
    };
  }
  const session =
    trading && et.minutes < OPEN_MINUTES ? et.date : nextSession(et.date);
  const minutes = until(marketInstant(session, OPEN_MINUTES));
  const state: MarketState = !trading
    ? "closed"
    : et.minutes >= PRE_MARKET_MINUTES && et.minutes < OPEN_MINUTES
      ? "pre-market"
      : et.minutes >= CLOSE_MINUTES && et.minutes < AFTER_HOURS_END_MINUTES
        ? "after-hours"
        : "closed";
  const holiday = trading ? null : (NYSE_HOLIDAYS[et.date] ?? null);
  // Name the day only when the next open is not today or tomorrow in New York.
  const opens =
    session === et.date || session === addDays(et.date, 1)
      ? "opens"
      : `opens ${shortDay(session)}`;
  return {
    state,
    session,
    minutesToChange: minutes,
    holiday,
    label: `US market: ${state}${holiday ? ` (${holiday})` : ""} · ${opens} in ${duration(minutes)}`,
  };
}

/** True when Intl accepts the IANA name. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
/** Every IANA zone this runtime knows, plus UTC, for a searchable picker. */
export function timeZoneOptions(): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return [
    ...new Set([DEFAULT_TIME_ZONE, MARKET_TIME_ZONE, "UTC", ...zones]),
  ].sort();
}
