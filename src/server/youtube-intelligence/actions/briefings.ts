import { z } from "zod";
import {
  buildBriefing,
  shareBriefing,
  revokeShare,
  shareSelection,
} from "../briefings.ts";
import { queueBriefing } from "../briefing-pipeline.ts";
import { writes, type ActionTable } from "./types.ts";
export const briefings: ActionTable = {
  briefing: writes(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(""))
      .nullish(),
    (day) => buildBriefing(day || undefined),
  ),
  synthesizeBriefing: writes(z.string(), (id) => queueBriefing(id)),
  share: writes(z.string(), (id) => shareBriefing(id)),
  revoke: writes(z.string(), (id) => revokeShare(id)),
  shareSelection: writes(
    z
      .array(
        z.strictObject({
          runId: z.string().min(1),
          claimId: z.string().min(1),
        }),
      )
      .min(1)
      .max(500),
    (v) => shareSelection(v),
  ),
};
