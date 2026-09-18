import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";
import { migrate, pgliteClient } from "./migrations/run.ts";
// The SQLite schema only. Every Postgres database, PGlite included, is built by
// the numbered files under migrations/, which are the single source of truth.
const schema = `
CREATE TABLE IF NOT EXISTS yi_runs(id TEXT PRIMARY KEY,video_id TEXT,url TEXT,model TEXT,prompt_version TEXT,title TEXT,status TEXT,stage TEXT,created_at TEXT,updated_at TEXT,error TEXT,input TEXT,output TEXT,cost DOUBLE PRECISION DEFAULT 0,lease_until BIGINT DEFAULT 0,lease_token TEXT);
CREATE TABLE IF NOT EXISTS yi_calls(id TEXT PRIMARY KEY,run_id TEXT,stage TEXT,status TEXT,amount DOUBLE PRECISION,metrics TEXT,attempt INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS yi_responses(id TEXT PRIMARY KEY,run_id TEXT,stage TEXT,payload TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS yi_heartbeat(id INTEGER PRIMARY KEY,at BIGINT);
CREATE TABLE IF NOT EXISTS yi_documents(kind TEXT,id TEXT,payload TEXT,created_at TEXT,updated_at TEXT,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS yi_events(id TEXT PRIMARY KEY,kind TEXT,entity_id TEXT,at TEXT,payload TEXT);
CREATE TABLE IF NOT EXISTS yi_prompts(id TEXT PRIMARY KEY,hash TEXT UNIQUE,payload TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS yi_discoveries(video_id TEXT PRIMARY KEY,channel_id TEXT,payload TEXT,discovered_at TEXT,run_id TEXT);
CREATE TABLE IF NOT EXISTS yi_shares(token_hash TEXT PRIMARY KEY,id TEXT UNIQUE,snapshot TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);
CREATE INDEX IF NOT EXISTS yi_runs_queue ON yi_runs(status,lease_until,created_at);
CREATE INDEX IF NOT EXISTS yi_calls_run_stage ON yi_calls(run_id,stage);
CREATE INDEX IF NOT EXISTS yi_documents_kind ON yi_documents(kind,created_at);
CREATE INDEX IF NOT EXISTS yi_discoveries_channel ON yi_discoveries(channel_id,discovered_at);
`;
type Row = Record<string, unknown>;
/**
 * A database created before attempts were keyed (spec section 4.4) has no
 * yi_calls.attempt column. SQLite has no ADD COLUMN IF NOT EXISTS, so its
 * column list is inspected first; the Postgres form is in 0001_baseline.sql.
 */
const attemptIndex =
  "CREATE INDEX IF NOT EXISTS yi_calls_run_stage_attempt ON yi_calls(run_id,stage,attempt)";
function sqliteMigrate(c: DatabaseSync) {
  const columns = c.prepare("PRAGMA table_info(yi_calls)").all() as Row[];
  if (!columns.some((column) => column.name === "attempt"))
    c.exec("ALTER TABLE yi_calls ADD COLUMN attempt INTEGER DEFAULT 1");
  c.exec(attemptIndex);
}
// PGlite is an in-process, single-connection Postgres used by tests
// (YTI_DB=pglite). It shares the pg.Pool code path: postgresSQL() rewriting,
// $n placeholders and the same migrations.
type Connection = pg.PoolClient | DatabaseSync | PGlite;
const context = new AsyncLocalStorage<Connection>();
let pool: pg.Pool | undefined,
  sqlite: DatabaseSync | undefined,
  pglite: PGlite | undefined,
  ready: Promise<void> | undefined;
