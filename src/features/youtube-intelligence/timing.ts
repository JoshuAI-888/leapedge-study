import { z } from "zod";

/** One claimed step, as recorded in yi_stage_timings by processNext. */
export const StageTiming = z.object({
  stage: z.string(),
  claimed_at: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
  finished_at: z
    .union([z.string(), z.date()])
    .nullable()
    .transform((v) => (v === null ? null : new Date(v).toISOString())),
  queue_ms: z.coerce.number(),
  execution_ms: z.coerce.number().nullable(),
  checkpoint_ms: z.coerce.number().nullable(),
  outcome: z.string(),
});
export type StageTimingData = z.infer<typeof StageTiming>;

const seconds = (ms: number) => Math.round(ms) / 1000;

function summarise(submittedAt: string, rows: StageTimingData[]) {
  const stages = new Map<string, { stage: string; steps: number; executionSeconds: number; queueSeconds: number }>();
  let execution = 0,
    queue = 0,
    checkpoint = 0;
  for (const row of rows) {
    const entry = stages.get(row.stage) ?? { stage: row.stage, steps: 0, executionSeconds: 0, queueSeconds: 0 };
    entry.steps++;
    entry.executionSeconds = seconds(entry.executionSeconds * 1000 + (row.execution_ms ?? 0));
    entry.queueSeconds = seconds(entry.queueSeconds * 1000 + row.queue_ms);
    stages.set(row.stage, entry);
    execution += row.execution_ms ?? 0;
    queue += row.queue_ms;
    checkpoint += row.checkpoint_ms ?? 0;
  }
  const finished = rows
    .map((r) => r.finished_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const started = rows.map((r) => r.claimed_at).sort()[0];
  return {
    firstClaimSeconds: started ? seconds(Date.parse(started) - Date.parse(submittedAt)) : null,
    finishedAt: finished ?? null,
    elapsedSeconds: finished ? seconds(Date.parse(finished) - Date.parse(submittedAt)) : null,
    executionSeconds: seconds(execution),
    queueSeconds: seconds(queue),
    checkpointSeconds: seconds(checkpoint),
    steps: rows.length,
    stages: [...stages.values()],
  };
}

/**
 * Wall-clock timeline of one submitted video: from submission to the analysis
 * finishing, and on to its research brief. Everything is computed from stored
 * step rows, so it can be recomputed and compared across runs and against an
 * external product timed the same way (submission to final visible result).
 */
export function runTimeline(input: {
  submittedAt: string;
  status: string;
  stages: StageTimingData[];
  brief?: { submittedAt: string; status: string; stages: StageTimingData[] } | null;
}) {
  const analysis = summarise(input.submittedAt, input.stages);
  const brief = input.brief ? summarise(input.submittedAt, input.brief.stages) : null;
  const terminal = (status: string) => !["queued", "running"].includes(status);
  const analysisDone = terminal(input.status) ? analysis.elapsedSeconds : null;
  const briefDone = input.brief && terminal(input.brief.status) ? brief?.elapsedSeconds ?? null : null;
  return {
    submittedAt: input.submittedAt,
    firstStepSeconds: analysis.firstClaimSeconds,
    analysisSeconds: analysisDone,
    briefSeconds: briefDone,
    endToEndSeconds: input.brief ? briefDone : analysisDone,
    complete: input.brief ? briefDone !== null : analysisDone !== null,
    analysis,
    brief,
  };
}
export type RunTimelineData = ReturnType<typeof runTimeline>;
