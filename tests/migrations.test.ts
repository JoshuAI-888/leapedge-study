import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  assertPreviewIsNotProduction,
  directConnectionString,
  loadMigrations,
  migrate,
  pgliteClient,
} from "../src/server/youtube-intelligence/migrations/run.ts";
const BASELINE_TABLES = [
  "yi_calls",
  "yi_discoveries",
  "yi_documents",
  "yi_events",
  "yi_heartbeat",
  "yi_prompts",
  "yi_responses",
  "yi_runs",
  "yi_shares",
];
async function blank() {
  const instance = await PGlite.create();
  return { instance, client: pgliteClient(instance) };
}
async function tables(instance: PGlite) {
  const rows = (
    await instance.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    )
  ).rows;
  return rows.map((r) => r.table_name);
}
async function versions(instance: PGlite) {
  const rows = (
    await instance.query<{ version: number; name: string; checksum: string }>(
      "SELECT version,name,checksum FROM yi_migrations ORDER BY version",
    )
  ).rows;
  return rows;
}
const temporary: string[] = [];
async function directory(sql: string) {
  const dir = await mkdtemp(join(tmpdir(), "yi-migrations-"));
  temporary.push(dir);
  await writeFile(join(dir, "0001_baseline.sql"), sql);
  return dir;
}
after(async () => {
  for (const dir of temporary) await rm(dir, { recursive: true, force: true });
});
test("Migrations apply the baseline once and do nothing on the second run", async () => {
  const { instance, client } = await blank();
  try {
    const all = (await loadMigrations()).map((m) => m.version);
    const first = await migrate(client);
    assert.deepEqual(first, { applied: all, stamped: false });
    const second = await migrate(client);
    assert.deepEqual(second, { applied: [], stamped: false });
    const recorded = await versions(instance);
    assert.deepEqual(
      recorded.map((r) => Number(r.version)),
      all,
    );
    assert.equal(recorded[0].name, "baseline");
    const present = await tables(instance);
    for (const t of [...BASELINE_TABLES, "yi_migrations"])
      assert.ok(present.includes(t), `${t} exists`);
    const index = (
      await instance.query(
        "SELECT indexname FROM pg_indexes WHERE indexname='yi_runs_queue'",
      )
    ).rows;
    assert.equal(index.length, 1);
  } finally {
    await instance.close();
  }
});
test("An applied migration edited afterwards is rejected by its checksum", async () => {
  const dir = await directory(
    "CREATE TABLE IF NOT EXISTS yi_runs(id TEXT PRIMARY KEY);\n",
  );
  const { instance, client } = await blank();
  try {
    assert.deepEqual((await migrate(client, { directory: dir })).applied, [1]);
    await writeFile(
      join(dir, "0001_baseline.sql"),
      "CREATE TABLE IF NOT EXISTS yi_runs(id TEXT PRIMARY KEY,url TEXT);\n",
    );
    await assert.rejects(
      () => migrate(client, { directory: dir }),
      /version 1 was edited after it was applied/,
    );
  } finally {
    await instance.close();
  }
});
test("A database that already has the baseline is stamped at version 1", async () => {
  const { instance, client } = await blank();
  const lines: string[] = [];
  try {
    await instance.exec("CREATE TABLE yi_runs(id TEXT PRIMARY KEY)");
    const later = (await loadMigrations())
      .map((m) => m.version)
      .filter((v) => v !== 1);
    const result = await migrate(client, { log: (line) => lines.push(line) });
    assert.equal(result.stamped, true);
    assert.deepEqual(result.applied, later);
    assert.equal(lines.filter((l) => l.startsWith("Stamped")).length, 1);
    const recorded = await versions(instance);
    assert.equal(Number(recorded[0].version), 1);
    assert.equal(recorded[0].name, "baseline");
    const baseline = (await loadMigrations()).find((m) => m.version === 1)!;
    assert.equal(recorded[0].checksum, baseline.checksum);
    // 0001 never ran, so the tables it would have created are still absent.
    assert.equal((await tables(instance)).includes("yi_documents"), false);
    assert.deepEqual((await migrate(client)).applied, []);
  } finally {
    await instance.close();
  }
});
test("A failing migration leaves nothing behind and the next run retries it", async () => {
  const dir = await directory(
    "CREATE TABLE IF NOT EXISTS yi_probe(id TEXT PRIMARY KEY);\nSELECT not_a_function();\n",
  );
  const { instance, client } = await blank();
  try {
    await assert.rejects(() => migrate(client, { directory: dir }));
    assert.equal((await tables(instance)).includes("yi_probe"), false);
    assert.deepEqual(await versions(instance), []);
    await writeFile(
      join(dir, "0001_baseline.sql"),
      "CREATE TABLE IF NOT EXISTS yi_probe(id TEXT PRIMARY KEY);\n",
    );
    assert.deepEqual((await migrate(client, { directory: dir })).applied, [1]);
    assert.equal((await tables(instance)).includes("yi_probe"), true);
  } finally {
    await instance.close();
  }
});
test("The preview guard refuses a preview pointed at the production host", () => {
  const env = {
    VERCEL_ENV: "preview",
    YTI_PRODUCTION_DB_HOST: "primary.db.invalid",
    DATABASE_URL_UNPOOLED: "postgres://role@primary.db.invalid/main",
  };
  assert.throws(
    () => assertPreviewIsNotProduction(env),
    (e: Error) =>
      /A preview deployment tried to migrate the production database/.test(
        e.message,
      ) &&
      !e.message.includes("primary.db.invalid") &&
      !e.message.includes("postgres://"),
  );
  assert.doesNotThrow(() =>
    assertPreviewIsNotProduction({
      ...env,
      DATABASE_URL_UNPOOLED: "postgres://role@branch.db.invalid/main",
    }),
  );
  assert.doesNotThrow(() =>
    assertPreviewIsNotProduction({ ...env, VERCEL_ENV: "production" }),
  );
  assert.throws(
    () =>
      assertPreviewIsNotProduction({
        ...env,
        DATABASE_URL_UNPOOLED: undefined,
      }),
    /A preview deployment tried to migrate the production database/,
  );
});
test("The preview guard refuses when YTI_PRODUCTION_DB_HOST is unset", () => {
  for (const guard of [undefined, ""])
    assert.throws(
      () =>
        assertPreviewIsNotProduction({
          VERCEL_ENV: "preview",
          YTI_PRODUCTION_DB_HOST: guard,
          DATABASE_URL_UNPOOLED: "postgres://role@branch.db.invalid/main",
        }),
      /A preview deployment tried to migrate the production database/,
    );
});
test("The migrator names DATABASE_URL_UNPOOLED when it is unset", () => {
  assert.throws(() => directConnectionString({}), /DATABASE_URL_UNPOOLED/);
  assert.equal(
    directConnectionString({
      DATABASE_URL_UNPOOLED: "postgres://role@branch.db.invalid/main",
    }),
    "postgres://role@branch.db.invalid/main",
  );
});
test("A migration named with underscores is accepted", async () => {
  const dir = await directory(
    "CREATE TABLE IF NOT EXISTS yi_probe(id TEXT PRIMARY KEY);\n",
  );
  await writeFile(
    join(dir, "0002_add_share_expiry.sql"),
    "ALTER TABLE yi_probe ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;\n",
  );
  assert.deepEqual(
    (await loadMigrations(dir)).map((m) => m.name),
    ["baseline", "add_share_expiry"],
  );
  const { instance, client } = await blank();
  try {
    assert.deepEqual((await migrate(client, { directory: dir })).applied, [
      1, 2,
    ]);
  } finally {
    await instance.close();
  }
  await writeFile(join(dir, "0003_AddMore.sql"), "SELECT 1;\n");
  await assert.rejects(() => loadMigrations(dir), /is not named NNNN_name.sql/);
});
test("A recorded migration whose file is gone is rejected", async () => {
  const dir = await directory(
    "CREATE TABLE IF NOT EXISTS yi_probe(id TEXT PRIMARY KEY);\n",
  );
  const { instance, client } = await blank();
  try {
    assert.deepEqual((await migrate(client, { directory: dir })).applied, [1]);
    await rm(join(dir, "0001_baseline.sql"));
    await assert.rejects(
      () => migrate(client, { directory: dir }),
      /version 1 is recorded as applied but has no file on disk/,
    );
  } finally {
    await instance.close();
  }
});
