import { z } from "zod";
import {
  statistics,
  benjaminiHochberg,
  wilsonInterval,
} from "./significance.ts";
import type { ClaimRow } from "../../server/youtube-intelligence/repos/claims.ts";
import type { SettlementRow } from "../../server/youtube-intelligence/repos/settlements.ts";
import type { PriceRow } from "../../server/youtube-intelligence/repos/prices.ts";
import type { InstrumentRow } from "../../server/youtube-intelligence/repos/instruments.ts";
import type { MentionRow } from "../../server/youtube-intelligence/repos/mentions.ts";
import type { TeamPreferencesData } from "./settings.ts";

export type BoardSnapshot = {
  claims: ClaimRow[];
  settlements: SettlementRow[];
  prices: PriceRow[];
  instruments: (InstrumentRow & { sector?: string })[];
  mentions: MentionRow[];
  channels: { id: string; title: string }[];
  runs: { id: string; record: "forward" | "historical"; createdAt: string }[];
  settings: TeamPreferencesData;
  asOf: string;
};
export const BoardOptionsSchema = z.object({
  asOf: z.string().optional(),
  horizonDays: z
    .union([z.literal(90), z.literal(180), z.literal(365)])
    .default(90),
  benchmark: z.string().min(1).default("SPY"),
  record: z.enum(["forward", "historical"]).default("forward"),
  markets: z.array(z.string()).optional(),
  minimumTrust: z.enum(["L0", "L1", "L2", "L3"]).default("L2"),
});
export type BoardOptions = z.input<typeof BoardOptionsSchema>;
export type BoardRow = ReturnType<typeof statistics> & {
  id: string;
  label: string;
  rank: number | null;
  q: number | null;
  status: "supported" | "negative" | "not-yet";
  claimIds: string[];
};
export type TickerBoardRow = BoardRow & {
  ticker: string;
  creators: number;
  consensus: string;
  mostReliableCreator: {
    id: string;
    label: string;
    n: number;
    winRate: number | null;
    status: BoardRow["status"];
  } | null;
};
export type Board = {
  asOf: string;
  options: z.output<typeof BoardOptionsSchema>;
  creators: BoardRow[];
  tickers: TickerBoardRow[];
  excluded: { claimId: string; reason: string }[];
  scored: {
    claim: ClaimRow;
    settlement: SettlementRow;
    excess: number;
    benchmarkReturn: number;
  }[];
};
export const SECTOR_ETFS: Record<string, string> = {
  Technology: "XLK",
  "Communication Services": "XLC",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  "Financial Services": "XLF",
  Financials: "XLF",
  Healthcare: "XLV",
  Industrials: "XLI",
  "Basic Materials": "XLB",
  Materials: "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
};
const instant = (value: string) =>
  Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value);
const creator = (claim: ClaimRow) =>
  claim.channelId ?? `unknown:${claim.runId}`;

