import type { MetricContext, MetricEntry } from "./registry.ts";
import type { UiColumn } from "./ui-columns.ts";
import { sentimentOf } from "../ui/foundations.ts";

/**
 * Registry entries for the followed-channels table on the Channels page
 * (F67). Kept in their own module and spread into the registry, so the
 * definitions sit next to each other; the figures themselves are computed by
 * server/youtube-intelligence/channel-stats.ts from stored rows.
 */
const RUNS = "yi_runs";
const DISCOVERIES = "yi_discoveries";
const byChannel = (ctx: MetricContext) => {
  const out: Record<string, { bullish: number; neutral: number; bearish: number }> = {};
  for (const c of ctx.claims) {
    const row = (out[c.channel] ??= { bullish: 0, neutral: 0, bearish: 0 });
    row[sentimentOf(c.stance)]++;
  }
  return Object.entries(out).map(([channel, split]) => ({ channel, ...split }));
};

export const channelListMetrics: MetricEntry[] = [
  {
    id: "channels.channel",
    label: "Channel",
    definition:
      "A YouTube channel the team follows, by its title and handle.",
    steps: [
      "List channels whose discovery switch is on (followed); catalogue rows nobody followed are left out.",
      "Show the stored title and handle; the row opens the channel page.",
    ],
    inputs: [{ table: "channels", columns: ["id", "title", "handle", "active"] }],
    settingsUsed: [],
    implementation: (ctx) => [...new Set(ctx.claims.map((c) => c.channel))],
  },
  {
    id: "channels.status",
    label: "Status",
    definition:
      "Whether the channel has a video being analysed now, is idle, or has not uploaded for at least 14 days.",
    steps: [
      "Analysing: at least one of the channel's videos has a queued or running analysis.",
      "Otherwise silent: the newest known upload, discovered or analysed, is 14 or more days old.",
      "Otherwise idle, including when no upload has been discovered yet.",
    ],
    inputs: [
      { table: RUNS, columns: ["status", "video_id", "input.task"] },
      { table: DISCOVERIES, columns: ["channel_id", "payload.publishedAt"] },
      { table: "claims", columns: ["channel_id", "published_at"] },
    ],
    settingsUsed: [],
    implementation: () => null,
  },
  {
    id: "channels.lastVideo",
    label: "Last video",
    definition:
      "How long ago the newest completed analysis of one of this channel's videos was made.",
    steps: [
      "Take completed video analyses (not research jobs) tied to the channel by their calls, discovery row or metadata.",
      "Show the age of the newest one's creation time.",
    ],
    inputs: [{ table: RUNS, columns: ["created_at", "status", "video_id"] }],
    settingsUsed: [],
    implementation: () => null,
  },
  {
    id: "channels.videos7d",
    label: "7 days",
    definition:
      "The number of distinct videos from this channel analysed in the last seven days.",
    steps: [
      "Take completed video analyses of the channel created in the last seven days.",
      "Count distinct videos, so a re-analysed video counts once.",
    ],
    inputs: [{ table: RUNS, columns: ["created_at", "status", "video_id"] }],
    settingsUsed: [],
    implementation: () => null,
  },
  {
    id: "channels.top",
    label: "Top",
    definition:
      "The instrument this channel made the most calls on in the last 30 days.",
    steps: [
      "Take calls from the canonical analysis of each video, published in the last 30 days.",
      "Group by ticker, or by the spoken instrument when there is no ticker, and pick the largest group; ties go to the alphabetically first.",
    ],
    inputs: [
      { table: "claims", columns: ["channel_id", "ticker", "instrument", "published_at"] },
    ],
    settingsUsed: [],
    implementation: (ctx) => {
      const counts = new Map<string, number>();
      for (const c of ctx.claims)
        if (c.ticker) counts.set(c.ticker, (counts.get(c.ticker) ?? 0) + 1);
      return (
        [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
        null
      );
    },
  },
  {
    id: "channels.lean",
    label: "Lean",
    definition:
      "This channel's calls from the last 30 days split into bullish, neutral and bearish by their stance.",
    steps: [
      "Take calls from the canonical analysis of each video, published in the last 30 days.",
      "Grade each stance: long is bullish; short and avoid are bearish; neutral, watch, hold and conditional are neutral.",
      "Count each sentiment; the bar shows the counts with ▲ ● ▼ beside it.",
    ],
    inputs: [{ table: "claims", columns: ["channel_id", "stance", "published_at"] }],
    settingsUsed: [],
    implementation: (ctx) => byChannel(ctx),
  },
  {
    id: "channels.record",
    label: "Record",
    definition:
      "The median excess return of this channel's settled calls against your benchmark, from the leaderboard's creator row.",
    steps: [
      "Read the channel's creator row from the leaderboard for your benchmark and horizon on the forward record.",
      "Show the median excess and the number of settled calls, and say not significant when the false-discovery test has not passed.",
      "Below the leaderboard minimum of settled calls, show how many there are instead of a figure.",
    ],
    inputs: [
      { table: "settlements", columns: ["claim_id", "return_pct", "status"] },
      { table: "prices", columns: ["ticker", "date", "adjusted_close"] },
    ],
    settingsUsed: [
      "accountDefaults.benchmark",
      "accountDefaults.defaultHorizonDays",
      "leaderboard.minSettledForRank",
    ],
    implementation: (ctx) => ctx.board?.medianExcess ?? null,
  },
];

export const channelListColumns: UiColumn[] = channelListMetrics.map((m) => ({
  surface: "channels.followed",
  column: m.label,
  metricId: m.id,
}));
