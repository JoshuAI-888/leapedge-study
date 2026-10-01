import { health } from "../../../../server/youtube-intelligence/store.ts";
import { missingRequiredHosted } from "../../../../server/youtube-intelligence/env.ts";
import { databaseRoundTripMs } from "../../../../server/youtube-intelligence/database.ts";
import {
  guard,
  failure,
  timed,
} from "../../../../server/youtube-intelligence/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function read(r: Request) {
  try {
    guard(r);
    // missingHosted names the hosted variables this deployment has not got —
    // names only, never values. It is composed here rather than inside health()
    // because it reads the environment and not the database, and the worker and
    // the maintenance scripts that also call health() have no use for it.
    return Response.json({
      ...(await health()),
      missingHosted: missingRequiredHosted(),
      // The bare round trip from this function's region to the database: the
      // floor under every query a page makes.
      databaseRoundTripMs: await databaseRoundTripMs(),
      functionRegion: process.env.VERCEL_REGION ?? null,
    });
  } catch (e) {
    return failure(e);
  }
}
export const GET = (r: Request) => timed(() => read(r));
