import { z } from "zod";
import { performance } from "../market.ts";
import { writes, reads, nothing, type ActionTable } from "./types.ts";
import {
  loadBoardSnapshot,
  RefreshBoardInput,
  refreshBoardData,
} from "../leaderboard.ts";
import { WatchlistInput, watchlist } from "../watchlist.ts";
export const market: ActionTable = {
  boardSnapshot: reads(nothing, loadBoardSnapshot),
  // F68: pinned and mentioned-today instruments beside their stored closes.
  watchlist: reads(WatchlistInput, (v) => watchlist(v)),
  refreshBoardData: writes(RefreshBoardInput, refreshBoardData),
  performance: writes(z.enum(["leapedge", "forward", "historical"]), (mode) =>
    performance(mode),
  ),
};
