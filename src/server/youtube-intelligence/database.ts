import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import pg from "pg";
// DATE is a calendar label, not a local-midnight instant. Auckland midnight
// converted to UTC otherwise shifts every price and settlement back a day.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
import type { PGlite } from "@electric-sql/pglite";
import {
  cluster,
  directConnectionString,
  migrate,
  pgliteClient,
} from "./migrations/run.ts";
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
export type ConnectionRole = "pooled" | "direct";
/**
 * Which of the two endpoints this process opens. A Next.js function and the
 * cron route take the POOLED one (DATABASE_URL, whose host carries -pooler):
 * many short-lived instances, a handful of clients each. A maintenance script
 * calls useDirectConnection() and gets the DIRECT one through
 * directConnectionString(), so no script reads DATABASE_URL_UNPOOLED itself.
 *
 * The direct endpoint is not a preference. DDL, session-level advisory locks
 * (pg_advisory_lock), SET, temporary tables and pg_dump are all unavailable
 * through a transaction-mode pooler, and the dangerous half of that list does
 * not error: the statement succeeds against a session the pooler then hands to
 * another client, and the effect is silently discarded.
 */
export function connectionRole(
  env: Record<string, string | undefined> = process.env,
): ConnectionRole {
  return env.YTI_DB_ROLE === "direct" ? "direct" : "pooled";
}
let directRequested = false;
/**
 * Opt this process into the DIRECT endpoint. A maintenance script calls this
 * before its first query, so the choice lives in the script rather than in the
 * shell line that starts it: `node scripts/postgres-check.ts` and
 * `npm run db:check` then open the same endpoint. YTI_DB_ROLE=direct does the
 * same thing from outside and the npm aliases still set it, but a script that
 * needs the direct endpoint must not depend on being started a particular way.
 *
 * DDL, session-level advisory locks (pg_advisory_lock), SET, temporary tables
 * and pg_dump are all unavailable through a transaction-mode pooler, and the
 * dangerous half of that list does not error: the statement succeeds against a
 * session the pooler then hands to another client, and the effect is silently
 * discarded.
 */
export function useDirectConnection() {
  if (ready)
    throw Error(
      "useDirectConnection() must be called before the first query: the role picks the connection string.",
    );
  directRequested = true;
}
function hostOf(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}
function connectionString(
  env: Record<string, string | undefined> = process.env,
) {
  if (directRequested || connectionRole(env) === "direct") {
    const direct = directConnectionString(env);
    // The guards a maintenance script runs first inspect DATABASE_URL, so a
    // DATABASE_URL_UNPOOLED pointing somewhere else would slip past them and be
    // written to. Neon issues the pair together and they differ only by
    // -pooler; anything else is a hand-edited mistake. Names only, no values.
    //
    // DATABASE_URL is required here even though this branch does not use it:
    // before the two roles existed, every script needed it and could not run
    // without it, and skipping the comparison when it is absent would hand that
    // invariant back — `restore-research.ts` would write to whatever the direct
    // endpoint named, with nothing having checked it.
    const pooled = hostOf(env.DATABASE_URL),
      unpooled = hostOf(direct);
    if (!pooled)
      throw Error(
        "DATABASE_URL must be set alongside DATABASE_URL_UNPOOLED, so the direct endpoint can be checked against it.",
      );
    if (!unpooled)
      throw Error("The host of DATABASE_URL_UNPOOLED cannot be read.");
    if (unpooled.includes("-pooler"))
      throw Error(
        "DATABASE_URL_UNPOOLED names a pooled endpoint: session locks and DDL would be discarded without erroring. Use the direct endpoint.",
      );
    if (cluster(pooled) !== cluster(unpooled))
      throw Error(
        "DATABASE_URL and DATABASE_URL_UNPOOLED are not the two endpoints of one database: point both at the same branch.",
      );
    return direct;
  }
  const value = env.DATABASE_URL?.trim();
  if (!value)
    throw Error(
      "DATABASE_URL is required: the store is Postgres only. Set YTI_DB=pglite for an in-process database.",
    );
  return value;
}
const DEFAULT_POOL_MAX = 4;
/**
 * Clients this instance may hold. Deliberately NOT derived from
 * processing.parallelVideos: that number lives in a team-preferences document
 * which is read *through* this pool, so it cannot size the pool that fetches
 * it. Neon's pooler multiplexes many instances onto few Postgres backends, so
 * the ceiling that matters is per instance, and an unreadable value falls back
 * rather than failing a serving instance.
 */
export function poolMax(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.YTI_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 64
    ? value
    : DEFAULT_POOL_MAX;
}
/**
 * The newest migration this checkout carries, and therefore the schema every
 * query in src/ is written against. It is a literal because a bundled Next
 * server cannot read migrations/*.sql — migrationsDirectory() resolves from
 * import.meta.url, which a bundle rewrites — so it cannot be derived at
 * runtime. It cannot drift silently either: a test asserts it equals the
 * highest version loadMigrations() finds on disk, so adding 0003_*.sql without
 * raising this number fails `npm test`.
 */
export const SCHEMA_VERSION = 6;
/**
 * Fail fast in one direction only. BEHIND means the database has not got the
 * tables or columns this code queries, so every statement is a guess: refuse
 * before serving anything. AHEAD is normal and must pass — a deploy migrates
 * on the direct endpoint before the new bundle serves, and a rollback leaves
 * the newer schema in place with an older bundle on top. No caller here
 * creates or alters a table; migrations are the only source of schema.
 */
