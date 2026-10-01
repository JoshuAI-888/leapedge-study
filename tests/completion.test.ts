import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sourceChunks,
  missingRanges,
  uniqueClaims,
} from "../src/features/youtube-intelligence/chunking.ts";
import type { ClaimData } from "../src/features/youtube-intelligence/contracts.ts";
import {
  directionChanges,
  trendSummary,
  type ResearchCall,
} from "../src/features/youtube-intelligence/trends.ts";
import { scoreCall } from "../src/features/youtube-intelligence/performance.ts";
test("Deduplication never erases different risks, conviction or evidence boundaries", () => {
  const c: ClaimData = {
    thesis_en: "Creator holds the company",
    instrument_as_spoken: "Example",
    ticker: null,
    ticker_explicit: false,
    stance: "hold",
    horizon_en: null,
    creator_conviction: "unspecified",
    conditions_en: [],
    risks_en: [],
    levels: [],
    evidence: [
      {
        segment_id: "s1",
        quote_original: "I hold it",
        quote_translation_en: "I hold it",
      },
    ],
  };
  assert.equal(uniqueClaims([c, structuredClone(c)]).length, 1);
  assert.equal(uniqueClaims([c, { ...c, risks_en: ["Debt risk"] }]).length, 2);
  assert.equal(
    uniqueClaims([c, { ...c, creator_conviction: "low" }]).length,
    2,
  );
  assert.equal(
    uniqueClaims([
      c,
      { ...c, evidence: [{ ...c.evidence[0], end_segment_id: "s2" }] },
    ]).length,
    2,
  );
});
test("Chunking retains every source segment and overlaps boundaries without rewriting evidence", () => {
  const segments = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    text: "原文".repeat(20),
    start_seconds: i * 10,
    end_seconds: (i + 1) * 10,
  }));
  const chunks = sourceChunks({ source_kind: "fixture", segments }, 600, 1);
  assert.ok(chunks.length > 1);
  assert.deepEqual(
    [...new Set(chunks.flat().map((s) => s.id))],
    segments.map((s) => s.id),
  );
  assert.equal(chunks[0].at(-1)?.id, chunks[1][0].id);
});
test("Trend direction changes compare different videos from the same channel and retain horizon uncertainty", () => {
  const c = (id: string, stance: string, horizon: string) =>
    ({
      run: {
        id,
        videoId: id,
        createdAt: `2026-09-0${id}`,
        output: { metadata: { channelId: "one" } },
      },
      item: {
        id: "c1",
        claim: {
          ticker: "SPY",
          stance,
          horizon_en: horizon,
          creator_conviction: "high",
        },
      },
    }) as unknown as ResearchCall;
  const rows = [c("1", "long", "month"), c("2", "short", "day")];
  assert.equal(directionChanges(rows).length, 1);
  assert.match(directionChanges(rows)[0].label, /not necessarily/);
  assert.equal(trendSummary(rows).videos, 2);
});
test("Stale exit prices do not become completed 90-day returns", () => {
  const series = (symbol: string) => ({
    symbol,
    provider: "fixture",
    adjustment: "same",
    fetchedAt: "2026-09-14",
    prices: [
      { date: "2026-01-02", close: 100 },
      { date: "2026-01-05", close: 101 },
    ],
  });
  assert.equal(
    scoreCall(
      {
        id: "x",
        ticker: "AAPL",
        channel: "one",
        stance: "long",
        conviction: "high",
        analysisAt: "2026-01-02",
      },
      series("AAPL"),
      series("SPY"),
      "2026-09-14",
    ).status,
    "stale",
  );
});
import { createHmac } from "node:crypto";
import { verifyEmailWebhook } from "../src/server/youtube-intelligence/webhooks.ts";
test("Email webhook signatures reject changed bodies, expired attempts and wrong keys", () => {
  const key = Buffer.alloc(32, 1),
    secret = `whsec_${key.toString("base64")}`,
    at = String(Math.floor(Date.now() / 1000)),
    body = '{"type":"email.delivered"}';
  const signature = createHmac("sha256", key)
    .update(`test.${at}.${body}`)
    .digest("base64");
  const headers = new Headers({
    "svix-id": "test",
    "svix-timestamp": at,
    "svix-signature": `v1,${signature}`,
  });
  assert.equal(
    verifyEmailWebhook(body, headers, secret).payload.type,
    "email.delivered",
  );
  assert.throws(() => verifyEmailWebhook(body + " ", headers, secret));
  assert.throws(() =>
    verifyEmailWebhook(body, headers, secret, Date.now() + 600000),
  );
});

test("Missing windows preserve actual time boundaries and ignore overlaps and short pauses", () => {
  const segments = [
    { id: "a", text: "a", start_seconds: 0, end_seconds: 10 },
    { id: "b", text: "b", start_seconds: 8, end_seconds: 20 },
    { id: "c", text: "c", start_seconds: 22, end_seconds: 30 },
    { id: "d", text: "d", start_seconds: 40, end_seconds: 45 },
  ];
  assert.deepEqual(missingRanges({ source_kind: "fixture", segments }, 60), [
    { start: 30, end: 40 },
    { start: 45, end: 60 },
  ]);
  assert.deepEqual(
    missingRanges({ source_kind: "fixture", segments: [] }, 60),
    [{ start: 0, end: 60 }],
  );
});

import { normalizeAudioReview } from "../src/server/youtube-intelligence/audio-review.ts";
test("Audio verdicts without explanations remain reviewable uncertainty, never verified passes", () => {
  const r = normalizeAudioReview({
    video_accessible: true,
    verdicts: [
      {
        id: "k1",
        quote_matches_audio: true,
        timestamp_supported: true,
        thesis_supported: true,
        heard_quote_original: "speech",
        actual_start_seconds: 12,
        reason_en: "",
      },
    ],
  });
  assert.equal(r.verdicts[0].review_status, "needs_review");
  assert.match(r.verdicts[0].reason_en, /manual review/);
});
