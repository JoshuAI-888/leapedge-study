import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { upsertChannel } from "../src/server/youtube-intelligence/repos/channels.ts";
import {
  nextMonitoringAt,
  scheduleSummary,
} from "../src/features/youtube-intelligence/monitoring.ts";
import {
  monitoringStatus,
  saveMonitoring,
  monitoringTick,
} from "../src/server/youtube-intelligence/monitoring.ts";
import { create, get } from "../src/server/youtube-intelligence/store.ts";
import { processNext } from "../src/server/youtube-intelligence/runner.ts";

test("Schedules use UTC, enforce 15-minute boundaries, and show real invocation counts", () => {
  assert.equal(
    nextMonitoringAt("0 * * * *", "2026-10-09T01:18:00Z"),
    "2026-10-09T02:00:00.000Z",
  );
  assert.equal(
    nextMonitoringAt("0 9 * * 1-5", "2026-10-09T10:00:00Z"),
    "2026-10-12T09:00:00.000Z",
  );
  assert.equal(scheduleSummary("0 * * * *").monitoringChecksPer30Days, 720);
  assert.equal(scheduleSummary("0 * * * *").platformChecksPer30Days, 2880);
  assert.throws(
    () => nextMonitoringAt("* * * * *", new Date().toISOString()),
    /15-minute/,
  );
  assert.throws(
    () => nextMonitoringAt("0 25 * * *", new Date().toISOString()),
    /range/,
  );
  assert.throws(
    () => nextMonitoringAt("0 0 31 2 *", new Date().toISOString()),
    /next year/,
  );
});

test("Pause blocks queued automatic stages while a manual video still completes", async () => {
  await freshDatabase();
  try {
    const auto = await create(
      "abcdefghijk",
      "fixture",
      { automaticMonitoring: true },
      "v1",
    );
    const manual = await create("lmnopqrstuv", "fixture", {}, "v1");
    const executed: string[] = [];
    const stage = async (run: Awaited<ReturnType<typeof create>>) => {
      executed.push(run.id);
      run.status = "completed";
    };
    await processNext(stage);
    await processNext(stage);
    assert.deepEqual(executed, [manual.id]);
    assert.equal((await get(auto.id))?.status, "queued");
    assert.equal((await get(manual.id))?.status, "completed");
  } finally {
    await database.close();
  }
});

test("Pausing during a metadata request prevents the newly discovered upload from queuing", async () => {
  await freshDatabase();
  const old = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture";
  await upsertChannel({
    id: "UCabcdefghijklmnopqrstuv",
    title: "Fixture",
    uploads: "playlist",
    active: true,
    autoAnalyze: true,
    processing: "immediate",
  });
  await saveMonitoring({
    enabled: true,
    schedule: "0 * * * *",
    maxVideosPerCheck: 1,
    includeRecentHours: 24,
    acknowledgeCosts: true,
  });
  const stub = stubFetch([
    {
      url: "googleapis.com",
      respond: async () => {
        await saveMonitoring({
          enabled: false,
          schedule: "0 * * * *",
          maxVideosPerCheck: 1,
        });
        return json({
          items: [
            {
              contentDetails: {
                videoId: "abcdefghijk",
                videoPublishedAt: new Date().toISOString(),
              },
              snippet: { title: "Upload" },
            },
          ],
        });
      },
    },
  ]);
  try {
    await monitoringTick({ force: true });
    assert.equal((await monitoringStatus()).enabled, false);
    assert.equal(
      Number(
        (await database.prepare("SELECT count(*) AS n FROM yi_runs").get())?.n,
      ),
      0,
    );
  } finally {
    stub.restore();
    if (old === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = old;
    await database.close();
  }
});

test("Off by default and off after disabling: no discovery or queued model work", async () => {
  await freshDatabase();
  const stub = stubFetch([]);
  try {
    assert.equal((await monitoringStatus()).enabled, false);
    assert.equal((await monitoringTick()).reason, "Monitoring paused");
    await assert.rejects(
      saveMonitoring({
        enabled: true,
        schedule: "0 * * * *",
        maxVideosPerCheck: 1,
      }),
      /cost warning/,
    );
    await saveMonitoring({
      enabled: true,
      schedule: "0 * * * *",
      maxVideosPerCheck: 1,
      acknowledgeCosts: true,
    });
    await saveMonitoring({
      enabled: false,
      schedule: "0 * * * *",
      maxVideosPerCheck: 1,
    });
    assert.equal((await monitoringTick()).reason, "Monitoring paused");
    assert.equal(stub.log.length, 0);
  } finally {
    stub.restore();
    await database.close();
  }
});

test("A due check discovers uploads, queues only one selected recent video, and concurrent ticks deduplicate", async () => {
  await freshDatabase();
  const savedKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture";
  const now = new Date().toISOString();
  await upsertChannel({
    id: "UCabcdefghijklmnopqrstuv",
    title: "Fixture",
    uploads: "playlist",
    active: true,
    autoAnalyze: true,
    processing: "immediate",
    followedAt: "2026-01-01T00:00:00Z",
  });
  const stub = stubFetch([
    {
      url: "googleapis.com/youtube/v3/playlistItems",
      respond: () =>
        json({
          items: ["abcdefghijk", "lmnopqrstuv"].map((videoId) => ({
            contentDetails: { videoId, videoPublishedAt: now },
            snippet: { title: "Upload" },
          })),
        }),
    },
  ]);
  try {
    await saveMonitoring({
      enabled: true,
      schedule: "*/15 * * * *",
      maxVideosPerCheck: 1,
      includeRecentHours: 24,
      acknowledgeCosts: true,
    });
    const results = await Promise.all([
      monitoringTick({ force: true }),
      monitoringTick({ force: true }),
    ]);
    assert.equal(results.filter((x) => !x.skipped).length, 1);
    assert.equal(stub.log.length, 1);
    assert.equal(
      Number(
        (await database.prepare("SELECT count(*) AS n FROM yi_runs").get())?.n,
      ),
      1,
    );
    assert.equal(
      Number(
        (await database.prepare("SELECT count(*) AS n FROM yi_calls").get())?.n,
      ),
      0,
    );
    const retained = await monitoringStatus();
    assert.equal(retained.lastResult?.queued, 1);
    assert.ok(retained.nextCheckAt);
    assert.equal((await monitoringTick()).reason, "Not due");
  } finally {
    stub.restore();
    if (savedKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = savedKey;
    await database.close();
  }
});
