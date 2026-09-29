/**
 * Manifest of every table column the UI shows, with the registry metric that
 * produces it. The CI test asserts each metricId exists in the registry, and
 * column headings read their hover text from that entry. Add a row here when a
 * column is added; the test fails until the registry can explain it.
 */
import { channelListColumns } from "./channel-columns.ts";
export type UiColumn = {
  /** Surface id: <page>.<table>. */
  surface: string;
  /** Column heading exactly as rendered. */
  column: string;
  metricId: string;
};
export const uiColumns: UiColumn[] = [
  ...channelListColumns,
  { surface: "today.calls", column: "Creators", metricId: "today.creators" },
  {
    surface: "today.calls",
    column: "Instrument",
    metricId: "today.instrument",
  },
  { surface: "today.calls", column: "Stance", metricId: "today.stance" },
  {
    surface: "today.calls",
    column: "Thesis & conditions",
    metricId: "today.thesis",
  },
  { surface: "today.calls", column: "Trust", metricId: "today.trust" },
  { surface: "today.calls", column: "Levels", metricId: "today.levels" },
  { surface: "standalone.ticker", column: "Ticker", metricId: "ticker.symbol" },
  {
    surface: "standalone.ticker",
    column: "Sentiment shift",
    metricId: "sentiment.direction",
  },
  {
    surface: "standalone.ticker",
    column: "Consensus now",
    metricId: "ticker.consensus",
  },
  {
    surface: "standalone.ticker",
    column: "Creators",
    metricId: "ticker.creators",
  },
  {
    surface: "standalone.ticker",
    column: "Settled calls",
    metricId: "board.settledCount",
  },
  {
    surface: "standalone.ticker",
    column: "Median excess",
    metricId: "board.medianExcess",
  },
  {
    surface: "standalone.ticker",
    column: "Most reliable creator",
    metricId: "ticker.reliableCreator",
  },
  { surface: "standalone.creator", column: "Name", metricId: "board.label" },
  { surface: "standalone.creator", column: "Rank", metricId: "board.rank" },
  {
    surface: "standalone.creator",
    column: "Settled calls",
    metricId: "board.settledCount",
  },
  {
    surface: "standalone.creator",
    column: "Win rate",
    metricId: "board.winRate",
  },
  {
    surface: "standalone.creator",
    column: "Median excess",
    metricId: "board.medianExcess",
  },
  {
    surface: "standalone.creator",
    column: "Evidence",
    metricId: "board.status",
  },
  // F73: Processing details, one row per model call.
  ...(
    [
      ["Step", "usage.step"],
      ["Model", "usage.model"],
      ["Input tokens", "usage.inputTokens"],
      ["Cached", "usage.cachedTokens"],
      ["Output tokens", "usage.outputTokens"],
      ["Time", "usage.seconds"],
      ["Cost", "usage.costUsd"],
    ] as const
  ).map(([column, metricId]) => ({
    surface: "analysis.modelCalls",
    column,
    metricId,
  })),
  // F73: Lab cost diagnostics, the same columns per step.
  ...(
    [
      ["Step", "usage.step"],
      ["Calls", "usage.calls"],
      ["Analyses", "usage.runs"],
      ["Input tokens", "usage.inputTokens"],
      ["Cached", "usage.cachedTokens"],
      ["Output tokens", "usage.outputTokens"],
      ["Time", "usage.seconds"],
      ["Cost", "usage.costUsd"],
      ["Cost per analysis", "usage.costPerRun"],
    ] as const
  ).map(([column, metricId]) => ({
    surface: "lab.stepUsage",
    column,
    metricId,
  })),
];
