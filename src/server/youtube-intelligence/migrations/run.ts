import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { PGlite } from "@electric-sql/pglite";
type Row = Record<string, unknown>;
/** The slice of a Postgres driver the runner needs; pg and PGlite both fit. */
export type MigrationClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  exec(sql: string): Promise<void>;
};
export type MigrationFile = {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
};
export type MigrateResult = { applied: number[]; stamped: boolean };
export type MigrateOptions = {
  directory?: string;
  log?: (line: string) => void;
  /**
   * Takes one session-level pg_advisory_lock for the whole run. A session lock
   * outlives the statement that took it, so it is legal only on the direct
   * (unpooled) endpoint, where the session stays with this process; a pooler
   * may hand the session to another client and the lock would never be
   * released. Left off for PGlite, which has a single connection and can
   * never contend.
   */
  lock?: boolean;
};
const LOCK_KEY = 78941003;
const BASELINE_TABLE = "yi_runs";
const FILENAME = /^(\d{4})_([a-z0-9_-]+)\.sql$/;
// This module's own directory. Only a Node process reads the files (the
// migrate script, the worker, tests); a bundled server never migrates.
export const migrationsDirectory = dirname(fileURLToPath(import.meta.url));
export function pgliteClient(instance: PGlite): MigrationClient {
  return {
    async query(sql, params) {
      return { rows: (await instance.query<Row>(sql, params)).rows };
    },
    async exec(sql) {
      await instance.exec(sql);
    },
  };
}
export function poolClient(c: pg.PoolClient): MigrationClient {
  return {
    async query(sql, params) {
      return { rows: (await c.query(sql, params)).rows as Row[] };
    },
    async exec(sql) {
      await c.query(sql);
    },
  };
}
function checksumOf(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}
export async function loadMigrations(
  directory = migrationsDirectory,
): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for (const file of (await readdir(directory)).filter((n) =>
    n.endsWith(".sql"),
  )) {
    const parsed = FILENAME.exec(file);
    if (!parsed)
      throw Error(
        `Migration ${file} is not named NNNN_name.sql: four digits, an underscore, then a lower-case name of letters, digits, underscores and dashes.`,
      );
    const sql = await readFile(join(directory, file), "utf8");
    files.push({
      version: Number(parsed[1]),
      name: parsed[2],
      file,
      sql,
      checksum: checksumOf(sql),
    });
  }
  files.sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i++)
    if (files[i].version === files[i - 1].version)
      throw Error(`Two migrations claim version ${files[i].version}.`);
  return files;
}
async function recordedVersions(c: MigrationClient) {
  const rows = (
    await c.query("SELECT version,checksum FROM yi_migrations ORDER BY version")
  ).rows;
  return new Map(
    rows.map((r) => [Number(r.version), String(r.checksum)] as const),
  );
}
async function tableExists(c: MigrationClient, table: string) {
  const rows = (
    await c.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
      [table],
    )
  ).rows;
  return rows.length > 0;
}
async function apply(
  c: MigrationClient,
  files: MigrationFile[],
  options: MigrateOptions,
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});
  await c.exec(
    "CREATE TABLE IF NOT EXISTS yi_migrations(version integer primary key,name text not null,applied_at timestamptz not null default now(),checksum text not null)",
  );
  let recorded = await recordedVersions(c);
  let stamped = false;
  // A database that predates this runner already carries the baseline schema:
  // record version 1 instead of running it.
  if (recorded.size === 0 && (await tableExists(c, BASELINE_TABLE))) {
    const baseline = files.find((f) => f.version === 1);
    if (!baseline)
      throw Error("Migration version 1 is missing; nothing to stamp.");
    await c.query(
      "INSERT INTO yi_migrations(version,name,checksum) VALUES($1,$2,$3)",
      [baseline.version, baseline.name, baseline.checksum],
    );
    log(`Stamped ${baseline.file} as applied: ${BASELINE_TABLE} exists.`);
    stamped = true;
    recorded = await recordedVersions(c);
  }
  for (const f of files) {
    const checksum = recorded.get(f.version);
    if (checksum !== undefined && checksum !== f.checksum)
      throw Error(
        `Migration version ${f.version} was edited after it was applied: ${f.file} no longer matches the recorded checksum.`,
      );
  }
  for (const version of recorded.keys())
    if (!files.some((f) => f.version === version))
      throw Error(
        `Migration version ${version} is recorded as applied but has no file on disk: restore it instead of deleting or renaming an applied migration.`,
      );
  const applied: number[] = [];
  for (const f of files) {
    if (recorded.has(f.version)) continue;
    await c.query("BEGIN");
    try {
      await c.exec(f.sql);
      await c.query(
        "INSERT INTO yi_migrations(version,name,checksum) VALUES($1,$2,$3)",
        [f.version, f.name, f.checksum],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    log(`Applied ${f.file}.`);
    applied.push(f.version);
  }
  return { applied, stamped };
}
/**
 * Applies every unapplied migration in version order, each file in its own
 * transaction together with its yi_migrations row, so a failure leaves nothing
 * behind and the next run retries exactly that file.
 */
export async function migrate(
  c: MigrationClient,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const files = await loadMigrations(options.directory);
  if (!options.lock) return apply(c, files, options);
  await c.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);
  try {
    return await apply(c, files, options);
  } finally {
    await c.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
  }
}
function hostOf(connectionString: string | undefined) {
  if (!connectionString) return undefined;
  try {
    return new URL(connectionString).hostname || undefined;
  } catch {
    return undefined;
  }
}
/**
 * A preview deployment must never migrate the production database. Only hosts
 * are compared, and the error names neither value; an unset
 * YTI_PRODUCTION_DB_HOST cannot rule the production host out, so it refuses too.
 */
export function assertPreviewIsNotProduction(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.VERCEL_ENV !== "preview") return;
  const refuse = (why: string) =>
    Error(
      `A preview deployment tried to migrate the production database: ${why}.`,
    );
  const production = env.YTI_PRODUCTION_DB_HOST?.trim().toLowerCase();
  if (!production)
    throw refuse(
      "YTI_PRODUCTION_DB_HOST is unset, so the production host cannot be ruled out",
    );
  const host = hostOf(env.DATABASE_URL_UNPOOLED);
  if (!host) throw refuse("the host of DATABASE_URL_UNPOOLED cannot be read");
  if (host === production) throw refuse("the two hosts are the same");
}
/** The direct (unpooled) endpoint; the pooled one cannot hold a session lock. */
export function directConnectionString(
  env: Record<string, string | undefined> = process.env,
) {
  const value = env.DATABASE_URL_UNPOOLED?.trim();
  if (!value)
    throw Error(
      "DATABASE_URL_UNPOOLED is not set: migrations need the direct endpoint.",
    );
  return value;
}
