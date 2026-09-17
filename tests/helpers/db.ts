import { database } from "../../src/server/youtube-intelligence/database.ts";
/**
 * Test helper: switch the process to the in-process PGlite driver, drop any
 * connection that is already open (SQLite, pg.Pool or a previous PGlite) so
 * module state resets, and return the database once the schema has applied.
 * Every call yields an empty, isolated Postgres instance.
 */
export async function freshDatabase() {
  process.env.YTI_DB = "pglite";
  await database.close();
  await database.prepare("SELECT 1 AS ok").get();
  return database;
}
