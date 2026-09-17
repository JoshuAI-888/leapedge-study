import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { seedFixture, fixtureSpec } from "./helpers/fixtures.ts";
import { loadFrozen, frozenPath, requestHash } from "./helpers/frozen.ts";
import { freshDatabase } from "./helpers/db.ts";
import { Claim } from "../src/features/youtube-intelligence/contracts.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import {
  doc,
  docs,
  canonicalRuns,
  accepted,
} from "../src/server/youtube-intelligence/research-store.ts";

test("stubFetch matches routes by substring, RegExp and method, first match wins", async () => {
  const original = globalThis.fetch;
  const stub = stubFetch([
    { method: "POST", url: "/v1/transcript", respond: () => json({ jobId: "j" }, 202) },
    { url: /\/v1\/transcript\/[\w-]+$/, respond: () => json({ status: "completed" }) },
    { url: "example.com", respond: () => new Response("plain", { status: 200 }) },
    { url: "example.com", respond: () => new Response("never", { status: 500 }) },
  ]);
  try {
    assert.notEqual(globalThis.fetch, original, "fetch is replaced");
    const submitted = await fetch("https://api.supadata.ai/v1/transcript?url=x", {
      method: "POST",
      body: JSON.stringify({ url: "x" }),
    });
    assert.equal(submitted.status, 202);
    assert.deepEqual(await submitted.json(), { jobId: "j" });
    const polled = await fetch(new URL("https://api.supadata.ai/v1/transcript/job-1"));
    assert.deepEqual(await polled.json(), { status: "completed" });
    const plain = await fetch(new Request("https://example.com/a"));
    assert.equal(await plain.text(), "plain", "first matching route wins");
    // A GET to the submission path does not match the POST-only route and
    // falls through to the poll RegExp? No: the RegExp needs a job id, so it
    // is unmatched and the stub refuses it instead of reaching the network.
    await assert.rejects(
      fetch("https://api.supadata.ai/v1/transcript?url=y"),
      /unmatched fetch: GET https:\/\/api\.supadata\.ai\/v1\/transcript\?url=y/,
    );
    assert.equal(stub.log.length, 4, "every call, matched or not, is logged");
    assert.deepEqual(
      stub.log.map((c) => [c.method, c.route]),
      [
        ["POST", 0],
        ["GET", 1],
        ["GET", 2],
        ["GET", null],
      ],
    );
    assert.equal(stub.log[0].body, JSON.stringify({ url: "x" }));
    assert.equal(stub.log[1].body, null);
    assert.equal(stub.log[0].url, "https://api.supadata.ai/v1/transcript?url=x");
    assert.equal(stub.calls("example.com").length, 1);
    assert.equal(stub.calls(/\/v1\/transcript/).length, 3);
  } finally {
    stub.restore();
  }
  assert.equal(globalThis.fetch, original, "restore puts the original back");
});

test("stubFetch queues responses per route, reuses a static Response, and lets responders throw", async () => {
  const stub = stubFetch([
    {
      url: "googleapis.com",
      responses: [() => json({ page: 1 }), () => json({ page: 2 })],
    },
    { url: "static", respond: new Response("same body", { status: 201 }) },
    {
      url: "boom",
      respond: () => {
        throw new Error("secret upstream details");
      },
    },
    {
      url: "slow",
      respond: async (call) => {
        await new Promise((r) => setTimeout(r, 5));
        return json({ echoed: call.body });
      },
    },
  ]);
  try {
    assert.deepEqual(await (await fetch("https://www.googleapis.com/youtube/v3/a")).json(), { page: 1 });
    assert.deepEqual(await (await fetch("https://www.googleapis.com/youtube/v3/b")).json(), { page: 2 });
    await assert.rejects(
      fetch("https://www.googleapis.com/youtube/v3/c"),
      /queue exhausted for route 0 \(googleapis\.com\) on call 3/,
    );
    const a = await fetch("https://x/static"),
      b = await fetch("https://x/static");
    assert.equal(await a.text(), "same body");
    assert.equal(await b.text(), "same body");
    assert.equal(b.status, 201);
    await assert.rejects(fetch("https://x/boom"), /secret upstream details/);
    const slow = await fetch("https://x/slow", { method: "PUT", body: "payload" });
    assert.deepEqual(await slow.json(), { echoed: "payload" });
    assert.equal(stub.log.at(-1)?.method, "PUT");
    assert.equal(stub.log.length, 7);
  } finally {
    stub.restore();
  }
});

