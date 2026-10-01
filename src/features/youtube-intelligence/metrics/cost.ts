import { z } from "zod";
const money = z.number().finite().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
export const CostContext = z.object({
  now: timestamp,
  selectedChannelIds: z.array(z.string().min(1)),
  uploads: z.array(
    z.object({
      channelId: z.string(),
      videoId: z.string(),
      publishedAt: timestamp,
    }),
  ),
  // True only when metadata pagination covers the full window (or the end of uploads).
  observations: z.array(
    z.object({ channelId: z.string(), complete: z.boolean() }),
  ),
  samples: z.array(
    z.object({
      videoId: z.string(),
      measuredUsd: money.nullable(),
      acceptedClaims: z.number().int().nonnegative(),
    }),
  ),
  calls: z.array(
    z.object({
      status: z.enum(["completed", "reserved", "unknown", "released"]),
      amount: money,
      settledAt: timestamp.nullable(),
    }),
  ),
  monthlyUsd: money,
  hardCeilingUsd: money.nullable(),
  alertAtPercent: z.number().min(0).max(100),
});
export type CostContextInput = z.input<typeof CostContext>;
export function costProjection(input: CostContextInput) {
  const ctx = CostContext.parse(input);
  const now = Date.parse(ctx.now),
    start = now - 90 * 86400000;
  const measured = ctx.samples.filter((s) => s.measuredUsd !== null);
  const measuredCostPerVideoUsd = measured.length
    ? measured.reduce((sum, s) => sum + s.measuredUsd!, 0) / measured.length
    : null;
  const channels = [...new Set(ctx.selectedChannelIds)].map((channelId) => {
    const observedUploads = new Set(
      ctx.uploads
        .filter(
          (u) =>
            u.channelId === channelId &&
            Date.parse(u.publishedAt) >= start &&
            Date.parse(u.publishedAt) <= now,
        )
        .map((u) => u.videoId),
    ).size;
    const complete = ctx.observations.some(
      (o) => o.channelId === channelId && o.complete,
    );
    const uploadsPerMonth = complete ? observedUploads / 3 : null;
    const projectedMonthlyUsd =
      uploadsPerMonth === 0
        ? 0
        : uploadsPerMonth !== null && measuredCostPerVideoUsd !== null
          ? uploadsPerMonth * measuredCostPerVideoUsd
          : null;
    return {
      channelId,
      observedUploads,
      complete,
      uploadsPerMonth,
      projectedMonthlyUsd,
    };
  });
  const projectedMonthlyUsd = channels.some(
    (c) => c.projectedMonthlyUsd === null,
  )
    ? null
    : channels.reduce((sum, c) => sum + c.projectedMonthlyUsd!, 0);
  return {
    windowStart: new Date(start).toISOString(),
    windowEnd: ctx.now,
    channels,
    measuredCostPerVideoUsd,
    sampleCount: measured.length,
    sampleCoverage: ctx.samples.length
      ? measured.length / ctx.samples.length
      : null,
    projectedMonthlyUsd,
    exceedsBudget:
      projectedMonthlyUsd === null
        ? null
        : projectedMonthlyUsd > ctx.monthlyUsd,
  };
}
export function budgetMeter(input: CostContextInput) {
  const ctx = CostContext.parse(input);
  const now = new Date(ctx.now),
    monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let monthToDateSpentUsd = 0,
    openHoldsUsd = 0,
    unknownOutcomeHoldsUsd = 0,
    unallocatedSpentUsd = 0;
  for (const call of ctx.calls) {
    if (call.status === "reserved" || call.status === "unknown") {
      openHoldsUsd += call.amount;
      if (call.status === "unknown") unknownOutcomeHoldsUsd += call.amount;
    } else if (call.status === "completed") {
      if (call.settledAt === null) unallocatedSpentUsd += call.amount;
      else if (
        Date.parse(call.settledAt) >= monthStart &&
        Date.parse(call.settledAt) <= now.getTime()
      )
        monthToDateSpentUsd += call.amount;
    }
  }
  const committedUsd = monthToDateSpentUsd + openHoldsUsd;
  // Historical undated charges cannot be assigned to this month, but must not create apparent headroom.
  const conservativeCommittedUsd = committedUsd + unallocatedSpentUsd;
  const effectiveLimitUsd = Math.min(
    ctx.monthlyUsd,
    ctx.hardCeilingUsd ?? Infinity,
  );
  const state =
    ctx.hardCeilingUsd !== null &&
    conservativeCommittedUsd >= ctx.hardCeilingUsd
      ? "hard-ceiling-reached"
      : conservativeCommittedUsd >= ctx.monthlyUsd
        ? "budget-reached"
        : conservativeCommittedUsd >=
            (ctx.monthlyUsd * ctx.alertAtPercent) / 100
          ? "warning"
          : "within-budget";
  return {
    monthStart: new Date(monthStart).toISOString(),
    monthToDateSpentUsd,
    openHoldsUsd,
    unknownOutcomeHoldsUsd,
    unallocatedSpentUsd,
    committedUsd,
    conservativeCommittedUsd,
    monthlyUsd: ctx.monthlyUsd,
    hardCeilingUsd: ctx.hardCeilingUsd,
    effectiveLimitUsd,
    remainingUsd: Math.max(0, effectiveLimitUsd - conservativeCommittedUsd),
    usedPercent:
      effectiveLimitUsd > 0
        ? (conservativeCommittedUsd / effectiveLimitUsd) * 100
        : null,
    state,
  };
}
