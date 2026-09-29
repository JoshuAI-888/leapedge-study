/**
 * The follow prompt (F71), as pure logic: whether a channel is followed,
 * what following it would cost by the Channels page's own projection
 * (metrics/cost.ts costProjection), and the 30-day "Not now" on this browser.
 *
 * Following never buys anything by itself (channels.ts follow()); processing
 * new uploads is the spending switch. The prompt turns processing on by
 * default only when the projected monthly cost is known and fits the budget.
 * An unknown projection or one that would exceed the budget defaults to
 * discovery only, and the banner says which.
 */
import { costProjection, type CostContextInput } from "./metrics/cost.ts";

export const DISMISS_DAYS = 30;
const DAY_MS = 86_400_000;
/** Weeks in an average month, so a monthly rate reads per week. */
const WEEKS_PER_MONTH = 52 / 12;

export type FollowChannel = { id: string; active: boolean; uploads: string };

/** A channel is followed when it is listed, discovery is on and its uploads are known. */
export function isFollowed(channelId: string, channels: FollowChannel[]) {
  const c = channels.find((x) => x.id === channelId);
  return Boolean(c && c.active && c.uploads);
}

export type FollowPlan = {
  /** Uploads per week from a complete 90-day observation, else null. */
  uploadsPerWeek: number | null;
  /** Uploads seen in the window when the observation is incomplete (a lower bound). */
  observedUploads: number;
  /** Projected monthly cost of processing this channel, else null. */
  monthlyUsd: number | null;
  remainingUsd: number;
  /** Processing would exceed what is left this month, or the monthly budget overall. */
  overBudget: boolean;
  /** Whether "Follow" also switches on processing of new uploads. */
  processByDefault: boolean;
  reason: "within-budget" | "over-budget" | "cost-unknown";
};

export function followPlan(input: {
  channelId: string;
  context: CostContextInput;
  remainingUsd: number;
}): FollowPlan {
  const selected = [
    ...new Set([...input.context.selectedChannelIds, input.channelId]),
  ];
  const projection = costProjection({
    ...input.context,
    selectedChannelIds: selected,
  });
  const row = projection.channels.find((c) => c.channelId === input.channelId);
  const monthlyUsd = row?.projectedMonthlyUsd ?? null;
  const remainingUsd = Math.max(0, input.remainingUsd);
  const overBudget =
    monthlyUsd !== null &&
    (monthlyUsd > remainingUsd || projection.exceedsBudget === true);
  const reason =
    monthlyUsd === null
      ? "cost-unknown"
      : overBudget
        ? "over-budget"
        : "within-budget";
  return {
    uploadsPerWeek:
      row?.uploadsPerMonth == null ? null : row.uploadsPerMonth / WEEKS_PER_MONTH,
    observedUploads: row?.observedUploads ?? 0,
    monthlyUsd,
    remainingUsd,
    overBudget,
    processByDefault: reason === "within-budget",
    reason,
  };
}

/** "About 2 uploads a week", or what little is known. */
export function uploadsText(plan: FollowPlan) {
  if (plan.uploadsPerWeek !== null) {
    const n = plan.uploadsPerWeek;
    if (n === 0) return "No uploads in the last 90 days";
    if (n < 1) return "Less than one upload a week";
    const rounded = Math.round(n);
    return `About ${rounded} upload${rounded === 1 ? "" : "s"} a week`;
  }
  return plan.observedUploads > 0
    ? `At least ${plan.observedUploads} upload${plan.observedUploads === 1 ? "" : "s"} in 90 days`
    : "Upload rate is known once the channel is followed";
}

export const dismissKey = (channelId: string) =>
  `yti:follow-prompt:dismissed:${channelId}`;

/** The stored value for "Not now": when the prompt may show again. */
export const dismissUntil = (now: number) =>
  new Date(now + DISMISS_DAYS * DAY_MS).toISOString();

/** True while a stored "Not now" is still in force; anything unreadable is not. */
export function isDismissed(stored: string | null | undefined, now: number) {
  if (!stored) return false;
  const until = Date.parse(stored);
  return Number.isFinite(until) && until > now;
}