test("stubFetch stacks: restoring the inner stub returns to the outer one", async () => {
  const original = globalThis.fetch;
  const outer = stubFetch([{ url: "a", respond: () => new Response("outer") }]);
  const inner = stubFetch([{ url: "a", respond: () => new Response("inner") }]);
  assert.equal(await (await fetch("https://x/a")).text(), "inner");
  inner.restore();
  assert.equal(await (await fetch("https://x/a")).text(), "outer");
  assert.equal(outer.log.length, 1, "the outer log only sees its own calls");
  outer.restore();
  assert.equal(globalThis.fetch, original);
});

test("seedFixture writes the baseline fixture through the store APIs with deterministic ids", async () => {
  await freshDatabase();
  const spec = fixtureSpec("baseline");
  assert.equal(spec.channels.length, 2);
  assert.equal(spec.runs.length, 3);
  assert.equal(spec.runs.flatMap((r) => r.claims).length, 6);
  const seeded = await seedFixture("baseline");
  assert.deepEqual(Object.keys(seeded.channels).sort(), spec.channels.map((c) => c.key).sort());
  assert.equal(Object.keys(seeded.runs).length, 3);
  assert.equal(Object.keys(seeded.claims).length, 6);
  for (const id of Object.values(seeded.runs))
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const runs = await store.list();
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.equal(r.status, "completed");
    for (const c of accepted(r)) Claim.parse(c.claim);
    assert.ok(r.output.sourceHash, "runs carry a source hash");
  }
  const claims = runs.flatMap((r) => (r.output.claims as { claim: { ticker: string | null } }[]));
  assert.equal(claims.length, 6);
  assert.ok(claims.every((c) => c.claim.ticker), "every fixture claim names a ticker");
  assert.equal(
    claims.filter((c) => c.claim.ticker === "NVDA").length,
    3,
    "three NVDA claims across channels",
  );
  const canonical = await canonicalRuns();
  assert.equal(canonical.length, 3, "all fixture runs are canonical, non-experiment analyses");
  const channels = await docs<{ id: string; title: string }>("channel");
  assert.equal(channels.length, 2);
  const discoveries = await store
    .db()
    .prepare("SELECT video_id, channel_id, run_id FROM yi_discoveries ORDER BY video_id")
    .all();
  assert.equal(discoveries.length, 3, "each run's video is a discovery of its channel");
  assert.ok(discoveries.every((d) => d.run_id && d.channel_id));
  const nvda = await doc<{ symbol: string; prices: { date: string; close: number }[] }>(
    "prices",
    seeded.prices.NVDA,
  );
  const spy = await doc<{ symbol: string; prices: { date: string; close: number }[] }>(
    "prices",
    seeded.prices.SPY,
  );
  assert.equal(nvda?.symbol, "NVDA");
  assert.equal(spy?.symbol, "SPY");
  assert.ok((nvda?.prices.length ?? 0) > 50, "a quarter of daily closes");
  assert.equal(nvda?.prices.length, spy?.prices.length, "aligned sessions");
  assert.match(seeded.prices.NVDA, /^fmp:NVDA:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/);
  assert.ok(await doc("instrument", "NVDA"), "priced tickers resolve offline");
  const settlements = await docs<{ status: string; ticker?: string; excessReturn?: number }>("settlement");
  assert.equal(settlements.length, 6, "one settlement-like row per claim");
  const statuses = settlements.map((s) => s.status).sort();
  assert.ok(statuses.includes("completed"), "a 90-day call has settled");
  assert.ok(statuses.includes("ongoing"), "a later call is still running");
  assert.ok(statuses.includes("ineligible"), "non-directional calls are ineligible");
  assert.ok(statuses.includes("unpriced"), "a ticker without a fixture series is unpriced");
  const priced = settlements.filter((s) => typeof s.excessReturn === "number");
  assert.ok(priced.length >= 2);
  assert.ok(await doc("watchlist", "NVDA"), "generic documents are written as given");
});

