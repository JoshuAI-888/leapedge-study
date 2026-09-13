import { finishExperiments } from "./experiments.ts";
import { claimNext, save, heartbeat, db } from "./store.ts";
import { step } from "./pipeline.ts";
import { SourcePending } from "./transcripts.ts";
import { preferences, doc, put } from "./research-store.ts";
import { pullDue } from "./channels.ts";
import { prepareScheduledDigest } from "./briefings.ts";
import { deliverDue } from "./email.ts";
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
export async function sweep() {
  const acquired = await db().transaction(async () => {
    const old = await doc<{ until: number }>("scheduler", "lease");
    if (old && old.until > Date.now()) return false;
    await put("scheduler", "lease", { until: Date.now() + 300000 });
    return true;
  });
  if (!acquired) return { skipped: true };
  try {
    if ((await preferences()).autoPullEnabled) await pullDue();
    await prepareScheduledDigest();
    await deliverDue();
    return { skipped: false };
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
