import test from "node:test";
import assert from "node:assert/strict";
import { cluster, assertPreviewIsNotProduction, assertIsolatedDatabase } from "../src/server/youtube-intelligence/migrations/run.ts";
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
