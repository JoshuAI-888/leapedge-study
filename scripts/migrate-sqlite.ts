import { DatabaseSync } from "node:sqlite";
import { db } from "../src/server/youtube-intelligence/store.ts";
if (!process.env.DATABASE_URL)
  throw Error("DATABASE_URL required; use a separate Neon branch.");
const path = process.argv[2];
if (!path) throw Error("Pass the source SQLite path.");
const source = new DatabaseSync(path, { readOnly: true });
const tables = [
  "yi_runs",
  "yi_calls",
  "yi_responses",
  "yi_heartbeat",
  "yi_documents",
  "yi_events",
  "yi_prompts",
  "yi_discoveries",
  "yi_shares",
];
const counts: Record<string, number> = {};
await db().transaction(async () => {
  for (const table of tables) {
    const exists = source
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!exists) continue;
    const columns = source
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => String(c.name));
    const rows = source.prepare(`SELECT * FROM ${table}`).all();
    const existing = await db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get();
    if (Number(existing?.n))
      throw Error(`Destination ${table} is not empty; refusing to overwrite.`);
    for (const row of rows)
      await db()
        .prepare(
          `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        )
        .run(...columns.map((c) => row[c]));
    counts[table] = rows.length;
    const actual = await db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get();
    if (Number(actual?.n) !== rows.length) throw Error("Row count mismatch.");
  }
});
source.close();
await db().close();
console.log(
  JSON.stringify({
    migrated: counts,
    verified: "row counts; source remains unchanged",
  }),
);
