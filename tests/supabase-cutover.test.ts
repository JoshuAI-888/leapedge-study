import test from "node:test";
import assert from "node:assert/strict";
import { assertConnectionPair, cluster, assertPreviewIsNotProduction, assertIsolatedDatabase } from "../src/server/youtube-intelligence/migrations/run.ts";
import { GET } from "../src/app/api/cron/intelligence/route.ts";

const prod = "aaaaaaaaaaaaaaaaaaaa";
const other = "bbbbbbbbbbbbbbbbbbbb";
const direct = (ref: string) => `postgres://postgres:secret@db.${ref}.supabase.co:5432/postgres`;
const pooled = (ref: string) => `postgres://postgres.${ref}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

test("Supabase endpoints match by project ref, not just by provider", () => {
  assert.equal(cluster(direct(prod)), cluster(pooled(prod)));
  assert.notEqual(cluster(direct(prod)), cluster(pooled(other)));
  assert.equal(cluster(direct(prod)), cluster(`db.${prod}.supabase.co`));
  assert.equal(cluster("postgres://user@ep-prod-pooler.us-east-1.aws.neon.tech/db"), cluster("ep-prod.us-east-1.aws.neon.tech"));
  assert.equal(cluster("aws-0-us-east-1.pooler.supabase.com"), undefined);
});

test("A preview cannot bypass the production guard by using its Supabase pooler", () => {
  const env = { VERCEL_ENV: "preview", YTI_PRODUCTION_DB_HOST: `db.${prod}.supabase.co`, DATABASE_URL_UNPOOLED: pooled(prod).replace(":6543/", ":5432/") };
  assert.throws(() => assertPreviewIsNotProduction(env), /production database/);
  assert.doesNotThrow(() => assertPreviewIsNotProduction({ ...env, DATABASE_URL_UNPOOLED: direct(other) }));
});

test("An isolated Supabase project is allowed, production and unknown identity are refused", () => {
  const env = { YTI_ISOLATED_DB: "true", YTI_PRODUCTION_DB_HOST: `db.${prod}.supabase.co`, DATABASE_URL: pooled(other) };
  assert.doesNotThrow(() => assertIsolatedDatabase("probe", env));
  assert.throws(() => assertIsolatedDatabase("probe", { ...env, DATABASE_URL: pooled(prod) }), /production database/);
  assert.throws(() => assertIsolatedDatabase("probe", { ...env, DATABASE_URL: "postgres://postgres:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres" }), /cannot be read/);
});

test("The cron dispatcher stays off by default, without opening a database", async () => {
  const saved = { secret: process.env.CRON_SECRET, cron: process.env.YTI_CRON_ENABLED, preview: process.env.YTI_PREVIEW_READ_ONLY, db: process.env.DATABASE_URL };
  try {
    process.env.CRON_SECRET = "x".repeat(40);
    delete process.env.YTI_PREVIEW_READ_ONLY;
    delete process.env.YTI_CRON_ENABLED;
    delete process.env.DATABASE_URL;
    const request = new Request("https://example.invalid/api/cron/intelligence", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    for (const flag of [undefined, "false", "TRUE", "1"]) {
      if (flag === undefined) delete process.env.YTI_CRON_ENABLED;
      else process.env.YTI_CRON_ENABLED = flag;
      const response = await GET(request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { skipped: true, reason: "Scheduled processing disabled" });
    }
    assert.equal((await GET(new Request(request.url))).status, 401);
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: saved.secret, YTI_CRON_ENABLED: saved.cron, YTI_PREVIEW_READ_ONLY: saved.preview, DATABASE_URL: saved.db })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test("Maintenance connections reject another Supabase project or a transaction pooler", () => {
  const env = { DATABASE_URL: pooled(prod), DATABASE_URL_UNPOOLED: direct(prod) };
  assert.equal(assertConnectionPair(env), direct(prod));
  assert.equal(assertConnectionPair({ ...env, DATABASE_URL_UNPOOLED: pooled(prod).replace(":6543/", ":5432/") }), pooled(prod).replace(":6543/", ":5432/"));
  assert.throws(() => assertConnectionPair({ ...env, DATABASE_URL_UNPOOLED: direct(other) }), /same project and database/);
  assert.throws(() => assertConnectionPair({ ...env, DATABASE_URL_UNPOOLED: pooled(prod) }), /transaction-pooled/);
  assert.throws(() => assertConnectionPair({ ...env, DATABASE_URL_UNPOOLED: direct(prod).replace(/\/postgres$/, "/different") }), /same project and database/);
  assert.throws(() => assertConnectionPair({ ...env, DATABASE_URL: undefined }), /DATABASE_URL must be set/);
});

test("Append-only protection keeps rejecting edits after its search_path is pinned", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const db = await freshDatabase();
  try {
    const config = await db.prepare("SELECT proconfig FROM pg_proc WHERE proname='yi_append_only'").get() as { proconfig: string[] };
    assert.ok(config.proconfig.includes("search_path=pg_catalog"));
    await db.prepare("INSERT INTO reviews(id,claim_id,reviewer_account_id,verdict) VALUES($1,$2,$3,$4)").run("review1", "claim1", "reviewer1", "verified");
    await assert.rejects(() => db.prepare("UPDATE reviews SET verdict=$1 WHERE id=$2").run("changed", "review1"), /append-only/);
    await assert.rejects(() => db.prepare("DELETE FROM reviews WHERE id=$1").run("review1"), /append-only/);
  } finally { await db.close(); }
});


test("Serving Supabase uses transaction pooling while preserving the saved secret", async () => {
  const { servingConnectionString } = await import("../src/server/youtube-intelligence/database.ts");
  const session = pooled(prod).replace(":6543/", ":5432/").replace("secret@", "p%40ss%23word@") + "?sslmode=require";
  const before = new URL(session), after = new URL(servingConnectionString(session));
  assert.equal(after.port, "6543");
  assert.equal(after.hostname, before.hostname);
  assert.equal(after.username, before.username);
  assert.equal(after.password, before.password);
  assert.equal(after.pathname, before.pathname);
  assert.equal(after.search, before.search);
  assert.equal(servingConnectionString(pooled(prod)), pooled(prod));
  assert.equal(new URL(servingConnectionString(session.replace(":5432/", "/"))).port, "6543");
  assert.equal(servingConnectionString(direct(prod)), direct(prod));
  const neon = "postgres://user:secret@ep-prod-pooler.us-east-1.aws.neon.tech/db?sslmode=require";
  assert.equal(servingConnectionString(neon), neon);
  assert.throws(() => servingConnectionString("https://example.invalid/secret"), /DATABASE_URL/);
  assert.throws(() => servingConnectionString("not-a-uri-secret"), /DATABASE_URL/);
  // Normalizing serving must never change the migration role.
  assert.equal(assertConnectionPair({ DATABASE_URL: session, DATABASE_URL_UNPOOLED: session }), session);
});
