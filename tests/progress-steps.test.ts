import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import { processNext } from "../src/server/youtube-intelligence/runner.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";
import { events } from "../src/server/youtube-intelligence/research-store.ts";
import {
  retryRun,
  progressContext,
} from "../src/server/youtube-intelligence/run-progress.ts";
import {
  STEPS,
  aboutText,
  durationText,
  failureReason,
  isStuck,
  progressOf,
  retryCostEstimate,
  retryPlan,
  stepOfCall,
  stepOfStage,
  typicalDuration,
} from "../src/features/youtube-intelligence/progress-steps.ts";

test("every analysis stage maps onto one of five plain steps", () => {
  assert.deepEqual(
    STEPS.map((s) => s.short),
    ["Title", "Transcript", "Extract", "Check", "Publish"],
  );
  const expected: Record<string, number> = {
    metadata: 1,
    source: 2,
    "source-window": 2,
    "native-source": 2,
    "native-recovery": 2,
    "asr-source": 2,
    synthesis: 3,
    translate: 3,
    critique: 4,
    agree: 4,
    "asr-evidence": 4,
    "audio-review": 4,
    publish: 5,
    complete: 5,
  };
  for (const [stage, step] of Object.entries(expected))
    assert.equal(stepOfStage(stage), step, stage);
  assert.equal(stepOfStage("research-sources"), null);
  // Paid call stages carry chunk, window and repair suffixes.
  assert.equal(stepOfCall("transcribe-window-3"), 2);
  assert.equal(stepOfCall("native-recovery-1"), 2);
  assert.equal(stepOfCall("synthesis-chunk-2-repair-1"), 3);
  assert.equal(stepOfCall("synthesis-recall-0"), 3);
  assert.equal(stepOfCall("critique-chunk-1-repair-1"), 4);
  assert.equal(stepOfCall("research-synthesis"), null);
});

test("progress marks done, current and pending steps, and the stopped step on failure", () => {
  const running = progressOf({ status: "running", stage: "critique" });
  assert.equal(running.step, 4);
  assert.equal(running.label, "Checking calls against the transcript");
  assert.deepEqual(running.states, ["done", "done", "done", "current", "pending"]);
  assert.equal(running.working, true);
  const failed = progressOf({ status: "failed", stage: "source" });
  assert.deepEqual(failed.states, ["done", "failed", "pending", "pending", "pending"]);
  assert.equal(failed.working, false);
  const done = progressOf({ status: "completed", stage: "complete" });
  assert.deepEqual(done.states, ["done", "done", "done", "done", "done"]);
  // An unknown stage starts at the first step rather than guessing.
  assert.equal(progressOf({ status: "queued", stage: "mystery" }).step, 1);
});

test("typical duration: similar-length median, then all analyses, then a stated estimate", () => {
  const history = [
    { durationSeconds: 1200, elapsedSeconds: 170 },
    { durationSeconds: 1000, elapsedSeconds: 190 },
    { durationSeconds: 1500, elapsedSeconds: 180 },
    { durationSeconds: 300, elapsedSeconds: 60 },
    { durationSeconds: 5000, elapsedSeconds: 900 },
  ];
  assert.deepEqual(typicalDuration(history, 1200), {
    seconds: 180,
    basis: "similar-length",
    samples: 3,
  });
  // No three similar videos: the median of everything.
  assert.deepEqual(typicalDuration(history, 100), {
    seconds: 180,
    basis: "all-analyses",
    samples: 5,
  });
  // No history: one minute plus six seconds per minute of video.
  assert.deepEqual(typicalDuration([], 1200), {
    seconds: 180,
    basis: "estimate",
    samples: 0,
  });
  assert.equal(typicalDuration([], null).seconds, 180);
  assert.equal(
    typicalDuration([{ durationSeconds: 60, elapsedSeconds: -5 }], null).samples,
    0,
  );
});

test("elapsed time reads in seconds, minutes, then hours", () => {
  assert.equal(durationText(45), "45 s");
  assert.equal(durationText(72), "1 min 12 s");
  assert.equal(durationText(120), "2 min");
  assert.equal(durationText(20067), "5 h 34 min");
  assert.equal(durationText(7200), "2 h");
  assert.equal(aboutText(170), "about 3 minutes");
});

