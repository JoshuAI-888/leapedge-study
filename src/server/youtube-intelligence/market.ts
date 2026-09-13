import { createHash } from "node:crypto";
import { z } from "zod";
import { doc, docs, put, canonicalRuns, accepted } from "./research-store.ts";
import {
  scoreCall,
  summarizeScores,
  type PriceSeries,
  type PerformanceCall,
} from "../../features/youtube-intelligence/performance.ts";
export async function resolveInstrument(symbol: string) {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))
    throw Error(
      "Unresolved or non-equity symbol; explicit instrument mapping required.",
    );
  const old = await doc<{ symbol: string; currency: string; exchange: string }>(
    "instrument",
    symbol,
  );
  if (old) return old;
  if (!process.env.FMP_API_KEY) throw Error("FMP key is not configured.");
  const url = new URL("https://financialmodelingprep.com/stable/profile");
  url.search = new URLSearchParams({
    symbol,
    apikey: process.env.FMP_API_KEY,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch {
    throw Error("Instrument lookup failed.");
  }
  if (!response.ok) throw Error(`Instrument lookup HTTP ${response.status}.`);
  const rows = await response.json();
  const p = Array.isArray(rows) ? rows.find((p) => p.symbol === symbol) : null;
  if (
    !p ||
    p.currency !== "USD" ||
    !["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "NYSE AMERICAN", "CBOE"].includes(
      String(p.exchangeShortName || p.exchange).toUpperCase(),
    )
  )
    throw Error(
      "Instrument is not verified as a US-listed USD security; excluded from SPY comparison.",
    );
  const result = {
    symbol,
    currency: p.currency,
    exchange: p.exchangeShortName || p.exchange,
    name: p.companyName,
    verifiedAt: new Date().toISOString(),
  };
  await put("instrument", symbol, result);
  return result;
}
export async function prices(
  symbol: string,
  from: string,
  to: string,
): Promise<PriceSeries> {
  if (
    !/^[A-Z0-9.^=-]{1,20}$/.test(symbol) ||
    ![from, to].every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
  )
    throw Error("Invalid price request.");
  const id = `fmp:${symbol}:${from}:${to}`,
    cached = await doc<PriceSeries>("prices", id);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 86400000)
    return cached;
  if (!process.env.FMP_API_KEY) throw Error("FMP key is not configured.");
  const u = new URL(
    "https://financialmodelingprep.com/stable/historical-price-eod/dividend-adjusted",
  );
  u.search = new URLSearchParams({
    symbol,
    from,
    to,
    apikey: process.env.FMP_API_KEY,
  }).toString();
  let r: Response;
  try {
    r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  } catch {
    throw Error("FMP network request failed.");
  }
  if (!r.ok) throw Error(`FMP historical data HTTP ${r.status}.`);
  const data = z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adjClose: z.number().positive(),
      }),
    )
    .parse(await r.json());
  if (!data.length) throw Error(`No adjusted prices available for ${symbol}.`);
  const value = {
    symbol,
    provider: "FMP",
    adjustment: "dividend-adjusted endpoint",
    fetchedAt: new Date().toISOString(),
    prices: data.map((p) => ({ date: p.date, close: p.adjClose })),
  };
  await put("prices", id, value);
  await put(
    "priceSnapshot",
    createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    value,
  );
  return value;
}
export async function performance(
  mode: "leapedge" | "forward" | "historical",
  asOf = new Date().toISOString().slice(0, 10),
) {
  const current = await canonicalRuns();
  const observed = await docs<{
    observedAt: string;
    run: import("../../features/youtube-intelligence/contracts.ts").Run;
  }>("forwardObservation");
  const inputs =
    mode === "forward"
      ? observed.map((o) => ({ ...o.run, createdAt: o.observedAt }))
      : mode === "historical"
        ? current.map((r) => ({
            ...r,
            createdAt: String(
              (r.output.metadata as { publishedAt?: string })?.publishedAt ||
                r.createdAt,
            ),
          }))
        : current;
  const calls: PerformanceCall[] = inputs.flatMap((r) =>
    accepted(r)
      .filter((c) => c.claim.ticker)
      .map((c) => ({
        id: `${r.id}:${c.id}`,
        ticker: c.claim.ticker!.toUpperCase(),
        channel: String(
          (
            r.output.metadata as {
              channel?: string;
            }
          )?.channel || "Unknown",
        ),
        stance: c.claim.stance,
        conviction: c.claim.creator_conviction,
        analysisAt: r.createdAt,
        sourceHash: String(r.output.sourceHash || ""),
      })),
  );
  const rows: ReturnType<typeof scoreCall>[] = [];
  for (const c of calls) {
    if (
      !["long", "short"].includes(c.stance) ||
      !["medium", "high"].includes(c.conviction)
    ) {
      rows.push({
        id: c.id,
        status: "ineligible",
        reason: "Only medium/high long/short calls qualify.",
      });
      continue;
    }
    try {
      await resolveInstrument(c.ticker);
      const from = c.analysisAt.slice(0, 10),
        stock = await prices(c.ticker, from, asOf),
        spy = await prices("SPY", from, asOf);
      rows.push(scoreCall(c, stock, spy, asOf, mode));
    } catch (e) {
      rows.push({
        id: c.id,
        status: "unpriced",
        reason: e instanceof Error ? e.message : "Price failure",
      });
    }
  }
  const result = {
    id: crypto.randomUUID(),
    asOf,
    mode,
    createdAt: new Date().toISOString(),
    summary: summarizeScores(rows),
    rows,
    channels: [...new Set(calls.map((c) => c.channel))].map((channel) => ({
      channel,
      ...summarizeScores(
        rows.filter(
          (r) => calls.find((c) => c.id === r.id)?.channel === channel,
        ),
      ),
    })),
    limitations: [
      "Retrospective analyses are not contemporaneous historical recommendations.",
      ...(mode === "historical"
        ? [
            "Historical replay uses publication dates with today’s extraction. It is a retrospective backtest, not a forward record, and may contain hindsight bias.",
          ]
        : []),
      "LeapEdge exact holiday mapping is unpublished; first common session on/after analysis day is our explicit comparison rule.",
      "Forward mode enters the next common session after the UTC analysis day.",
      "FMP prices may differ from LeapEdge Yahoo Finance snapshots.",
      mode === "forward"
        ? "Forward calls are frozen from the first observation of each video in the collection; later prompt changes cannot replace them."
        : "Selected collection analysis per video; versioned retrospective comparison, not portfolio return.",
    ],
  };
  await put("performance", result.id, result);
  return result;
}
