import { z } from "zod";
import { list } from "./store.ts";
import { docs, teamPreferences, canonicalRuns } from "./research-store.ts";
import { listClaims } from "./repos/claims.ts";
import { listMentions } from "./repos/mentions.ts";
import { listChannels } from "./repos/channels.ts";
import { listInstruments, upsertInstrument } from "./repos/instruments.ts";
import { listSettlements, appendSettlement } from "./repos/settlements.ts";
import { priceHistory, priceSeries } from "./repos/prices.ts";
import { HORIZONS, settleCall } from "./settlement.ts";
import { prices, resolveInstrument } from "./market.ts";
import {
  boardAsOf,
  SECTOR_ETFS,
  type BoardSnapshot,
} from "../../features/youtube-intelligence/leaderboard.ts";
import { database, advisoryKey } from "./database.ts";

/** Reads never freeze observations, fetch prices, or write scoreboard snapshots. */
export async function loadBoardSnapshot(): Promise<BoardSnapshot> {
  const publications = new Map(
    (await docs<{ videoId: string; runId: string }>("publication")).map((p) => [
      p.videoId,
      p.runId,
    ]),
  );
  const observations = new Map(
    (
      await docs<{ videoId: string; run: { id: string } }>("forwardObservation")
    ).map((p) => [p.videoId, p.run.id]),
  );
  const seen = new Set<string>();
  const runs = (await list()).filter((r) => {
    const selected =
      r.input.record !== "historical" && observations.has(r.videoId)
        ? observations.get(r.videoId)
        : publications.get(r.videoId);
    if (
      r.status !== "completed" ||
      r.input.task ||
      (r.input.experiment === true && selected !== r.id) ||
      (selected !== undefined && selected !== r.id)
    )
      return false;
    const key = `${r.videoId}:${r.input.record === "historical" ? "historical" : "forward"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ids = new Set(runs.map((r) => r.id));
  const [
    claims,
    settlements,
    priceRows,
    instruments,
    mentions,
    channels,
    settings,
  ] = await Promise.all([
    listClaims(100000),
    listSettlements(),
    priceHistory(),
    listInstruments(),
    listMentions(100000),
    listChannels(),
    teamPreferences(),
  ]);
  const profiles = await docs<{ symbol: string; sector?: string }>(
    "instrument",
  );
  return {
    claims: claims.filter((c) => ids.has(c.runId)),
    settlements,
    prices: priceRows,
    instruments: instruments.map((i) => ({
      ...i,
      sector: profiles.find((p) => p.symbol === i.symbol)?.sector,
    })),
    mentions: mentions.filter((m) => ids.has(m.runId)),
    channels: channels.map((c) => ({ id: c.id, title: c.title })),
    runs: runs.map((r) => ({
      id: r.id,
      record: r.input.record === "historical" ? "historical" : "forward",
      createdAt: r.createdAt,
    })),
    settings,
    asOf: new Date().toISOString(),
  };
}

/** Append only changed outcomes. A lock makes concurrent worker sweeps idempotent. No provider calls. */
export async function settlementSweep(
  asOf = new Date().toISOString().slice(0, 10),
) {
  z.iso.date().parse(asOf);
  // A mutating sweep freezes the first observed forward configuration; board reads never do.
  await canonicalRuns();
  const snapshot = await loadBoardSnapshot();
  return database.transaction(async () => {
    await database
      .prepare("SELECT pg_advisory_xact_lock($1)")
      .get(advisoryKey("yi:settlement-sweep"));
    const existing = await listSettlements();
    let appended = 0;
    for (const claim of snapshot.claims) {
      if (!claim.ticker || claim.trustLevel < "L2") continue;
      const run = snapshot.runs.find((r) => r.id === claim.runId)!;
      // A forward record cannot enter before the analysis was observable.
      const published = claim.publishedAt?.slice(0, 10) ?? "";
      const callDate =
        run.record === "historical"
          ? published
          : [published, run.createdAt.slice(0, 10)].sort().at(-1)!;
      const bars = await priceSeries(
        claim.ticker,
        callDate || "1970-01-01",
        asOf,
      );
      for (const horizonDays of HORIZONS) {
        const result = settleCall(
          {
            claimId: claim.id,
            ticker: claim.ticker,
            stance: claim.stance,
            creatorConviction: claim.creatorConviction,
            callDate,
            record: run.record,
          },
          bars,
          horizonDays,
          asOf,
        );
        const previous = existing
          .filter(
            (s) =>
              s.claimId === claim.id &&
              s.horizonDays === horizonDays &&
              s.record === run.record,
          )
          .at(-1);
        if (
          previous &&
          Object.entries(result).every(
            ([key, value]) => previous[key as keyof typeof previous] === value,
          )
        )
          continue;
        existing.push(await appendSettlement(result));
        appended++;
      }
    }
    return { appended, asOf };
  });
}

export const RefreshBoardInput = z.strictObject({
  benchmark: z
    .string()
    .regex(/^(?:none|sector|[A-Z0-9.^=-]{1,20})$/)
    .default("SPY"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
/** Explicit operator action: requests external price data, then settles using stored bars. */
export async function refreshBoardData(
  input: z.input<typeof RefreshBoardInput>,
) {
  const options = RefreshBoardInput.parse(input),
    snapshot = await loadBoardSnapshot();
  const from =
    options.from ??
    snapshot.claims
      .map((c) => c.publishedAt?.slice(0, 10))
      .filter((v): v is string => !!v)
      .sort()[0] ??
    new Date().toISOString().slice(0, 10);
  const to = options.to ?? new Date().toISOString().slice(0, 10);
  if (from > to) throw Error("Price refresh start must precede its end.");
  const tickers = [
    ...new Set(snapshot.claims.flatMap((c) => (c.ticker ? [c.ticker] : []))),
  ];
  const failures: { ticker: string; reason: string }[] = [];
  for (const symbol of tickers) {
    try {
      const instrument = await resolveInstrument(symbol);
      await upsertInstrument({
        symbol,
        name: instrument.name ?? null,
        currency: instrument.currency,
        exchange: instrument.exchange,
        market:
          "market" in instrument && typeof instrument.market === "string"
            ? instrument.market
            : "us-stock",
        verifiedAt:
          "verifiedAt" in instrument &&
          typeof instrument.verifiedAt === "string"
            ? instrument.verifiedAt
            : new Date().toISOString(),
      });
    } catch (error) {
      failures.push({
        ticker: symbol,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const benchmarkSymbols =
    options.benchmark === "none"
      ? []
      : options.benchmark === "sector"
        ? Object.values(SECTOR_ETFS)
        : [options.benchmark];
  for (const ticker of [...new Set([...tickers, ...benchmarkSymbols])]) {
    try {
      await prices(ticker, from, to);
    } catch (error) {
      failures.push({
        ticker,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ...(await settlementSweep(to)), failures };
}
export { boardAsOf };
