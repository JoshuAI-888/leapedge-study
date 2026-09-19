import { resolveListing } from "../identity.ts";
export const trustNames: Record<string, string> = {
  L0: "Extracted",
  L1: "Text-checked",
  L2: "Audio-agreed",
  L3: "Human-verified",
};
export function processingState(status: string) {
  return (
    (
      { queued: "Queued", running: "Analysing", completed: "Ready" } as Record<
        string,
        string
      >
    )[status] ?? "Needs review"
  );
}
export function visibleClaims<
  T extends {
    id: string;
    trustLevel: string;
    creatorConviction: string;
    ticker: string | null;
    instrument?: string | null;
    thesisEn: string;
  },
>(rows: T[], search = "", minimum = "L2"): T[] {
  const rank = (v: string) => Number(v.slice(1)) || 0;
  const conviction: Record<string, number> = {
    high: 3,
    medium: 2,
    low: 1,
    unspecified: 0,
  };
  return rows
    .filter(
      (c) =>
        rank(c.trustLevel) >= rank(minimum) &&
        `${c.ticker ?? ""} ${c.instrument ?? ""} ${resolveListing(c.instrument ?? null, c.ticker)?.ticker ?? ""} ${c.thesisEn}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        rank(b.trustLevel) - rank(a.trustLevel) ||
        (conviction[b.creatorConviction] ?? 0) -
          (conviction[a.creatorConviction] ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
export function localClaimId(id: string, runId: string) {
  return id.startsWith(`${runId}:`) ? id.slice(runId.length + 1) : id;
}
export function csv(headers: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
export const money = (n: number | null | undefined) =>
  n == null
    ? "Not measured"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(n);
export const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;
export const dateLabel = (value: string | null | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Date unavailable";
export function sortTickerRows<
  T extends {
    id: string;
    label: string;
    consensus: string;
    creators: number;
    n: number;
    medianExcess: number | null;
    mostReliableCreator: { winRate: number | null; n: number } | null;
  },
>(
  rows: T[],
  key: string,
  descending: boolean,
  sentiments: ReadonlyMap<string, string>,
): T[] {
  const stance: Record<string, number> = {
    bullish: 1,
    unchanged: 0,
    bearish: -1,
  };
  const value = (row: T): string | number | null =>
    key === "label"
      ? row.label
      : key === "sentiment"
        ? (stance[sentiments.get(row.id) ?? ""] ?? null)
        : key === "consensus"
          ? row.consensus
          : key === "creators"
            ? row.creators
            : key === "n"
              ? row.n
              : key === "reliable"
                ? row.mostReliableCreator && row.mostReliableCreator.n >= 10
                  ? row.mostReliableCreator.winRate
                  : null
                : row.medianExcess;
  return [...rows].sort((a, b) => {
    const left = value(a),
      right = value(b);
    if (left === null && right === null) return a.id.localeCompare(b.id);
    if (left === null) return 1;
    if (right === null) return -1;
    return (
      (typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right)) * (descending ? -1 : 1) ||
      a.id.localeCompare(b.id)
    );
  });
}

/** Latest dated stance per known creator and ticker, never a count of repeated claims. */
export function creatorStances(
  rows: {
    id: string;
    ticker: string | null;
    channelId: string | null;
    stance: string;
    publishedAt: string | null;
    trustBasis: unknown;
  }[],
) {
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of [...rows].sort(
    (a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
      a.id.localeCompare(b.id),
  )) {
    const rejected =
      row.trustBasis &&
      typeof row.trustBasis === "object" &&
      "latestReviewVerdict" in row.trustBasis &&
      row.trustBasis.latestReviewVerdict === "rejected";
    if (!row.channelId || !row.ticker || !row.publishedAt || rejected) continue;
    const key = JSON.stringify([row.ticker, row.channelId]);
    if (!latest.has(key)) latest.set(key, row);
  }
  const tickers = new Map<
    string,
    { ticker: string; creators: number; stances: Record<string, number> }
  >();
  for (const row of latest.values()) {
    const ticker = row.ticker!;
    const summary = tickers.get(ticker) ?? { ticker, creators: 0, stances: {} };
    summary.creators++;
    summary.stances[row.stance] = (summary.stances[row.stance] ?? 0) + 1;
    tickers.set(ticker, summary);
  }
  return [...tickers.values()].sort(
    (a, b) => b.creators - a.creators || a.ticker.localeCompare(b.ticker),
  );
}