/** Latest append-only settlement known at the cutoff, never a future correction. */
export function latestSettlements(
  rows: SettlementRow[],
  options: { asOf: string; horizonDays: number; record: string },
) {
  const latest = new Map<string, SettlementRow>();
  for (const row of [...rows].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      (a.revision ?? 0) - (b.revision ?? 0) ||
      a.id.localeCompare(b.id),
  )) {
    if (
      row.record !== options.record ||
      row.horizonDays !== options.horizonDays ||
      instant(row.createdAt) > instant(options.asOf)
    )
      continue;
    latest.set(row.claimId, row);
  }
  return latest;
}
function benchmarkReturn(
  snapshot: BoardSnapshot,
  claim: ClaimRow,
  row: SettlementRow,
  benchmark: string,
  cutoff: number,
): number | null {
  if (benchmark === "none") return 0;
  const symbol =
    benchmark === "sector"
      ? SECTOR_ETFS[
          snapshot.instruments.find((i) => i.symbol === claim.ticker)?.sector ??
            ""
        ]
      : benchmark.toUpperCase();
  if (!symbol || !row.entryDate || !row.exitDate) return null;
  const latest = new Map<string, PriceRow>();
  for (const p of [...snapshot.prices]
    .filter(
      (p) =>
        p.ticker === symbol &&
        instant(p.fetchedAt) <= cutoff &&
        p.adjustedClose > 0,
    )
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt)))
    latest.set(p.date, p);
  // Compare exactly the same sessions. Missing benchmark data is never substituted from another date.
  const first = latest.get(row.entryDate),
    last = latest.get(row.exitDate);
  return first && last ? last.adjustedClose / first.adjustedClose - 1 : null;
}
function rank(rows: BoardRow[], minimum: number, fdr: number) {
  const qs = benjaminiHochberg(rows.map((r) => (r.n >= minimum ? r.p : null)));
  rows.forEach((row, i) => {
    row.q = qs[i];
    row.status =
      row.n >= minimum && row.q !== null && row.q < fdr
        ? row.meanExcess! > 0
          ? "supported"
          : "negative"
        : "not-yet";
  });
  rows.sort(
    (a, b) =>
      Number(b.n >= minimum) - Number(a.n >= minimum) ||
      (b.medianExcess ?? -Infinity) - (a.medianExcess ?? -Infinity) ||
      b.n - a.n ||
      a.id.localeCompare(b.id),
  );
  rows.forEach((r, i) => (r.rank = r.n >= minimum ? i + 1 : null));
  return rows;
}
export function boardAsOf(
  snapshot: BoardSnapshot,
  input: BoardOptions = {},
): Board {
  const options = BoardOptionsSchema.parse(input),
    asOf = options.asOf ?? snapshot.asOf,
    cutoff = instant(asOf);
  if (!Number.isFinite(cutoff)) throw Error("Invalid board cutoff.");
  const latest = latestSettlements(snapshot.settlements, { ...options, asOf });
  const runs = new Map(snapshot.runs.map((r) => [r.id, r]));
  const excluded: Board["excluded"] = [];
  const claims = snapshot.claims.filter((c) => {
    const run = runs.get(c.runId),
      market =
        snapshot.instruments.find((i) => i.symbol === c.ticker)?.market ??
        "unknown";
    const reason =
      !run || run.record !== options.record
        ? "Different record"
        : instant(run.createdAt) > cutoff ||
            !c.publishedAt ||
            instant(c.publishedAt) > cutoff
          ? "Not yet published or analyzed"
          : (c.trustBasis as { latestReviewVerdict?: string } | null)
                ?.latestReviewVerdict === "rejected"
            ? "Human reviewer rejected this claim and evidence"
            : c.trustLevel < options.minimumTrust || c.trustLevel < "L2"
              ? "Audio agreement required"
              : !["medium", "high"].includes(c.creatorConviction) ||
                  !["long", "short"].includes(c.stance)
                ? "Only medium/high directional calls are scored"
                : options.markets?.length && !options.markets.includes(market)
                  ? `Market filter (${market})`
                  : null;
    if (reason) {
      excluded.push({ claimId: c.id, reason });
      return false;
    }
    return true;
  });
  const scored: Board["scored"] = [];
  for (const claim of claims) {
    const settlement = latest.get(claim.id);
    if (
      !claim.ticker ||
      !settlement ||
      settlement.status !== "settled" ||
      settlement.return === null ||
      !Number.isFinite(settlement.return) ||
      !settlement.entryDate ||
      !settlement.exitDate ||
      instant(settlement.exitDate) > cutoff
    ) {
      excluded.push({
        claimId: claim.id,
        reason:
          settlement?.reason ??
          "Not settleable, no price source or horizon not reached",
      });
      continue;
    }
    const benchmark = benchmarkReturn(
      snapshot,
      claim,
      settlement,
      options.benchmark,
      cutoff,
    );
    if (benchmark === null) {
      excluded.push({
        claimId: claim.id,
        reason: "Benchmark prices unavailable at this cutoff",
      });
      continue;
    }
    scored.push({
      claim,
      settlement,
      excess: settlement.return - benchmark,
      benchmarkReturn: benchmark,
    });
  }
  const minimum = Math.max(20, snapshot.settings.leaderboard.minSettledForRank),
    fdr = snapshot.settings.leaderboard.fdrQ;
  const make = (
    id: string,
    label: string,
    filter: (c: ClaimRow) => boolean,
  ): BoardRow => {
    const selected = scored.filter((s) => filter(s.claim));
    const wins = selected.filter((s) => s.settlement.return! > 0).length;
    return {
      id,
      label,
      rank: 0,
      ...statistics(selected.map((s) => s.excess)),
      winRate: selected.length ? wins / selected.length : null,
      wilson: wilsonInterval(wins, selected.length),
      q: null,
      status: "not-yet",
      claimIds: selected.map((s) => s.claim.id),
    };
  };
  const creators = rank(
    [...new Set(claims.map(creator))].map((id) =>
      make(
        id,
        snapshot.channels.find((c) => c.id === id)?.title ?? id,
        (c) => creator(c) === id,
      ),
    ),
    minimum,
    fdr,
  );
  const tickers = rank(
    [
      ...new Set(claims.map((c) => c.ticker).filter((t): t is string => !!t)),
    ].map((t) => make(t, t, (c) => c.ticker === t)),
    minimum,
    fdr,
  ) as TickerBoardRow[];
  for (const row of tickers) {
    const selected = claims.filter((c) => c.ticker === row.id),
      open = new Map<string, ClaimRow>();
    for (const c of [...selected].sort(
      (a, b) =>
        a.publishedAt!.localeCompare(b.publishedAt!) ||
        a.id.localeCompare(b.id),
    ))
      if (latest.get(c.id)?.status !== "settled") open.set(creator(c), c);
    const longs = [...open.values()].filter((c) => c.stance === "long").length,
      shorts = [...open.values()].filter((c) => c.stance === "short").length;
    const consensus = !open.size
      ? "no open calls"
      : longs === 0
        ? "agree short"
        : shorts === 0
          ? "agree long"
          : longs === shorts
            ? "split"
            : longs > shorts
              ? "lean long"
              : "lean short";
    const reliable = [...new Set(selected.map(creator))]
      .map((id) =>
        make(
          id,
          creators.find((c) => c.id === id)?.label ?? id,
          (c) => c.ticker === row.id && creator(c) === id,
        ),
      )
      .filter(
        (c) =>
          c.n >=
          Math.max(10, snapshot.settings.leaderboard.minSettledPerTicker),
      )
      .sort(
        (a, b) =>
          b.winRate! - a.winRate! || b.n - a.n || a.id.localeCompare(b.id),
      )[0];
    Object.assign(row, {
      ticker: row.id,
      creators: new Set(selected.map(creator)).size,
      consensus,
      mostReliableCreator: reliable
        ? {
            id: reliable.id,
            label: reliable.label,
            n: reliable.n,
            winRate: reliable.winRate,
            status: creators.find((c) => c.id === reliable.id)!.status,
          }
        : null,
    });
  }
  return { asOf, options, creators, tickers, excluded, scored };
}
export function diffBoards(before: Board, after: Board) {
  return (["creator", "ticker"] as const)
    .flatMap((kind) => {
      const oldRows = kind === "creator" ? before.creators : before.tickers,
        newRows = kind === "creator" ? after.creators : after.tickers;
      return [...new Set([...oldRows, ...newRows].map((r) => r.id))].map(
        (id) => {
          const a = oldRows.find((r) => r.id === id),
            b = newRows.find((r) => r.id === id);
          return {
            kind,
            id,
            label: b?.label ?? a!.label,
            beforeRank: a?.rank ?? null,
            afterRank: b?.rank ?? null,
            rankMove:
              a?.rank != null && b?.rank != null ? a.rank - b.rank : null,
            callsAdded: (b?.n ?? 0) - (a?.n ?? 0),
            winRateBefore: a?.winRate ?? null,
            winRateAfter: b?.winRate ?? null,
            medianExcessBefore: a?.medianExcess ?? null,
            medianExcessAfter: b?.medianExcess ?? null,
            statusBefore: a?.status ?? null,
            statusAfter: b?.status ?? null,
            meaningful: (a?.n ?? 0) >= 20 && (b?.n ?? 0) >= 20,
            reason: !a
              ? "New entrant: first eligible call"
              : !b
                ? "No longer eligible under selected record, market or benchmark"
                : a.n < 20 && b.n >= 20
                  ? "Reached 20 settled calls"
                  : a.status !== b.status
                    ? "Statistical status changed"
                    : "Settlement or rank movement",
            claimIds: (b?.claimIds ?? []).filter(
              (id) => !a?.claimIds.includes(id),
            ),
            ...(kind === "ticker"
              ? {
                  consensusBefore: (a as TickerBoardRow)?.consensus,
                  consensusAfter: (b as TickerBoardRow)?.consensus,
                }
              : {}),
          };
        },
      );
    })
    .sort(
      (a, b) =>
        Number(b.meaningful) - Number(a.meaningful) ||
        Math.abs(b.rankMove ?? 0) - Math.abs(a.rankMove ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
