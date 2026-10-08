import pg from "pg";
import {
  assertPreviewIsNotProduction,
  assertConnectionPair,
  migrate,
  poolClient,
} from "../src/server/youtube-intelligence/migrations/run.ts";
assertPreviewIsNotProduction();
const connectionUrl = new URL(assertConnectionPair());
// Supabase signs its certificates with a private CA that Node does not trust
// (see database.ts). YTI_DB_SSL_CA carries that CA (PEM) and keeps the same
// guarantees as verify-full: chain checked against it, hostname against the
// certificate. The URL's sslmode is dropped so it cannot override this.
const sslCa = process.env.YTI_DB_SSL_CA?.trim();
if (sslCa) connectionUrl.searchParams.delete("sslmode");
else if (connectionUrl.searchParams.get("sslmode") === "require")
  connectionUrl.searchParams.set("sslmode", "verify-full");
const pool = new pg.Pool({
  connectionString: connectionUrl.toString(),
  ...(sslCa ? { ssl: { ca: sslCa, rejectUnauthorized: true } } : {}),
  max: 1,
  connectionTimeoutMillis: 15000,
});
const client = await pool.connect();
try {
  // Session-level advisory lock: legal because this is the direct endpoint.
  const { applied, stamped } = await migrate(poolClient(client), {
    lock: true,
    log: (line) => console.log(line),
  });
  console.log(
    applied.length === 0 && !stamped
      ? "Migrations already up to date."
      : `Migrations complete: ${applied.length} applied.`,
  );
} finally {
  client.release();
  await pool.end();
}
