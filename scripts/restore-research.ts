import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { db } from "../src/server/youtube-intelligence/store.ts";
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
          `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
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
