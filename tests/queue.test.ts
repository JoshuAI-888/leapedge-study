import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  enqueueJob,
  listJobs,
} from "../src/server/youtube-intelligence/repos/jobs.ts";
import {
  claimJob,
  completeJob,
  retryJob,
  renewJob,
} from "../src/server/youtube-intelligence/queue.ts";
test("durable queue deduplicates, bounds claims, fences expired owners and drains while paused", async () => {
  const db = await freshDatabase();
  try {
    for (let i = 0; i < 5; i++)
      await enqueueJob({
        id: `job-${i}`,
        kind: "analyze",
        payload: { runId: `r-${i}` },
      });
    assert.equal(await enqueueJob({ id: "job-0", kind: "analyze" }), false);
    const claims = await Promise.all(
      Array.from({ length: 5 }, () => claimJob({ parallelVideos: 4 })),
    );
    assert.equal(claims.filter(Boolean).length, 4);
    const first = claims.find(Boolean)!;
    process.env.YTI_QUEUE_PAUSED = "true";
    assert.equal(await claimJob({ parallelVideos: 4 }), null);
    assert.equal(await completeJob(first.id, first.leaseToken!), true);
    delete process.env.YTI_QUEUE_PAUSED;
    const next = (await claimJob({ parallelVideos: 4 }))!;
    await db
      .prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1")
      .run(next.id);
    const replacement = (await claimJob({ parallelVideos: 4 }))!;
    assert.equal(replacement.id, next.id);
    assert.notEqual(replacement.leaseToken, next.leaseToken);
    assert.equal(await completeJob(next.id, next.leaseToken!), false);
    assert.equal(await renewJob(next.id, next.leaseToken!), false);
    assert.equal(
      await retryJob(replacement.id, replacement.leaseToken!, "pending", 0),
      true,
    );
    assert.equal(
      (await listJobs()).find((x) => x.id === replacement.id)?.status,
      "queued",
    );
  } finally {
    delete process.env.YTI_QUEUE_PAUSED;
    await db.close();
  }
});
