import { guard, failure, timed } from "../../../../server/youtube-intelligence/http.ts";
import { workspaceActivity } from "../../../../server/youtube-intelligence/run-summaries.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function read(request: Request) {
  try {
    guard(request);
    return Response.json(await workspaceActivity(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export const GET = (request: Request) => timed(() => read(request));
