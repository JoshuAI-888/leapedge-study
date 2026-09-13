import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
const schema = `
CREATE TABLE IF NOT EXISTS yi_runs(id TEXT PRIMARY KEY,video_id TEXT,url TEXT,model TEXT,prompt_version TEXT,title TEXT,status TEXT,stage TEXT,created_at TEXT,updated_at TEXT,error TEXT,input TEXT,output TEXT,cost DOUBLE PRECISION DEFAULT 0,lease_until BIGINT DEFAULT 0,lease_token TEXT);
CREATE TABLE IF NOT EXISTS yi_calls(id TEXT PRIMARY KEY,run_id TEXT,stage TEXT,status TEXT,amount DOUBLE PRECISION,metrics TEXT);
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
type Connection = pg.PoolClient | DatabaseSync;
const context = new AsyncLocalStorage<Connection>();
let pool: pg.Pool | undefined,
  sqlite: DatabaseSync | undefined,
  ready: Promise<void> | undefined;
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
      if (process.env.DATABASE_URL) {
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
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          await c.query("SELECT pg_advisory_xact_lock(78941001)");
          await c.query(schema);
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      } else {
        if (process.env.VERCEL)
          throw Error("DATABASE_URL is required on Vercel.");
        mkdirSync("data", { recursive: true });
        sqlite = new DatabaseSync(
          process.env.YTI_DB_PATH || "data/intelligence.sqlite",
        );
        sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
        sqlite.exec(schema);
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
    const r = await c.query(postgresSQL(sql), params);
    return { rows: r.rows as Row[], changes: r.rowCount || 0 };
  };
  const c = context.getStore();
  if (c) return run(c);
  if (sqlite) return exclusive(() => run(sqlite!));
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
    else if (c) await c.query(postgresSQL(sql));
    else if (sqlite)
      await exclusive(async () => {
        sqlite!.exec(sql);
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
          await c.query("BEGIN");
          await c.query("SELECT pg_advisory_xact_lock(78941002)");
        }
        try {
          const result = await fn();
          if (c instanceof DatabaseSync) c.exec("COMMIT");
          else await c.query("COMMIT");
          return result;
        } catch (e) {
          if (c instanceof DatabaseSync) c.exec("ROLLBACK");
          else await c.query("ROLLBACK");
          throw e;
        }
      });
    if (sqlite) return exclusive(() => run(sqlite!));
    const c = await pool!.connect();
    try {
      return await run(c);
    } finally {
      c.release();
    }
  },
  async close() {
    if (pool) await pool.end();
    sqlite?.close();
    pool = undefined;
    sqlite = undefined;
    ready = undefined;
  },
};
