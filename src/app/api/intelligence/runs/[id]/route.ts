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
    return run
      ? Response.json({ run })
      : Response.json({ error: "Run not found." }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}
