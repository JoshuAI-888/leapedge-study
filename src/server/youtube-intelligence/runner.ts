import { z } from "zod";
import {
  claimJob,
  completeJob,
  retryJob,
  failJob,
  renewJob,
  queuePaused,
} from "./queue.ts";
import { enqueueJob } from "./repos/jobs.ts";
import { finishExperiments } from "./experiments.ts";
import {
  db,
  get,
  save,
  heartbeat,
  enqueueExpiredReservations,
} from "./store.ts";
import { step } from "./pipeline.ts";
import { SourcePending } from "./transcripts.ts";
import {
  preferences,
  claimLease,
  put,
  teamPreferences,
} from "./research-store.ts";
import { pullDue } from "./channels.ts";
import { prepareScheduledDigest } from "./briefings.ts";
import { deliverDue } from "./email.ts";
import { reconcileUnknown } from "./reconcile.ts";
export type JobHandler = (payload: unknown) => Promise<void>;
const handlers = new Map<string, JobHandler>([
  [
    "reconcile",
    async () => {
      await reconcileUnknown();
    },
  ],
  [
    "settle",
    async (payload) => {
      const { asOf } = z
        .object({ asOf: z.iso.date().optional() })
        .parse(payload);
      await (await import("./leaderboard.ts")).settlementSweep(asOf);
    },
  ],
  [
    "push-renew",
    async (payload) => {
      const { channelId } = z.object({ channelId: z.string() }).parse(payload);
      await (await import("./push.ts")).pushRenew(channelId);
    },
  ],
  [
    "batch-poll",
    async (payload) => {
      const { id } = z.object({ id: z.string() }).parse(payload);
      await (await import("./batch.ts")).pollBatch(id);
    },
  ],
]);
export function registerJobHandler(kind: string, handler: JobHandler) {
  handlers.set(kind, handler);
}
/** Migrate open pre-queue runs idempotently; paid work is only performed by the worker. */
export async function dispatchOpenRuns() {
  const rows = await db()
    .prepare("SELECT id FROM yi_runs WHERE status IN ('queued','running')")
    .all();
  for (const row of rows)
    await enqueueJob({
      id: `analyze:${row.id}`,
      kind: "analyze",
      payload: { runId: String(row.id) },
    });
}
export async function processNext(executeStage: typeof step = step) {
  await heartbeat();
  const job = await claimJob();
  if (!job) return null;
  const token = job.leaseToken!;
  const timer = setInterval(() => {
    void renewJob(job.id, token).catch(() => undefined);
  }, 60000);
  timer.unref();
  try {
    if (job.kind !== "analyze") {
      const handler = handlers.get(job.kind);
      if (!handler) throw Error(`No worker handler registered for ${job.kind}`);
      await handler(job.payload);
      if (!(await completeJob(job.id, token)))
        throw Error("Stale worker lease.");
      return { id: job.id, stage: job.kind, status: "completed" };
    }
    const { runId } = z.object({ runId: z.string().min(1) }).parse(job.payload);
    const run = await get(runId);
    if (!run) throw Error("Analysis run is missing.");
    if (["completed", "failed"].includes(run.status)) {
      await completeJob(job.id, token);
      return { id: run.id, stage: run.stage, status: run.status };
    }
    await db()
      .prepare(
        "UPDATE yi_runs SET status='running',lease_token=$1,lease_until=$2 WHERE id=$3",
      )
      .run(token, Date.now() + 600000, run.id);
    run.status = "running";
    run.error = null;
    try {
      await executeStage(run);
      if (run.status === "running") run.status = "queued";
    } catch (error) {
      run.status = error instanceof SourcePending ? "queued" : "failed";
      run.error = error instanceof Error ? error.message : "Stage failed";
    }
    // Lock and check queue ownership in the same transaction as the checkpoint.
    await db().transaction(async () => {
      const owner = await db()
        .prepare(
          "SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
        )
        .get(job.id, token);
      if (!owner) throw Error("Stale worker lease.");
      await db()
        .prepare(
          "UPDATE yi_runs SET lease_until=$1 WHERE id=$2 AND lease_token=$3",
        )
        .run(Date.now() + 600000, run.id, token);
      await save(run, token);
      if (run.status === "queued")
        await retryJob(
          job.id,
          token,
          run.error,
          run.input.processingMode === "batch"
            ? 60000
            : run.stage === "source"
              ? 1500
              : 0,
        );
      else if (run.status === "failed")
        await failJob(job.id, token, run.error ?? "Stage failed");
      else await completeJob(job.id, token);
    });
    await finishExperiments();
    return { id: run.id, stage: run.stage, status: run.status };
  } catch (error) {
    if (error instanceof SourcePending) {
      await retryJob(job.id, token, error.message, 60000);
      return { id: job.id, stage: job.kind, status: "queued" };
    }
    await failJob(
      job.id,
      token,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    clearInterval(timer);
  }
}
/**
 * One sweep at a time. The lease is claimed by a conditional UPDATE that only
 * changes a row whose deadline has passed, so exactly one of any number of
 * concurrent callers gets it without holding a lock across external IO.
 */
export async function sweep() {
  if (queuePaused()) return { skipped: true };
  await dispatchOpenRuns();
  await (await import("./batch.ts")).schedulePendingBatches();
  await (await import("./push.ts")).schedulePushRenewals();
  await enqueueJob({
    id: `settle:${Math.floor(Date.now() / 3600000)}`,
    kind: "settle",
    payload: {},
  });
  if (!(await claimLease("scheduler", "lease", Date.now() + 300000)))
    return { skipped: true };
  try {
    if ((await preferences()).autoPullEnabled) await pullDue();
    await prepareScheduledDigest();
    await deliverDue();
    /**
     * Unknown provider outcomes are held for budget.unknownOutcomeHoldMinutes
     * and then reconciled here (spec 4.4), by the worker that is already
     * awake rather than by the run that hit the uncertainty.
     */
    await enqueueExpiredReservations(
      (await teamPreferences()).budget.unknownOutcomeHoldMinutes,
    );
    const reconciled = await reconcileUnknown();
    return { skipped: false, reconciled };
  } finally {
    await put("scheduler", "lease", { until: Date.now() + 60000 });
  }
}
export async function processWindow(milliseconds = 90000) {
  const start = Date.now(),
    jobs = [];
  while (Date.now() - start < milliseconds) {
    const job = await processNext();
    if (!job) break;
    jobs.push(job);
    if (job.status === "queued" && job.stage === "source") break;
  }
  return jobs;
}
