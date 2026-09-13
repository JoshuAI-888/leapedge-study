import { createHmac } from "node:crypto";
import { constantEqual } from "./access.ts";
import { db } from "./store.ts";
import { doc, docs, put } from "./research-store.ts";
export function verifyEmailWebhook(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const id = headers.get("svix-id"),
    at = headers.get("svix-timestamp"),
    signature = headers.get("svix-signature");
  if (
    !id ||
    !at ||
    !signature ||
    !/^\d+$/.test(at) ||
    Math.abs(now / 1000 - Number(at)) > 300 ||
    !secret.startsWith("whsec_")
  )
    throw Error("Invalid webhook");
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) throw Error("Invalid signing key");
  const expected = createHmac("sha256", key)
    .update(`${id}.${at}.${body}`)
    .digest("base64");
  if (
    !signature
      .split(" ")
      .some((s) => s.startsWith("v1,") && constantEqual(s.slice(3), expected))
  )
    throw Error("Invalid signature");
  return { id, payload: JSON.parse(body) };
}
export async function receiveEmailWebhook(body: string, headers: Headers) {
  const { id, payload } = verifyEmailWebhook(
    body,
    headers,
    process.env.RESEND_WEBHOOK_SECRET || "",
  );
  return db().transaction(async () => {
    if (await doc("emailEvent", id)) return { duplicate: true };
    const type = String(payload.type),
      emailId = String(payload.data?.email_id || "");
    const status = (
      {
        "email.delivered": "delivered",
        "email.bounced": "bounced",
        "email.complained": "complained",
        "email.failed": "failed",
        "email.delivery_delayed": "delayed",
      } as Record<string, string>
    )[type];
    const delivery = (
      await docs<{ id: string; providerId?: string; eventAt?: string }>(
        "delivery",
      )
    ).find((d) => d.providerId === emailId);
    await put("emailEvent", id, {
      id,
      type,
      emailId,
      at: payload.created_at || new Date().toISOString(),
    });
    if (
      delivery &&
      status &&
      (!delivery.eventAt || String(payload.created_at) >= delivery.eventAt)
    )
      await put("delivery", delivery.id, {
        ...delivery,
        status,
        eventAt: payload.created_at,
        lastEvent: type,
      });
    return { received: true, matched: !!delivery };
  });
}
