import test from "node:test";
import assert from "node:assert/strict";
import { drain, drainAfterResponse } from "../src/server/youtube-intelligence/drain.ts";

test("drain runs lanes until the queue is idle", async () => {
  let remaining = 7,
    concurrent = 0,
    peak = 0;
  const result = await drain({
    budgetMs: 800_000,
    lanes: 3,
    step: async () => {
      if (remaining <= 0) return null;
      remaining--;
      peak = Math.max(peak, ++concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return { id: "job" };
    },
  });
  assert.equal(result.steps, 7);
  assert.equal(result.errors, 0);
  assert.equal(peak, 3);
});

test("drain stops claiming once only the reserve remains", async () => {
  let clock = 0;
  const result = await drain({
    budgetMs: 1000,
    reserveMs: 300,
    lanes: 1,
    now: () => clock,
    step: async () => {
      clock += 250;
      return { id: "job" };
    },
  });
  // Claims at 0, 250 and 500; at 750 only 250 ms remain, below the reserve.
  assert.equal(result.steps, 3);
});

test("a lane gives up after three consecutive failures instead of spinning", async () => {
  let calls = 0;
  const result = await drain({
    budgetMs: 800_000,
    lanes: 1,
    step: async () => {
      calls++;
      throw Error("provider down");
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.errors, 3);
  assert.equal(result.steps, 0);
});

test("outside a request scope no inline drain is started", async () => {
  assert.equal(await drainAfterResponse(10_000), false);
});

test("concurrent drains carry multi-step runs to completion within shared capacity", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const store = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext } = await import("../src/server/youtube-intelligence/runner.ts");
  const db = await freshDatabase();
  try {
    const runs = await Promise.all(
      Array.from({ length: 3 }, (_, i) => store.create(`drain-${i}`, "fixture", {}, "v1")),
    );
    let active = 0,
      peak = 0,
      calls = 0;
    // Include the real metadata -> source boundary, which must not need cron.
    const stage: Parameters<typeof processNext>[0] = async (run) => {
      calls++;
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      if (run.stage === "metadata") run.stage = "source";
      else if (run.stage === "source") run.stage = "synthesis";
      else if (run.stage === "synthesis") run.stage = "publish";
      else {
        run.stage = "done";
        run.status = "completed";
      }
    };
    // Two drains, as when cron and a submit overlap, each asking for 4 lanes;
    // the queue's capacity lock admits the team's parallelVideos (4) in total.
    const step = () => processNext(stage);
    const [a, b] = await Promise.all([
      drain({ budgetMs: 800_000, lanes: 4, step }),
      drain({ budgetMs: 800_000, lanes: 4, step }),
    ]);
    for (const run of runs)
      assert.equal((await store.get(run.id))?.status, "completed");
    assert.equal(calls, 12);
    assert.equal(a.steps + b.steps, 12);
    assert.ok(peak <= 4, `peak ${peak} exceeds team capacity`);
  } finally {
    await db.close();
  }
});

test("a delayed checkpoint continues in the same invocation without cron", async () => {
  let clock = 0, calls = 0;
  const waits: number[] = [];
  const result = await drain({
    budgetMs: 1000, reserveMs: 300, lanes: 1, now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    step: async () => {
      calls++;
      return calls === 1 ? { retryAfterMs: 100 } : calls === 2 ? { status: "completed" } : null;
    },
  });
  assert.equal(result.steps, 2);
  assert.deepEqual(waits, [100]);
});

test("a delayed checkpoint beyond the claim budget stops without waiting", async () => {
  let calls = 0;
  const result = await drain({
    budgetMs: 1000, reserveMs: 300, lanes: 1, now: () => 0,
    sleep: async () => { assert.fail("must preserve the reserve"); },
    step: async () => ++calls === 1 ? { retryAfterMs: 800 } : null,
  });
  assert.equal(result.steps, 1);
});

test("an asynchronous transcript poll resumes its checkpoint without repeating metadata", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const store = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext } = await import("../src/server/youtube-intelligence/runner.ts");
  const { SourcePending } = await import("../src/server/youtube-intelligence/transcripts.ts");
  const db = await freshDatabase();
  try {
    const run = await store.create("pending-source", "fixture", {}, "v1");
    const seen: string[] = [], waits: number[] = [];
    let pending = true;
    await drain({
      budgetMs: 800000, lanes: 1,
      sleep: async (ms) => {
        waits.push(ms);
        await (await store.db()).prepare("UPDATE jobs SET run_after=now() WHERE id=$1").run(`analyze:${run.id}`);
      },
      step: () => processNext(async (r) => {
        seen.push(r.stage);
        if (r.stage === "metadata") r.stage = "source";
        else if (pending) { pending = false; throw new SourcePending("Waiting for transcript"); }
        else { r.status = "completed"; r.stage = "done"; }
      }),
    });
    assert.deepEqual(seen, ["metadata", "source", "source"]);
    assert.deepEqual(waits, [1500]);
    assert.equal((await store.get(run.id))?.status, "completed");
  } finally { await db.close(); }
});

test("a run put back in the queue after its job failed is picked up again", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const store = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext, dispatchOpenRuns } = await import("../src/server/youtube-intelligence/runner.ts");
  const db = await freshDatabase();
  try {
    const run = await store.create("recovered-video", "fixture", {}, "v1");
    await processNext(async (r) => {
      r.stage = "critique";
      throw Error("Critique missing verdicts: m18.");
    });
    assert.equal((await store.get(run.id))?.status, "failed");
    // An audit recovery puts the run back in the queue but cannot enqueue a
    // second job under the same id.
    await (await store.db()).prepare("UPDATE yi_runs SET status='queued',error=NULL WHERE id=$1").run(run.id);
    await dispatchOpenRuns();
    const done = await processNext(async (r) => {
      r.stage = "done";
      r.status = "completed";
    });
    assert.ok(done, "the reopened job is claimed");
    assert.equal((await store.get(run.id))?.status, "completed");
  } finally {
    await db.close();
  }
});

test("a database connection timeout retries the step instead of failing the run", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const store = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext, isTransientInfrastructureError, MAX_TRANSIENT_RETRIES } = await import("../src/server/youtube-intelligence/runner.ts");
  const db = await freshDatabase();
  try {
    assert.equal(isTransientInfrastructureError(Error("timeout exceeded when trying to connect")), true);
    assert.equal(isTransientInfrastructureError(Error("Provider HTTP 400. No automatic paid retry.")), false);
    const run = await store.create("flaky-db", "fixture", {}, "v1");
    await processNext(async () => {
      throw Error("timeout exceeded when trying to connect");
    });
    let saved = await store.get(run.id);
    assert.equal(saved?.status, "queued");
    assert.match(saved?.error ?? "", /temporary database error \(1\/5\)/);
    assert.equal(saved?.output.transientRetries, 1);
    // Bounded: once the retries are spent the run fails as before.
    await (await store.db()).prepare("UPDATE yi_runs SET output=$1 WHERE id=$2").run(JSON.stringify({ transientRetries: MAX_TRANSIENT_RETRIES }), run.id);
    await (await store.db()).prepare("UPDATE jobs SET run_after=now() WHERE id=$1").run(`analyze:${run.id}`);
    await processNext(async () => {
      throw Error("timeout exceeded when trying to connect");
    });
    saved = await store.get(run.id);
    assert.equal(saved?.status, "failed");
  } finally {
    await db.close();
  }
});
