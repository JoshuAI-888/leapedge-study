import { database } from "../../../../../server/youtube-intelligence/database.ts";
import { researchBriefs } from "../../../../../server/youtube-intelligence/research-pipeline.ts";
import { claimsForRun } from "../../../../../server/youtube-intelligence/repos/claims.ts";
import { spansForClaims } from "../../../../../server/youtube-intelligence/repos/evidence-spans.ts";
import { docs } from "../../../../../server/youtube-intelligence/research-store.ts";
import { get } from "../../../../../server/youtube-intelligence/store.ts";
import { timelineFor } from "../../../../../server/youtube-intelligence/timing.ts";
import { analystViewFor } from "../../../../../server/youtube-intelligence/analyst-view.ts";
import {
  guard,
  failure,
} from "../../../../../server/youtube-intelligence/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  r: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    guard(r);
    const run = await get((await params).id);
    const claims = run ? await claimsForRun(run.id) : [];
    const briefs = run
      ? (await researchBriefs()).filter(
          (b) => b.sourceRunId === run.id || b.runId === run.id,
        )
      : [];
    // The analyst view is a convenience over the retained output: a run whose
    // output it cannot read (older or partial formats) still opens, without it.
    let analyst: ReturnType<typeof analystViewFor> | null = null;
    let analystViewError: string | null = null;
    if (run && !run.input.task && run.status === "completed")
      try {
        analyst = analystViewFor(run, briefs[0] ?? null);
      } catch (error) {
        analystViewError = error instanceof Error ? error.message : String(error);
      }
    return run
      ? Response.json({
          claims,
          researchBriefs: briefs,
          analystView: analyst?.view ?? null,
          analystNote: analyst?.note ?? null,
          analystViewError,
          evidenceSpans: await spansForClaims(claims.map((c) => c.id)),
          reviewerConfigured: Boolean(process.env.YTI_REVIEWER_ACCOUNT_ID),
          run: {
            ...run,
            output: {
              ...run.output,
              stageTimings: await database.prepare("SELECT stage,claimed_at,finished_at,queue_ms,execution_ms,checkpoint_ms,outcome FROM yi_stage_timings WHERE run_id=$1 ORDER BY claimed_at LIMIT 1000").all(run.id),
              timeline: await timelineFor(run),
              entityRegistry: await docs("entity"),
              ...(run.input.task === "research-brief"
                ? {
                    researchRequests: (
                      await docs<{ runId: string }>("researchRequest")
                    ).filter((t) => t.runId === run.id),
                  }
                : {}),
            },
          },
        })
      : Response.json({ error: "Run not found." }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}
