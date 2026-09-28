import test from "node:test";
import assert from "node:assert/strict";
import { runTimeline, StageTiming } from "../src/features/youtube-intelligence/timing.ts";

const row = (stage: string, claimed: string, finished: string | null, queue: number, execution: number | null) =>
  StageTiming.parse({ stage, claimed_at: claimed, finished_at: finished, queue_ms: queue, execution_ms: execution, checkpoint_ms: 5, outcome: "completed" });

test("the timeline runs from submission through analysis to the brief", () => {
  const t = runTimeline({
    submittedAt: "2026-09-28T00:00:00.000Z",
    status: "completed",
    stages: [
      row("metadata", "2026-09-28T00:00:02.000Z", "2026-09-28T00:00:03.000Z", 2000, 1000),
      row("synthesis", "2026-09-28T00:00:03.100Z", "2026-09-28T00:00:40.000Z", 100, 36900),
      row("synthesis", "2026-09-28T00:00:40.050Z", "2026-09-28T00:01:00.000Z", 50, 19950),
    ],
    brief: {
      submittedAt: "2026-09-28T00:01:00.100Z",
      status: "completed",
      stages: [row("research-synthesis", "2026-09-28T00:01:01.000Z", "2026-09-28T00:02:00.000Z", 900, 59000)],
    },
  });
  assert.equal(t.firstStepSeconds, 2);
  assert.equal(t.analysisSeconds, 60);
  assert.equal(t.briefSeconds, 120);
  assert.equal(t.endToEndSeconds, 120);
  assert.equal(t.complete, true);
  assert.deepEqual(t.analysis.stages.find((s) => s.stage === "synthesis"), { stage: "synthesis", steps: 2, executionSeconds: 56.85, queueSeconds: 0.15 });
});

test("an unfinished run has no end-to-end time rather than a partial one", () => {
  const t = runTimeline({
    submittedAt: "2026-09-28T00:00:00.000Z",
    status: "completed",
    stages: [row("metadata", "2026-09-28T00:00:01.000Z", "2026-09-28T00:00:02.000Z", 1000, 1000)],
    brief: { submittedAt: "2026-09-28T00:00:03.000Z", status: "running", stages: [row("research-synthesis", "2026-09-28T00:00:04.000Z", null, 1000, null)] },
  });
  assert.equal(t.analysisSeconds, 2);
  assert.equal(t.briefSeconds, null);
  assert.equal(t.endToEndSeconds, null);
  assert.equal(t.complete, false);
});

test("the stored timeline links an analysis to its first research brief", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const store = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext } = await import("../src/server/youtube-intelligence/runner.ts");
  const { timelineFor } = await import("../src/server/youtube-intelligence/timing.ts");
  const db = await freshDatabase();
  try {
    const run = await store.create("timed-video", "fixture", {}, "v1");
    await processNext(async (r) => { r.stage = "done"; r.status = "completed"; });
    await store.create("timed-video", "fixture", { task: "research-brief", snapshot: { sourceRunId: run.id } }, "v1");
    await processNext(async (r) => { r.stage = "complete"; r.status = "completed"; });
    const timeline = await timelineFor((await store.get(run.id))!);
    assert.equal(timeline.complete, true);
    assert.equal(timeline.analysis.steps, 1);
    assert.equal(timeline.brief?.steps, 1);
    assert.ok(timeline.briefSeconds! >= timeline.analysisSeconds!);
  } finally {
    await db.close();
  }
});
