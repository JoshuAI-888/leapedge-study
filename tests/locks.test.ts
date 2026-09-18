import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { freshDatabase } from "./helpers/db.ts";
import { iso, json } from "../src/server/youtube-intelligence/database.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import {
  claimLease,
  doc,
  put,
  putIfAbsent,
} from "../src/server/youtube-intelligence/research-store.ts";
import { sweep } from "../src/server/youtube-intelligence/runner.ts";
const SQL_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b/;
async function sources() {
  const files: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  await walk("src");
  await walk("scripts");
  return Promise.all(
    files.map(async (file) => ({ file, text: await readFile(file, "utf8") })),
  );
}
/** The SQL string literals in one file, quoted SQL strings stripped out. */
function sqlLiterals(text: string) {
  const found: string[] = [];
  for (const m of text.matchAll(
    /"((?:[^"\\\n]|\\.)*)"|`([^`]*)`|'((?:''|[^'\n])*)'/g,
  )) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    if (SQL_KEYWORD.test(body)) found.push(body.replace(/'(?:''|[^'])*'/g, ""));
  }
  return found;
}
test("No SQLite, no dialect rewriter, no global lock and no raw row readers remain", async () => {
  const banned: [RegExp, string][] = [
    [/node:sqlite/, "the SQLite driver"],
    [/postgresSQL/, "the dialect rewriter"],
    [/YTI_DB_PATH/, "the SQLite path variable"],
    [/78941002/, "the global transaction lock key"],
    [/JSON\.parse\(String\(/, "a raw row-JSON read instead of json()"],
    [
      /String\((?:[A-Za-z_$][\w$]*\.)+\w*_at\)/,
      "String() on a timestamp column instead of iso()",
    ],
  ];
  const offences: string[] = [];
  for (const { file, text } of await sources()) {
    for (const [pattern, why] of banned)
      if (pattern.test(text)) offences.push(`${file}: ${why}`);
    for (const sql of sqlLiterals(text))
      if (sql.includes("?"))
        offences.push(`${file}: a ? SQL placeholder in ${sql.slice(0, 60)}`);
  }
  assert.deepEqual(offences, []);
});
test("json() and iso() read a string column, a parsed column, a Date and epoch milliseconds", async () => {
  assert.deepEqual(json('{"a":1}'), { a: 1 });
  assert.deepEqual(json({ a: 1 }), { a: 1 });
  assert.equal(json(null), null);
  assert.equal(json(undefined), null);
  assert.equal(json("not json"), null);
  assert.equal(iso("2026-01-02T03:04:05.678Z"), "2026-01-02T03:04:05.678Z");
  assert.equal(iso("2026-01-02"), "2026-01-02");
  assert.equal(
    iso(new Date("2026-01-02T03:04:05.678Z")),
    "2026-01-02T03:04:05.678Z",
  );
  assert.equal(iso(Date.parse("2026-01-02T03:04:05.678Z")), "2026-01-02T03:04:05.678Z");
  assert.equal(iso("2026-01-02 03:04:05.678+00"), "2026-01-02T03:04:05.678Z");
  assert.equal(iso(null), null);
});
test("numeric reads back as a number and timestamptz as an ISO string on PGlite", async () => {
  const d = await freshDatabase();
  const row = (await d
    .prepare(
      "SELECT 1.25::numeric AS n, '2026-01-02T03:04:05.678Z'::timestamptz AS t",
    )
    .get()) as { n: unknown; t: unknown };
  assert.equal(typeof row.n, "number");
  assert.equal(row.n, 1.25);
  assert.equal(typeof row.t, "string");
  assert.equal(row.t, "2026-01-02T03:04:05.678Z");
  const applied = (await d
    .prepare("SELECT applied_at FROM yi_migrations ORDER BY version LIMIT 1")
    .get()) as { applied_at: string };
  assert.match(applied.applied_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});
test("The lock-replacement indexes exist", async () => {
  const d = await freshDatabase();
  const names = (
    (await d
      .prepare("SELECT indexname FROM pg_indexes WHERE schemaname='public'")
      .all()) as { indexname: string }[]
  ).map((r) => r.indexname);
  assert.ok(names.includes("yi_runs_open_dedupe"), "run dedupe index");
  assert.ok(names.includes("yi_calls_open_attempt"), "open attempt index");
});
test("Concurrent create() of the same input yields one row, and the index rejects a second", async () => {
  const d = await freshDatabase();
  const input = { promptSnapshot: { id: "v1" } };
  const made = await Promise.all(
    Array.from({ length: 6 }, () =>
      store.create("wkAqHlYL7bQ", "model", input, "v1"),
    ),
  );
  assert.equal(new Set(made.map((r) => r.id)).size, 1);
  assert.equal(
    Number(
      (
        (await d
          .prepare("SELECT COUNT(*) AS n FROM yi_runs").get()) as { n: unknown }
      ).n,
    ),
    1,
  );
  const now = new Date().toISOString();
  await assert.rejects(
    async () =>
      await d
        .prepare(
          "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .run(
          randomUUID(),
          "wkAqHlYL7bQ",
          "url",
          "model",
          "v1",
          "t",
          "queued",
          "metadata",
          now,
          now,
          JSON.stringify(input),
          "{}",
        ),
    /yi_runs_open_dedupe|duplicate key/,
  );
  // A finished run no longer holds the key, so the next request queues.
  await d
    .prepare("UPDATE yi_runs SET status='completed' WHERE id=$1")
    .run(made[0].id);
  const again = await store.create("wkAqHlYL7bQ", "model", input, "v1");
  assert.notEqual(again.id, made[0].id);
});
test("claimNext() hands a run to one caller and asks Postgres to keep it that way", async () => {
  await freshDatabase();
  const run = await store.create("wkAqHlYL7bQ", "model", {}, "v1");
  const claims = await Promise.all([store.claimNext(), store.claimNext()]);
  const won = claims.filter((c) => c !== null);
  assert.equal(won.length, 1);
  assert.equal(won[0]!.run.id, run.id);
  // PGlite has one connection, so the two calls above serialise and the
  // assertions hold even with the row lock removed. The guard is therefore
  // asserted in the source as well: contention is proved only by
  // scripts/postgres-check.ts against a real branch through the pooler.
  const source = await readFile("src/server/youtube-intelligence/store.ts", "utf8");
  const claim = source
    .split("\n")
    .find((l) => /SELECT \* FROM yi_runs WHERE .*claimable/.test(l));
  assert.ok(claim, "the claim statement moved; update this assertion");
  assert.match(claim!, /FOR UPDATE SKIP LOCKED/);
});
test("A second open reservation for the same run and stage is rejected", async () => {
  const d = await freshDatabase();
  process.env.YTI_BUDGET_USD = "5";
  const run = await store.create("wkAqHlYL7bQ", "model", {}, "v1");
  await store.reserve(run.id, "synthesis", 0.1);
  await assert.rejects(
    () => store.reserve(run.id, "synthesis", 0.1, 2),
    /still open/,
  );
  // The index, not the read before it, is what makes that safe.
  await assert.rejects(
    async () =>
      await d
        .prepare(
          "INSERT INTO yi_calls(id,run_id,stage,status,amount,metrics,attempt) VALUES($1,$2,$3,'reserved',0.1,'{}',2)",
        )
        .run(randomUUID(), run.id, "synthesis"),
    /yi_calls_open_attempt|duplicate key/,
  );
  await store.release(
    (await store.listAttempts(run.id, "synthesis"))[0].id,
    "test",
  );
  assert.ok(await store.reserve(run.id, "synthesis", 0.1, 2));
});
test("settle() rewrites only its own run's cost", async () => {
  await freshDatabase();
  process.env.YTI_BUDGET_USD = "5";
  const one = await store.create("wkAqHlYL7bQ", "model", { a: 1 }, "v1");
  const two = await store.create("3u24qyWjSVM", "model", { a: 2 }, "v1");
  const call = await store.reserve(one.id, "synthesis", 0.2);
  await store.reserve(two.id, "synthesis", 0.4);
  await store.settle(call, 0.05, {});
  assert.equal((await store.get(one.id))!.cost, 0.05);
  assert.equal((await store.get(two.id))!.cost, 0.4);
});
test("forwardObservation is a freeze: an existing row is never overwritten", async () => {
  await freshDatabase();
  assert.equal(
    await putIfAbsent("forwardObservation", "v1", { observedAt: "first" }),
    true,
  );
  assert.equal(
    await putIfAbsent("forwardObservation", "v1", { observedAt: "second" }),
    false,
  );
  assert.equal(
    (await doc<{ observedAt: string }>("forwardObservation", "v1"))?.observedAt,
    "first",
  );
});
test("The sweep lease is held by exactly one of two concurrent callers", async () => {
  await freshDatabase();
  const now = Date.now();
  const claims = await Promise.all([
    claimLease("scheduler", "lease", now + 300000, now),
    claimLease("scheduler", "lease", now + 300000, now),
  ]);
  assert.deepEqual(claims.filter(Boolean).length, 1);
  assert.equal(await claimLease("scheduler", "lease", now + 300000, now), false);
  // An expired lease is claimable again.
  assert.equal(
    await claimLease("scheduler", "lease", now + 600000, now + 300001),
    true,
  );
  await put("scheduler", "lease", { until: Date.now() + 300000 });
  assert.deepEqual(await sweep(), { skipped: true });
});
