/** YouTube WebSub: https://developers.google.com/youtube/v3/guides/push_notifications */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { doc, put, teamPreferences } from "./research-store.ts";
import { database } from "./database.ts";
import { getChannel, listChannels } from "./repos/channels.ts";
import { enqueueJob } from "./repos/jobs.ts";
import { analyzeDiscovery } from "./channels.ts";
const ChannelId = z.string().regex(/^UC[\w-]{22}$/);
const topic = (id: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${ChannelId.parse(id)}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const Subscription = z.object({
  channelId: ChannelId,
  status: z.enum(["pending", "active", "failed"]),
  tokenHash: z.string().optional(),
  requestedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function pushSecret(id: string) {
  ChannelId.parse(id);
  const secret = process.env.YTI_PUSH_CALLBACK_SECRET;
  if (!secret || secret.length < 32)
    throw Error(
      "YTI_PUSH_CALLBACK_SECRET must contain at least 32 characters.",
    );
  return createHmac("sha256", secret).update(id).digest("hex");
}
export async function pushRenew(channelId: string) {
  const channel = await getChannel(ChannelId.parse(channelId));
  if (!channel?.active) return;
  const origin = new URL(process.env.YTI_APP_ORIGIN ?? "http://invalid.local");
  if (origin.protocol !== "https:")
    throw Error("Push requires an HTTPS YTI_APP_ORIGIN callback.");
  const callback = new URL("/api/youtube-intelligence/push", origin);
  callback.searchParams.set("channel", channelId);
  const token = randomBytes(24).toString("hex");
  await put("pushSubscription", channelId, {
    channelId,
    status: "pending",
    tokenHash: sha(token),
    requestedAt: new Date().toISOString(),
  });
  const response = await fetch("https://pubsubhubbub.appspot.com/subscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "hub.callback": callback.href,
      "hub.mode": "subscribe",
      "hub.topic": topic(channelId),
      "hub.verify": "async",
      "hub.verify_token": token,
      "hub.secret": pushSecret(channelId),
      "hub.lease_seconds": "864000",
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    await put("pushSubscription", channelId, {
      channelId,
      status: "failed",
      requestedAt: new Date().toISOString(),
    });
    throw Error(`Push subscription HTTP ${response.status}`);
  }
  return { channelId, status: "pending" };
}
export async function verifyPushChallenge(
  channelId: string,
  params: URLSearchParams,
) {
  ChannelId.parse(channelId);
  const sub = Subscription.parse(await doc("pushSubscription", channelId));
  const challenge = z
    .string()
    .min(1)
    .max(2000)
    .parse(params.get("hub.challenge"));
  const seconds = Number(params.get("hub.lease_seconds"));
  if (
    sub.status !== "pending" ||
    params.get("hub.mode") !== "subscribe" ||
    params.get("hub.topic") !== topic(channelId) ||
    !equal(sha(params.get("hub.verify_token") ?? ""), sub.tokenHash ?? "") ||
    !Number.isInteger(seconds) ||
    seconds <= 0 ||
    seconds > 31 * 86400
  )
    throw Error("Push verification does not match a pending subscription.");
  await put("pushSubscription", channelId, {
    channelId,
    status: "active",
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  });
  return challenge;
}
function decode(text: string) {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (x) =>
      ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      })[x]!,
  );
}
const Entry = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  channelId: ChannelId,
  title: z.string().min(1).max(500),
  publishedAt: z.iso.datetime(),
});
export function parsePushFeed(xml: string, channelId: string) {
  if (Buffer.byteLength(xml) > 200000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Unsupported push XML.");
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)];
  return entries.map(([, body]) => {
    const value = (tag: string) =>
      decode(
        body
          .match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1]
          ?.trim() ?? "",
      );
    const entry = Entry.parse({
      videoId: value("yt:videoId"),
      channelId: value("yt:channelId"),
      title: value("title"),
      publishedAt: value("published"),
    });
    if (entry.channelId !== channelId) throw Error("Push channel mismatch.");
    return entry;
  });
}
export async function receivePush(
  channelId: string,
  body: string,
  signature: string,
) {
  ChannelId.parse(channelId);
  const match = /^(sha1|sha256)=([a-f0-9]+)$/i.exec(signature);
  if (
    !match ||
    !equal(
      createHmac(match[1].toLowerCase(), pushSecret(channelId))
        .update(body)
        .digest("hex"),
      match[2].toLowerCase(),
    )
  )
    throw Error("Invalid push signature.");
  const sub = Subscription.parse(await doc("pushSubscription", channelId));
  if (
    sub.status !== "active" ||
    !sub.expiresAt ||
    Date.parse(sub.expiresAt) <= Date.now()
  )
    throw Error("Push subscription is not active.");
  const channel = await getChannel(channelId);
  if (!channel?.active) return { discovered: 0, queued: 0 };
  const entries = parsePushFeed(body, channelId);
  let discovered = 0,
    queued = 0;
  for (const entry of entries) {
    const inserted = await database
      .prepare(
        "INSERT INTO yi_discoveries(video_id,channel_id,payload,discovered_at,run_id) VALUES($1,$2,$3,$4,NULL) ON CONFLICT DO NOTHING",
      )
      .run(
        entry.videoId,
        channelId,
        JSON.stringify(entry),
        new Date().toISOString(),
      );
    discovered += inserted.changes;
    // Retry the idempotent scheduling if a prior delivery died after insertion.
    if (
      channel.autoAnalyze &&
      channel.processing !== "on-request" &&
      Date.parse(entry.publishedAt) >=
        Date.parse(
          channel.followedAt ?? channel.createdAt ?? new Date().toISOString(),
        )
    ) {
      const before = await database
        .prepare("SELECT run_id FROM yi_discoveries WHERE video_id=$1")
        .get(entry.videoId);
      if (
        !before?.run_id &&
        (await analyzeDiscovery(entry.videoId)).newlyQueued
      )
        queued++;
    }
  }
  return { discovered, queued };
}
export async function schedulePushRenewals() {
  if (!process.env.YTI_PUSH_CALLBACK_SECRET || !process.env.YTI_APP_ORIGIN)
    return 0;
  const settings = await teamPreferences();
  if (settings.channels.discovery !== "push") return 0;
  let count = 0;
  for (const channel of (await listChannels()).filter((c) => c.active)) {
    const sub = await doc<z.infer<typeof Subscription>>(
      "pushSubscription",
      channel.id,
    );
    if (
      sub?.status === "active" &&
      Date.parse(sub.expiresAt ?? "") > Date.now() + 86400000
    )
      continue;
    if (
      sub?.status === "pending" &&
      Date.parse(sub.requestedAt ?? "") > Date.now() - 3600000
    )
      continue;
    if (
      await enqueueJob({
        id: `push-renew:${channel.id}:${Math.floor(Date.now() / 3600000)}`,
        kind: "push-renew",
        payload: { channelId: channel.id },
      })
    )
      count++;
  }
  return count;
}
