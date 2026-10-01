import { constantEqual } from "../../../../server/youtube-intelligence/access.ts";
import { sweep } from "../../../../server/youtube-intelligence/runner.ts";
import { drain } from "../../../../server/youtube-intelligence/drain.ts";
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
  const started = Date.now();
  try {
    const scheduled = await sweep();
    // Execute queued work here on Vercel; the queue's capacity lock, leases
    // and fencing make overlapping cron and submit drains safe.
    const drained = await drain({ budgetMs: maxDuration * 1000 - (Date.now() - started) });
    return Response.json(
      { scheduled, drained },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("Intelligence dispatcher failed; inspect retained job state");
    return Response.json({ error: "Dispatcher failed" }, { status: 500 });
  }
}
