import { z } from "zod";
import {
  follow as followChannel,
  discoverChannels as discover,
  backfillChannel as backfill,
  pull as pullChannel,
  updateChannel,
  analyzeUploadAndProcess,
  saveProcessingSelection,
} from "../channels.ts";
import { seedCatalog } from "../seed/channels.ts";
import { loadCostMetrics } from "../cost-metrics.ts";
import { reads, nothing, writes, type ActionTable } from "./types.ts";
export const channels: ActionTable = {
  seedCatalog: writes(nothing, () => seedCatalog()),
  saveSelection: writes(
    z.strictObject({ channelIds: z.array(z.string().min(1)).max(1000) }),
    (v) => saveProcessingSelection(v.channelIds),
  ),
  costMetrics: reads(nothing, () => loadCostMetrics()),
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
  analyzeUpload: writes(z.string(), (id) => analyzeUploadAndProcess(id)),
};
