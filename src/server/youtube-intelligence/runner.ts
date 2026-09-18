import { finishExperiments } from "./experiments.ts";
import { claimNext, save, heartbeat } from "./store.ts";
import { step } from "./pipeline.ts";
import { SourcePending } from "./transcripts.ts";
import { preferences, claimLease, put } from "./research-store.ts";
import { pullDue } from "./channels.ts";
import { prepareScheduledDigest } from "./briefings.ts";
import { deliverDue } from "./email.ts";
import { reconcileUnknown } from "./reconcile.ts";
export async function processNext() {
  await heartbeat();
  const job = await claimNext();
  if (!job) return null;
  const { run, token } = job;
  try {
    await step(run);
    if (run.status === "running") run.status = "queued";
  } catch (e) {
    run.status = e instanceof SourcePending ? "queued" : "failed";
    run.error = e instanceof Error ? e.message : "Stage failed";
  }
  await save(run, token);
  await finishExperiments();
  return { id: run.id, stage: run.stage, status: run.status };
}
/**
 * One sweep at a time. The lease is claimed by a conditional UPDATE that only
 * changes a row whose deadline has passed, so exactly one of any number of
 * concurrent callers gets it without a lock over the database. F26 replaces this
 * with a singleton job.
 */
export async function sweep() {
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
