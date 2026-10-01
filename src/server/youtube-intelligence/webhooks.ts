import { createHmac } from "node:crypto";
import { constantEqual } from "./access.ts";
import { db } from "./store.ts";
import { docs, lockedDoc, put, putIfAbsent } from "./research-store.ts";
import { iso } from "./database.ts";
const EVENT_STATUS: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.delivery_delayed": "delayed",
};
export async function reconcileDeliveryEvents(id: string) {
  return db().transaction(async () => {
    // FOR UPDATE on the delivery row, so a concurrent webhook cannot settle a
    // newer outcome between this read and the write below.
    const delivery = await lockedDoc<{
      id: string;
      providerId?: string;
      eventAt?: string;
    }>("delivery", id);
    if (!delivery?.providerId) return delivery;
    const events = (
      await docs<{ emailId: string; type: string; at: string }>("emailEvent")
    )
      .filter(
        (e) =>
          e.emailId === delivery.providerId &&
          EVENT_STATUS[e.type] &&
          Number.isFinite(Date.parse(e.at)),
      )
      .sort((a, b) => a.at.localeCompare(b.at));
    const latest = events.at(-1);
    if (latest && (!delivery.eventAt || latest.at >= delivery.eventAt)) {
      const updated = {
        ...delivery,
        status: EVENT_STATUS[latest.type],
        eventAt: latest.at,
        lastEvent: latest.type,
      };
      await put("delivery", id, updated);
      return updated;
    }
    return delivery;
  });
}
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
    const at = iso(payload.created_at) ?? new Date().toISOString();
    const matched = (
      await docs<{ id: string; providerId?: string }>("delivery")
    ).find((d) => d.providerId === emailId);
    // The event id is the dedupe key: an insert-if-absent decides which of two
    // concurrent deliveries of the same webhook is the one that counts.
    if (
      !(await putIfAbsent("emailEvent", id, { id, type, emailId, at }))
    )
      return { duplicate: true };
    // Re-read the delivery under FOR UPDATE and ignore an event older than the
    // outcome already stored, so a late arrival cannot regress the status.
    const delivery = matched
      ? await lockedDoc<{ id: string; eventAt?: string }>(
          "delivery",
          matched.id,
        )
      : null;
    if (delivery && status && (!delivery.eventAt || at >= delivery.eventAt))
      await put("delivery", matched!.id, {
        ...delivery,
        status,
        eventAt: at,
        lastEvent: type,
      });
    return { received: true, matched: !!matched };
  });
}
