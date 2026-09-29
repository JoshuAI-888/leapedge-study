import { list } from "../store.ts";
import { rowsForRun, writeRunRows } from "../repos/publish.ts";

/**
 * Re-resolve the listings of runs published before resolution existed, by
 * republishing their rows. Republishing is idempotent: rows are upserted by id,
 * and trust earned on unchanged content is kept because the resolved columns
 * are outside the content digest. A run that cannot be republished is reported,
 * not retried.
 */
export async function resolvePublishedListings(limit = 200) {
  const runs = (await list()).filter((r) => r.status === "completed" && !r.input.task).slice(0, limit);
  let republished = 0;
  const failed: { runId: string; error: string }[] = [];
  for (const run of runs) {
    try {
      await writeRunRows(rowsForRun(run));
      republished++;
    } catch (error) {
      failed.push({ runId: run.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { considered: runs.length, republished, failed };
}
