import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import { processNext } from "../src/server/youtube-intelligence/runner.ts";
import {
  claimJob,
  completeJob,
} from "../src/server/youtube-intelligence/queue.ts";
import {
  modelCall,
  modelCallFingerprint,
} from "../src/server/youtube-intelligence/pipeline.ts";
const real = process.env.YTI_QUEUE_REAL_PG === "true";
if (real) {
  assert.equal(
    process.env.YTI_ISOLATED_DB,
    "true",
    "Real queue tests require isolated test database",
  );
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(
    url.pathname,
    "/yti_queue",
    "Destructive fixture reset is restricted to yti_queue",
  );
}
test("four fixture videos execute concurrently and commit distinct checkpoints", async () => {
  const db = real ? database : await freshDatabase();
  let active = 0,
    peak = 0;
  try {
    await db.exec("TRUNCATE jobs, yi_runs CASCADE");
    const runs = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.create(`parallel-${i}`, "fixture", {}, "v1"),
      ),
    );
    const stage: Parameters<typeof processNext>[0] = async (run) => {
      active++;
      peak = Math.max(active, peak);
      await new Promise((resolve) => setTimeout(resolve, 100));
      run.stage = "done";
      run.status = "completed";
      run.output.fixture = true;
      active--;
    };
    const jobs = await Promise.all(
      Array.from({ length: 5 }, () => processNext(stage)),
    );
    assert.equal(jobs.filter(Boolean).length, 4);
    assert.equal(peak, 4);
    await processNext(stage);
    for (const run of runs)
      assert.equal((await store.get(run.id))?.status, "completed");
  } finally {
    await db.close();
  }
});
test(
  "real Postgres survives process kill after retained response and fences replaced owner",
  { skip: !real },
  async () => {
    try {
      const run = await store.create("killed-worker", "fixture", {}, "v1");
      const job = (await claimJob())!;
      const settings = await (
        await import("../src/server/youtube-intelligence/research-store.ts")
      ).teamPreferences();
      const fingerprint = modelCallFingerprint({
        stage: "extraction",
        model: "fixture",
        prompt: "prompt",
        payload: {},
        video: null,
        responseSchema: null,
        maxOutputTokens: null,
        inferenceConfig: null,
        source: null,
        models: settings.models,
        transport: settings.transport,
      });
      const code = `import * as s from './src/server/youtube-intelligence/store.ts';
   const id=await s.reserve(${JSON.stringify(run.id)},'extraction',0.1);
   await s.retainResponse(id+':normalized',${JSON.stringify(run.id)},'extraction',{requestFingerprint:${JSON.stringify(fingerprint)},text:'{"resumed":true}',usage:{inputTokens:1,outputTokens:1,costUsd:0.02},finishReason:'stop',raw:{fixture:true}});
   console.log('RETAINED');setInterval(()=>{},1000);`;
      const child = spawn(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", code],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let errors = "";
      child.stderr.on("data", (value) => (errors += value));
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (value) => {
          if (String(value).includes("RETAINED")) resolve();
        });
        child.once("exit", () => reject(Error(errors || "child exited early")));
      });
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      await database
        .prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1")
        .run(job.id);
      const replacement = (await claimJob())!;
      assert.equal(replacement.id, job.id);
      assert.notEqual(replacement.leaseToken, job.leaseToken);
      assert.equal(await completeJob(job.id, job.leaseToken!), false);
      assert.deepEqual(
        await modelCall(run, "extraction", "fixture", "prompt", {}),
        { resumed: true },
      );
      const attempts = await store.listAttempts(run.id, "extraction");
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].amount, 0.02);
      await completeJob(replacement.id, replacement.leaseToken!);
    } finally {
      await database.close();
    }
  },
);
