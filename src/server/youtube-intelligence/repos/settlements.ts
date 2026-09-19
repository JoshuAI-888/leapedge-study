import { randomUUID } from "node:crypto";
import { database, iso } from "../database.ts";
import type { SettlementResult, SettlementRecord } from "../settlement.ts";

/**
 * The only door to the `settlements` table (spec 8).
 *
 * Append-only, and the database enforces it: 0004 puts a trigger on UPDATE and
 * DELETE that raises. That is not belt and braces over careful code, it is what
 * makes the Changes tab honest. Spec 4.12 computes a board "as of" a date by
 * reading the rows that existed then, so a row rewritten after it was reported
 * changes a figure somebody has already read, and no amount of care in this
 * module prevents it from a psql prompt.
 *
 * There is therefore no update and no delete here. A correction is a new sweep.
 */
export type SettlementRow = SettlementResult & {
  id: string;
  createdAt: string;
  revision?: number;
};

const COLUMNS =
  "id,claim_id,horizon_days,entry_date,entry_price,exit_date,exit_price,return_pct,status,reason,record,created_at,revision";

function day(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(iso(value) ?? value).slice(0, 10);
}

function convert(r: Record<string, unknown>): SettlementRow {
  return {
    id: String(r.id),
    claimId: String(r.claim_id),
    horizonDays: Number(r.horizon_days),
    entryDate: day(r.entry_date),
    entryPrice: r.entry_price === null ? null : Number(r.entry_price),
    exitDate: day(r.exit_date),
    exitPrice: r.exit_price === null ? null : Number(r.exit_price),
    return: r.return_pct === null ? null : Number(r.return_pct),
    status: String(r.status) as SettlementRow["status"],
    reason: r.reason === null ? null : String(r.reason),
    record: String(r.record) as SettlementRecord,
    createdAt: iso(r.created_at)!,
    revision: Number(r.revision),
  };
}

/** Write one settlement. The row is dated by the database, never by the caller. */
export async function appendSettlement(
  result: SettlementResult,
): Promise<SettlementRow> {
  const id = randomUUID();
  const rows = (await database
    .prepare(
      `INSERT INTO settlements(${COLUMNS.replace(",created_at", "").replace(",revision", "")})
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${COLUMNS}`,
    )
    .all(
      id,
      result.claimId,
      result.horizonDays,
      result.entryDate,
      result.entryPrice,
      result.exitDate,
      result.exitPrice,
      result.return,
      result.status,
      result.reason,
      result.record,
    )) as Record<string, unknown>[];
  return convert(rows[0]!);
}

/** Every settlement written for one claim, oldest first. */
export async function settlementsFor(
  claimId: string,
): Promise<SettlementRow[]> {
  const rows = (await database
    .prepare(
      `SELECT ${COLUMNS} FROM settlements WHERE claim_id=$1 ORDER BY created_at, revision`,
    )
    .all(claimId)) as Record<string, unknown>[];
  return rows.map(convert);
}

/**
 * Settlements filtered by record and horizon. Spec 4.12: the forward record and
 * the historical replay are never mixed, so a caller that omits `record` is
 * asking for both on purpose.
 */
export async function listSettlements(
  filter: {
    record?: SettlementRecord;
    horizonDays?: number;
    /** Only rows written on or before this instant, which is how a board "as of" a date is computed. */
    asOf?: string;
  } = {},
): Promise<SettlementRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.record) {
    values.push(filter.record);
    where.push(`record=$${values.length}`);
  }
  if (filter.horizonDays !== undefined) {
    values.push(filter.horizonDays);
    where.push(`horizon_days=$${values.length}`);
  }
  if (filter.asOf) {
    values.push(filter.asOf);
    where.push(`created_at<=$${values.length}`);
  }
  // Built by concatenation, not by a ternary inside the template: the guard in
  // tests/locks.test.ts looks for a "?" in SQL text, and it is right to, because
  // a stray one is a SQLite placeholder that Postgres would not understand.
  let sql = `SELECT ${COLUMNS} FROM settlements`;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY created_at, revision";
  const rows = (await database.prepare(sql).all(...values)) as Record<
    string,
    unknown
  >[];
  return rows.map(convert);
}
