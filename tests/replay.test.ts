import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replayEligibility,
  durationSeconds,
} from "../src/server/youtube-intelligence/replay.ts";
test("Historical replay stops at the follow date, excludes Shorts and unknown duration, and selects Tier 1", () => {
  const base = {
    tier: "tier1",
    publishedAt: "2026-02-01T00:00:00Z",
    followedAt: "2026-06-01T00:00:00Z",
    durationSeconds: 600,
    title: "Review",
    from: "2026-01-01",
  };
  assert.equal(replayEligibility(base), null);
  assert.match(replayEligibility({ ...base, tier: "tier2" })!, /Tier/);
  assert.match(replayEligibility({ ...base, durationSeconds: 60 })!, /short/i);
  assert.match(
    replayEligibility({ ...base, durationSeconds: null })!,
    /duration/i,
  );
  assert.match(
    replayEligibility({ ...base, publishedAt: "2026-07-01T00:00:00Z" })!,
    /follow/,
  );
  assert.match(
    replayEligibility({ ...base, publishedAt: "2025-12-01T00:00:00Z" })!,
    /window/,
  );
  assert.match(
    replayEligibility({ ...base, title: "Market #shorts" })!,
    /short/i,
  );
  assert.equal(durationSeconds("PT1H2M3S"), 3723);
  assert.equal(durationSeconds("garbage"), null);
});

test("replay is bounded and idempotent, stores historical batch provenance, excludes shorts and missing metadata", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { stubFetch, json } = await import("./helpers/fetch-stub.ts");
  const { upsertChannel } =
    await import("../src/server/youtube-intelligence/repos/channels.ts");
  const { replayHistorical } =
    await import("../src/server/youtube-intelligence/replay.ts");
  const { get, list } =
    await import("../src/server/youtube-intelligence/store.ts");
  const db = await freshDatabase();
  const oldKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture";
  const channel = "UCabcdefghijklmnopqrstuv";
  const videos = [
    ["aaaaaaaaaaa", "PT2M"],
    ["bbbbbbbbbbb", "unknown"],
    ["ccccccccccc", "PT20M"],
    ["ddddddddddd", "PT30M"],
  ];
  const stub = stubFetch([
    {
      url: "youtube/v3/videos",
      respond: () =>
        json({
          items: videos.map(([id, duration]) => ({
            id,
            contentDetails: { duration },
            snippet: {
              title: "Historical research",
              publishedAt: "2026-02-01T00:00:00Z",
              channelId: channel,
            },
          })),
        }),
    },
  ]);
  try {
    await upsertChannel({
      id: channel,
      title: "Tier 1",
      tier: "tier1",
      active: true,
      followedAt: "2026-06-01T00:00:00Z",
    });
    for (const [id] of videos)
      await db
        .prepare(
          "INSERT INTO yi_discoveries(video_id,channel_id,payload,discovered_at) VALUES($1,$2,$3,$4)",
        )
        .run(
          id,
          channel,
          JSON.stringify({ publishedAt: "2026-02-01T00:00:00Z" }),
          "2026-02-01",
        );
    const first = await replayHistorical({ maxVideos: 1, pagesPerChannel: 0 });
    assert.equal(first.queued.length, 1);
    assert.equal(first.skipped.length, 2);
    const run = (await get(first.queued[0].runId))!;
    assert.equal(run.input.record, "historical");
    assert.equal(run.input.processingMode, "batch");
    assert.equal(run.input.origin, "channel");
    const [second, third] = await Promise.all([
      replayHistorical({ maxVideos: 1, pagesPerChannel: 0 }),
      replayHistorical({ maxVideos: 1, pagesPerChannel: 0 }),
    ]);
    assert.equal(second.queued.length + third.queued.length, 1);
    assert.equal((await list()).length, 2);
    assert.equal(
      (await replayHistorical({ maxVideos: 50, pagesPerChannel: 0 })).queued
        .length,
      0,
    );
    await assert.rejects(() =>
      replayHistorical({ maxVideos: 51, pagesPerChannel: 0 }),
    );
    const ledger = await db.prepare("SELECT COUNT(*) AS n FROM yi_calls").get();
    assert.equal(
      Number(ledger?.n),
      0,
      "queueing performs no model/transcript calls",
    );
  } finally {
    stub.restore();
    if (oldKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = oldKey;
    await db.close();
  }
});
