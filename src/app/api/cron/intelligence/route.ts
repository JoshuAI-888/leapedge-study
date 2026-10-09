import { constantEqual } from "../../../../server/youtube-intelligence/access.ts";
import { dispatchOpenRuns } from "../../../../server/youtube-intelligence/runner.ts";
import { drain } from "../../../../server/youtube-intelligence/drain.ts";
import { monitoringStatus, monitoringTick } from "../../../../server/youtube-intelligence/monitoring.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;
export async function GET(r: Request) {
  if (process.env.YTI_PREVIEW_READ_ONLY === "true")
    return Response.json({ skipped: true, reason: "Read-only preview" });
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    !constantEqual(r.headers.get("authorization") || "", `Bearer ${secret}`)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Default off: even an authenticated manual invocation must not start paid
  // work until scheduled processing is explicitly enabled by the operator.
  if (process.env.YTI_CRON_ENABLED !== "true")
    return Response.json(
      { skipped: true, reason: "Scheduled processing disabled" },
      { headers: { "Cache-Control": "no-store" } },
    );
  const started = Date.now();
  try {
    if (!(await monitoringStatus()).enabled)
      return Response.json({ skipped: true, reason: "Monitoring paused" }, { headers: { "Cache-Control": "no-store" } });
    const monitoring = await monitoringTick();
    await dispatchOpenRuns();
    await (await import("../../../../server/youtube-intelligence/batch.ts")).schedulePendingBatches();
    // Execute queued work here on Vercel; the queue's capacity lock, leases
    // and fencing make overlapping cron and submit drains safe.
    const drained = await drain({ budgetMs: maxDuration * 1000 - (Date.now() - started) });
    return Response.json(
      { monitoring, drained },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("Intelligence dispatcher failed; inspect retained job state");
    return Response.json({ error: "Dispatcher failed" }, { status: 500 });
  }
}
