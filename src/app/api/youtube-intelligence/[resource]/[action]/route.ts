import {
  guard,
  failure,
  timed,
} from "../../../../../server/youtube-intelligence/http.ts";
import {
  dispatch,
  lookup,
} from "../../../../../server/youtube-intelligence/actions/index.ts";
import { drainAfterResponse } from "../../../../../server/youtube-intelligence/drain.ts";
export const maxDuration = 800;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function parseInput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw Error("The input parameter is not valid JSON.");
  }
}
type Context = { params: Promise<{ resource: string; action: string }> };
/**
 * The action is the path, so the body is the action's own input rather than a
 * shared envelope. `mutating` decides the method: a read answers GET, a write
 * takes POST, and nothing needs a list of action names to tell them apart.
 */
async function read(r: Request, { params }: Context) {
  try {
    guard(r);
    const { resource, action } = await params;
    if (lookup(resource, action).mutating)
      throw Error("This action changes data. Send it as POST.");
    // A read that takes input (the query resource) carries it as JSON in
    // `?input=`; every other read ignores the parameter's absence as before.
    const input = new URL(r.url).searchParams.get("input");
    if (input !== null && input.length > 16000) throw Error("Request too large.");
    return Response.json(
      await dispatch(resource, action, input === null ? undefined : parseInput(input)),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request, { params }: Context) {
  try {
    guard(r);
    const { resource, action } = await params;
    if (!lookup(resource, action).mutating)
      throw Error("This action only reads. Request it with GET.");
    const text = await r.text();
    if (text.length > 150000) throw Error("Request too large.");
    const result = await dispatch(
        resource,
        action,
        text ? JSON.parse(text) : undefined,
      );
    // Wake the worker only after an authorized mutation succeeds. Invalid
    // inputs and rejected retries must not start unrelated paid work.
    await drainAfterResponse(maxDuration * 1000);
    return Response.json({ result });
  } catch (e) {
    return failure(e);
  }
}
export const GET = (r: Request, context: Context) => timed(() => read(r, context));