function isPGlite(c: Connection): c is PGlite {
  return pglite !== undefined && c === pglite;
}
// One statement, no parameters, on either Postgres driver.
async function simple(c: pg.PoolClient | PGlite, sql: string) {
  if (isPGlite(c)) await c.query(sql);
  else await c.query(sql);
}
export type DriverName = "pg" | "sqlite" | "pglite";
export function driverName(): DriverName | undefined {
  if (pool) return "pg";
  if (pglite) return "pglite";
  if (sqlite) return "sqlite";
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
export function postgresSQL(sql: string) {
  let index = 0;
  // Skip quoted SQL strings; all external values remain parameterized.
  sql = sql.replace(/'(?:''|[^'])*'|\?/g, (s) =>
    s === "?" ? `$${++index}` : s,
  );
  sql = sql.replace(
    /json_extract\(payload, '\$\.publishedAt'\)/g,
    "(payload::jsonb ->> 'publishedAt')",
  );
  if (sql.includes("INSERT OR IGNORE"))
    sql = sql.replace("INSERT OR IGNORE", "INSERT") + " ON CONFLICT DO NOTHING";
  if (sql.includes("INSERT OR REPLACE INTO yi_heartbeat"))
    sql =
      sql.replace("INSERT OR REPLACE", "INSERT") +
      " ON CONFLICT(id) DO UPDATE SET at=excluded.at";
  return sql;
}
async function initialize() {
  if (!ready)
    ready = (async () => {
      if (process.env.YTI_DB === "pglite") {
        const { PGlite: Driver } = await loadPGlite();
        const instance = await Driver.create();
        // Single connection: no advisory lock is needed (or meaningful) here.
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
      } else {
        if (process.env.VERCEL)
          throw Error("DATABASE_URL is required on Vercel.");
        mkdirSync("data", { recursive: true });
        sqlite = new DatabaseSync(
          process.env.YTI_DB_PATH || "data/intelligence.sqlite",
        );
        sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
        sqlite.exec(schema);
        sqliteMigrate(sqlite);
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
  const run = async (c: Connection) => {
    if (c instanceof DatabaseSync) {
      const p = params.map((x) => (x === undefined ? null : x)) as (
        string | number | bigint | null | Uint8Array
      )[];
      const statement = c.prepare(sql);
      if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql))
        return { rows: statement.all(...p) as Row[], changes: 0 };
      return { rows: [], changes: Number(statement.run(...p).changes) };
    }
    if (isPGlite(c)) {
      const r = await c.query<Row>(
        postgresSQL(sql),
        params.map((x) => (x === undefined ? null : x)),
      );
      return { rows: r.rows, changes: r.affectedRows ?? 0 };
    }
    const r = await c.query(postgresSQL(sql), params);
    return { rows: r.rows as Row[], changes: r.rowCount || 0 };
  };
  const c = context.getStore();
  if (c) return run(c);
  if (sqlite) return exclusive(() => run(sqlite!));
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
    if (c instanceof DatabaseSync) c.exec(sql);
    else if (c && isPGlite(c)) await c.exec(postgresSQL(sql));
    else if (c) await c.query(postgresSQL(sql));
    else if (sqlite)
      await exclusive(async () => {
        sqlite!.exec(sql);
      });
    else if (pglite)
      await exclusive(async () => {
        await pglite!.exec(postgresSQL(sql));
      });
    else await pool!.query(postgresSQL(sql));
  },
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await initialize();
    if (context.getStore()) return fn();
    const run = async (c: Connection) =>
      context.run(c, async () => {
        if (c instanceof DatabaseSync) c.exec("BEGIN IMMEDIATE");
        else {
          await simple(c, "BEGIN");
          // PGlite has one connection and transactions are serialized by
          // exclusive(), so the global advisory lock is skipped there; it
          // could never contend and would only mask real-Postgres behaviour.
          if (!isPGlite(c))
            await c.query("SELECT pg_advisory_xact_lock(78941002)");
        }
        try {
          const result = await fn();
          if (c instanceof DatabaseSync) c.exec("COMMIT");
          else await simple(c, "COMMIT");
          return result;
        } catch (e) {
          if (c instanceof DatabaseSync) c.exec("ROLLBACK");
          else await simple(c, "ROLLBACK");
          throw e;
        }
      });
    if (sqlite) return exclusive(() => run(sqlite!));
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
    sqlite?.close();
    if (pglite) await pglite.close();
    pool = undefined;
    sqlite = undefined;
    pglite = undefined;
    ready = undefined;
  },
};
