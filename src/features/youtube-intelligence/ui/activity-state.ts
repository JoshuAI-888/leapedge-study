import { z } from "zod";
import type { Run } from "../contracts.ts";
const Summary = z.object({
  id: z.string(),
  videoId: z.string(),
  url: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  title: z.string(),
  status: z.string(),
  stage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
  cost: z.number(),
  findingsRevision:z.number().int().nonnegative().optional(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
});
export const RunPage = z.object({
  runs: z.array(Summary),
  nextCursor: z.string().nullable(),
});
export const Activity = z.object({
  active: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      stage: z.string(),
      title: z.string(),
      error: z.string().nullable(),
      cost: z.number(),
      findingsRevision:z.number().int().nonnegative().optional(),
      updatedAt: z.string(),
    }),
  ),
  activeTruncated: z.boolean(),
  terminalRevision: z.string(),
  latestRunId: z.string().nullable(),
});
function revision(run: {output?:Record<string,unknown>;findingsRevision?:number}) {
  const value=run.findingsRevision ?? run.output?.checkedFindingsRevision;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function mergeRunSummaries(existing: Run[], incoming: Run[]) {
  const byId = new Map(existing.map((run) => [run.id, run]));
  for (const run of incoming) {
    const previous = byId.get(run.id);
    if (!previous) byId.set(run.id, run);
    else {
      const newer=previous.status === "completed" && run.status !== "completed" ? previous : previous.updatedAt <= run.updatedAt ? run : previous;
      byId.set(run.id,{...newer,findingsRevision:Math.max(revision(previous),revision(run))} as Run);
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}
export function applyActivity(runs: Run[], activity: z.infer<typeof Activity>) {
  const updates = new Map(activity.active.map((run) => [run.id, run]));
  return runs.map((run) => {
    const next = updates.get(run.id);
    if(!next) return run;
    const findingsRevision=Math.max(revision(run),next.findingsRevision ?? 0);
    // A late active poll cannot undo a completed row already read from detail.
    return next.updatedAt >= run.updatedAt && run.status !== "completed"
      ? {...run,...next,findingsRevision} : {...run,findingsRevision};
  });
}
