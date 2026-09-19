import type { MentionRow } from "../../../server/youtube-intelligence/repos/mentions.ts";
export type SentimentBucket = { mentions: number; creators: number };
export type SentimentCounts = Record<
  "bullish" | "neutral" | "bearish",
  SentimentBucket
>;
const empty = (): SentimentCounts => ({
  bullish: { mentions: 0, creators: 0 },
  neutral: { mentions: 0, creators: 0 },
  bearish: { mentions: 0, creators: 0 },
});
export function sentimentShift(
  mentions: MentionRow[],
  options: {
    asOf: string;
    periodDays: number;
    minimumTrust?: string;
    callsOnly?: boolean;
  },
) {
  const end = Date.parse(
      options.asOf.length === 10
        ? `${options.asOf}T23:59:59.999Z`
        : options.asOf,
    ),
    span = options.periodDays * 86400000;
  if (!Number.isFinite(end) || !(span > 0))
    throw Error("Choose a valid sentiment date and period.");
  const eligible = mentions.filter(
    (m) =>
      m.ticker &&
      m.publishedAt &&
      Date.parse(m.publishedAt) <= end &&
      Date.parse(m.publishedAt) > end - 2 * span &&
      m.trustLevel >= (options.minimumTrust ?? "L1") &&
      (!options.callsOnly || m.isCall),
  );
  return [...new Set(eligible.map((m) => m.ticker!))].sort().map((ticker) => {
    const rows = eligible.filter((m) => m.ticker === ticker);
    const counts = (recent: boolean) => {
      const selected = rows.filter(
        (m) => Date.parse(m.publishedAt!) > end - span === recent,
      );
      const result = empty();
      for (const sentiment of ["bullish", "neutral", "bearish"] as const) {
        result[sentiment].mentions = selected.filter(
          (m) => m.sentiment === sentiment,
        ).length;
        // A creator contributes their latest stance once per period, even if they mention a ticker repeatedly.
        const latest = new Map<string, MentionRow>();
        for (const m of [...selected].sort(
          (a, b) =>
            a.publishedAt!.localeCompare(b.publishedAt!) ||
            a.id.localeCompare(b.id),
        ))
          if (m.channelId) latest.set(m.channelId, m);
        result[sentiment].creators = [...latest.values()].filter(
          (m) => m.sentiment === sentiment,
        ).length;
      }
      return result;
    };
    const current = counts(true),
      previous = counts(false),
      delta = empty();
    for (const s of ["bullish", "neutral", "bearish"] as const)
      delta[s] = {
        mentions: current[s].mentions - previous[s].mentions,
        creators: current[s].creators - previous[s].creators,
      };
    const net = delta.bullish.creators - delta.bearish.creators;
    return {
      ticker,
      current,
      previous,
      delta,
      direction:
        net > 0
          ? ("bullish" as const)
          : net < 0
            ? ("bearish" as const)
            : ("unchanged" as const),
      mentionIds: rows.map((m) => m.id),
    };
  });
}
