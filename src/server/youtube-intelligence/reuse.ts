import { z } from "zod";
import { database, iso, json } from "./database.ts";
import { create, get } from "./store.ts";
import { event, queuePlan } from "./research-store.ts";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";
/**
 * F74: reuse a finished analysis instead of paying for the same one twice.
 *
 * A submitted video is answered with its existing analysis when that analysis
 * is the video's canonical run (what the workspace shows for it), it completed,
 * and it was produced by the same identity a new run would get today. Anything
 * else — no analysis, a failed or held run, a different model, prompt or
 * pipeline version, or an explicit re-run — queues a new run through the
 * existing path, so the open-run dedupe in store.create() is untouched.
 */
export type RunIdentity = {
  model: string;
  promptVersion: string;
  criticModel: string | null;
  transcriptionModel: string | null;
  /** Null on runs that predate the recorded pipeline version. */
  pipelineVersion: string | null;
  transcriptionWindowSeconds: number;
};
const text = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : String(v);
/**
 * What decides the content of an analysis: the extraction, critique and
 * transcription models, the prompt version, the pipeline revision (the same
 * five that make a claim's config hash) and whether audio was transcribed in
 * windows, which changes the trust a call can earn. Queue mode, origin and
 * record type do not change what is extracted and are left out.
 */
export function runIdentity(run: {
  model: string;
  promptVersion: string;
  input: Record<string, unknown>;
}): RunIdentity {
  return {
    model: run.model,
    promptVersion: run.promptVersion,
    criticModel: text(run.input.criticModel),
    transcriptionModel: text(run.input.transcriptionModel),
    pipelineVersion: text(run.input.pipelineVersion),
    transcriptionWindowSeconds: Number(run.input.transcriptionWindowSeconds ?? 0) || 0,
  };
}
/** Equal identities. A run with no recorded pipeline version matches nothing. */
export function sameIdentity(a: RunIdentity, b: RunIdentity) {
  return (
    a.pipelineVersion !== null &&
    a.pipelineVersion === b.pipelineVersion &&
    a.model === b.model &&
    a.promptVersion === b.promptVersion &&
    a.criticModel === b.criticModel &&
    a.transcriptionModel === b.transcriptionModel &&
    a.transcriptionWindowSeconds === b.transcriptionWindowSeconds
  );
}
export type ReuseCandidate = {
  id: string;
  status: string;
  identity: RunIdentity;
  completedAt: string | null;
};
export type ReuseDecision =
  | { reuse: true; runId: string; analysedAt: string | null }
  | {
      reuse: false;
      reason: "forced" | "no-analysis" | "not-completed" | "different-pipeline";
    };
/** The whole policy, with no I/O. */
export function reuseDecision(o: {
  candidate: ReuseCandidate | null;
  identity: RunIdentity;
  force: boolean;
}): ReuseDecision {
  if (o.force) return { reuse: false, reason: "forced" };
  if (!o.candidate) return { reuse: false, reason: "no-analysis" };
  if (o.candidate.status !== "completed")
    return { reuse: false, reason: "not-completed" };
  if (!sameIdentity(o.candidate.identity, o.identity))
    return { reuse: false, reason: "different-pipeline" };
  return {
    reuse: true,
    runId: o.candidate.id,
    analysedAt: o.candidate.completedAt,
  };
}
/**
 * The video's canonical run, chosen exactly as research-store canonicalRuns()
 * chooses it: the run a publication names, or else the newest completed,
 * non-experimental analysis. Only the small `input` column is read.
 */
export async function canonicalRunFor(
  videoId: string,
): Promise<ReuseCandidate | null> {
  const [runs, publication] = await Promise.all([
    database
      .prepare(
        "SELECT id,model,prompt_version,status,updated_at,input FROM yi_runs WHERE video_id=$1 AND status='completed' ORDER BY created_at DESC,id DESC",
      )
      .all(videoId) as Promise<Record<string, unknown>[]>,
    database
      .prepare("SELECT payload FROM yi_documents WHERE kind='publication' AND id=$1")
      .get(videoId) as Promise<{ payload: unknown } | undefined>,
  ]);
  const selected = z
    .object({ runId: z.string() })
    .safeParse(publication ? json(publication.payload) : null);
  for (const r of runs) {
    const input = (json(r.input) ?? {}) as Record<string, unknown>;
    if (input.task) continue;
    if (selected.success ? selected.data.runId !== r.id : input.experiment === true)
      continue;
    return {
      id: String(r.id),
      status: String(r.status),
      identity: runIdentity({
        model: String(r.model),
        promptVersion: String(r.prompt_version),
        input,
      }),
      completedAt: iso(r.updated_at),
    };
  }
  return null;
}
export type AnalyseResult = Run & {
  /** The run to open: the reused analysis or the one just queued. */
  runId: string;
  /** True when an existing analysis answered the request at no cost. */
  reused: boolean;
  /** When the reused analysis finished; null for a queued run. */
  analysedAt: string | null;
};
/**
 * Analyse one video on the Today form's behalf. Reuse never queues a job or
 * reserves spend; `force` always queues, carries the analysis it replaces in
 * the run input (so repeated clicks dedupe onto one open run) and appends a
 * `rerun_requested` event as the audit record.
 */
export async function analyseVideo(
  videoId: string,
  options: { force?: boolean },
): Promise<AnalyseResult> {
  const id = z
    .string()
    .regex(/^[\w-]{11}$/, "Not a YouTube video id.")
    .parse(videoId);
  const force = options.force === true;
  const plan = await queuePlan();
  const candidate = await canonicalRunFor(id);
  const decision = reuseDecision({
    candidate,
    identity: runIdentity(plan),
    force,
  });
  const reused = decision.reuse ? await get(decision.runId) : null;
  if (decision.reuse && reused) {
    await event("analysis_reused", reused.id, {
      videoId: id,
      analysedAt: decision.analysedAt,
    });
    // The finished output (transcript, audits) stays on the run detail API.
    return {
      ...reused,
      output: {},
      runId: reused.id,
      reused: true,
      analysedAt: decision.analysedAt,
    };
  }
  const input = force
    ? { ...plan.input, rerun: { requested: true, previousRunId: candidate?.id ?? null } }
    : plan.input;
  const run = await create(id, plan.model, input, plan.promptVersion);
  if (force)
    await event("rerun_requested", run.id, {
      videoId: id,
      previousRunId: candidate?.id ?? null,
      previousStatus: candidate?.status ?? null,
    });
  return { ...run, runId: run.id, reused: false, analysedAt: null };
}
