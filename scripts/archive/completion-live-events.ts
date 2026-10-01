// Real Resend event simulation using its documented test addresses; no human recipients.
// Re-running observes existing records and NEVER repeats submissions.
import { writeFileSync } from "node:fs";
import {
  doc,
  docs,
  put,
} from "../src/server/youtube-intelligence/research-store.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
import { reconcileDeliveryEvents } from "../src/server/youtube-intelligence/webhooks.ts";
const results = [];
for (const kind of ["delivered", "bounced"]) {
  const id = `completion-event-${kind}-20260915`;
  let row = await doc<any>("delivery", id);
  if (!row && process.argv.includes("--send")) {
    const to = `${kind}+yti-completion-20260915@resend.dev`;
    const from = process.env.YTI_EMAIL_FROM!;
    if (!from.includes("welcome@accounts.joshuai.nz"))
      throw Error("Unexpected sender");
    await put("delivery", id, {
      id,
      test: true,
      status: "sending",
      simulation: true,
      expectedEvent: `email.${kind}`,
      createdAt: new Date().toISOString(),
    });
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": id,
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `[TEST] YouTube Intelligence ${kind} event`,
          text: "Authorized delivery-event acceptance test. This contains no research or personal data.",
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error(`Resend HTTP ${r.status}`);
      const body = await r.json();
      if (typeof body.id !== "string") throw Error("Missing provider ID");
      await put("delivery", id, {
        id,
        test: true,
        status: "provider_accepted",
        simulation: true,
        providerId: body.id,
        expectedEvent: `email.${kind}`,
        acceptedAt: new Date().toISOString(),
      });
    } catch (e) {
      await put("delivery", id, {
        id,
        test: true,
        status: "uncertain",
        simulation: true,
        reason: e instanceof Error ? e.message : "Unknown failure",
      });
    }
  }
  row = await reconcileDeliveryEvents(id);
  const events = (await docs<any>("emailEvent")).filter(
    (e) => e.emailId === row?.providerId,
  );
  results.push({
    id,
    delivery: row,
    events,
    passed: events.some((e) => e.type === `email.${kind}`),
  });
}
writeFileSync(
  "docs/completion-live-events-20260915.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      method:
        "Resend documented test addresses -> live signed webhook -> Neon -> application reconciliation",
      results,
      inboxReceiptProven: false,
    },
    null,
    2,
  ),
);
console.log(
  results.map((x) => ({
    id: x.id,
    passed: x.passed,
    status: x.delivery?.status,
    events: x.events.map((e) => e.type),
  })),
);
await db().close();
