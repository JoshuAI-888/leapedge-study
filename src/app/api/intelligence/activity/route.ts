import { guard, failure } from "../../../../server/youtube-intelligence/http.ts";
import { workspaceActivity } from "../../../../server/youtube-intelligence/run-summaries.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    guard(request);
    return Response.json(await workspaceActivity(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
