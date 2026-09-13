import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("Channel discovery deduplicates uploads; provider failures retain actionable state; native job polling does not resubmit", async () => {
  process.env.YTI_YOUTUBEJS_ENABLED = "false";
  process.env.YTI_DB_PATH = join(
    mkdtempSync(join(tmpdir(), "yti-providers-")),
    "test.sqlite",
  );
  process.env.YOUTUBE_API_KEY = "fixture-only";
  process.env.SUPADATA_API_KEY = "fixture-only";
  const original = globalThis.fetch;
  let calls = 0;
  const payloads: unknown[] = [
    {
      items: [
        {
          id: "UCFhJ8ZFg9W4kLwFTBBNIjOw",
          snippet: { title: "Test creator", customUrl: "@test" },
          contentDetails: { relatedPlaylists: { uploads: "UU-test" } },
        },
      ],
    },
    {
      items: [
        {
          snippet: { title: "A video", publishedAt: "2026-09-13T00:00:00Z" },
          contentDetails: {
            videoId: "3u24qyWjSVM",
            videoPublishedAt: "2026-09-13T00:00:00Z",
          },
        },
      ],
    },
    {
      items: [
        {
          snippet: { title: "A video", publishedAt: "2026-09-13T00:00:00Z" },
          contentDetails: {
            videoId: "3u24qyWjSVM",
            videoPublishedAt: "2026-09-13T00:00:00Z",
          },
        },
      ],
    },
  ];
  globalThis.fetch = async () => {
    calls++;
    return Response.json(payloads.shift());
  };
  try {
    const C = await import("../src/server/youtube-intelligence/channels.ts"),
      R = await import("../src/server/youtube-intelligence/research-store.ts");
    const c = await C.follow("@test");
    assert.equal(c.autoAnalyze, false);
    assert.equal((await C.pull(c.id)).added, 1);
    assert.equal((await C.pull(c.id)).added, 0);
    assert.equal(
      (
        await (
          await R.researchDB()
        )
          .prepare("SELECT COUNT(*) AS n FROM yi_discoveries")
          .get()
      )?.n,
      1,
    );
    assert.equal(
      (
        await (
          await R.researchDB()
        )
          .prepare("SELECT COUNT(*) AS n FROM yi_runs")
          .get()
      )?.n,
      0,
    );
    globalThis.fetch = async () => new Response("denied", { status: 403 });
    await assert.rejects(C.pull(c.id), /403/);
    assert.match(String((await R.doc("channel", c.id))?.error), /403/);
    const T = await import("../src/server/youtube-intelligence/transcripts.ts");
    let submitted = 0,
      polls = 0;
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/transcript") {
        submitted++;
        return Response.json({ jobId: "job-test" }, { status: 202 });
      }
      polls++;
      return Response.json({
        status: "completed",
        content: [{ text: "原文", offset: 0, duration: 1000 }],
        lang: "zh",
      });
    };
    await assert.rejects(T.nativeTranscript("3u24qyWjSVM"), T.SourcePending);
    const source = await T.nativeTranscript("3u24qyWjSVM");
    assert.equal(source?.segments[0].text, "原文");
    await T.nativeTranscript("3u24qyWjSVM");
    assert.equal(submitted, 1);
    assert.equal(polls, 1);
  } finally {
    globalThis.fetch = original;
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.SUPADATA_API_KEY;
  }
});
test("Changing a collection version cannot rewrite its first forward observation", async () => {
  const R =
      await import("../src/server/youtube-intelligence/research-store.ts"),
    S = await import("../src/server/youtube-intelligence/store.ts");
  const a = await R.queue("kXYvRR7gV2E");
  await (
    await S.db()
  )
    .prepare("UPDATE yi_runs SET status='completed' WHERE id=?")
    .run(a.id);
  await R.publishRun(a.id);
  await R.canonicalRuns();
  const frozen = await R.doc<{
    run: {
      id: string;
    };
  }>("forwardObservation", a.videoId);
  assert.equal(frozen?.run.id, a.id);
  const b = await R.queue(a.videoId, undefined, undefined, true);
  await (
    await S.db()
  )
    .prepare("UPDATE yi_runs SET status='completed' WHERE id=?")
    .run(b.id);
  await R.publishRun(b.id);
  assert.equal(
    (await R.canonicalRuns()).find((r) => r.videoId === a.videoId)?.id,
    b.id,
  );
  assert.equal(
    (
      await R.doc<{
        run: {
          id: string;
        };
      }>("forwardObservation", a.videoId)
    )?.run.id,
    a.id,
  );
});
