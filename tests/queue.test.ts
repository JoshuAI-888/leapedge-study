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
  holdingLease,
  STALE_LEASE,
} from "../src/server/youtube-intelligence/queue.ts";
import { queue } from "../src/server/youtube-intelligence/research-store.ts";
import {
  dispatchOpenRuns,
  processNext,
  registerJobHandler,
} from "../src/server/youtube-intelligence/runner.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
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
test("A worker that has lost its job lease cannot reserve money for a paid call", async () => {
  const db = await freshDatabase();
  try {
    const run = await queue("lease-fence");
    await dispatchOpenRuns();
    const first = (await claimJob({ parallelVideos: 1 }))!;
    assert.equal(first.id, `analyze:${run.id}`);
    const held = await holdingLease(first.id, first.leaseToken!, () =>
      store.reserve(run.id, "held", 0.01),
    );
    await store.settle(held, 0.01, {});
    // The lease lapses and a second worker takes the job over.
    await db
      .prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1")
      .run(first.id);
    const second = (await claimJob({ parallelVideos: 1 }))!;
    assert.equal(second.id, first.id);
    await assert.rejects(
      holdingLease(first.id, first.leaseToken!, () =>
        store.reserve(run.id, "stale", 0.01),
      ),
      new RegExp(STALE_LEASE.replace(".", "\\.")),
    );
    await holdingLease(second.id, second.leaseToken!, () =>
      store.reserve(run.id, "current", 0.01),
    );
    const stages = (
      await db.prepare("SELECT stage FROM yi_calls WHERE run_id=$1").all(run.id)
    ).map((row) => row.stage);
    assert.deepEqual(stages.sort(), ["current", "held"]);
  } finally {
    await db.close();
  }
});
test("processNext runs a stage under its lease, so a lapse mid-stage stops the spend", async () => {
  const db = await freshDatabase();
  try {
    const run = await queue("lease-fence-runner");
    await dispatchOpenRuns();
    await assert.rejects(
      processNext(async (current) => {
        await db
          .prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1")
          .run(`analyze:${current.id}`);
        await store.reserve(current.id, "extract", 0.01);
      }),
      /Stale worker lease/,
    );
    assert.equal(
      (await db.prepare("SELECT id FROM yi_calls WHERE run_id=$1").all(run.id))
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("A handler job runs under its lease too, so a lapse stops its spend", async () => {
  const db = await freshDatabase();
  try {
    const run = await queue("lease-fence-handler");
    // Only the handler job is claimable; the run exists for its call rows.
    await db.prepare("UPDATE jobs SET status='completed' WHERE kind='analyze'").run();
    await enqueueJob({ id: "push-renew:fence", kind: "push-renew", payload: {} });
    registerJobHandler("push-renew", async () => {
      await db
        .prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1")
        .run("push-renew:fence");
      await store.reserve(run.id, "handler", 0.01);
    });
    await assert.rejects(processNext(), /Stale worker lease/);
    assert.equal(
      (await db.prepare("SELECT id FROM yi_calls WHERE run_id=$1").all(run.id))
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});
