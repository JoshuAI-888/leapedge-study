import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { create, get } from "../src/server/youtube-intelligence/store.ts";
import {
  claimJob,
  completeJob,
} from "../src/server/youtube-intelligence/queue.ts";
import { processNext } from "../src/server/youtube-intelligence/runner.ts";
test("interactive work passes background backlog while aged work cannot starve", async () => {
  const db = await freshDatabase();
  try {
    const background = await create(
      "background",
      "fixture",
      { origin: "channel" },
      "v1",
    );
    const interactive = await create(
      "interactive",
      "fixture",
      { origin: "manual" },
      "v1",
    );
    const first = await claimJob();
    assert.equal((first!.payload as { runId: string }).runId, interactive.id);
    await completeJob(first!.id, first!.leaseToken!);
    await db
      .prepare("UPDATE jobs SET run_after='2000-01-01' WHERE id=$1")
      .run("analyze:" + background.id);
    await create("interactive2", "fixture", { origin: "manual" }, "v1");
    const aged = await claimJob();
    assert.equal((aged!.payload as { runId: string }).runId, background.id);
  } finally {
    await db.close();
  }
});
test("each durable stage records queue, execution and persistence durations without source payload", async () => {
  const db = await freshDatabase();
  try {
    const r = await create("timed", "fixture", { origin: "manual" }, "v1");
    await processNext(async (run) => {
      run.stage = "done";
      run.status = "completed";
    });
    assert.equal((await get(r.id))!.status, "completed");
    const rows = await db
      .prepare("SELECT * FROM yi_stage_timings WHERE run_id=$1")
      .all(r.id);
    assert.equal(rows.length, 1);
    assert.ok(Number(rows[0].queue_ms) >= 0);
    assert.ok(Number(rows[0].execution_ms) >= 0);
    assert.ok(Number(rows[0].checkpoint_ms) >= 0);
    assert.equal(rows[0].outcome, "completed");
  } finally {
    await db.close();
  }
});

test("background admission leaves a slot for interactive work across claims", async () => {
  const db = await freshDatabase();
  try {
    for (let i = 0; i < 4; i++)
      await create(`background-${i}`, "fixture", { origin: "channel" }, "v1");
    assert.ok(await claimJob({ parallelVideos: 3 }));
    assert.ok(await claimJob({ parallelVideos: 3 }));
    assert.equal(await claimJob({ parallelVideos: 3 }), null);
    const manual = await create(
      "priority-now",
      "fixture",
      { origin: "manual" },
      "v1",
    );
    const next = await claimJob({ parallelVideos: 3 });
    assert.equal((next!.payload as { runId: string }).runId, manual.id);
  } finally {
    await db.close();
  }
});
