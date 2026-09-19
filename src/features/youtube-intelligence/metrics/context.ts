import { z } from "zod";
import {
  canonicalRuns,
  docs,
} from "../../../server/youtube-intelligence/research-store.ts";
import type { CheckedClaim } from "../contracts.ts";
import {
  loadBoardSnapshot,
  boardAsOf,
} from "../../../server/youtube-intelligence/leaderboard.ts";
import {
  MetricContext,
  SettlementRow,
  TrustLevel,
  type ClaimRowData,
  type TrustLevelName,
} from "./registry.ts";
/**
 * Builds the rows every registry metric reads. Server-only: it queries the
 * store. registry.ts stays pure so the UI can render hover text without it.
 */
export const MetricScope = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horizonDays: z.number().int().positive().default(90),
  benchmark: z.string().min(1).default("SPY"),
  mode: z.enum(["leapedge", "forward", "historical"]).default("leapedge"),
});
export type MetricScopeInput = z.input<typeof MetricScope>;
/**
 * Trust ladder (spec 4.4). A stored `trust` field wins once the pipeline writes
 * one; until then the level follows the checks the claim has passed: L1 when
 * the critic accepted it, L0 when only the deterministic checks did. Rejected
 * claims are off the ladder (null).
 */
export function trustLevelOf(claim: CheckedClaim): TrustLevelName | null {
  if (!claim.passed) return null;
  const stored = TrustLevel.safeParse((claim as { trust?: unknown }).trust);
  if (stored.success) return stored.data;
  return claim.audit?.verdict === "accept" ? "L1" : "L0";
}
export function emptyMetricContext(
  scope: MetricScopeInput = { asOf: "1970-01-01" },
): MetricContext {
  return MetricContext.parse({
    ...MetricScope.parse(scope),
    settlements: [],
    claims: [],
  });
}
export async function loadMetricContext(
  input: MetricScopeInput,
): Promise<MetricContext> {
  const scope = MetricScope.parse(input);
  if (scope.mode !== "leapedge") {
    const snapshot = await loadBoardSnapshot();
    const board = boardAsOf(snapshot, {
      asOf: scope.asOf,
      horizonDays: scope.horizonDays as 90 | 180 | 365,
      benchmark: scope.benchmark,
      record: scope.mode,
    });
    const eligibleRuns = new Set(
      snapshot.runs
        .filter(
          (r) =>
            r.record === scope.mode && r.createdAt.slice(0, 10) <= scope.asOf,
        )
        .map((r) => r.id),
    );
    const claims = snapshot.claims
      .filter((c) => eligibleRuns.has(c.runId))
      .map((c) => ({
        runId: c.runId,
        claimId: c.id,
        channel:
          snapshot.channels.find((row) => row.id === c.channelId)?.title ??
          c.channelId ??
          "Unknown",
        ticker: c.ticker,
        stance: c.stance,
        conviction: c.creatorConviction,
        passed: true,
        trust: c.trustLevel,
      }));
    const settlements = board.scored.map((s) => ({
      id: s.settlement.id,
      runId: s.claim.runId,
      claimId: s.claim.id,
      channel: claims.find((c) => c.claimId === s.claim.id)!.channel,
      ticker: s.claim.ticker ?? undefined,
      status: "completed",
      stockReturn: s.settlement.return!,
      spyReturn: s.benchmarkReturn,
      excessReturn: s.excess,
      win: s.settlement.return! > 0,
      beatsSpy: s.excess > 0,
      horizonDays: scope.horizonDays,
      benchmark: scope.benchmark,
      mode: scope.mode,
    }));
    return MetricContext.parse({ ...scope, claims, settlements });
  }
  // Legacy comparison fixtures are a Lab-only oracle; product records above use relational rows.
  const runs = await canonicalRuns();
  const runIds = new Set(runs.map((r) => r.id));
  const claims: ClaimRowData[] = runs.flatMap((r) => {
    const metadata = (r.output.metadata ?? {}) as { channel?: string };
    return ((r.output.claims || []) as CheckedClaim[]).map((c) => ({
      runId: r.id,
      claimId: c.id,
      channel: String(metadata.channel || "Unknown"),
      ticker: c.claim.ticker ? c.claim.ticker.toUpperCase() : null,
      stance: c.claim.stance,
      conviction: c.claim.creator_conviction,
      passed: c.passed,
      trust: trustLevelOf(c),
    }));
  });
  const settlements = (await docs<unknown>("settlement"))
    .map((row) => SettlementRow.parse(row))
    .filter(
      (row) =>
        (row.runId === undefined || runIds.has(row.runId)) &&
        (row.horizonDays === undefined ||
          row.horizonDays === scope.horizonDays) &&
        (row.benchmark === undefined || row.benchmark === scope.benchmark) &&
        (row.mode === undefined || row.mode === scope.mode),
    );
  return MetricContext.parse({ ...scope, settlements, claims });
}
