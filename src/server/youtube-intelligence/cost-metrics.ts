import { z } from "zod";
import {
  CostContext,
  costProjection,
  budgetMeter,
} from "../../features/youtube-intelligence/metrics/cost.ts";
import { database, json } from "./database.ts";
import { listChannels } from "./repos/channels.ts";
import { doc, teamPreferences } from "./research-store.ts";
import { list } from "./store.ts";
export const CostMetricsRequest = z.object({
  selectedChannelIds: z.array(z.string().min(1)).max(1000).optional(),
  now: z.iso.datetime({ offset: true }).optional(),
});
const uploadSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
});
/** Read-only selection preview: never saves switches or queues paid work. */
export async function loadCostMetrics(
  input: z.input<typeof CostMetricsRequest> = {},
) {
  const request = CostMetricsRequest.parse(input),
    now = request.now ?? new Date().toISOString();
  const [team, channels, discoveries, runs, ledger] = await Promise.all([
    teamPreferences(),
    listChannels(),
    database.prepare("SELECT payload FROM yi_discoveries").all(),
    list(),
    database.prepare("SELECT run_id,status,amount,metrics FROM yi_calls").all(),
  ]);
  const uploads = discoveries.flatMap((row) => {
    const parsed = uploadSchema.safeParse(json(row.payload));
    return parsed.success ? [parsed.data] : [];
  });
  const windowStart = Date.parse(now) - 90 * 86400000;
  const observations = await Promise.all(
    channels.map(async (c) => {
      const coverage = await doc<unknown>("channelCoverage", c.id);
      const parsed = z
        .object({ latestMetadataAt: z.iso.datetime({ offset: true }) })
        .safeParse(coverage);
      const latestAt = parsed.success
        ? Date.parse(parsed.data.latestMetadataAt)
        : NaN;
      return {
        channelId: c.id,
        complete: Boolean(
          !c.error &&
          latestAt <= Date.parse(now) &&
          latestAt >= Date.parse(now) - 86400000 &&
          c.historyStarted &&
          (!c.nextPageToken ||
            uploads.some(
              (u) =>
                u.channelId === c.id &&
                Date.parse(u.publishedAt) <= windowStart,
            )),
        ),
      };
    }),
  );
  const measuredRuns = new Set<string>();
  const samples = runs
    .filter((r) => r.status === "completed" && !r.input.experiment)
    .flatMap((r) => {
      if (measuredRuns.has(r.videoId)) return [];
      measuredRuns.add(r.videoId);
      const attempts = ledger.filter(
        (l) => l.run_id === r.id && l.status !== "released",
      );
      const measured =
        attempts.length > 0 &&
        attempts.every(
          (l) =>
            l.status === "completed" &&
            Number.isFinite(Number(l.amount)) &&
            Number(l.amount) >= 0,
        );
      const claims = Array.isArray(r.output.claims) ? r.output.claims : [];
      return [
        {
          videoId: r.videoId,
          measuredUsd: measured
            ? attempts.reduce((sum, a) => sum + Number(a.amount), 0)
            : null,
          acceptedClaims: claims.filter(
            (c) =>
              c && typeof c === "object" && "passed" in c && c.passed === true,
          ).length,
        },
      ];
    });
  const hard = process.env.YTI_HARD_BUDGET_USD_MONTH;
  const context = CostContext.parse({
    now,
    selectedChannelIds:
      request.selectedChannelIds ??
      channels
        .filter((c) => c.autoAnalyze && c.processing !== "on-request")
        .map((c) => c.id),
    uploads,
    observations,
    samples,
    calls: ledger.map((row) => {
      const metrics = json(row.metrics) as Record<string, unknown> | null;
      return {
        status: row.status,
        amount: Number(row.amount),
        settledAt: metrics?.settledAt ?? null,
      };
    }),
    monthlyUsd: team.budget.monthlyUsd,
    hardCeilingUsd: hard ? Number(hard) : null,
    alertAtPercent: team.budget.alertAtPercent,
  });
  return {
    context,
    projection: costProjection(context),
    budget: budgetMeter(context),
  };
}