export function assertSchemaVersion(
  applied: number,
  required: number = SCHEMA_VERSION,
) {
  if (applied < required)
    throw Error(`Schema version ${required} required, ${applied} applied`);
}
/** undefined_table: no yi_migrations, so nothing has been applied. */
const UNDEFINED_TABLE = "42P01";
/** Exported for the test that pins which failures may read as "0 applied". */
export async function appliedSchemaVersion(
  query: (sql: string) => Promise<Row[]>,
): Promise<number> {
  try {
    const rows = await query(
      "SELECT COALESCE(MAX(version),0) AS version FROM yi_migrations",
    );
    return Number(rows[0]?.version ?? 0);
  } catch (e) {
    // Only a missing table means nothing is applied. A dropped connection, a
    // suspending compute or a refused login must stay what they are: read as
    // "0 applied" they would surface on a correctly migrated database as a
    // schema-skew refusal, which is both false and the opposite of the rule
    // that a lost connection is ordinary.
    if ((e as { code?: unknown })?.code !== UNDEFINED_TABLE) throw e;
    return 0;
  }
}
export type DatabaseErrorClass = "retryable" | "fatal";
// Connection-level SQLSTATEs (class 08) plus the shutdown, cannot-connect-now
// and too-many-connections ones Neon raises when it suspends or recycles.
const RETRYABLE_SQLSTATE = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);
const RETRYABLE_ERRNO = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EAI_AGAIN",
]);
const RETRYABLE_TEXT =
  /connection terminated|terminating connection|not queryable|socket hang up|server closed the connection|connection closed/i;
/**
 * Is this database failure worth another attempt? Neon suspends an idle compute
 * and the pooler recycles connections, so a dropped connection is an ordinary
 * event rather than a defect: classify it retryable and let the caller open a
 * new one. A constraint violation, a syntax error or a missing relation is
 * fatal — repeating it repeats the same answer.
 */
export function classifyDatabaseError(error: unknown): DatabaseErrorClass {
  if (!error || typeof error !== "object") return "fatal";
  const e = error as { code?: unknown; errno?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if (RETRYABLE_SQLSTATE.has(code) || RETRYABLE_ERRNO.has(code))
    return "retryable";
  const errno = typeof e.errno === "string" ? e.errno : "";
  if (RETRYABLE_ERRNO.has(errno)) return "retryable";
  const message = typeof e.message === "string" ? e.message : "";
  return RETRYABLE_TEXT.test(message) ? "retryable" : "fatal";
}
export function isRetryableDatabaseError(error: unknown) {
  return classifyDatabaseError(error) === "retryable";
}
/**
 * Runs a read once more when the first attempt failed on a dropped connection.
 * The statement this guards is a SELECT, so repeating it is free of
 * consequence, and the first statement after a cold start is the likely one to
 * meet a compute that has just suspended. Nothing that writes is retried
 * anywhere: a run whose transaction was cut stays leased until its lease
 * expires and is re-claimed.
 */
async function readOnceMore<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (!isRetryableDatabaseError(e)) throw e;
    return read();
  }
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
async function attachPool(instance: pg.Pool) {
  // maxDuration = 800 on the cron route implies Fluid Compute, where an
  // invocation can be suspended with clients still checked out; an idle client
  // is an idle Neon connection held open for nothing. attachDatabasePool()
  // closes the pool when the instance suspends or shuts down. The specifier is
  // a literal so Next bundles and traces it — the opposite of loadPGlite(),
  // which hides a dev-only package behind a variable. A failure here must not
  // stop a local run or the PGlite test path, which never reach this function.
  try {
    const { attachDatabasePool } = await import("@vercel/functions");
    attachDatabasePool(instance);
  } catch {
    console.error(
      "attachDatabasePool is unavailable; the pool is not attached",
    );
  }
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
        assertSchemaVersion(
          await appliedSchemaVersion(
            async (sql) => (await instance.query<Row>(sql)).rows,
          ),
        );
        pglite = instance;
      } else {
        const connectionUrl = new URL(connectionString());
        if (connectionUrl.searchParams.get("sslmode") === "require")
          connectionUrl.searchParams.set("sslmode", "verify-full");
        const instance = new pg.Pool({
          connectionString: connectionUrl.toString(),
          max: poolMax(),
          connectionTimeoutMillis: 15000,
          idleTimeoutMillis: 10000,
        });
        instance.on("error", (error) =>
          // A client can fail while idle, which pg reports here rather than to a
          // caller. It has already discarded that client, so the next connect()
          // opens a fresh one. The classification here is diagnostic only —
          // nothing is retried from this handler, and "retryable" means a
          // suspended compute or a recycled pooler connection rather than a
          // defect to investigate. Recovery is pg discarding the client plus
          // lease expiry: a run whose transaction was cut stays leased until it
          // expires and is re-claimed. readOnceMore() is where the same
          // classification does decide something.
          console.error(
            `Database pool connection error (${classifyDatabaseError(error)})`,
          ),
        );
        await attachPool(instance);
        // No schema work here: the deployment migrates with `npm run migrate`
        // on the direct endpoint, never from a serving instance on the pooled
        // one. migrations/README.md says why. It is still checked, because a
        // bundle older than the schema is fine and a bundle newer than it is
        // not. The pool is published only once it passes, so a refusal leaves
        // no connections behind for the retry initialize() allows.
        try {
          assertSchemaVersion(
            await readOnceMore(() =>
              appliedSchemaVersion(
                async (sql) => (await instance.query(sql)).rows as Row[],
              ),
            ),
          );
        } catch (e) {
          await instance.end().catch(() => undefined);
          throw e;
        }
        pool = instance;
      }
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
