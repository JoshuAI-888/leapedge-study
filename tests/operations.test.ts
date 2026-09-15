import { test } from "node:test";
import assert from "node:assert/strict";
import { guard } from "../src/server/youtube-intelligence/http.ts";
import {
  sessionToken,
  validSession,
} from "../src/server/youtube-intelligence/access.ts";
import { normalizeNative } from "../src/server/youtube-intelligence/transcripts.ts";
import { emailText } from "../src/server/youtube-intelligence/email.ts";
test("Loopback browser origin succeeds even when Next internally normalizes hostname", () => {
  guard(
    new Request("http://localhost:3101/api/intelligence/research", {
      headers: { host: "127.0.0.1:3101", origin: "http://127.0.0.1:3101" },
    }),
  );
  assert.throws(() =>
    guard(
      new Request("http://localhost:3101/api/intelligence/research", {
        headers: { host: "127.0.0.1:3101", origin: "https://evil.test" },
      }),
    ),
  );
});
test("Hosted guard requires signed unexpired session and exact configured origin", () => {
  process.env.YTI_APP_ORIGIN = "https://research.example.test";
  process.env.YTI_ACCESS_TOKEN =
    "a-test-only-secret-with-more-than-32-characters";
  try {
    const token = sessionToken();
    assert.equal(validSession(token), true);
    assert.equal(validSession(token + "x"), false);
    assert.equal(validSession(sessionToken(Date.now() - 13 * 3600000)), false);
    const url = "https://research.example.test/api/intelligence/research";
    assert.throws(() => guard(new Request(url)));
    guard(
      new Request(url, {
        headers: {
          cookie: `yti_session=${token}`,
          origin: "https://research.example.test",
        },
      }),
    );
    assert.throws(() =>
      guard(
        new Request(url, {
          headers: {
            cookie: `yti_session=${token}`,
            origin: "https://evil.test",
          },
        }),
      ),
    );
  } finally {
    delete process.env.YTI_APP_ORIGIN;
    delete process.env.YTI_ACCESS_TOKEN;
  }
});
test("Native captions preserve original Chinese text and convert milliseconds without inventing timing", () => {
  const s = normalizeNative(
    {
      lang: "zh",
      content: [{ text: "保留原话。", offset: 1500, duration: 2200 }],
    },
    "3u24qyWjSVM",
  );
  assert.equal(s.segments[0].text, "保留原话。");
  assert.equal(s.segments[0].start_seconds, 1.5);
  assert.equal(s.segments[0].end_seconds, 3.7);
  assert.throws(() => normalizeNative({ content: [] }, "3u24qyWjSVM"));
  assert.throws(() =>
    normalizeNative(
      { content: [{ text: "bad", offset: -1, duration: 3 }] },
      "3u24qyWjSVM",
    ),
  );
});
test("Digest email links back to research and does not claim an empty day has analysis", () => {
  const text = emailText(
    {
      id: "test",
      date: "2026-09-13",
      createdAt: "2026-09-13",
      timezone: "Pacific/Auckland",
      kind: "test",
      runIds: [],
      groups: [],
      limitations: ["No sources available."],
    },
    "https://research.example.test",
  );
  assert.match(text, /Videos: 0/);
  assert.match(text, /No sources available/);
  assert.match(text, /research\?tab=settings/);
});
