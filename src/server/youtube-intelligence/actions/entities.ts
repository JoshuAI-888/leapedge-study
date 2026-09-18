import { z } from "zod";
import { saveEntity, suggestEntities, mergeEntities } from "../entities.ts";
import { Entity } from "../../../features/youtube-intelligence/entities.ts";
import { writes, nothing, type ActionTable } from "./types.ts";
export const entities: ActionTable = {
  // The cross-field rules stay in Entity itself; the table declares the keys.
  entity: writes(z.strictObject(Entity.shape), (v) => saveEntity(v)),
  entityMerge: writes(
    z.strictObject({
      sourceId: z.string(),
      targetId: z.string(),
      reason: z.string().trim().min(10).max(1000),
    }),
    (v) => mergeEntities(v),
  ),
  suggestEntities: writes(nothing, () => suggestEntities()),
};
