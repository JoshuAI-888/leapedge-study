/**
 * The channel page (spec 7.6, F66): the headline tiles for one creator,
 * assembled from the F56 query aggregates and the leaderboard's creator row.
 * Pure, so the wording (including "Too few settled calls to score") is tested
 * without a browser.
 */
export type SplitCounts = { bullish: number; neutral: number; bearish: number };
export type CreatorRecord = {
  n: number;
  medianExcess: number | null;
  q: number | null;
  status: "supported" | "negative" | "not-yet";
};
export type ChannelTile = { label: string; value: string; note: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;
function signedPercent(v: number) {
  const text = `${(Math.abs(v) * 100).toFixed(1)}%`;
  return v > 0 ? `+${text}` : v < 0 ? `−${text}` : text;
}

/** "84% bullish · usually bullish"; a lean needs a clear majority. */
export function leanText(split: SplitCounts) {
  const total = split.bullish + split.neutral + split.bearish;
  if (!total) return { share: null, text: "No calls yet" };
  const [top, n] = (Object.entries(split) as [keyof SplitCounts, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const share = n / total;
  const tied = Object.values(split).filter((v) => v === n).length > 1;
  const word = tied
    ? "mixed"
    : share >= 0.6
      ? `usually ${top}`
      : `leans ${top}`;
  return { share, text: tied ? `${pct(share)} ${top} · mixed` : `${pct(share)} ${top} · ${word}` };
}

/** The leaderboard's significance wording for one creator row. */
export function significanceText(record: CreatorRecord) {
  const q = record.q === null ? "q not measured" : `q=${record.q.toFixed(3)}`;
  const verdict =
    record.status === "supported"
      ? "significant, above the benchmark"
      : record.status === "negative"
        ? "significant, below the benchmark"
        : "not significant";
  return `n=${record.n} · ${q} · ${verdict}`;
}

/**
 * The four tiles: videos analysed (and in the last 7 days), calls (and per
 * video), lean, and the forward record against the team benchmark. Below the
 * leaderboard's minimum the record tile says so instead of a percentage.
 */
export function channelTiles(input: {
  videos: number;
  videosLast7: number;
  calls: number;
  split: SplitCounts;
  record: CreatorRecord | null;
  minimumSettled: number;
  benchmark: string;
  horizonDays: number;
}): ChannelTile[] {
  const lean = leanText(input.split);
  const settled = input.record?.n ?? 0;
  const scored =
    input.record !== null &&
    settled >= input.minimumSettled &&
    input.record.medianExcess !== null;
  return [
    {
      label: "Videos analysed",
      value: input.videos.toLocaleString("en-US"),
      note: `${input.videosLast7} in the last 7 days`,
    },
    {
      label: "Calls",
      value: input.calls.toLocaleString("en-US"),
      note: input.videos
        ? `${(input.calls / input.videos).toFixed(1)} per video`
        : "No videos analysed",
    },
    { label: "Lean", value: lean.text, note: "Share of this creator's calls" },
    {
      label: `Record vs ${input.benchmark}, ${input.horizonDays}d`,
      value: scored
        ? `${signedPercent(input.record!.medianExcess!)} median excess`
        : "Too few settled calls to score",
      note: scored
        ? significanceText(input.record!)
        : `(${settled} of ${input.minimumSettled})`,
    },
  ];
}

/** Live status: any of the channel's videos queued or being analysed. */
export function liveStatus(
  runs: { videoId: string; status: string }[],
  channelVideoIds: Set<string>,
) {
  const active = runs.filter(
    (r) =>
      channelVideoIds.has(r.videoId) &&
      (r.status === "queued" || r.status === "running"),
  );
  const running = active.filter((r) => r.status === "running").length;
  if (!active.length) return null;
  return running
    ? `Analysing ${running} video${running === 1 ? "" : "s"} now`
    : `${active.length} video${active.length === 1 ? "" : "s"} queued`;
}
