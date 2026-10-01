import test from "node:test";
import assert from "node:assert/strict";
process.env.YTI_DB = "pglite";
import { doc } from "../src/server/youtube-intelligence/research-store.ts";
import { db, create } from "../src/server/youtube-intelligence/store.ts";
import {
  shareSelection,
  readShare,
  revokeShare,
} from "../src/server/youtube-intelligence/briefings.ts";
import { pull } from "../src/server/youtube-intelligence/channels.ts";
import {
  getChannel,
  upsertChannel,
} from "../src/server/youtube-intelligence/repos/channels.ts";
test("Share snapshot includes only frozen visible IDs when another matching run completes; revoke removes access", async () => {
  const claim = {
    thesis_en: "SoFi research",
    instrument_as_spoken: "SoFi",
    ticker: null,
    ticker_explicit: false,
    stance: "watch",
    horizon_en: null,
    conditions_en: [],
    creator_conviction: "unspecified",
    risks_en: [],
    levels: [],
    evidence: [
      { segment_id: "a", quote_original: "SoFi", quote_translation_en: "SoFi" },
    ],
  };
  async function ready(video: string) {
    const r = await create(video, "test", {}, "v1");
    await db()
      .prepare("UPDATE yi_runs SET status='completed',output=$1 WHERE id=$2")
      .run(
        JSON.stringify({
          claims: [{ id: "c1", claim, passed: true, reasons: [] }],
        }),
        r.id,
      );
    return r;
  }
  const a = await ready("aaaaabbbbbb");
  const selected = [{ runId: a.id, claimId: "c1" }];
  await ready("bbbbbaaaaaa");
  const share = await shareSelection(selected);
  const token = share.path.split("/").at(-1)!;
  const snapshot = await readShare(token);
  assert.deepEqual(snapshot?.runIds, [a.id]);
  assert.equal(snapshot?.groups.flatMap((g) => g.calls).length, 1);
  await assert.rejects(() =>
    shareSelection([{ runId: a.id, claimId: "nonexistent" }]),
  );
  await revokeShare(share.id);
  assert.equal(await readShare(token), null);
});
test("Latest refresh preserves historical cursor, older pages deduplicate and exhausted cursor stays exhausted", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture";
  const c = {
    id: "UCabcdefghijklmnopqrstuv",
    title: "Test",
    handle: "@test",
    uploads: "UUtest",
    active: true,
    favorite: false,
    autoAnalyze: false,
    createdAt: new Date().toISOString(),
    lastPull: null,
    error: null,
  };
  // Since F28 a channel is a row. The cursor this test follows is read back
  // from the `channels` table, not from a `channel` document.
  await upsertChannel(c);
  const seen: string[] = [];
  let latest = 0;
  globalThis.fetch = async (input) => {
    const u = new URL(String(input)),
      token = u.searchParams.get("pageToken") || "latest";
    seen.push(token);
    return Response.json({
      items: [
        {
          contentDetails: { videoId: "aaaaabbbbbb" },
          snippet: { title: "Test", publishedAt: "2026-09-01" },
        },
      ],
      ...(token === "latest"
        ? { nextPageToken: ++latest === 1 ? "history-1" : "new-latest" }
        : token === "history-1"
          ? { nextPageToken: "history-2" }
          : {}),
    });
  };
  try {
    await pull(c.id);
    await pull(c.id, true);
    await pull(c.id);
    assert.equal(
      (await getChannel(c.id))?.nextPageToken,
      "history-2",
    );
    await pull(c.id, true);
    await pull(c.id);
    assert.equal((await getChannel(c.id))?.nextPageToken, null);
    assert.equal(seen[3], "history-2");
    await assert.rejects(() => pull(c.id, true));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey) process.env.YOUTUBE_API_KEY = oldKey;
    else delete process.env.YOUTUBE_API_KEY;
  }
});
test("Bounded history import follows at most three pages and never queues paid analysis", async () => {
  const { backfillChannel } =
    await import("../src/server/youtube-intelligence/channels.ts");
  const oldFetch = globalThis.fetch,
    oldKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture";
  const id = "UCzyxwvutsrqponmlkjihgfe";
  await upsertChannel({
    id,
    title: "History",
    uploads: "UUhistory",
    active: true,
    historyStarted: false,
  });
  let calls = 0;
  globalThis.fetch = async () =>
    Response.json({
      items: [
        {
          contentDetails: { videoId: "ccccccccccc" },
          snippet: { title: "Historical", publishedAt: "2020-01-01" },
        },
      ],
      nextPageToken: `page-${++calls}`,
    });
  try {
    const before = await db()
      .prepare("SELECT COUNT(*) AS n FROM yi_runs")
      .get();
    const result = await backfillChannel({ id, pages: 3 });
    assert.equal(result.pages, 3);
    assert.equal(calls, 3);
    assert.equal(result.added, 1);
    assert.deepEqual(
      await db().prepare("SELECT COUNT(*) AS n FROM yi_runs").get(),
      before,
    );
    await assert.rejects(() => backfillChannel({ id, pages: 4 }));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey) process.env.YOUTUBE_API_KEY = oldKey;
    else delete process.env.YOUTUBE_API_KEY;
  }
});
test("Entity merge keeps an audit record, groups aliases, and rejects distinct listings", async () => {
  const { saveEntity, mergeEntities } =
    await import("../src/server/youtube-intelligence/entities.ts");
  const { docs } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const base = {
    type: "Company",
    aliases: [],
    topics: ["Software"],
    ticker: null,
    exchange: null,
    status: "suggested",
    resolutionNote: "Synthetic fixture only",
  };
  await saveEntity({ ...base, id: "example-a", name: "Example Company" });
  await saveEntity({ ...base, id: "example-b", name: "Example Co" });
  await mergeEntities({
    sourceId: "example-b",
    targetId: "example-a",
    reason: "Synthetic test confirms these are aliases.",
  });
  assert.equal(await doc("entity", "example-b"), null);
  assert.ok(
    (await doc<{ aliases: string[] }>("entity", "example-a"))?.aliases.includes(
      "Example Co",
    ),
  );
  assert.equal((await docs("entityMerge")).length, 1);
  await saveEntity({
    ...base,
    id: "listing-a",
    name: "Listing One",
    ticker: "TEST",
    exchange: "ONE",
    status: "reviewed",
  });
  await saveEntity({
    ...base,
    id: "listing-b",
    name: "Listing Two",
    ticker: "TEST",
    exchange: "TWO",
    status: "reviewed",
  });
  await assert.rejects(() =>
    mergeEntities({
      sourceId: "listing-a",
      targetId: "listing-b",
      reason: "These must remain distinct listings.",
    }),
  );
  assert.ok(await doc("entity", "listing-a"));
});
