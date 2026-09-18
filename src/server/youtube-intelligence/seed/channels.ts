import { createHash } from "node:crypto";
import { docs, putIfAbsent } from "../research-store.ts";
import {
  listSeededChannels,
  seedChannel,
  setAutomaticAnalysis,
} from "../repos/channels.ts";
import {
  LEAPEDGE,
  seedLists,
  type SeedListData,
} from "./lists.ts";
/**
 * Two switches, and they are not the same switch.
 *
 * `discovery` says how a channel's uploads are found: `scheduled` is the free
 * metadata poll, `manual` is only when somebody asks. `processing` says what
 * happens to an upload once it is found: `automatic` spends money on the
 * analysis pipeline without asking, `on-request` waits for a person.
 *
 * Seeding arms the first and leaves the second off. Eighty channels on
 * scheduled discovery is a quota question; eighty channels on automatic
 * analysis is a bill nobody agreed to, so the paid switch is turned on only by
 * the recorded selection below, or one channel at a time from the Channels
 * surface.
 */
export const DISCOVERY_SCHEDULED = "scheduled";
export const PROCESSING_AUTOMATIC = "automatic";
export const PROCESSING_ON_REQUEST = "on-request";
/** Tier 1 is selected outright; the LeapEdge list contributes its top 20. */
export const AUTOMATIC_TIER = 1;
export const LEAPEDGE_SELECTED = 20;
export const SELECTION_KIND = "channelSelection";
export const SELECTION_RULE = "tier1+leapedge-top20";
export const SELECTION_VERSION = "v1";
/** One channel after the lists have been folded together. */
export type ResolvedSeed = {
  id: string;
  handle: string;
  title: string;
  tier: number;
  seedSource: string[];
  /** Its position in the LeapEdge list, 1-based, or null if it is not on it. */
  leapedgeRank: number | null;
};
export type SelectionData = {
  id: string;
  rule: string;
  version: string;
  at: string;
  reason: string;
  channelIds: string[];
  candidates: number;
};
/**
 * Fold the lists into one channel per id. A channel on both lists is one
 * channel: its `seedSource` names both, and it keeps the strongest tier either
 * list gives it, because a tier is a claim about the channel rather than about
 * the list it was read from.
 */
export function resolveSeeds(lists: SeedListData[]): ResolvedSeed[] {
  const byId = new Map<string, ResolvedSeed>();
  for (const list of lists)
    for (const [index, channel] of list.channels.entries()) {
      const tier = channel.tier ?? list.tier;
      const rank = list.source === LEAPEDGE ? index + 1 : null;
      const held = byId.get(channel.id);
      if (!held) {
        byId.set(channel.id, {
          id: channel.id,
          handle: channel.handle,
          title: channel.title,
          tier,
          seedSource: [list.source],
          leapedgeRank: rank,
        });
        continue;
      }
      held.tier = Math.min(held.tier, tier);
      held.leapedgeRank = held.leapedgeRank ?? rank;
      if (!held.seedSource.includes(list.source))
        held.seedSource = [...held.seedSource, list.source].sort();
    }
  return [...byId.values()];
}
/**
 * Tier 1 plus the LeapEdge top 20. Everything else is seeded and watched, and
 * nothing analyses it until somebody says so.
 */
export function defaultSelection(resolved: ResolvedSeed[]): string[] {
  return [
    ...new Set(
      resolved
        .filter(
          (c) =>
            c.tier <= AUTOMATIC_TIER ||
            (c.leapedgeRank !== null && c.leapedgeRank <= LEAPEDGE_SELECTED),
        )
        .map((c) => c.id),
    ),
  ].sort();
}
/**
 * The selection is configuration with a version, not a column somebody edits.
 * Its id carries the rule, the version of the rule and a digest of the
 * channels it selects, and it is written insert-if-absent, so the same
 * selection recorded twice stays one document and a different one becomes a
 * second document beside it. The history is then readable as a series of
 * decisions rather than as whatever the present state happens to be.
 */
export function selectionRecord(
  channelIds: string[],
  candidates: number,
  at = new Date().toISOString(),
): SelectionData {
  const digest = createHash("sha256")
    .update(JSON.stringify([SELECTION_RULE, SELECTION_VERSION, channelIds]))
    .digest("hex")
    .slice(0, 16);
  return {
    id: `${SELECTION_RULE}.${SELECTION_VERSION}.${digest}`,
    rule: SELECTION_RULE,
    version: SELECTION_VERSION,
    at,
    reason: `Tier ${AUTOMATIC_TIER} channels and the top ${LEAPEDGE_SELECTED} of the ${LEAPEDGE} list are analysed automatically; every other seeded channel is discovered only.`,
    channelIds,
    candidates,
  };
}
/** Every recorded selection, newest first. */
export async function selectionHistory(): Promise<SelectionData[]> {
  return (await docs<SelectionData>(SELECTION_KIND)).sort((a, b) =>
    a.at === b.at ? b.id.localeCompare(a.id) : b.at < a.at ? -1 : 1,
  );
}
/** The selection in force, or null before anything has been seeded. */
export async function currentSelection(): Promise<SelectionData | null> {
  return (await selectionHistory())[0] ?? null;
}
/**
 * Seed the channel lists and put the default selection into force.
 *
 * Running it twice changes nothing: every row is upserted by id with a
 * conflict branch that only adds, and the selection is recorded
 * insert-if-absent, so the second run neither writes a second version nor
 * re-projects the first over whatever a person has since chosen. A selection
 * is projected onto the rows exactly once, when it is first recorded.
 */
export async function seedChannels(lists: SeedListData[] = seedLists()) {
  const resolved = resolveSeeds(lists);
  for (const c of resolved)
    await seedChannel({
      id: c.id,
      handle: c.handle,
      title: c.title,
      tier: String(c.tier),
      seedSource: c.seedSource,
      discovery: DISCOVERY_SCHEDULED,
      processing: PROCESSING_ON_REQUEST,
    });
  const selection = selectionRecord(defaultSelection(resolved), resolved.length);
  const recorded = await putIfAbsent(SELECTION_KIND, selection.id, selection);
  if (recorded)
    await setAutomaticAnalysis(
      selection.channelIds,
      PROCESSING_AUTOMATIC,
      PROCESSING_ON_REQUEST,
    );
  return {
    channels: resolved.length,
    seeded: (await listSeededChannels()).length,
    selection,
    recorded,
  };
}
