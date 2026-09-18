import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  database,
  useDirectConnection,
} from "../src/server/youtube-intelligence/database.ts";
import { assertIsolatedDatabase } from "../src/server/youtube-intelligence/migrations/run.ts";
import { seedChannels } from "../src/server/youtube-intelligence/seed/channels.ts";
import { seedLists } from "../src/server/youtube-intelligence/seed/lists.ts";
/**
 * Put the shipped channel lists into the `channels` table and record the
 * selection they imply (F28).
 *
 *   node --experimental-strip-types scripts/seed-channels.ts
 *   node --experimental-strip-types scripts/seed-channels.ts --production
 *
 * Running it twice changes nothing: rows are upserted by id with a conflict
 * branch that only adds, and the selection is recorded insert-if-absent, so a
 * second run neither writes a second version nor re-projects the first over
 * what anyone has since chosen.
 *
 * It refuses a placeholder list against a real database. The files that ship
 * say `placeholder: true`, and seeding those ids would fill the table with rows
 * pointing at channels that do not exist — which then have to be told apart
 * from real ones by hand. Replace the JSON files with the real lists first.
 */
export const USAGE = [
  "Usage:",
  "  node --experimental-strip-types scripts/seed-channels.ts [--production]",
  "",
  "  --production   run against the production database (skips the isolated-target check)",
].join("\n");
export class FlagError extends Error {}
export function parseOptions(argv: string[]) {
  let production = false;
  for (const flag of argv) {
    if (flag === "--production") production = true;
    else throw new FlagError(`Unknown flag ${flag}.`);
  }
  return { production };
}
export function placeholderSources(lists = seedLists()): string[] {
  return lists.filter((l) => l.placeholder).map((l) => l.source);
}
async function main() {
  let options: { production: boolean };
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof FlagError)) throw e;
    console.error(`scripts/seed-channels.ts: ${e.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const placeholders = placeholderSources();
  if (placeholders.length && options.production) {
    console.error(
      `scripts/seed-channels.ts: ${placeholders.join(" and ")} ${placeholders.length === 1 ? "is a placeholder list" : "are placeholder lists"}. ` +
        "Replace src/server/youtube-intelligence/seed/*.json with the real lists before seeding production.",
    );
    process.exitCode = 2;
    return;
  }
  // A maintenance script takes the direct endpoint, chosen here rather than by
  // the shell line that starts it.
  useDirectConnection();
  if (!options.production) assertIsolatedDatabase("scripts/seed-channels.ts");
  try {
    const result = await seedChannels();
    console.log(
      JSON.stringify(
        {
          channels: result.channels,
          seeded: result.seeded,
          selection: result.selection.id,
          selected: result.selection.channelIds.length,
          // false means this selection was already in force, so no row's paid
          // switch was touched by this run.
          projected: result.recorded,
          placeholderLists: placeholders,
        },
        null,
        2,
      ),
    );
  } finally {
    await database.close();
  }
}
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
