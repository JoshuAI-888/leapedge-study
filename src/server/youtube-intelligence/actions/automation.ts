import { reads, writes, nothing, type ActionTable } from "./types.ts";
import { ReplayRequest, replayHistorical } from "../replay.ts";
import { docs } from "../research-store.ts";
export const automation: ActionTable = {
  replayHistorical: writes(ReplayRequest, replayHistorical),
  automationStatus: reads(nothing, async () => ({
    subscriptions: await docs("pushSubscription"),
    batches: await docs("batch"),
    replays: await docs("historicalReplay"),
  })),
};