test("seedFixture is deterministic: the same spec yields the same ids and rows", async () => {
  await freshDatabase();
  const first = await seedFixture("baseline");
  const snapshot = async () => ({
    runs: (await store.list()).map((r) => [r.id, r.videoId, r.createdAt, r.output]),
    documents: (
      await store
        .db()
        .prepare("SELECT kind,id,payload FROM yi_documents ORDER BY kind,id")
        .all()
    ).map((d) => [String(d.kind), String(d.id), String(d.payload)]),
  });
  const a = await snapshot();
  await freshDatabase();
  const second = await seedFixture(fixtureSpec("baseline"));
  const b = await snapshot();
  assert.deepEqual(second, first);
  assert.deepEqual(b.runs, a.runs);
  assert.deepEqual(
    b.documents.map(([k, id]) => [k, id]),
    a.documents.map(([k, id]) => [k, id]),
  );
  // Payloads that carry no wall-clock field are byte-identical as well.
  const stable = (rows: string[][]) =>
    rows.filter(([k]) => ["channel", "prices", "settlement", "watchlist", "instrument"].includes(k));
  assert.deepEqual(stable(b.documents), stable(a.documents));
  const other = await seedFixture({ ...fixtureSpec("baseline"), id: "variant" });
  assert.notDeepEqual(other.runs, first.runs, "a different fixture id gives different ids");
});

test("seedFixture rejects a malformed spec at the boundary", async () => {
  await freshDatabase();
  await assert.rejects(
    seedFixture({ ...fixtureSpec("baseline"), runs: [{ key: "bad" }] } as never),
    /runs/,
  );
  await assert.rejects(seedFixture("../escape" as never), /fixture/i);
});

test("loadFrozen reads <stage>-<hash>.json, validates the envelope, and explains a miss", async () => {
  const dir = mkdtempSync(join(tmpdir(), "frozen-"));
  const hash = requestHash({ b: 2, a: [1, { z: 1, y: 2 }] });
  assert.equal(hash, requestHash({ a: [1, { y: 2, z: 1 }], b: 2 }), "key order does not matter");
  assert.notEqual(hash, requestHash({ a: [1, { y: 2, z: 1 }], b: 3 }));
  assert.match(hash, /^[0-9a-f]{16}$/);
  const envelope = {
    stage: "extraction",
    hash,
    model: "google/gemini-3.5-flash",
    capturedAt: "2026-09-10T08:00:00.000Z",
    request: { messages: [] },
    response: { claims: [] },
  };
  writeFileSync(frozenPath("extraction", hash, dir), JSON.stringify(envelope));
  const loaded = loadFrozen("extraction", hash, dir);
  assert.deepEqual(loaded, envelope);
  assert.throws(() => loadFrozen("extraction", "0".repeat(16), dir), /tests\/fixtures\/model\/README/);
  assert.throws(() => loadFrozen("../x", hash, dir), /stage/);
  assert.throws(() => loadFrozen("extraction", "not a hash", dir), /hash/);
  writeFileSync(frozenPath("critique", hash, dir), JSON.stringify({ hash, response: {} }));
  assert.throws(() => loadFrozen("critique", hash, dir), /stage/);
  writeFileSync(
    frozenPath("synthesis", hash, dir),
    JSON.stringify({ ...envelope, stage: "extraction" }),
  );
  assert.throws(() => loadFrozen("synthesis", hash, dir), /does not match/);
  assert.match(frozenPath("extraction", hash), /tests[\\/]fixtures[\\/]model[\\/]extraction-[0-9a-f]{16}\.json$/);
});
