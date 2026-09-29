import { z } from "zod";
import { performance } from "../market.ts";
import { priceSeries } from "../repos/prices.ts";
import { writes, reads, nothing, type ActionTable } from "./types.ts";
import {
  loadBoardSnapshot,
  RefreshBoardInput,
  refreshBoardData,
} from "../leaderboard.ts";
/** F65: one ticker's stored adjusted closes for the Trends price chart. */
export const PriceSeriesInput = z.preprocess(
  (v) => v ?? {},
  z.strictObject({
    ticker: z.string().trim().min(1).max(40).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  }),
);
async function loadPriceSeries(input: z.output<typeof PriceSeriesInput>) {
  if (!input.ticker) return { ticker: null, prices: [] };
  const rows = await priceSeries(
    input.ticker.toUpperCase(),
    input.from ?? "1900-01-01",
    input.to ?? "9999-12-31",
  );
  return {
    ticker: input.ticker.toUpperCase(),
    prices: rows.map((r) => ({ date: r.date, close: r.adjustedClose })),
  };
}
export const market: ActionTable = {
  priceSeries: reads(PriceSeriesInput, loadPriceSeries),
  boardSnapshot: reads(nothing, loadBoardSnapshot),
  refreshBoardData: writes(RefreshBoardInput, refreshBoardData),
  performance: writes(z.enum(["leapedge", "forward", "historical"]), (mode) =>
    performance(mode),
  ),
};
