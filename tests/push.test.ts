import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { freshDatabase } from "./helpers/db.ts";
import { upsertChannel } from "../src/server/youtube-intelligence/repos/channels.ts";
import { put, doc } from "../src/server/youtube-intelligence/research-store.ts";
import {
  pushSecret,
  receivePush,
  verifyPushChallenge,
  parsePushFeed,
} from "../src/server/youtube-intelligence/push.ts";
const channel = "UCabcdefghijklmnopqrstuv",
  video = "abcdefghijk";
const xml = `<feed><entry><yt:videoId>${video}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>Research &amp; results</title><published>2026-09-19T00:00:00Z</published></entry></feed>`;
async function setup() {
  await freshDatabase();
  process.env.YTI_PUSH_CALLBACK_SECRET = "a".repeat(40);
  await upsertChannel({
    id: channel,
    title: "Research",
    active: true,
    autoAnalyze: false,
  });
  await put("pushSubscription", channel, {
    channelId: channel,
    status: "active",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
}
test("Signed push discovers once, without turning discovery into permission to spend", async () => {
  await setup();
  const sig =
    "sha256=" +
    createHmac("sha256", pushSecret(channel)).update(xml).digest("hex");
  assert.deepEqual(await receivePush(channel, xml, sig), {
    discovered: 1,
    queued: 0,
  });
  assert.deepEqual(await receivePush(channel, xml, sig), {
    discovered: 0,
    queued: 0,
  });
  const db = await freshDatabase();
  await db.close();
});
test("Unsigned, tampered and wrong-channel notifications cannot write discoveries", async () => {
  await setup();
  await assert.rejects(receivePush(channel, xml, ""), /signature/i);
  const sig =
    "sha1=" + createHmac("sha1", pushSecret(channel)).update(xml).digest("hex");
  await assert.rejects(receivePush(channel, xml + " ", sig), /signature/i);
  assert.throws(
    () =>
      parsePushFeed(xml.replace(channel, "UCzzzzzzzzzzzzzzzzzzzzzz"), channel),
    /channel/i,
  );
  assert.throws(() => parsePushFeed("<!DOCTYPE feed>" + xml, channel), /XML/i);
});
test("A hub challenge must match a pending subscription token and topic", async () => {
  await setup();
  const { createHash } = await import("node:crypto");
  await put("pushSubscription", channel, {
    channelId: channel,
    status: "pending",
    tokenHash: createHash("sha256").update("token").digest("hex"),
  });
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.topic": `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,
    "hub.challenge": "challenge",
    "hub.verify_token": "token",
    "hub.lease_seconds": "86400",
  });
  assert.equal(await verifyPushChallenge(channel, params), "challenge");
  assert.equal(
    (await doc<{ status: string }>("pushSubscription", channel))?.status,
    "active",
  );
  params.set("hub.verify_token", "attacker");
  await assert.rejects(verifyPushChallenge(channel, params), /verification/i);
});

test("opted-in duplicate push delivery queues one forward run with the channel immediate policy and no provider spend", async () => {
  const { list } = await import("../src/server/youtube-intelligence/store.ts");
  const { database } =
    await import("../src/server/youtube-intelligence/database.ts");
  await setup();
  try {
    await upsertChannel({
      id: channel,
      title: "Research",
      active: true,
      autoAnalyze: true,
      processing: "immediate",
      followedAt: "2026-01-01T00:00:00Z",
    });
    const sig =
      "sha256=" +
      createHmac("sha256", pushSecret(channel)).update(xml).digest("hex");
    await Promise.all([
      receivePush(channel, xml, sig),
      receivePush(channel, xml, sig),
    ]);
    const runs = await list();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].input.processingMode, "immediate");
    assert.equal(runs[0].input.record, "forward");
    const again = await receivePush(channel, xml, sig);
    assert.equal(again.queued, 0);
    assert.equal(
      Number(
        (await database.prepare("SELECT COUNT(*) AS n FROM yi_calls").get())?.n,
      ),
      0,
    );
  } finally {
    await database.close();
  }
});

test("renewal sends signed callback contract and schedules idempotently until the hub verifies it", async () => {
  const { pushRenew, schedulePushRenewals } =
    await import("../src/server/youtube-intelligence/push.ts");
  const { stubFetch } = await import("./helpers/fetch-stub.ts");
  const { database } =
    await import("../src/server/youtube-intelligence/database.ts");
  await setup();
  const previous = process.env.YTI_APP_ORIGIN;
  process.env.YTI_APP_ORIGIN = "https://yti-fixture.example";
  const stub = stubFetch([
    {
      url: "pubsubhubbub.appspot.com/subscribe",
      method: "POST",
      respond: () => new Response("", { status: 202 }),
    },
  ]);
  try {
    await put("pushSubscription", channel, {
      channelId: channel,
      status: "failed",
    });
    assert.equal(await schedulePushRenewals(), 1);
    assert.equal(await schedulePushRenewals(), 0);
    await pushRenew(channel);
    const form = new URLSearchParams(stub.log[0].body!);
    assert.equal(form.get("hub.mode"), "subscribe");
    assert.equal(form.get("hub.secret"), pushSecret(channel));
    assert.equal(
      form.get("hub.callback"),
      `https://yti-fixture.example/api/youtube-intelligence/push?channel=${channel}`,
    );
    form.set("hub.challenge", "hub-response");
    form.set("hub.lease_seconds", "864000");
    assert.equal(await verifyPushChallenge(channel, form), "hub-response");
    assert.equal(await schedulePushRenewals(), 0);
  } finally {
    stub.restore();
    if (previous === undefined) delete process.env.YTI_APP_ORIGIN;
    else process.env.YTI_APP_ORIGIN = previous;
    await database.close();
  }
});

test("public push route rejects oversized streamed bodies without buffering the rest", async () => {
  const { POST } =
    await import("../src/app/api/youtube-intelligence/push/route.ts");
  let cancelled = false,
    chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (++chunks <= 4) controller.enqueue(new Uint8Array(100001));
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await POST(
    new Request("https://example.test/api/youtube-intelligence/push", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit),
  );
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});
