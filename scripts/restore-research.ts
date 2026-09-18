import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { useDirectConnection } from "../src/server/youtube-intelligence/database.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
// The DIRECT (unpooled) endpoint, chosen here and not by the npm alias, so that
// running this file straight with node opens the same connection. See
// useDirectConnection(): a transaction-mode pooler discards session-scoped work
// and mostly does so without erroring.
useDirectConnection();
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  input.version !== 1 ||
  createHash("sha256").update(JSON.stringify(input.data)).digest("hex") !==
    input.sha256
)
  throw Error("Backup integrity check failed.");
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
      await db()
        .prepare(
          `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        )
        .run(...keys.map((k) => row[k]));
    }
    const actual = await db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get();
    if (Number(actual?.n) !== rows.length)
      throw Error("Restore count mismatch");
  }
});
console.log("Backup checksum and all restored table counts verified.");
await db().close();
