export type Price = { date: string; close: number };
export type PriceSeries = {
  symbol: string;
  provider: string;
  adjustment: string;
  fetchedAt: string;
  prices: Price[];
};
export type PerformanceCall = {
  id: string;
  ticker: string;
  channel: string;
  stance: string;
  conviction: string;
  analysisAt: string;
  publishedAt?: string;
  sourceHash?: string;
};
export function scoreCall(
  call: PerformanceCall,
  stock: PriceSeries,
  spy: PriceSeries,
  asOf: string,
  mode: "leapedge" | "forward" | "historical" = "leapedge",
  horizon = 90,
) {
  const valid = (s: PriceSeries) =>
    s.prices
      .filter(
        (p) =>
          /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
          Number.isFinite(p.close) &&
          p.close > 0,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  if (
    !["long", "short"].includes(call.stance) ||
    !["medium", "high"].includes(call.conviction)
  )
    return {
      id: call.id,
      status: "ineligible",
      reason: "Only medium/high conviction long/short calls qualify.",
    };
  if (
    stock.symbol !== call.ticker ||
    spy.symbol !== "SPY" ||
    stock.provider !== spy.provider ||
    stock.adjustment !== spy.adjustment
  )
    throw Error("Price identities, providers and adjustment bases must match.");
  const day = call.analysisAt.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(call.analysisAt))
  )
    throw Error("Invalid analysis date.");
  const s = valid(stock),
    b = valid(spy),
    shared = s.filter(
      (p) => b.some((q) => q.date === p.date) && p.date <= asOf,
    );
  // LeapEdge holiday rule is unpublished: explicit adapter uses first common session on/after analysis day.
  // Forward policy waits until the next common session after the UTC analysis date, avoiding same-day close look-ahead.
  const entry = shared.find((p) =>
    mode === "forward" ? p.date > day : p.date >= day,
  );
  if (!entry)
    return {
      id: call.id,
      status: "unpriced",
      reason: "No common entry session is available.",
    };
  const target = new Date(Date.parse(day + "T00:00:00Z") + horizon * 86400000)
    .toISOString()
    .slice(0, 10);
  const exit = shared
    .filter(
      (p) => p.date >= entry.date && p.date <= (target < asOf ? target : asOf),
    )
    .at(-1);
  if (!exit)
    return {
      id: call.id,
      status: "unpriced",
      reason: "No common exit session is available.",
    };
  const valuationDay = target < asOf ? target : asOf;
  const benchmarkLast = b.filter((p) => p.date <= valuationDay).at(-1);
  const lag = benchmarkLast
    ? (Date.parse(valuationDay) - Date.parse(benchmarkLast.date)) / 86400000
    : Infinity;
  if (!benchmarkLast || benchmarkLast.date !== exit.date || lag > 7)
    return {
      id: call.id,
      status: "stale",
      reason:
        "A current matching stock/SPY exit session is unavailable; excluded from return averages.",
    };
  const be = b.find((p) => p.date === entry.date)!,
    bx = b.find((p) => p.date === exit.date)!;
  const stockReturn =
      (exit.close / entry.close - 1) * (call.stance === "short" ? -1 : 1),
    spyReturn = bx.close / be.close - 1;
  return {
    id: call.id,
    channel: call.channel,
    ticker: call.ticker,
    stance: call.stance,
    status: asOf >= target ? "completed" : "ongoing",
    entryDate: entry.date,
    exitDate: exit.date,
    targetDate: target,
    entryPrice: entry.close,
    exitPrice: exit.close,
    spyEntry: be.close,
    spyExit: bx.close,
    stockReturn,
    spyReturn,
    excessReturn: stockReturn - spyReturn,
    win: stockReturn > 0,
    beatsSpy: stockReturn > spyReturn,
    provider: stock.provider,
    adjustment: stock.adjustment,
    asOf,
    mode,
  };
}
export function summarizeScores(rows: ReturnType<typeof scoreCall>[]) {
  const priced = rows.filter(
    (r) => "stockReturn" in r && typeof r.stockReturn === "number",
  );
  const mean = (key: "stockReturn" | "spyReturn" | "excessReturn") =>
    priced.length
      ? priced.reduce((s, r) => s + (r[key] ?? 0), 0) / priced.length
      : null;
  return {
    total: rows.length,
    priced: priced.length,
    completed: priced.filter((r) => r.status === "completed").length,
    ongoing: priced.filter((r) => r.status === "ongoing").length,
    stale: rows.filter((r) => r.status === "stale").length,
    meanReturn: mean("stockReturn"),
    meanSpy: mean("spyReturn"),
    meanExcess: mean("excessReturn"),
    winRate: priced.length
      ? priced.filter((r) => r.win).length / priced.length
      : null,
    beatsSpyRate: priced.length
      ? priced.filter((r) => r.beatsSpy).length / priced.length
      : null,
  };
}
