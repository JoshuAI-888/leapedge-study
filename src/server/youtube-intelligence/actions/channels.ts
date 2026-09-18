import { z } from "zod";
import {
  follow as followChannel,
  discoverChannels as discover,
  backfillChannel as backfill,
  pull as pullChannel,
  updateChannel,
  analyzeDiscovery,
} from "../channels.ts";
import { writes, type ActionTable } from "./types.ts";
export const channels: ActionTable = {
  discoverChannels: writes(
    z.strictObject({
      query: z.string().trim().min(3).max(150),
      language: z.enum(["en", "zh-Hans", "zh-Hant"]).default("en"),
    }),
    (v) => discover(v),
  ),
  follow: writes(z.string().max(500), (raw) => followChannel(raw)),
  channel: writes(
    z.strictObject({
      id: z.string(),
      active: z.boolean().optional(),
      favorite: z.boolean().optional(),
      autoAnalyze: z.boolean().optional(),
    }),
    (v) => updateChannel(v),
  ),
  pull: writes(z.string(), (id) => pullChannel(id)),
  pullOlder: writes(z.string(), (id) => pullChannel(id, true)),
  backfillChannel: writes(
    z.strictObject({
      id: z.string().min(1),
      pages: z.number().int().min(1).max(3),
    }),
    (v) => backfill(v),
  ),
  analyzeUpload: writes(z.string(), (id) => analyzeDiscovery(id)),
};
