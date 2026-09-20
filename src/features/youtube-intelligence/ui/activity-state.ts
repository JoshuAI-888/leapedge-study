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
      updatedAt: z.string(),
    }),
  ),
  activeTruncated: z.boolean(),
  terminalRevision: z.string(),
  latestRunId: z.string().nullable(),
});
export function mergeRunSummaries(existing: Run[], incoming: Run[]) {
  const byId = new Map(existing.map((run) => [run.id, run]));
  for (const run of incoming) {
    const previous = byId.get(run.id);
    if (!previous || previous.updatedAt <= run.updatedAt) byId.set(run.id, run);
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
    return next && next.updatedAt >= run.updatedAt ? { ...run, ...next } : run;
  });
}
