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
    // Three steps per run: metadata -> synthesis -> complete.
    const stage: Parameters<typeof processNext>[0] = async (run) => {
      calls++;
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      if (run.stage === "metadata") run.stage = "synthesis";
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
    assert.equal(calls, 9);
    assert.equal(a.steps + b.steps, 9);
    assert.ok(peak <= 4, `peak ${peak} exceeds team capacity`);
  } finally {
    await db.close();
  }
});
