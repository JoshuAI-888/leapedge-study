import { database } from "../../src/server/youtube-intelligence/database.ts";
/**
 * Test helper: switch the process to the in-process PGlite driver, drop any
 * connection that is already open (SQLite, pg.Pool or a previous PGlite) so
 * module state resets, and return the database once the migrations under
 * src/server/youtube-intelligence/migrations have run against it.
 * Every call yields an empty, isolated Postgres instance.
 */
export async function freshDatabase() {
  process.env.YTI_DB = "pglite";
  await database.close();
  // Reading yi_migrations both opens the connection and fails loudly if the
  // migrations did not run.
  await database.prepare("SELECT version FROM yi_migrations").all();
  return database;
}