test("a run is stuck only after three times the typical time", () => {
  assert.equal(isStuck(540, 180), false);
  assert.equal(isStuck(541, 180), true);
  assert.equal(isStuck(1000, 0), false);
});

test("the retry plan names the stopped step and the right alternatives", () => {
  const base = { error: null, input: {}, output: {} };
  const captions = retryPlan({ ...base, status: "failed", stage: "source", error: "Captions unavailable" });
  assert.equal(captions.step, 2);
  assert.equal(captions.short, "Transcript");
  assert.equal(captions.canRetry, true);
  assert.equal(captions.offerAudio, true);
  assert.equal(captions.offerCheckRecovery, false);
  const onDemand = retryPlan({ ...base, status: "needs_review", stage: "source" });
  assert.equal(onDemand.canRetry, false);
  assert.equal(onDemand.offerAudio, true);
  const check = retryPlan({ ...base, status: "failed", stage: "critique", error: "Model response was incomplete" });
  assert.equal(check.step, 4);
  assert.equal(check.offerCheckRecovery, true);
  assert.equal(check.offerAudio, false);
  assert.equal(
    retryPlan({ ...base, status: "failed", stage: "critique", output: { auditRecoveryAttempts: 2 } }).offerCheckRecovery,
    false,
  );
  assert.equal(
    retryPlan({ ...base, status: "failed", stage: "critique", error: "Monthly budget limit reached" }).offerCheckRecovery,
    false,
  );
  assert.equal(retryPlan({ ...base, status: "running", stage: "synthesis", stuck: true }).canRetry, true);
  assert.equal(retryPlan({ ...base, status: "running", stage: "synthesis" }).canRetry, false);
  const brief = retryPlan({ ...base, status: "failed", stage: "source", input: { task: "research-brief" } });
  assert.equal(brief.canRetry || brief.offerAudio || brief.offerCheckRecovery, false);
});

test("a retry estimate sums the average spend of the steps still to run", () => {
  const averages = new Map([
    [3, 0.02],
    [4, 0.006],
  ]);
  assert.ok(Math.abs(retryCostEstimate(2, averages)! - 0.026) < 1e-12);
  assert.ok(Math.abs(retryCostEstimate(4, averages)! - 0.006) < 1e-12);
  assert.equal(retryCostEstimate(5, averages), null);
});

test("failure reasons read as plain words", () => {
  assert.equal(failureReason("Captions unavailable. ASR is on demand", 2), "Captions are not available for this video.");
  assert.match(failureReason("Monthly budget limit reached: US$1", 3), /spending limit/);
  assert.match(failureReason(null, 4), /check step stopped/);
  assert.equal(failureReason("x".repeat(400), 3).length, 218);
});

/** A run that got to the check step, paid for extraction, then failed. */
async function failedAtCheck() {
  await freshDatabase();
  const run = await store.create("retryVid001", "google/gemini-3.8-flash", { researchPipeline: "current" }, "v1");
  await processNext(async (current) => {
    current.stage = "critique";
    const call = await store.reserve(current.id, "synthesis", 0.05);
    await store.settle(call, 0.021, { model: "google/gemini-3.8-flash" });
  });
  await processNext(async () => {
    throw Error("Model response was incomplete; refusing partial output.");
  });
  const failed = (await store.get(run.id))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.stage, "critique");
  return run.id;
}
const ledger = async (id: string) =>
  (await database
    .prepare("SELECT stage,status,amount FROM yi_calls WHERE run_id=$1 ORDER BY stage,attempt")
    .all(id)) as { stage: string; status: string; amount: number }[];

test("Retry resumes a failed analysis at its stopped step without paying for completed steps again", async () => {
  const id = await failedAtCheck();
  const before = await ledger(id);
  const result = (await dispatch("runs", "retry", id)) as { step: number; stage: string };
  assert.deepEqual(result, { id, stage: "critique", step: 4 });
  const queued = (await store.get(id))!;
  assert.equal(queued.status, "queued");
  assert.equal(queued.error, null);
  const seen: string[] = [];
  await processNext(async (current) => {
    seen.push(current.stage);
    current.stage = "complete";
    current.status = "completed";
  });
  assert.deepEqual(seen, ["critique"]);
  assert.equal((await store.get(id))!.status, "completed");
  // The extraction step's settled spend is untouched and nothing new was reserved for it.
  assert.deepEqual(await ledger(id), before);
  assert.equal((await ledger(id)).filter((c) => c.stage === "synthesis").length, 1);
  const audit = await events("run_retry");
  assert.equal(audit.at(-1)?.entityId, id);
  assert.equal((audit.at(-1)?.payload as { step: number }).step, 4);
});

