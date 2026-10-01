import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { useDirectConnection } from "../src/server/youtube-intelligence/database.ts";
import { assertIsolatedDatabase } from "../src/server/youtube-intelligence/migrations/run.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
import { tablesFor } from "../src/server/youtube-intelligence/backup.ts";
// The DIRECT (unpooled) endpoint, chosen here and not by the npm alias, so that
// running this file straight with node opens the same connection. See
// useDirectConnection(): a transaction-mode pooler discards session-scoped work
// and mostly does so without erroring.
useDirectConnection();
// A restore only ever goes into a new, empty database: the runbook says restore,
// verify, then point the app at it. The empty-table check below catches a
// populated target, but not an empty production branch, so the target is ruled
// out by host as well.
assertIsolatedDatabase("restore-research");
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  createHash("sha256").update(JSON.stringify(input.data)).digest("hex") !==
  input.sha256
)
  throw Error("Backup integrity check failed.");
// A version-1 file was written before the relational tables existed, so it
// carries only the nine document-era ones and the rest stay empty. tablesFor
// refuses any other version rather than restoring part of a file this build
// does not understand.
const tables = tablesFor(Number(input.version));
await db().transaction(async () => {
  for (const table of tables) {
    const existing = await db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get();
    if (Number(existing?.n))
      throw Error("Restore requires an empty isolated database.");
    const rows = input.data[table];
    if (!Array.isArray(rows)) throw Error("Missing backup table");
    for (const row of rows) {
      const keys = Object.keys(row);
      if (keys.some((k) => !/^\w+$/.test(k))) throw Error("Invalid column");
      const identityOverride =
        table === "settlements" ? "OVERRIDING SYSTEM VALUE " : "";
      await db()
        .prepare(
          `INSERT INTO ${table}(${keys.join(",")}) ${identityOverride}VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        )
        .run(...keys.map((k) => row[k]));
    }
    const actual = await db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get();
    if (Number(actual?.n) !== rows.length)
      throw Error("Restore count mismatch");
  }
  if (tables.includes("settlements"))
    await db()
      .prepare(
        "SELECT setval(pg_get_serial_sequence('settlements','revision'),COALESCE(MAX(revision),1),MAX(revision) IS NOT NULL) FROM settlements",
      )
      .get();
  if (Number(input.version) < 3 && tables.includes("prices"))
    await db()
      .prepare(
        "INSERT INTO price_history(ticker,date,adjusted_close,source,fetched_at) SELECT ticker,date,adjusted_close,source,fetched_at FROM prices ON CONFLICT DO NOTHING",
      )
      .run();
});
console.log(
  `Backup checksum and all ${tables.length} restored table counts verified (backup version ${input.version}).`,
);
await db().close();
