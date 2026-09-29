import test from "node:test";
import assert from "node:assert/strict";
import { coverage, Source } from "../src/features/youtube-intelligence/contracts.ts";

const lines = (spans: [number, number][]) =>
  Source.parse({ segments: spans.map(([a, b], i) => ({ id: `s${i}`, text: "x", start_seconds: a, end_seconds: b })) });

test("pauses between caption lines are speech timing, not missing content", () => {
  // 4 s lines with 0.6 s pauses, as fetched captions arrive: 87% raw, all spoken.
  const spans: [number, number][] = [];
  for (let t = 0; t + 4 <= 1000; t += 4.6) spans.push([t, t + 4]);
  const c = coverage(lines(spans), 1000);
  assert.equal(c.status, "timestamps_cover_most_video");
  assert.ok(c.ratio > 0.99);
});

test("a gap longer than a pause still counts as missing", () => {
  const c = coverage(lines([[0, 400], [401.5, 500], [700, 1000]]), 1000);
  assert.equal(c.coveredSeconds, 800);
  assert.equal(c.status, "incomplete_or_unknown");
});

test("fetched captions with a real gap fall back to audio transcription, not review", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { stubFetch, json } = await import("./helpers/fetch-stub.ts");
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const { teamDefaults } = await import("../src/features/youtube-intelligence/settings.ts");
  const db = await freshDatabase();
  const prior = process.env.TRANSCRIPTAPI_API_KEY;
  process.env.TRANSCRIPTAPI_API_KEY = "fixture";
  const stub = stubFetch([{ url: "transcriptapi", respond: () => json({
    video_id: "gappyvideo1", language: "en",
    transcript: [{ text: "First half.", start: 0, duration: 300 }, { text: "Last part.", start: 900, duration: 100 }],
  }) }]);
  try {
    const run = {
      id: "gappy", videoId: "gappyvideo1", url: "https://www.youtube.com/watch?v=gappyvideo1",
      model: "test", promptVersion: "v1", title: "Gappy", status: "running", stage: "source",
      createdAt: "", updatedAt: "", error: null,
      input: { teamPreferencesSnapshot: teamDefaults() },
      output: { metadata: { duration: 1000, language: "en" } }, cost: 0,
    } as import("../src/features/youtube-intelligence/contracts.ts").Run;
    await step(run);
    assert.equal(run.status, "running");
    assert.equal(run.stage, "asr-source");
    assert.equal((run.output.captionCoverage as { status: string }).status, "incomplete_or_unknown");
    assert.equal(run.output.source, undefined);
  } finally {
    stub.restore();
    if (prior === undefined) delete process.env.TRANSCRIPTAPI_API_KEY;
    else process.env.TRANSCRIPTAPI_API_KEY = prior;
    await db.close();
  }
});
