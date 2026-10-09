import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database, iso, json } from "./database.ts";
import { enqueueJob } from "./repos/jobs.ts";
import { event } from "./research-store.ts";
import {
  progressOf,
  stepOfCall,
  typicalDuration,
  type TimingSample,
} from "../../features/youtube-intelligence/progress-steps.ts";

/**
 * Server side of live progress and Retry (F72).
 *
 * `progressContext` gives the Analysis page what it cannot compute alone: a
 * typical duration from stored timings of completed analyses, and the
 * average spend per step for a retry estimate. `retryRun` resumes a failed
 * or stalled analysis from its checkpoint.
 */

const HISTORY_LIMIT = 200;

/** Completed analyses: video length and submission-to-finish seconds. */
export async function timingHistory(): Promise<TimingSample[]> {
  const rows = (await database
    .prepare(
      `WITH recent AS MATERIALIZED (
         SELECT id,created_at,output FROM yi_runs
         WHERE status='completed' AND input::jsonb->>'task' IS NULL
         ORDER BY created_at DESC,id DESC LIMIT $1
       )
       SELECT r.id,r.created_at,
         (r.output::jsonb->'metadata'->>'duration') AS duration,
         max(t.finished_at) AS finished
       FROM recent r JOIN yi_stage_timings t ON t.run_id=r.id
       GROUP BY r.id,r.created_at,r.output`,
    )
    .all(HISTORY_LIMIT)) as Record<string, unknown>[];
  return rows.flatMap((r) => {
    const start = Date.parse(iso(r.created_at) ?? "");
    const end = Date.parse(iso(r.finished) ?? "");
    const duration = Number(r.duration);
    const elapsed = (end - start) / 1000;
    return Number.isFinite(elapsed) && elapsed > 0
      ? [
          {
            durationSeconds:
              Number.isFinite(duration) && duration > 0 ? duration : null,
            elapsedSeconds: elapsed,
          },
        ]
      : [];
  });
}

/** Average spend per step over completed analyses that paid for that step. */
export async function stepCostAverages(): Promise<Map<number, number>> {
  const rows = (await database
    .prepare(
      `WITH recent AS MATERIALIZED (
         SELECT id FROM yi_runs
         WHERE status='completed' AND input::jsonb->>'task' IS NULL
         ORDER BY created_at DESC,id DESC LIMIT $1
       )
       SELECT c.run_id,c.stage,c.amount FROM yi_calls c JOIN recent r ON r.id=c.run_id
       WHERE c.status='completed'`,
    )
    .all(HISTORY_LIMIT)) as { run_id: string; stage: string; amount: unknown }[];
  const perRun = new Map<string, number>();
  for (const r of rows) {
    const step = stepOfCall(String(r.stage));
    const amount = Number(r.amount);
    if (step === null || !Number.isFinite(amount)) continue;
    const key = `${step}|${r.run_id}`;
    perRun.set(key, (perRun.get(key) ?? 0) + amount);
  }
  const sums = new Map<number, { total: number; runs: number }>();
  for (const [key, amount] of perRun) {
    const step = Number(key.split("|")[0]);
    const s = sums.get(step) ?? { total: 0, runs: 0 };
    s.total += amount;
    s.runs++;
    sums.set(step, s);
  }
  return new Map([...sums].map(([step, s]) => [step, s.total / s.runs]));
}

/** Typical duration for this run's length, and the per-step averages. */
export async function progressContext(durationSeconds: number | null) {
  const [history, averages] = await Promise.all([
    timingHistory(),
    stepCostAverages(),
  ]);
  return {
    typical: typicalDuration(history, durationSeconds),
    stepCostUsd: Object.fromEntries(averages),
  };
}

const RunId = z.string().min(1).max(200);

/**
 * Retry an analysis from the step it stopped at. The run keeps its stage and
 * everything earlier steps stored, so completed steps never run again; within
 * the stopped step, a model call that already settled is replayed from its
 * retained response by modelCall rather than paid for twice. A paid call
 * whose outcome is still open or unknown blocks the retry until reconciled.
 *
 * A failed run is re-queued. A queued or running run counts as stalled only
 * when no running job holds a current lease. Existing queued/expired jobs
 * are resumed without creating another job. Research briefs have their own retry.
 */
export async function retryRun(input: unknown) {
  const id = RunId.parse(input);
  return database.transaction(async () => {
    const row = (await database
      .prepare(
        "SELECT id,status,stage,error,input FROM yi_runs WHERE id=$1 FOR UPDATE",
      )
      .get(id)) as
      | { id: string; status: string; stage: string; error: string | null; input: unknown }
      | undefined;
    if (!row) throw Error("Analysis not found.");
    const runInput = (json(row.input) ?? {}) as Record<string, unknown>;
    if (runInput.task)
      throw Error("Research briefs are regenerated from their own tab.");
    const stalled = row.status === "queued" || row.status === "running";
    if (row.status !== "failed" && !stalled)
      throw Error("Only a failed or stalled analysis can be retried.");
    if (stalled) {
      const live = await database
        .prepare(
          "SELECT id FROM jobs WHERE kind='analyze' AND payload->>'runId'=$1 AND status='running' AND lease_until>now() LIMIT 1",
        )
        .get(id);
      if (live)
        throw Error("This analysis is still being worked on; nothing to retry yet.");
    }
    if (
      await database
        .prepare(
          "SELECT id FROM yi_calls WHERE run_id=$1 AND status IN ('reserved','unknown') LIMIT 1",
        )
        .get(id)
    )
      throw Error(
        "A paid request for this analysis has an open or unknown outcome; it must be settled before a retry.",
      );
    const existing = stalled && await database.prepare(
      "SELECT id FROM jobs WHERE kind='analyze' AND payload->>'runId'=$1 AND (status='queued' OR (status='running' AND lease_until<=now())) LIMIT 1",
    ).get(id);
    if (existing) {
      // The authenticated mutation starts an inline drain after its response.
      // Keep the job, its backoff and checkpoint; never race a claim by resetting it.
      const step = progressOf({ status: "queued", stage: row.stage }).step;
      await event("run_resume", id, { stage: row.stage, step, jobId: existing.id });
      return { id, stage: row.stage, step };
    }
    const changed = await database
      .prepare(
        "UPDATE yi_runs SET status='queued',error=NULL,lease_until=0,lease_token=NULL,updated_at=$1 WHERE id=$2 AND status=$3",
      )
      .run(new Date().toISOString(), id, row.status);
    if (!changed.changes) throw Error("This analysis changed; reload and try again.");
    await enqueueJob({
      id: `retry:${id}:${randomUUID()}`,
      kind: "analyze",
      payload: { runId: id },
    });
    const step = progressOf({ status: "queued", stage: row.stage }).step;
    await event("run_retry", id, {
      stage: row.stage,
      step,
      previousStatus: row.status,
      previousError: row.error,
    });
    return { id, stage: row.stage, step };
  });
}
