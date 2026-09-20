import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { driverName } from "../src/server/youtube-intelligence/database.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
test("PGlite driver applies the schema and reports the Postgres dialect", async () => {
  const d = await freshDatabase();
  assert.equal(driverName(), "pglite");
  const tables = (await d
    .prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    )
    .all()) as { table_name: string }[];
  // 0003 added the relational core (spec 8) beside the document tables and 0004
  // added prices and settlements, so the list this asserts is both halves: the
  // new tables first, alphabetically.
  assert.deepEqual(
    tables.map((t) => t.table_name),
    [
      "channels",
      "claims",
      "evidence_spans",
      "instruments",
      "jobs",
      "mentions",
      "price_history",
      "prices",
      "reviews",
      "settlements",
      "transcripts",
      "yi_calls",
      "yi_discoveries",
      "yi_documents",
      "yi_events",
      "yi_heartbeat",
      "yi_migrations",
      "yi_prompts",
      "yi_provider_slots",
      "yi_responses",
      "yi_runs",
      "yi_shares",
      "yi_stage_timings",
    ],
  );
  const idx = await d
    .prepare("SELECT indexname FROM pg_indexes WHERE indexname='yi_runs_queue'")
    .get();
  assert.ok(idx, "queue index exists");
});
test("Insert and select round-trip on $n placeholders, with change counts", async () => {
  const d = await freshDatabase();
  const inserted = await d
    .prepare(
      "INSERT INTO yi_documents(kind,id,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5)",
    )
    .run(
      "note",
      "n1",
      JSON.stringify({ a: 1, q: "?" }),
      "2026-01-01",
      "2026-01-01",
    );
  assert.equal(inserted.changes, 1);
  const row = (await d
    .prepare("SELECT * FROM yi_documents WHERE kind=$1 AND id=$2")
    .get("note", "n1")) as Record<string, unknown>;
  assert.equal(row.payload, JSON.stringify({ a: 1, q: "?" }));
  assert.equal(row.created_at, "2026-01-01");
  const ignored = await d
    .prepare(
      "INSERT INTO yi_responses VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    )
    .run("r1", "run", "stage", "{}", "now");
  assert.equal(ignored.changes, 1);
  const again = await d
    .prepare(
      "INSERT INTO yi_responses VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    )
    .run("r1", "run", "stage", "{}", "later");
  assert.equal(again.changes, 0);
  const beatSQL =
    "INSERT INTO yi_heartbeat VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET at=excluded.at";
  await d.prepare(beatSQL).run(5);
  await d.prepare(beatSQL).run(9);
  const beat = (await d
    .prepare("SELECT at FROM yi_heartbeat WHERE id=1")
    .get()) as {
    at: unknown;
  };
  assert.equal(Number(beat.at), 9);
});
test("Transactions roll back on error and nested calls share the connection", async () => {
  const d = await freshDatabase();
  await assert.rejects(
    d.transaction(async () => {
      await d
        .prepare("INSERT INTO yi_events VALUES($1,$2,$3,$4,$5)")
        .run("e1", "k", "x", "t", "{}");
      const inner = (await d
        .prepare("SELECT count(*) AS n FROM yi_events")
        .get()) as { n: unknown };
      assert.equal(Number(inner.n), 1, "visible inside the transaction");
      throw Error("boom");
    }),
    /boom/,
  );
  const after = (await d
    .prepare("SELECT count(*) AS n FROM yi_events")
    .get()) as { n: unknown };
  assert.equal(Number(after.n), 0, "rolled back");
  const committed = await d.transaction(async () => {
    await d
      .prepare("INSERT INTO yi_events VALUES($1,$2,$3,$4,$5)")
      .run("e2", "k", "x", "t", "{}");
    return "done";
  });
  assert.equal(committed, "done");
  const total = (await d
    .prepare("SELECT count(*) AS n FROM yi_events")
    .get()) as { n: unknown };
  assert.equal(Number(total.n), 1);
});
test("freshDatabase gives an isolated instance each time", async () => {
  const d = await freshDatabase();
  await d
    .prepare("INSERT INTO yi_events VALUES($1,$2,$3,$4,$5)")
    .run("e1", "k", "x", "t", "{}");
  const fresh = await freshDatabase();
  const rows = await fresh.prepare("SELECT * FROM yi_events").all();
  assert.equal(rows.length, 0);
});
test("store.ts create/claimNext/save lease fencing works on PGlite", async () => {
  await freshDatabase();
  const a = await store.create("wkAqHlYL7bQ", "model", {}, "v1");
  const b = await store.create("wkAqHlYL7bQ", "model", {}, "v1");
  assert.equal(a.id, b.id, "duplicate queued work is deduplicated");
  assert.equal(a.status, "queued");
  const first = (await store.claimNext())!;
  assert.equal(first.run.id, a.id);
  assert.equal(first.run.status, "running");
  assert.equal(await store.claimNext(), null, "leased run is not reclaimed");
  await store
    .db()
    .prepare("UPDATE yi_runs SET lease_until=0 WHERE id=$1")
    .run(a.id);
  const second = (await store.claimNext())!;
  assert.equal(second.run.id, a.id);
  assert.notEqual(second.token, first.token);
  await assert.rejects(
    async () => await store.save(first.run, first.token),
    /Stale worker lease/,
  );
  await store.save(
    { ...second.run, status: "done", stage: "complete" },
    second.token,
  );
  const saved = (await store.get(a.id))!;
  assert.equal(saved.status, "done");
  assert.equal(saved.stage, "complete");
  assert.equal(await store.claimNext(), null);
});
test("Concurrent transactions on the single PGlite connection are serialized", async () => {
  const d = await freshDatabase();
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      d.transaction(async () => {
        const n = (await d
          .prepare("SELECT count(*) AS n FROM yi_events")
          .get()) as { n: unknown };
        await d
          .prepare("INSERT INTO yi_events VALUES($1,$2,$3,$4,$5)")
          .run(`e${i}`, "k", String(Number(n.n)), "t", "{}");
      }),
    ),
  );
  const ids = (await d
    .prepare("SELECT entity_id FROM yi_events ORDER BY entity_id")
    .all()) as { entity_id: string }[];
  assert.deepEqual(
    ids.map((r) => r.entity_id),
    ["0", "1", "2", "3", "4"],
  );
  await d.close();
});
