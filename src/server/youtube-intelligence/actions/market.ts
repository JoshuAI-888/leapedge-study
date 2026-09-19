import { z } from "zod";
import { performance } from "../market.ts";
import { writes, reads, nothing, type ActionTable } from "./types.ts";
import {
  loadBoardSnapshot,
  RefreshBoardInput,
  refreshBoardData,
} from "../leaderboard.ts";
export const market: ActionTable = {
  boardSnapshot: reads(nothing, loadBoardSnapshot),
  refreshBoardData: writes(RefreshBoardInput, refreshBoardData),
  performance: writes(z.enum(["leapedge", "forward", "historical"]), (mode) =>
    performance(mode),
  ),
};
