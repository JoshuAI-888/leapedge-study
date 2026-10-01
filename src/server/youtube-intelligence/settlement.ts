import type { PriceRow } from "./repos/prices.ts";

/**
 * Settlement scoring (spec 4.12).
 *
 * This is `performance.ts` `scoreCall`'s convention with the benchmark taken
 * out: entry at the first session on or after the call, exit at the horizon,
 * sign flipped for a short, eligible only for medium and high conviction long
 * and short calls. What is gone is SPY. `scoreCall` computed `excessReturn`
 * against a hard-coded SPY series, and spec 4.12 makes the benchmark the
 * viewer's choice — SPY, QQQ, IWM, a sector ETF, a custom ticker, or none —
 * computed when the board is requested. A settlement row therefore records only
 * what the call's own instrument did, and changing a benchmark changes nothing
 * stored.
 *
 * Every function here is pure over the bars it is handed, so the sweep, a
 * backfill and a test all score identically.
 */

/** Spec 4.12: the three horizons the boards offer. */
export const HORIZONS = [90, 180, 365] as const;
export type Horizon = (typeof HORIZONS)[number];

export type SettlementRecord = "forward" | "historical";

export type SettleableCall = {
  claimId: string;
  ticker: string;
  stance: string;
  creatorConviction: string;
  /** YYYY-MM-DD: the video's date for a forward record, its publication date for a replay. */
  callDate: string;
  record: SettlementRecord;
};

export type SettlementStatus = "settled" | "pending" | "not-settleable";

export type SettlementResult = {
  claimId: string;
  horizonDays: number;
  entryDate: string | null;
  entryPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  /** The call's own return, short-adjusted. Null unless status is "settled". */
  return: number | null;
  status: SettlementStatus;
  /** Why, in one sentence, when the status is not "settled". */
  reason: string | null;
  record: SettlementRecord;
};

const DIRECTIONAL = new Set(["long", "short"]);
const COMMITTED = new Set(["medium", "high"]);
const DAY_MS = 86400000;

/**
 * Spec 4.12's scoring convention: only a call with a direction and a stated
 * commitment behind it is a call whose return means anything. A "watch" or a
 * low-conviction aside is still extracted, shown and counted in sentiment; it
 * is simply not scored.
 */
export function eligibleForSettlement(call: SettleableCall): boolean {
  return (
    DIRECTIONAL.has(call.stance) && COMMITTED.has(call.creatorConviction)
  );
}

function outcome(
  call: SettleableCall,
  horizonDays: number,
  status: SettlementStatus,
  reason: string,
): SettlementResult {
  return {
    claimId: call.claimId,
    horizonDays,
    entryDate: null,
    entryPrice: null,
    exitDate: null,
    exitPrice: null,
    return: null,
    status,
    reason,
    record: call.record,
  };
}

/**
 * Score one call at one horizon against the bars for its own ticker.
 *
 * `asOf` is the sweep's date. A horizon whose target date has not been reached
 * is `pending`, never a partial return: a 90-day record made of 40-day returns
 * flatters whichever direction the market moved.
 */
export function settleCall(
  call: SettleableCall,
  bars: PriceRow[],
  horizonDays: number,
  asOf: string,
): SettlementResult {
  if (!eligibleForSettlement(call))
    return outcome(
      call,
      horizonDays,
      "not-settleable",
      "Only medium and high conviction long and short calls are scored.",
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(call.callDate))
    return outcome(call, horizonDays, "not-settleable", "The call has no usable date.");

  const series = bars
    .filter((b) => b.ticker === call.ticker && Number.isFinite(b.adjustedClose) && b.adjustedClose > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length)
    return outcome(
      call,
      horizonDays,
      "not-settleable",
      `No price source for ${call.ticker}; the next sweep settles it if one is added.`,
    );

  /**
   * A forward record enters the first session strictly after the call date. The
   * close of the day the call was made is not knowable at the moment the call
   * is made, so using it would score the record with information it did not
   * have. A historical replay is explicitly retrospective and enters the
   * session it has (spec 4.16), which is also what makes the two records
   * incomparable and why they are never mixed.
   */
  const entry = series.find((b) =>
    call.record === "forward" ? b.date > call.callDate : b.date >= call.callDate,
  );
  if (!entry)
    return outcome(
      call,
      horizonDays,
      "pending",
      "No session at or after the call date has been priced yet.",
    );

  const target = new Date(Date.parse(`${call.callDate}T00:00:00Z`) + horizonDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  if (asOf < target)
    return outcome(
      call,
      horizonDays,
      "pending",
      `The ${horizonDays}-day horizon ends ${target}, after the ${asOf} sweep.`,
    );

  const exit = series.filter((b) => b.date >= entry.date && b.date <= target).at(-1);
  if (!exit)
    return outcome(
      call,
      horizonDays,
      "pending",
      "No priced session between the entry and the horizon date.",
    );
  /**
   * The horizon elapsed but the series stops well short of it, so the last bar
   * is not the horizon's close. Returning it would silently shorten the
   * horizon, so the row stays pending until the series catches up.
   */
  const gapDays = (Date.parse(target) - Date.parse(exit.date)) / DAY_MS;
  if (gapDays > 7)
    return outcome(
      call,
      horizonDays,
      "pending",
      `The last priced session (${exit.date}) is more than a week before the ${target} horizon.`,
    );

  const move = exit.adjustedClose / entry.adjustedClose - 1;
  return {
    claimId: call.claimId,
    horizonDays,
    entryDate: entry.date,
    entryPrice: entry.adjustedClose,
    exitDate: exit.date,
    exitPrice: exit.adjustedClose,
    return: call.stance === "short" ? -move : move,
    status: "settled",
    reason: null,
    record: call.record,
  };
}
