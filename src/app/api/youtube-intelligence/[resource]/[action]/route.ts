import {
  guard,
  failure,
} from "../../../../../server/youtube-intelligence/http.ts";
import {
  dispatch,
  lookup,
} from "../../../../../server/youtube-intelligence/actions/index.ts";
export const maxDuration = 120;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ resource: string; action: string }> };
/**
 * The action is the path, so the body is the action's own input rather than a
 * shared envelope. `mutating` decides the method: a read answers GET, a write
 * takes POST, and nothing needs a list of action names to tell them apart.
 */
export async function GET(r: Request, { params }: Context) {
  try {
    guard(r);
    const { resource, action } = await params;
    if (lookup(resource, action).mutating)
      throw Error("This action changes data. Send it as POST.");
    return Response.json(await dispatch(resource, action, undefined));
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
    return Response.json({
      result: await dispatch(
        resource,
        action,
        text ? JSON.parse(text) : undefined,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
