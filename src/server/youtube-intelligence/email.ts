import { get, db } from "./store.ts";
import { createHash } from "node:crypto";
import { doc, docs, put, preferences } from "./research-store.ts";
import type { Briefing } from "./briefings.ts";
import { reconcileDeliveryEvents } from "./webhooks.ts";
export function emailText(b: Briefing, origin: string) {
  return [
    `YouTube Intelligence — ${b.date}`,
    `Timezone: ${b.timezone}`,
    `Videos: ${b.runIds.length}`,
    ...(b.summaryPoints || []).filter((p) => p.passed).map((p) => p.text_en),
    ...b.groups.flatMap((g) => [
      `${g.ticker}: ${g.agreement}`,
      ...g.calls.map(
        (c) =>
          `${c.channel}: ${c.claim.thesis_en}\nEvidence: ${origin}/?run=${encodeURIComponent(c.runId)}`,
      ),
    ]),
    "",
    ...b.limitations,
    `Manage digest preferences: ${origin}/research?tab=settings`,
  ].join("\n\n");
}
export async function sendPreview(id: string) {
  const delivery = await doc<{
    id: string;
    date: string;
    status: string;
    briefingId: string;
    test?: boolean;
  }>("delivery", id);
  if (!delivery) throw Error("Digest preview not found.");
  if (delivery.status !== "preview_ready")
    throw Error(
      "Delivery is already sent, pending or uncertain. Review it before retrying.",
    );
  const key = process.env.RESEND_API_KEY,
    to = process.env.YTI_EMAIL_TO,
    from = process.env.YTI_EMAIL_FROM,
    origin = process.env.YTI_APP_ORIGIN;
  if (
    process.env.YTI_EMAIL_SEND_ENABLED !== "true" ||
    !key ||
    !to ||
    !from ||
    !origin
  )
    throw Error(
      "Email delivery is not enabled or configured. Preview remains available.",
    );
  const b = await doc<Briefing>("briefing", delivery.briefingId);
  if (!b) throw Error("Briefing snapshot not found.");
  const text =
      (delivery.test ? "Test digest from YouTube Intelligence.\n\n" : "") +
      emailText(b, origin),
    idempotencyKey = createHash("sha256")
      .update(id + to + text)
      .digest("hex");
  await db().transaction(async () => {
    if (
      (await doc<{ status: string }>("delivery", id))?.status !==
      "preview_ready"
    )
      throw Error("Delivery already claimed.");
    return put("delivery", id, {
      ...delivery,
      status: "sending",
      idempotencyKey,
      submittedAt: new Date().toISOString(),
    });
  });
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${delivery.test ? "[TEST] " : ""}YouTube Intelligence — ${b.date}`,
        text,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    await put("delivery", id, {
      ...delivery,
      status: "uncertain",
      idempotencyKey,
      reason: "Network interrupted; check provider before retry.",
    });
    throw Error("Email delivery status is uncertain.");
  }
  if (!r.ok) {
    await put("delivery", id, {
      ...delivery,
      status: "failed",
      http: r.status,
      idempotencyKey,
    });
    throw Error(`Email provider HTTP ${r.status}.`);
  }
  const result = await r.json();
  const accepted = {
    ...delivery,
    status: "provider_accepted",
    providerId: result.id,
    idempotencyKey,
    acceptedAt: new Date().toISOString(),
    reason: "Accepted by provider; mailbox delivery is not yet confirmed.",
  };
  await put("delivery", id, accepted);
  // A fast webhook can arrive before the provider ID is persisted. Replay retained
  // matching events so acceptance cannot erase a delivered/bounced outcome.
  return { ...accepted, ...(await reconcileDeliveryEvents(id)) };
}
export async function deliverDue() {
  for (const d of await docs<{
    id: string;
    status: string;
    runId?: string;
    briefingId: string;
  }>("delivery")) {
    if (d.status !== "synthesizing" || !d.runId) continue;
    const run = await get(d.runId);
    if (run?.status === "completed" && run.output.briefingId)
      await put("delivery", d.id, {
        ...d,
        briefingId: run.output.briefingId,
        status: "preview_ready",
      });
    else if (run?.status === "failed" || run?.status === "needs_review")
      await put("delivery", d.id, {
        ...d,
        status: "synthesis_failed",
        reason: run.error,
      });
  }
  if (
    !(await preferences()).digestEnabled ||
    process.env.YTI_EMAIL_SEND_ENABLED !== "true"
  )
    return;
  for (const d of (
    await docs<{ id: string; status: string; test?: boolean }>("delivery")
  )
    .filter((d) => d.status === "preview_ready" && !d.test)
    .slice(0, 1)) {
    try {
      await sendPreview(d.id);
    } catch {
      /* State retained, no silent retry. */
    }
  }
}
