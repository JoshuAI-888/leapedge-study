import { z } from "zod";
import {
  guard,
  failure,
} from "../../../../server/youtube-intelligence/http.ts";
import {
  dispatch,
  lookup,
  resourceOf,
} from "../../../../server/youtube-intelligence/actions/index.ts";
export const maxDuration = 120;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The pre-F30 envelope, kept so both front ends keep working unchanged. It
 * carries no logic of its own: every action resolves in the same dispatch
 * tables /api/youtube-intelligence/* uses. Deleted at the phase-3a gate.
 */
export async function GET(r: Request) {
  try {
    guard(r);
    return Response.json(
      new URL(r.url).searchParams.get("view") === "preferences"
        ? await dispatch("settings", "current", undefined)
        : await dispatch("research", "snapshot", undefined),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    guard(r);
    const text = await r.text();
    if (text.length > 150000) throw Error("Request too large.");
    const a = z
      .object({ action: z.string(), data: z.unknown() })
      .parse(JSON.parse(text));
    const resource = resourceOf(a.action);
    if (!resource || !lookup(resource, a.action).mutating)
      throw Error("Unknown research action.");
    return Response.json({
      result: await dispatch(resource, a.action, a.data),
    });
  } catch (e) {
    return failure(e);
  }
}
