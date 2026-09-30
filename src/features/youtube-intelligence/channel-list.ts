/**
 * The followed-channels table (F67): the row shape the server computes
 * (server/youtube-intelligence/channel-stats.ts) and the pure helpers the
 * Channels page sorts, filters and labels it with. No React and no database,
 * so node:test covers it and client components may import it.
 */
import type { SentimentSplit } from "./ui/foundations.ts";

/** A channel with no upload for this many days is flagged as silent. */
export const SILENT_AFTER_DAYS = 14;
/** Top instrument and lean look back this far. */
export const LEAN_WINDOW_DAYS = 30;
/** "7 days" column window. */
export const ACTIVITY_WINDOW_DAYS = 7;

export type ChannelStatus = "analysing" | "idle" | "silent";
export type ChannelStat = {
  channelId: string;
  title: string;
  handle: string;
  followedAt: string | null;
  favorite: boolean;
  /** Analysing while a video of the channel is queued or running. */
  status: ChannelStatus;
  /** Queued or running video analyses for this channel. */
  activeRuns: number;
  /** Newest known upload, from discovered uploads and analysed videos. */
  lastUploadAt: string | null;
  /** Whole days since that upload; null when no upload is known. */
  silentDays: number | null;
  /** When the newest completed analysis of this channel's videos was made. */
  lastAnalysedAt: string | null;
  lastRunId: string | null;
  /** Distinct videos analysed in the last seven days. */
  videos7d: number;
  /** Calls from canonical analyses published in the last 30 days. */
  calls30d: number;
  topInstrument: { ticker: string | null; instrument: string | null; calls: number } | null;
  /** Those calls by sentiment. */
  lean: SentimentSplit;
};
/** What the leaderboard knows about a creator (BoardRow, reduced). */
export type ChannelRecord = {
  n: number;
  medianExcess: number | null;
  status: string;
};

export const CHANNEL_SORTS = [
  "active",
  "added",
  "record",
  "channel",
  "status",
  "last",
  "week",
  "top",
  "lean",
] as const;
export type ChannelSort = (typeof CHANNEL_SORTS)[number];
export const SORT_PRESETS: { id: ChannelSort; label: string }[] = [
  { id: "active", label: "Most active" },
  { id: "added", label: "Recently added" },
  { id: "record", label: "Best record" },
];
/** Column heading id (metrics registry, `channels.<key>`) to the sort it applies. */
export const CHANNEL_COLUMNS = [
  { key: "channel", sort: "channel" },
  { key: "status", sort: "status" },
  { key: "lastVideo", sort: "last" },
  { key: "videos7d", sort: "week" },
  { key: "top", sort: "top" },
  { key: "lean", sort: "lean" },
  { key: "record", sort: "record" },
] as const satisfies readonly { key: string; sort: ChannelSort }[];

const time = (value: string | null | undefined) => {
  const t = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};
const STATUS_ORDER: Record<ChannelStatus, number> = {
  analysing: 0,
  idle: 1,
  silent: 2,
};
const leanScore = (s: ChannelStat) => {
  const total = s.lean.bullish + s.lean.neutral + s.lean.bearish;
  return total ? (s.lean.bullish - s.lean.bearish) / total : null;
};
const TEXT_SORTS: readonly ChannelSort[] = ["channel", "top", "status"];
/** The direction a sort reads in when none is chosen: A→Z for text, largest first for figures. */
export function naturalDirection(sort: ChannelSort): "asc" | "desc" {
  return TEXT_SORTS.includes(sort) ? "asc" : "desc";
}

/**
 * Sorted copy. Presets have a natural direction (most active, newest follow,
 * best median excess first); `direction` overrides it for a column sort.
 * Unknown values (no record, never analysed) sort last either way, and ties
 * fall back to the channel name.
 */
export function sortChannels(
  rows: ChannelStat[],
  sort: ChannelSort,
  records: Map<string, ChannelRecord>,
  direction: "asc" | "desc" = naturalDirection(sort),
): ChannelStat[] {
  const key = (s: ChannelStat): number | string | null => {
    switch (sort) {
      case "active":
      case "week":
        return s.videos7d;
      case "added":
        return time(s.followedAt);
      case "record":
        return records.get(s.channelId)?.medianExcess ?? null;
      case "channel":
        return (s.title || s.handle || s.channelId).toLowerCase();
      case "status":
        return STATUS_ORDER[s.status];
      case "last":
        return time(s.lastAnalysedAt);
      case "top":
        return s.topInstrument
          ? (s.topInstrument.ticker ?? s.topInstrument.instrument ?? "").toLowerCase() || null
          : null;
      case "lean":
        return leanScore(s);
    }
  };
  const sign = direction === "asc" ? 1 : -1;
  const name = (s: ChannelStat) => (s.title || s.handle || s.channelId).toLowerCase();
  return [...rows].sort((a, b) => {
    const x = key(a),
      y = key(b);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      const c =
        typeof x === "string" && typeof y === "string"
          ? x.localeCompare(y)
          : Number(x) - Number(y);
      if (c) return sign * c;
    }
    if (sort === "active") {
      const ta = time(a.lastAnalysedAt) ?? -Infinity,
        tb = time(b.lastAnalysedAt) ?? -Infinity;
      if (ta !== tb) return tb - ta;
    }
    return name(a).localeCompare(name(b));
  });
}

/** Name, handle or top instrument contains the text, case-insensitively. */
export function filterChannels(rows: ChannelStat[], text: string) {
  const needle = text.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((s) =>
    [
      s.title,
      s.handle,
      s.topInstrument?.ticker ?? "",
      s.topInstrument?.instrument ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

/** The status chip: text first, tone as a second cue. */
export function channelStatusLabel(s: ChannelStat): {
  label: string;
  tone: "live" | "idle" | "warn";
  title: string;
} {
  if (s.status === "analysing")
    return {
      label: s.activeRuns > 1 ? `Analysing ${s.activeRuns}` : "Analysing",
      tone: "live",
      title: `${s.activeRuns} ${s.activeRuns === 1 ? "video is" : "videos are"} queued or being analysed now.`,
    };
  if (s.status === "silent")
    return {
      label: `No uploads ${s.silentDays} d`,
      tone: "warn",
      title: `No new upload found for ${s.silentDays} days. Consider whether to keep following this channel.`,
    };
  return {
    label: "Idle",
    tone: "idle",
    title:
      s.lastUploadAt === null
        ? "Nothing is being analysed. No uploads have been discovered yet."
        : "Nothing is being analysed now.",
  };
}

/** "4 h ago", "2 d ago", "Under 1 h ago"; "—" when unknown. */
export function relativeAge(value: string | null, now: string) {
  const at = time(value),
    end = time(now);
  if (at === null || end === null) return "—";
  const hours = Math.floor(Math.max(0, end - at) / 3_600_000);
  if (hours < 1) return "Under 1 h ago";
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * The record against the team benchmark in the leaderboard's own words: a
 * median excess with its sample, "not significant" when it has not cleared
 * the false-discovery test, and the minimum when there are too few.
 */
export function recordLabel(record: ChannelRecord | undefined, minimum = 20) {
  if (!record || record.n === 0) return "No settled calls";
  if (record.n < minimum)
    return `Too few settled calls (${record.n} of ${minimum})`;
  const m = record.medianExcess;
  const value =
    m === null
      ? "—"
      : `${m > 0 ? "+" : m < 0 ? "−" : ""}${Math.abs(m * 100).toFixed(1)}%`;
  return `${value} · n=${record.n}${record.status === "not-yet" ? " · not significant" : ""}`;
}