test("Retry is refused while a paid request has an open outcome, and for finished or live runs", async () => {
  const id = await failedAtCheck();
  const held = await store.reserve(id, "critique", 0.01, 2);
  await assert.rejects(retryRun(id), /open or unknown outcome/);
  await store.release(held, "test");
  await retryRun(id);
  // A queued job can be resumed without creating another one.
  await retryRun(id);
  const { claimJob } = await import("../src/server/youtube-intelligence/queue.ts");
  await claimJob();
  await assert.rejects(retryRun(id), /still being worked on/);
  await database.prepare("UPDATE yi_runs SET status='completed' WHERE id=$1").run(id);
  await assert.rejects(retryRun(id), /Only a failed or stalled analysis/);
  await assert.rejects(retryRun("missing"), /not found/);
});

test("Resume wakes a queued checkpoint without duplicating jobs or spend", async () => {
  await freshDatabase();
  const run = await store.create("resume001", "fixture", {}, "v1");
  await database.prepare("UPDATE yi_runs SET stage='source' WHERE id=$1").run(run.id);
  await retryRun(run.id);
  await retryRun(run.id);
  const jobs = await database.prepare("SELECT id FROM jobs WHERE payload->>'runId'=$1").all(run.id);
  assert.equal(jobs.length, 1);
  assert.equal((await store.get(run.id))?.stage, "source");
  assert.deepEqual(await ledger(run.id), []);
});

test("A stalled run with no live job gets a fresh job", async () => {
  await freshDatabase();
  const run = await store.create("stallVid001", "google/gemini-3.8-flash", { researchPipeline: "current" }, "v1");
  await database.prepare("UPDATE jobs SET status='failed' WHERE payload->>'runId'=$1").run(run.id);
  await database.prepare("UPDATE yi_runs SET status='running',stage='synthesis' WHERE id=$1").run(run.id);
  const result = await retryRun(run.id);
  assert.equal(result.step, 3);
  const jobs = (await database
    .prepare("SELECT id FROM jobs WHERE payload->>'runId'=$1 AND status='queued'")
    .all(run.id)) as { id: string }[];
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].id, /^retry:/);
});

test("progress context reads typical time and per-step spend from completed analyses", async () => {
  await freshDatabase();
  const empty = await progressContext(1200);
  assert.equal(empty.typical.basis, "estimate");
  assert.deepEqual(empty.stepCostUsd, {});
  for (let i = 0; i < 3; i++) {
    const run = await store.create(`typVid00${i}`, "google/gemini-3.8-flash", { researchPipeline: "current" }, "v1");
    const created = Date.parse("2026-09-01T00:00:00Z") + i * 3_600_000;
    await database
      .prepare("UPDATE yi_runs SET status='completed',stage='complete',created_at=$1,output=$2 WHERE id=$3")
      .run(new Date(created).toISOString(), JSON.stringify({ metadata: { duration: 1200 } }), run.id);
    await database
      .prepare("INSERT INTO yi_stage_timings(id,run_id,job_id,stage,claimed_at,finished_at,queue_ms,execution_ms,checkpoint_ms,outcome) VALUES($1,$2,$3,'publish',$4,$5,0,1,1,'completed')")
      .run(`t${i}`, run.id, `analyze:${run.id}`, new Date(created).toISOString(), new Date(created + (150 + i * 30) * 1000).toISOString());
    const call = await store.reserve(run.id, "synthesis-chunk-0", 0.05);
    await store.settle(call, 0.02, {});
    await store.reserve(run.id, "critique", 0.05).then((c) => store.release(c, "failed"));
  }
  const ctx = await progressContext(1100);
  assert.deepEqual(ctx.typical, { seconds: 180, basis: "similar-length", samples: 3 });
  assert.deepEqual(Object.keys(ctx.stepCostUsd), ["3"]);
  assert.ok(Math.abs(ctx.stepCostUsd[3] - 0.02) < 1e-9);
});
