import { z } from "zod";
import leapedge from "./leapedge.json" with { type: "json" };
import truealpha from "./truealpha.json" with { type: "json" };
/**
 * The seed lists are data, not code. Each file names its source, the tier its
 * entries carry unless they say otherwise, and an ordered array of channels,
 * best first: the order IS the ranking, so re-ranking a list moves lines
 * rather than editing a number on every one of them.
 *
 * TrueAlpha handles are resolved against the YouTube API with dated evidence.
 * LeapEdge stays empty and explicitly unavailable until a ranked source exists.
 * A personal subscription list must never be relabelled as a ranking.
 */
export const SeedChannel = z.object({
  id: z.string().regex(/^UC[\w-]{22}$/),
  handle: z.string().regex(/^@[^\s/?#]{1,100}$/),
  title: z.string().min(1).max(200),
  tier: z.number().int().min(1).max(3).optional(),
});
export const SeedList = z
  .object({
    source: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
    tier: z.number().int().min(1).max(3),
    placeholder: z.boolean(),
    note: z.string().max(2000).default(""),
    channels: z.array(SeedChannel).max(500),
  })
  .refine(
    (list) => list.placeholder || list.channels.length > 0,
    "A confirmed seed list must contain channels.",
  )
  .refine(
    (list) =>
      new Set(list.channels.map((c) => c.id)).size === list.channels.length,
    "A seed list names each channel once.",
  );
export type SeedChannelData = z.infer<typeof SeedChannel>;
export type SeedListData = z.infer<typeof SeedList>;
export const LEAPEDGE = "leapedge";
export const TRUEALPHA = "truealpha";
/** The two shipped lists, parsed. A malformed file fails here, not at the row. */
export function seedLists(): SeedListData[] {
  return [SeedList.parse(leapedge), SeedList.parse(truealpha)];
}
