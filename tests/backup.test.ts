import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_TABLES,
  BACKUP_V1_TABLES,
  BACKUP_VERSION,
  NOT_BACKED_UP,
  tablesFor,
} from "../src/server/youtube-intelligence/backup.ts";
import { loadMigrations } from "../src/server/youtube-intelligence/migrations/run.ts";

/**
 * A backup that silently omits a table is worse than no backup: it restores,
 * reports success, and the missing data is only noticed later. The channels
 * table was in exactly that state — the data used to be `channel` documents in
 * yi_documents, which was exported, and moving it into its own table took it
 * out of every backup without failing anything.
 */
test("Every table the migrations create is backed up, or excluded on purpose", async () => {
  const created = new Set<string>();
  for (const file of await loadMigrations())
    for (const m of file.sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)? ([a-z_][a-z0-9_]*)/gi,
    ))
      created.add(m[1].toLowerCase());
  assert.equal(created.size > 0, true, "the migrations were read");
  const covered = new Set([...BACKUP_TABLES, ...NOT_BACKED_UP]);
  const missing = [...created].filter((t) => !covered.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    "add each of these to BACKUP_TABLES, or to NOT_BACKED_UP with the reason",
  );
  const phantom = BACKUP_TABLES.filter((t) => !created.has(t)).sort();
  assert.deepEqual(phantom, [], "a backup cannot read a table nothing creates");
});

test("The runner's own ledger is the only table left out", () => {
  assert.deepEqual(NOT_BACKED_UP, ["yi_migrations"]);
});

test("A version-1 backup restores its nine tables; an unknown version restores none", () => {
  assert.equal(BACKUP_VERSION, 2);
  assert.deepEqual(tablesFor(2), BACKUP_TABLES);
  assert.deepEqual(tablesFor(1), BACKUP_V1_TABLES);
  assert.equal(BACKUP_V1_TABLES.length, 9);
  // Every version-1 table is still backed up today, so an old file restores
  // into the current schema with the newer tables left empty, which is what
  // that database held.
  for (const t of BACKUP_V1_TABLES) assert.equal(BACKUP_TABLES.includes(t), true);
  assert.throws(() => tablesFor(3), /not one this build can restore/);
  assert.throws(() => tablesFor(Number.NaN), /not one this build can restore/);
});
