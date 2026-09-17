/**
 * Manifest of every table column the UI shows, with the registry metric that
 * produces it. The CI test asserts each metricId exists in the registry, and
 * column headings read their hover text from that entry. Add a row here when a
 * column is added; the test fails until the registry can explain it.
 */
export type UiColumn = {
  /** Surface id: <page>.<table>. */
  surface: string;
  /** Column heading exactly as rendered. */
  column: string;
  metricId: string;
};
export const uiColumns: UiColumn[] = [
  // ResearchApp, Performance tab: "Creator performance versus SPY" per-channel table.
  { surface: "research.performance", column: "Channel", metricId: "channel.title" },
  { surface: "research.performance", column: "Priced calls", metricId: "calls.priced" },
  { surface: "research.performance", column: "Mean return", metricId: "calls.meanReturn" },
  { surface: "research.performance", column: "SPY", metricId: "calls.meanBenchmarkReturn" },
  { surface: "research.performance", column: "Excess", metricId: "calls.meanExcessReturn" },
  { surface: "research.performance", column: "Win rate", metricId: "calls.winRate" },
  // ResearchApp, Performance tab: the summary line above each saved calculation.
  { surface: "research.performance.summary", column: "priced", metricId: "calls.priced" },
  { surface: "research.performance.summary", column: "calls", metricId: "calls.count" },
  { surface: "research.performance.summary", column: "completed", metricId: "calls.completed" },
  { surface: "research.performance.summary", column: "ongoing", metricId: "calls.ongoing" },
];
