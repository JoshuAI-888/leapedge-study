import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeYouTubeJs,
  youtubeJsTranscript,
} from "../src/server/youtube-intelligence/youtubejs.ts";
import { doc } from "../src/server/youtube-intelligence/research-store.ts";
process.env.YTI_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "yti-youtubejs-")),
  "db.sqlite",
);
const id = "3u24qyWjSVM";
const payload = {
  videoId: id,
  language: "zh",
  selectedLanguage: "Chinese",
  availableLanguages: ["Chinese"],
  trackKind: "automatic" as const,
  segments: [{ text: "QQQ 跌到 450，再觀察。", startMs: 1200, endMs: 3600 }],
};
test("YouTube.js keeps Chinese evidence and supplied times; malformed timing and mismatched videos fail", () => {
  const s = normalizeYouTubeJs(payload, id);
  assert.equal(s.segments[0].text, payload.segments[0].text);
  assert.equal(s.segments[0].start_seconds, 1.2);
  assert.equal(s.segments[0].end_seconds, 3.6);
  assert.throws(() =>
    normalizeYouTubeJs({ ...payload, videoId: "kXYvRR7gV2E" }, id),
  );
  assert.throws(() =>
    normalizeYouTubeJs(
      { ...payload, segments: [{ text: "x", startMs: 10, endMs: 5 }] },
      id,
    ),
  );
  assert.throws(() =>
    normalizeYouTubeJs(
      { ...payload, segments: [{ text: "x", startMs: NaN, endMs: 5 }] },
      id,
    ),
  );
});
test("Successful free captions are cached and original provenance is retained", async () => {
  let count = 0;
  const fetcher = async () => {
    count++;
    return { payload, source: normalizeYouTubeJs(payload, id) };
  };
  await youtubeJsTranscript(id, fetcher);
  await youtubeJsTranscript(id, fetcher);
  assert.equal(count, 1);
  assert.equal(
    ((await doc("youtubeJsTranscript", id))?.payload as typeof payload)
      .trackKind,
    "automatic",
  );
});
test("Free retrieval failures are explicit, sanitized and cooled down without throwing away fallback", async () => {
  let count = 0;
  const fetcher = async () => {
    count++;
    throw Error("https://example.com/?secret=do-not-store");
  };
  assert.equal(await youtubeJsTranscript("kXYvRR7gV2E", fetcher), null);
  assert.equal(await youtubeJsTranscript("kXYvRR7gV2E", fetcher), null);
  assert.equal(count, 1);
  const result = await doc("youtubeJsLastAttempt", "kXYvRR7gV2E");
  assert.equal(result?.status, "failed");
  assert.ok(!JSON.stringify(result).includes("do-not-store"));
});
