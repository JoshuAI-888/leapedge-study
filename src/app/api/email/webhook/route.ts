import { receiveEmailWebhook } from "../../../../server/youtube-intelligence/webhooks.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(r: Request) {
  if (!process.env.RESEND_WEBHOOK_SECRET)
    return Response.json({ error: "Webhook not configured" }, { status: 503 });
  try {
    const body = await r.text();
    if (body.length > 100000)
      return Response.json({ error: "Too large" }, { status: 413 });
    return Response.json(await receiveEmailWebhook(body, r.headers));
  } catch {
    return Response.json({ error: "Webhook rejected" }, { status: 400 });
  }
}
