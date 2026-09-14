import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export type Attempt = {
  id: string;
  caseKey: string;
  status: string;
  reservedNzd: number;
  createdAt: string;
  artifact?: string;
  retryOf?: string;
};
export function reserve(directory: string, caseKey: string, capNzd = 10, retryOf?: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "ledger.lock");
  const fd = openSync(lock, "wx", 0o600);
  try {
    const p = join(directory, "ledger.json");
    const rows: Attempt[] = existsSync(p)
      ? JSON.parse(readFileSync(p, "utf8"))
      : [];
    if (retryOf) {
      const prior = rows.find(r => r.id === retryOf);
      if (!prior || prior.caseKey !== caseKey || prior.status !== "quota_or_rate_limit") throw Error("Retry requires a matching explicit quota rejection");
      caseKey = `${caseKey}:retry:${retryOf}`;
    }
    if (rows.some((r) => r.caseKey === caseKey))
      throw Error(
        "Attempt already recorded; review it instead of resubmitting",
      );
    if (
      rows.length >= 60 ||
      rows.reduce((n, r) => n + r.reservedNzd, 0) + 2.5 > Math.min(50, capNzd)
    )
      throw Error("Campaign reservation cap reached");
    const row: Attempt = {
      id: randomUUID(),
      retryOf,
      caseKey,
      status: "reserved",
      reservedNzd: 2.5,
      createdAt: new Date().toISOString(),
    };
    rows.push(row);
    writeFileSync(p, JSON.stringify(rows, null, 2), { mode: 0o600 });
    return row;
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
export function saveArtifact(
  directory: string,
  attempt: Attempt,
  data: unknown,
  secrets: string[] = [],
) {
  let text = JSON.stringify(data, null, 2);
  for (const key of secrets.filter(Boolean))
    text = text.replaceAll(key, "[REDACTED]");
  const p = join(directory, attempt.id + ".json");
  writeFileSync(p, text, { flag: "wx", mode: 0o600 });
  return p;
}
// Reservations remain held after success/error until billing reconciliation. Never infer a free failure.
export function finish(
  directory: string,
  id: string,
  outcome: string,
  artifact: string,
) {
  const lock = join(directory, "ledger.lock");
  const fd = openSync(lock, "wx", 0o600);
  try {
    const p = join(directory, "ledger.json");
    const rows: Attempt[] = JSON.parse(readFileSync(p, "utf8"));
    const row = rows.find((r) => r.id === id);
    if (!row) throw Error("Missing reservation");
    row.status = outcome;
    row.artifact = artifact;
    writeFileSync(p, JSON.stringify(rows, null, 2), { mode: 0o600 });
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
