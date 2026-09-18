import pg from "pg";
import {
  assertPreviewIsNotProduction,
  directConnectionString,
  migrate,
  poolClient,
} from "../src/server/youtube-intelligence/migrations/run.ts";
assertPreviewIsNotProduction();
const connectionUrl = new URL(directConnectionString());
if (connectionUrl.searchParams.get("sslmode") === "require")
  connectionUrl.searchParams.set("sslmode", "verify-full");
const pool = new pg.Pool({
  connectionString: connectionUrl.toString(),
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
