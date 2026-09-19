import { researchBriefs } from "../../../../../server/youtube-intelligence/research-pipeline.ts";
import { claimsForRun } from "../../../../../server/youtube-intelligence/repos/claims.ts";
import { spansForClaims } from "../../../../../server/youtube-intelligence/repos/evidence-spans.ts";
import { docs } from "../../../../../server/youtube-intelligence/research-store.ts";
import { get } from "../../../../../server/youtube-intelligence/store.ts";
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
    return run
      ? Response.json({
          claims,
          researchBriefs: (await researchBriefs()).filter(
            (b) => b.sourceRunId === run.id || b.runId === run.id,
          ),
          evidenceSpans: await spansForClaims(claims.map((c) => c.id)),
          reviewerConfigured: Boolean(process.env.YTI_REVIEWER_ACCOUNT_ID),
          run: {
            ...run,
            output: {
              ...run.output,
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
