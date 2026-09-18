import { briefings } from "./briefings.ts";
import { channels } from "./channels.ts";
import { entities } from "./entities.ts";
import { market } from "./market.ts";
import { research } from "./research.ts";
import { runs } from "./runs.ts";
import { settings } from "./settings.ts";
import type { ActionEntry, ActionTable } from "./types.ts";
/**
 * One dispatch table per resource, each mapping an action to its own schema,
 * its handler and whether it writes. Every API surface goes through here, so an
 * action is validated the same way whichever route reached it.
 */
export const RESOURCES: Record<string, ActionTable> = {
  briefings,
  channels,
  entities,
  market,
  research,
  runs,
  settings,
};
export function lookup(resource: string, action: string): ActionEntry {
  const table = Object.hasOwn(RESOURCES, resource)
    ? RESOURCES[resource]
    : undefined;
  if (!table || !Object.hasOwn(table, action)) throw Error("Unknown action.");
  return table[action];
}
/** The resource whose table declares this action name, for the old flat route. */
export function resourceOf(action: string) {
  for (const [resource, table] of Object.entries(RESOURCES))
    if (Object.hasOwn(table, action)) return resource;
  return undefined;
}
export async function dispatch(
  resource: string,
  action: string,
  input: unknown,
) {
  const entry = lookup(resource, action);
  if (entry.mutating && process.env.YTI_PREVIEW_READ_ONLY === "true")
    throw Error(
      "This preview is read-only. Changes are tested in the isolated local workspace.",
    );
  return await entry.handler(input);
}
