import {
  receivePush,
  verifyPushChallenge,
} from "../../../../server/youtube-intelligence/push.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return new Response(
      await verifyPushChallenge(
        url.searchParams.get("channel") ?? "",
        url.searchParams,
      ),
      { headers: { "content-type": "text/plain" } },
    );
  } catch {
    return new Response("Invalid verification request", { status: 403 });
  }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 200000)
      return new Response("Payload too large", { status: 413 });
    const reader = request.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 200000) {
            await reader.cancel();
            return new Response("Payload too large", { status: 413 });
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    const body = Buffer.concat(chunks).toString("utf8");
    return Response.json(
      await receivePush(
        new URL(request.url).searchParams.get("channel") ?? "",
        body,
        request.headers.get("x-hub-signature-256") ??
          request.headers.get("x-hub-signature") ??
          "",
      ),
    );
  } catch {
    return new Response("Invalid notification", { status: 403 });
  }
}
