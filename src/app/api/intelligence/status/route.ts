import { health } from "../../../../server/youtube-intelligence/store.ts";
import { missingRequiredHosted } from "../../../../server/youtube-intelligence/env.ts";
import {
  guard,
  failure,
} from "../../../../server/youtube-intelligence/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    guard(r);
    // missingHosted names the hosted variables this deployment has not got —
    // names only, never values. It is composed here rather than inside health()
    // because it reads the environment and not the database, and the worker and
    // the maintenance scripts that also call health() have no use for it.
    return Response.json({
      ...(await health()),
      missingHosted: missingRequiredHosted(),
    });
  } catch (e) {
    return failure(e);
  }
}
