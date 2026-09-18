import { z } from "zod";
import { performance } from "../market.ts";
import { writes, type ActionTable } from "./types.ts";
export const market: ActionTable = {
  performance: writes(z.enum(["leapedge", "forward", "historical"]), (mode) =>
    performance(mode),
  ),
};
