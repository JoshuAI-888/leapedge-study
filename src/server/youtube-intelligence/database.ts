import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";
import { migrate, pgliteClient } from "./migrations/run.ts";
/**
 * Postgres only. Every database reached from here — Neon in deployment, PGlite
 * in tests — is built by the numbered files under migrations/, which are the
 * single source of truth for the schema, and every statement carries $1, $2 …
 * placeholders.
 *
 * Neon's pooled (transaction-mode) endpoint hands the session to another client
 * between transactions, so nothing that outlives one transaction may be used at
 * runtime: no session-scoped advisory locks (pg_advisory_lock), no
 * LISTEN/NOTIFY, no temporary tables, no session SET and no SQL-level PREPARE.
 * Protocol-level prepared statements, transaction-scoped advisory locks
 * (pg_advisory_xact_lock) and FOR UPDATE SKIP LOCKED all work through the
 * pooler and are what the repositories use.
 */
type Row = Record<string, unknown>;
/**
 * numeric. pg returns it as a string, and PGlite's default number parser covers
 * only OIDs 21, 23, 26, 700 and 701, so PGlite returns it as a string too.
 */
const NUMERIC_OID = 1700;
/** timestamptz. Both drivers return it as a JavaScript Date by default. */
const TIMESTAMPTZ_OID = 1184;
/**
 * The one reader for row JSON. A text column arrives as a string and a jsonb
 * column arrives already parsed, so repositories route every row-JSON read
 * through here and keep working when a column's type changes.
 */
export function json(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
/**
 * The one reader for row timestamps: a Date, an ISO 8601 string, epoch
 * milliseconds or null in, an ISO 8601 string or null out. A string that is
 * already ISO 8601 is returned untouched, so a text column keeps its exact
 * stored value, and a value that is no date at all is passed through rather
 * than lost.
 */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number")
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/.test(text))
    return text;
  const at = Date.parse(text);
  return Number.isNaN(at) ? text : new Date(at).toISOString();
}
const parsers: Record<number, (value: string) => unknown> = {
  [NUMERIC_OID]: (value) => Number(value),
  [TIMESTAMPTZ_OID]: (value) => iso(value) ?? value,
};
pg.types.setTypeParser(NUMERIC_OID, parsers[NUMERIC_OID]);
pg.types.setTypeParser(TIMESTAMPTZ_OID, parsers[TIMESTAMPTZ_OID]);
/**
 * A stable signed 32-bit key for pg_advisory_xact_lock, derived from the name of
 * what the lock guards, so a caller never has to invent a magic number and two
 * different guards cannot collide by accident.
 */
export function advisoryKey(name: string) {
  return createHash("sha256").update(name).digest().readInt32BE(0);
}
// PGlite is an in-process, single-connection Postgres used by tests
// (YTI_DB=pglite). It shares the pg.Pool code path: the same $n placeholders,
// the same migrations and the same type parsers.
type Connection = pg.PoolClient | PGlite;
const context = new AsyncLocalStorage<Connection>();
let pool: pg.Pool | undefined,
  pglite: PGlite | undefined,
  ready: Promise<void> | undefined;
