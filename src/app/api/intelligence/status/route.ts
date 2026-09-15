import { health } from "../../../../server/youtube-intelligence/store.ts";
import {
  guard,
  failure,
} from "../../../../server/youtube-intelligence/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    guard(r);
    return Response.json(await health());
  } catch (e) {
    return failure(e);
  }
}
