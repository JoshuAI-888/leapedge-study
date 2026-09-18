import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YTI_DB = "pglite";
delete process.env.DATABASE_URL;
const { db, create, claimNext, save } =
  await import("../src/server/youtube-intelligence/store.ts");
const { preferences, savePreferences, put, doc } =
  await import("../src/server/youtube-intelligence/research-store.ts");
const { prepareScheduledDigest, localDay } =
  await import("../src/server/youtube-intelligence/briefings.ts");
const { deliverDue, sendPreview } =
  await import("../src/server/youtube-intelligence/email.ts");
test("Scheduled digests deduplicate concurrent sweeps, await audited synthesis and send once", async () => {
  const p = await preferences();
  await savePreferences({
    ...p,
    timezone: "UTC",
    digestHour: 0,
    digestEnabled: true,
  });
  const r = await create("schedule-fixture", "fixture", {}, p.promptVersion);
  const job = await claimNext();
  assert.equal(job!.run.id, r.id);
  job!.run.status = "completed";
  job!.run.output = {
    metadata: { channel: "Fixture" },
    keyPoints: [
      {
        id: "k1",
        passed: true,
        claim: {
          thesis_en: "Explicit fixture research.",
          ticker: null,
          instrument_as_spoken: null,
          stance: "neutral",
          evidence: [],
        },
      },
    ],
  };
  await save(job!.run, job!.token);
  const day = localDay(new Date().toISOString(), "UTC");
  await put("delivery", "manual-test", {
    id: "manual-test",
    date: day,
    status: "accepted",
    test: true,
  });
  const results = await Promise.all([
    prepareScheduledDigest(),
    prepareScheduledDigest(),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const delivery = await doc<any>("delivery", `UTC:${day}`);
  assert.equal(delivery.status, "synthesizing");
  assert.ok(delivery.runId);
  process.env.YTI_EMAIL_SEND_ENABLED = "false";
  await deliverDue();
  assert.equal(
    (await doc<any>("delivery", delivery.id)).status,
    "synthesizing",
  );
  const q = await claimNext();
  assert.equal(q!.run.id, delivery.runId);
  q!.run.status = "completed";
  q!.run.output.briefingId = delivery.briefingId;
  await save(q!.run, q!.token);
  await deliverDue();
  assert.equal(
    (await doc<any>("delivery", delivery.id)).status,
    "preview_ready",
  );
  const old = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => {
    sends++;
    return Response.json({ id: "fixture-message" });
  };
  Object.assign(process.env, {
    YTI_EMAIL_SEND_ENABLED: "true",
    RESEND_API_KEY: "fixture",
    YTI_EMAIL_FROM: "sender@example.test",
    YTI_EMAIL_TO: "recipient@example.test",
    YTI_APP_ORIGIN: "https://example.test",
  });
  try {
    const sent = await Promise.allSettled([
      sendPreview(delivery.id),
      sendPreview(delivery.id),
    ]);
    assert.equal(sent.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(sends, 1);
    assert.equal(
      (await doc<any>("delivery", delivery.id)).status,
      "provider_accepted",
    );
    await deliverDue();
    assert.equal(sends, 1);
    assert.equal(await prepareScheduledDigest(), null);
  } finally {
    globalThis.fetch = old;
    await db().close();
  }
});
