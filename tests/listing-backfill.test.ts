import test from "node:test";
import assert from "node:assert/strict";

test("resolved listing columns round-trip and stay outside the content digest", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { upsertClaim, claimsForRun, claimContentDigest } = await import("../src/server/youtube-intelligence/repos/claims.ts");
  const db = await freshDatabase();
  try {
    const base = {
      id: "run-1:c1", runId: "run-1", videoId: "video-1", channelId: null,
      instrument: "Celsius", ticker: null, tickerExplicit: false, stance: "long",
      thesisEn: "Celsius is the top holding.", horizonEn: null, conditionsEn: [], risksEn: [],
      creatorConviction: "high", trustLevel: "L1" as const, trustBasis: {}, configHash: null, publishedAt: null,
    };
    await upsertClaim({ ...base, resolvedTicker: "CELH", resolvedName: "Celsius Holdings, Inc.", resolvedBy: "alias" });
    const [row] = await claimsForRun("run-1");
    assert.equal(row.resolvedTicker, "CELH");
    assert.equal(row.resolvedName, "Celsius Holdings, Inc.");
    assert.equal(row.resolvedBy, "alias");
    assert.equal(row.ticker, null);
    assert.equal(
      claimContentDigest({ ...base, resolvedTicker: "CELH" }, []),
      claimContentDigest({ ...base, resolvedTicker: null }, []),
      "a human review signed before resolution still matches",
    );
  } finally {
    await db.close();
  }
});

test("the backfill republishes completed analyses and reports what it could not", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const { resolvePublishedListings } = await import("../src/server/youtube-intelligence/listings/backfill.ts");
  const db = await freshDatabase();
  try {
    const run = await create("backfill-video", "fixture", {}, "v1");
    const store = await import("../src/server/youtube-intelligence/store.ts");
    await (await store.db())
      .prepare("UPDATE yi_runs SET status='completed', output=$1 WHERE id=$2")
      .run(JSON.stringify({ claims: [], mentions: [] }), run.id);
    const brief = await create("backfill-video", "fixture", { task: "research-brief", snapshot: { sourceRunId: run.id } }, "v1");
    assert.ok(brief.id);
    const result = await resolvePublishedListings();
    assert.equal(result.considered, 1, "tasks such as briefs are not analyses");
    assert.equal(result.republished, 1);
    assert.deepEqual(result.failed, []);
  } finally {
    await db.close();
  }
});
