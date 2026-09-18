import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SCHEMA_VERSION,
  appliedSchemaVersion,
  assertSchemaVersion,
  classifyDatabaseError,
  connectionRole,
  isRetryableDatabaseError,
  poolMax,
} from "../src/server/youtube-intelligence/database.ts";
import { loadMigrations } from "../src/server/youtube-intelligence/migrations/run.ts";
import {
  missingRequired,
  missingRequiredHosted,
  readEnv,
} from "../src/server/youtube-intelligence/env.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
/**
 * Pure functions only. Nothing here opens a pool: the two connection roles are
 * exercised as string selection, and the version check as arithmetic, so the
 * suite still runs with no keys, no network and no Postgres.
 */
test("The schema check refuses a database that is behind and accepts one that is ahead", () => {
  // The message is the brief's literal, with nothing after "applied", so that a
  // build log grepped for it matches the whole line rather than a prefix.
  assert.throws(
    () => assertSchemaVersion(1, 2),
    /^Error: Schema version 2 required, 1 applied$/,
  );
  // A database with no yi_migrations at all reads as version 0.
  assert.throws(
    () => assertSchemaVersion(0, 2),
    /Schema version 2 required, 0 applied/,
  );
  // Equal passes, and AHEAD must pass: during a deploy the migration lands
  // before the new bundle serves, and a rollback leaves the newer schema with an
  // older bundle on top. Neither is an error.
  assert.doesNotThrow(() => assertSchemaVersion(2, 2));
  assert.doesNotThrow(() => assertSchemaVersion(3, 2));
  assert.doesNotThrow(() => assertSchemaVersion(99, 2));
});
test("Only a missing yi_migrations reads as nothing applied", async () => {
  const failing = (error: unknown) => async () => {
    throw error;
  };
  assert.equal(await appliedSchemaVersion(async () => [{ version: 2 }]), 2);
  assert.equal(await appliedSchemaVersion(async () => []), 0);
  assert.equal(
    await appliedSchemaVersion(
      failing(
        Object.assign(Error('relation "yi_migrations" does not exist'), {
          code: "42P01",
        }),
      ),
    ),
    0,
  );
  // A lost connection is not an empty schema. Swallowing it would turn a
  // routine blip on a correctly migrated database into a schema-skew refusal.
  for (const error of [
    Object.assign(Error("Connection terminated unexpectedly"), {
      code: "ECONNRESET",
    }),
    Object.assign(
      Error("terminating connection due to administrator command"),
      {
        code: "57P01",
      },
    ),
    Object.assign(Error("password authentication failed"), { code: "28P01" }),
  ])
    await assert.rejects(() => appliedSchemaVersion(failing(error)), {
      message: (error as Error).message,
    });
});
test("The maintenance scripts take the direct endpoint themselves", async () => {
  // A guarantee that lives in an npm alias evaporates the first time someone
  // runs the file the way every other script in scripts/ is run, and a
  // transaction-mode pooler discards session-scoped work without erroring.
  for (const file of [
    "scripts/postgres-check.ts",
    "scripts/export-research.ts",
    "scripts/restore-research.ts",
  ]) {
    const text = await readFile(file, "utf8");
    const call = text.indexOf("useDirectConnection();");
    assert.ok(call > 0, `${file} must call useDirectConnection()`);
    assert.ok(
      call < text.indexOf("await "),
      `${file} must call useDirectConnection() before its first query`,
    );
  }
});
test(".env.example names the database variables and none that were deleted", async () => {
  const text = await readFile(".env.example", "utf8");
  for (const key of [
    "DATABASE_URL=",
    "DATABASE_URL_UNPOOLED=",
    "YTI_PRODUCTION_DB_HOST=",
    "YTI_POOL_MAX=",
    "YTI_QUEUE_PAUSED=",
  ])
    assert.ok(text.includes(key), `.env.example must name ${key}`);
  for (const gone of ["YTI_DB_PATH", "SQLite", "sqlite"])
    assert.ok(!text.includes(gone), `.env.example still mentions ${gone}`);
});
test("SCHEMA_VERSION is the newest migration in this checkout", async () => {
  const files = await loadMigrations();
  assert.equal(
    SCHEMA_VERSION,
    files.reduce((n, f) => (f.version > n ? f.version : n), 0),
    "add the new migration's version to SCHEMA_VERSION in database.ts",
  );
  assert.doesNotThrow(() => assertSchemaVersion(SCHEMA_VERSION));
  assert.throws(() => assertSchemaVersion(SCHEMA_VERSION - 1));
});
test("YTI_POOL_MAX is honoured and defaults to 4", () => {
  assert.equal(poolMax({}), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "" }), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "  " }), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "1" }), 1);
  assert.equal(poolMax({ YTI_POOL_MAX: "12" }), 12);
  // An unusable value falls back rather than failing a serving instance.
  assert.equal(poolMax({ YTI_POOL_MAX: "0" }), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "-2" }), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "2.5" }), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "lots" }), 4);
  assert.equal(poolMax({ YTI_POOL_MAX: "9001" }), 4);
});
test("The pooled endpoint is the default role and only YTI_DB_ROLE=direct changes it", () => {
  assert.equal(connectionRole({}), "pooled");
  assert.equal(connectionRole({ YTI_DB_ROLE: "pooled" }), "pooled");
  assert.equal(connectionRole({ YTI_DB_ROLE: "Direct" }), "pooled");
  assert.equal(connectionRole({ YTI_DB_ROLE: "direct" }), "direct");
});
test("A dropped Neon connection is retryable and a rejected statement is not", () => {
  for (const error of [
    { code: "57P01" }, // admin shutdown: the compute suspended
    { code: "08006" }, // connection failure
    { code: "53300" }, // too many connections
    { code: "ECONNRESET" },
    { errno: "EPIPE" },
    Error("Connection terminated unexpectedly"),
    Error("Client has encountered a connection error and is not queryable"),
    Error("socket hang up"),
  ])
    assert.equal(classifyDatabaseError(error), "retryable", String(error));
  for (const error of [
    { code: "23505" }, // unique violation
    { code: "42P01" }, // undefined table
    { code: "42601" }, // syntax error
    Error("Stale fencing token"),
    undefined,
    null,
    "a string",
  ])
    assert.equal(classifyDatabaseError(error), "fatal", String(error));
  assert.equal(isRetryableDatabaseError({ code: "08003" }), true);
  assert.equal(isRetryableDatabaseError({ code: "23505" }), false);
});
test("missingRequiredHosted() names the hosted keys and never a value", () => {
  const all = missingRequiredHosted(readEnv({}));
  assert.deepEqual(all, [
    "DATABASE_URL_UNPOOLED",
    "YTI_PRODUCTION_DB_HOST",
    "CRON_SECRET",
    "YTI_ACCESS_TOKEN",
    "YTI_APP_ORIGIN",
  ]);
  const values = {
    DATABASE_URL_UNPOOLED: "postgres://u:hunter2@db.example/neondb",
    YTI_PRODUCTION_DB_HOST: "ep-prod.example.neon.tech",
    CRON_SECRET: "s".repeat(40),
  };
  const some = missingRequiredHosted(readEnv(values));
  assert.deepEqual(some, ["YTI_ACCESS_TOKEN", "YTI_APP_ORIGIN"]);
  for (const value of Object.values(values))
    assert.ok(
      !some.join(" ").includes(value) && !all.join(" ").includes(value),
      "the report leaked a value",
    );
  assert.deepEqual(
    missingRequiredHosted(
      readEnv({
        ...values,
        YTI_ACCESS_TOKEN: "t".repeat(40),
        YTI_APP_ORIGIN: "https://example.vercel.app",
      }),
    ),
    [],
  );
  // A blank variable is unset, not set to "".
  assert.deepEqual(missingRequiredHosted(readEnv({ CRON_SECRET: "  " })), all);
});
test("The hosted keys stay out of missingRequired(), which gates a serving instance", () => {
  // A serving instance never opens the direct endpoint, so it must not be told
  // it is missing a variable it does not use; the build step and the maintenance
  // scripts are what need DATABASE_URL_UNPOOLED, and directConnectionString()
  // refuses there. missingRequired() therefore keeps its previous contract.
  const missing = missingRequired(readEnv({}), teamDefaults());
  assert.ok(missing.includes("DATABASE_URL"));
  assert.ok(!missing.includes("DATABASE_URL_UNPOOLED"));
  assert.ok(!missing.includes("CRON_SECRET"));
  assert.ok(!missing.includes("YTI_POOL_MAX"));
});
test("readEnv() accepts the new hosted keys and still reports only key names", () => {
  const env = readEnv({
    DATABASE_URL_UNPOOLED: "postgres://direct",
    YTI_POOL_MAX: "6",
    YTI_QUEUE_PAUSED: "true",
    YTI_BUDGET_USD: "15",
    YTI_TRANSCRIPT_CREDIT_BUDGET: "90",
    YTI_PREVIEW_READ_ONLY: "true",
    RESEND_WEBHOOK_SECRET: "whsec_test",
  });
  assert.equal(env.YTI_POOL_MAX, 6);
  assert.equal(env.YTI_QUEUE_PAUSED, "true");
  assert.equal(env.YTI_BUDGET_USD, 15);
  assert.equal(env.YTI_TRANSCRIPT_CREDIT_BUDGET, 90);
  assert.throws(
    () => readEnv({ YTI_POOL_MAX: "sixteen" }),
    (e: unknown) => {
      assert.match((e as Error).message, /YTI_POOL_MAX/);
      assert.doesNotMatch((e as Error).message, /sixteen/);
      return true;
    },
  );
});
