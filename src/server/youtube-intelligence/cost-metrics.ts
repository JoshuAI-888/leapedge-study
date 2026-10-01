import { z } from "zod";
import {
  CostContext,
  costProjection,
  budgetMeter,
} from "../../features/youtube-intelligence/metrics/cost.ts";
import { database, json } from "./database.ts";
import { listChannels } from "./repos/channels.ts";
import { teamPreferences } from "./research-store.ts";
import { listHeaders } from "./store.ts";
export const CostMetricsRequest = z.object({
  selectedChannelIds: z.array(z.string().min(1)).max(1000).optional(),
  now: z.iso.datetime({ offset: true }).optional(),
});
const uploadSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
});
/**
 * Accepted claims per run, counted in Postgres so only the counts cross the
 * wire, not each run's output.
 */
async function acceptedClaimCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await database
    .prepare(
      `WITH page AS MATERIALIZED (SELECT id,output FROM yi_runs WHERE id=ANY($1::text[])),
      parsed AS MATERIALIZED (SELECT id,output::jsonb AS o FROM page)
      SELECT id,(SELECT count(*) FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(o->'claims')='array' THEN o->'claims' ELSE '[]'::jsonb END
      ) c WHERE jsonb_typeof(c)='object' AND c->'passed'='true'::jsonb) AS accepted
      FROM parsed`,
    )
    .all(ids);
  return new Map(rows.map((r) => [String(r.id), Number(r.accepted)]));
}
/** Read-only selection preview: never saves switches or queues paid work. */
export async function loadCostMetrics(
  input: z.input<typeof CostMetricsRequest> = {},
) {
  const request = CostMetricsRequest.parse(input),
    now = request.now ?? new Date().toISOString();
  const [team, channels, discoveries, runs, ledger, coverageRows] =
    await Promise.all([
      teamPreferences(),
      listChannels(),
      database.prepare("SELECT payload FROM yi_discoveries").all(),
      listHeaders(),
      database
        .prepare("SELECT run_id,status,amount,metrics FROM yi_calls")
        .all(),
      database
        .prepare(
          "SELECT id,payload FROM yi_documents WHERE kind='channelCoverage'",
        )
        .all(),
    ]);
  const coverageByChannel = new Map(
    coverageRows.map((r) => [String(r.id), json(r.payload)]),
  );
  const uploads = discoveries.flatMap((row) => {
    const parsed = uploadSchema.safeParse(json(row.payload));
    return parsed.success ? [parsed.data] : [];
  });
  const windowStart = Date.parse(now) - 90 * 86400000;
  const observations = channels.map((c) => {
    const coverage = coverageByChannel.get(c.id) ?? null;
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
              u.channelId === c.id && Date.parse(u.publishedAt) <= windowStart,
          )),
      ),
    };
  });
  const measuredRuns = new Set<string>();
  const sampled = runs
    .filter((r) => r.status === "completed" && !r.input.experiment)
    .filter((r) => {
      if (measuredRuns.has(r.videoId)) return false;
      measuredRuns.add(r.videoId);
      return true;
    });
  const accepted = await acceptedClaimCounts(sampled.map((r) => r.id));
  const samples = sampled.flatMap((r) => {
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
    return [
      {
        videoId: r.videoId,
        measuredUsd: measured
          ? attempts.reduce((sum, a) => sum + Number(a.amount), 0)
          : null,
        acceptedClaims: accepted.get(r.id) ?? 0,
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
