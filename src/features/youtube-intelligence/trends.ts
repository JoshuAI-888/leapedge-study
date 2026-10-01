import type { CheckedClaim, Run } from "./contracts.ts";
export type ResearchCall = { run: Run; item: CheckedClaim };
export function trendSummary(calls: ResearchCall[]) {
  const count = (key: (c: ResearchCall) => string) =>
    Object.entries(Object.groupBy(calls, key))
      .map(([label, rows]) => ({ label, count: rows!.length }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    directions: count((c) => c.item.claim.stance),
    conviction: count((c) => c.item.claim.creator_conviction),
    tickers: count(
      (c) =>
        c.item.claim.ticker ||
        c.item.claim.instrument_as_spoken ||
        "Unresolved",
    ),
    days: count((c) => c.run.createdAt.slice(0, 10)).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    videos: new Set(calls.map((c) => c.run.videoId)).size,
    channels: new Set(
      calls.map((c) =>
        String(
          (c.run.output.metadata as { channelId?: string; channel?: string })
            ?.channelId ||
            (c.run.output.metadata as { channel?: string })?.channel,
        ),
      ),
    ).size,
  };
}
export function directionChanges(calls: ResearchCall[]) {
  const groups = Object.groupBy(
    calls,
    (c) =>
      `${(c.run.output.metadata as { channelId?: string; channel?: string })?.channelId || (c.run.output.metadata as { channel?: string })?.channel}:${c.item.claim.ticker || c.item.claim.instrument_as_spoken || "unresolved"}`,
  );
  const result: {
    previous: ResearchCall;
    current: ResearchCall;
    label: string;
  }[] = [];
  for (const rows of Object.values(groups)) {
    const ordered = rows!
      .slice()
      .sort(
        (a, b) =>
          a.run.createdAt.localeCompare(b.run.createdAt) ||
          a.item.id.localeCompare(b.item.id),
      );
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1],
        current = ordered[i];
      if (
        previous.run.videoId === current.run.videoId ||
        previous.item.claim.stance === current.item.claim.stance
      )
        continue;
      result.push({
        previous,
        current,
        label:
          current.item.claim.horizon_en === previous.item.claim.horizon_en
            ? "Direction changed; verify conditions"
            : "Direction and horizon differ; not necessarily a reversal",
      });
    }
  }
  return result.sort((a, b) =>
    b.current.run.createdAt.localeCompare(a.current.run.createdAt),
  );
}
