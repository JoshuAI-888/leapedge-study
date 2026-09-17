import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.YTI_BACKUP_DIR || "data/backups";
mkdirSync(dir, { recursive: true });
const source = new DatabaseSync(
  process.env.YTI_DB_PATH || "data/intelligence.sqlite",
);
const target = join(
  dir,
  `intelligence-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
await backup(source, target);
const copy = new DatabaseSync(target, { readOnly: true });
const row = await copy.prepare("PRAGMA integrity_check").get();
if (row?.integrity_check !== "ok")
  throw Error("Backup integrity check failed.");
console.log(JSON.stringify({ backup: target, integrity: "ok" }));
await copy.close();
await source.close();
