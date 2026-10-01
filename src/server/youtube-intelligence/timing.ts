import { z } from "zod";
import { database } from "./database.ts";
import { get } from "./store.ts";
import { runTimeline, StageTiming } from "../../features/youtube-intelligence/timing.ts";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";

const TIMINGS =
  "SELECT stage,claimed_at,finished_at,queue_ms,execution_ms,checkpoint_ms,outcome FROM yi_stage_timings WHERE run_id=$1 ORDER BY claimed_at LIMIT 1000";

export async function stageTimings(runId: string) {
  return z.array(StageTiming).parse(await database.prepare(TIMINGS).all(runId));
}

/** Submission-to-brief timeline for a video analysis run. The first research
 * brief queued from it is the one produced automatically on completion. */
export async function timelineFor(run: Run) {
  const stages = await stageTimings(run.id);
  if (run.input.task) return runTimeline({ submittedAt: run.createdAt, status: run.status, stages });
  const row = (await database
    .prepare(
      "SELECT id FROM yi_runs WHERE (input::jsonb)->>'task'='research-brief' AND (input::jsonb)->'snapshot'->>'sourceRunId'=$1 ORDER BY created_at LIMIT 1",
    )
    .get(run.id)) as { id: string } | undefined;
  const brief = row ? await get(String(row.id)) : null;
  return runTimeline({
    submittedAt: run.createdAt,
    status: run.status,
    stages,
    brief: brief
      ? { submittedAt: brief.createdAt, status: brief.status, stages: await stageTimings(brief.id) }
      : null,
  });
}