function isPGlite(c: Connection): c is PGlite {
  return pglite !== undefined && c === pglite;
}
// One statement, no parameters, on either driver.
async function simple(c: Connection, sql: string) {
  if (isPGlite(c)) await c.query(sql);
  else await c.query(sql);
}
export type DriverName = "pg" | "pglite";
export function driverName(): DriverName | undefined {
  if (pool) return "pg";
  if (pglite) return "pglite";
  return undefined;
}
async function loadPGlite() {
  // Dev-only dependency: a non-literal specifier keeps it out of the Next
  // server bundle and out of production module resolution.
  const specifier = "@electric-sql/pglite";
  return (await import(specifier)) as typeof import("@electric-sql/pglite");
}
let tail = Promise.resolve();
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => (release = r));
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
async function initialize() {
  if (!ready)
    ready = (async () => {
      if (process.env.YTI_DB === "pglite") {
        const { PGlite: Driver } = await loadPGlite();
        const instance = await Driver.create({ parsers });
        await migrate(pgliteClient(instance));
        pglite = instance;
      } else if (process.env.DATABASE_URL) {
        const connectionUrl = new URL(process.env.DATABASE_URL);
        if (connectionUrl.searchParams.get("sslmode") === "require")
          connectionUrl.searchParams.set("sslmode", "verify-full");
        pool = new pg.Pool({
          connectionString: connectionUrl.toString(),
          max: 3,
          connectionTimeoutMillis: 15000,
          idleTimeoutMillis: 10000,
        });
        pool.on("error", () => console.error("Database pool connection error"));
        // No schema work here: the deployment migrates with `npm run migrate`
        // on the direct endpoint, never from a serving instance on the pooled
        // one. migrations/README.md says why.
      } else
        throw Error(
          "DATABASE_URL is required: the store is Postgres only. Set YTI_DB=pglite for an in-process database.",
        );
    })().catch((e) => {
      ready = undefined;
      throw e;
    });
  await ready;
}
async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Row[]; changes: number }> {
  await initialize();
  const values = params.map((x) => (x === undefined ? null : x));
  const run = async (c: Connection) => {
    if (isPGlite(c)) {
      const r = await c.query<Row>(sql, values);
      return { rows: r.rows, changes: r.affectedRows ?? 0 };
    }
    const r = await c.query(sql, values);
    return { rows: r.rows as Row[], changes: r.rowCount || 0 };
  };
  const c = context.getStore();
  if (c) return run(c);
  if (pglite) return exclusive(() => run(pglite!));
  const client = await pool!.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}
export const database = {
  prepare(sql: string) {
    return {
      async get(...p: unknown[]) {
        return (await execute(sql, p)).rows[0];
      },
      async all(...p: unknown[]) {
        return (await execute(sql, p)).rows;
      },
      async run(...p: unknown[]) {
        return { changes: (await execute(sql, p)).changes };
      },
    };
  },
  async exec(sql: string) {
    await initialize();
    const c = context.getStore();
    if (c && isPGlite(c)) await c.exec(sql);
    else if (c) await c.query(sql);
    else if (pglite)
      await exclusive(async () => {
        await pglite!.exec(sql);
      });
    else await pool!.query(sql);
  },
  /**
   * One transaction on one client, pinned for the duration by
   * AsyncLocalStorage, so every statement inside fn() runs on it. A nested
   * transaction() flattens into the outer one: there are no savepoints, so an
   * inner failure rolls the whole outer transaction back and nothing the inner
   * call did survives. That is deliberate — never add a nested rollback
   * expectation.
   *
   * No global lock is taken here. Each call site guards exactly what it needs:
   * FOR UPDATE, FOR UPDATE SKIP LOCKED, a unique index with ON CONFLICT, or a
   * transaction-scoped advisory lock held for milliseconds.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await initialize();
    if (context.getStore()) return fn();
    const run = async (c: Connection) =>
      context.run(c, async () => {
        await simple(c, "BEGIN");
        try {
          const result = await fn();
          await simple(c, "COMMIT");
          return result;
        } catch (e) {
          await simple(c, "ROLLBACK");
          throw e;
        }
      });
    // PGlite has one connection, so its transactions cannot overlap; real
    // Postgres runs them concurrently and each call site guards its own rows.
    if (pglite) return exclusive(() => run(pglite!));
    const c = await pool!.connect();
    try {
      return await run(c);
    } finally {
      c.release();
    }
  },
  async close() {
    if (ready) await ready.catch(() => undefined);
    if (pool) await pool.end();
    if (pglite) await pglite.close();
    pool = undefined;
    pglite = undefined;
    ready = undefined;
  },
};
