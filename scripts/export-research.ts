import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { useDirectConnection } from "../src/server/youtube-intelligence/database.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
} from "../src/server/youtube-intelligence/backup.ts";
// The DIRECT (unpooled) endpoint, chosen here and not by the npm alias, so that
// running this file straight with node opens the same connection. See
// useDirectConnection(): a transaction-mode pooler discards session-scoped work
// and mostly does so without erroring.
useDirectConnection();
const data: Record<string, Record<string, unknown>[]> = {};
await db().transaction(async () => {
  for (const table of BACKUP_TABLES)
    data[table] = await db().prepare(`SELECT * FROM ${table}`).all();
});
const at = new Date().toISOString(),
  payload = JSON.stringify(data),
  hash = createHash("sha256").update(payload).digest("hex");
mkdirSync("data/backups", { recursive: true });
const path = `data/backups/research-${at.replaceAll(":", "-")}.json`;
writeFileSync(
  path,
  JSON.stringify({ version: BACKUP_VERSION, at, sha256: hash, data }),
  {
    mode: 0o600,
  },
);
console.log(
  JSON.stringify({
    path,
    sha256: hash,
    counts: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v.length]),
    ),
  }),
);
await db().close();
