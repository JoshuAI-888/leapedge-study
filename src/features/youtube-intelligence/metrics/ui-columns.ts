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
];
