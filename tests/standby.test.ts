import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YTI_YOUTUBEJS_ENABLED = "false";
process.env.SUPADATA_API_KEY = "fixture";
process.env.TRANSCRIPTAPI_API_KEY = "fixture";
process.env.YTI_TRANSCRIPT_CREDIT_BUDGET = "5000";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import {
  managedTranscript,
  standbyTranscript,
  supadataBatch,
  providerAlerts,
  SourcePending,
} from "../src/server/youtube-intelligence/transcripts.ts";
import {
  trip,
  isOpen,
  state,
  vendorErrorForStatus,
  vendorErrorForFailure,
} from "../src/server/youtube-intelligence/circuit-breaker.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import type { TeamPreferencesData } from "../src/features/youtube-intelligence/settings.ts";

const T = Date.parse("2026-09-17T09:00:00.000Z");
const minute = 60_000;
function settings(
  sources: Partial<TeamPreferencesData["sources"]> = {},
): TeamPreferencesData {
  const team = teamDefaults();
  return { ...team, sources: { ...team.sources, ...sources } };
}
const supadataCaptions = () =>
  json({
    lang: "en",
    content: [{ text: "Do not buy.", offset: 0, duration: 8000 }],
  });

test("A 503 from TranscriptAPI trips the breaker for fifteen minutes and routes captions to Supadata", async () => {
  await freshDatabase();
  const stub = stubFetch([
    { url: "transcriptapi", respond: () => new Response("", { status: 503 }) },
    { url: "supadata", respond: supadataCaptions },
  ]);
  try {
    const first = await standbyTranscript("stdbyvideo1", {
      settings: settings(),
      now: T,
    });
    assert.equal(first?.source_kind, "native_captions_supadata");
    assert.equal(stub.calls("transcriptapi").length, 1);
    assert.equal(stub.calls("supadata").length, 1);
    const open = await state("transcriptapi");
    assert.equal(open?.vendor, "transcriptapi");
    assert.equal(open?.kind, "5xx");
    assert.equal(open?.cooldownMinutes, 15);
    assert.equal(open?.openedAt, new Date(T).toISOString());
    assert.equal(open?.openUntil, new Date(T + 15 * minute).toISOString());
    assert.equal(await isOpen("transcriptapi", T + 14 * minute), true);
    assert.equal(await isOpen("transcriptapi", T + 15 * minute + 1), false);
    // While the breaker is open the draft provider is not called at all.
    const during = await standbyTranscript("stdbyvideo2", {
      settings: settings(),
      now: T + minute,
    });
    assert.equal(during?.source_kind, "native_captions_supadata");
    assert.equal(stub.calls("transcriptapi").length, 1, "breaker is open");
    assert.equal(stub.calls("supadata").length, 2);
    // After the cooldown the draft provider is tried again.
    await standbyTranscript("stdbyvideo3", {
      settings: settings(),
      now: T + 16 * minute,
    });
    assert.equal(stub.calls("transcriptapi").length, 2, "breaker closed");
    const reopened = await state("transcriptapi");
    assert.equal(reopened?.trips, 2);
    assert.equal(
      reopened?.openUntil,
      new Date(T + 31 * minute).toISOString(),
      "the second trip restarts the cooldown from the injected clock",
    );
  } finally {
    stub.restore();
  }
});

test("A 206 or 404 from TranscriptAPI never trips the breaker and never falls back", async () => {
  await freshDatabase();
  const stub = stubFetch([
    {
      url: "transcriptapi",
      responses: [
        () => new Response("", { status: 206 }),
        () => new Response("", { status: 404 }),
      ],
    },
    // Present so an unwanted standby call is a wrong answer, not an unmatched fetch.
    { url: "supadata", respond: supadataCaptions },
  ]);
  try {
    assert.equal(
      await standbyTranscript("stdbynocap1", { settings: settings(), now: T }),
      null,
      "no captions is correlated across providers, so there is nothing to fall back to",
    );
    assert.equal(
      await standbyTranscript("stdbynocap2", { settings: settings(), now: T }),
      null,
    );
    assert.equal(await state("transcriptapi"), null);
    assert.equal(await isOpen("transcriptapi", T), false);
    assert.equal(stub.calls("supadata").length, 0);
    assert.equal(stub.calls("transcriptapi").length, 2);
  } finally {
    stub.restore();
  }
});

test("Supadata requests always carry an explicit mode and never mode=auto", async () => {
  await freshDatabase();
  const stub = stubFetch([
    { url: "transcriptapi", respond: () => new Response("", { status: 503 }) },
    { url: "supadata", respond: supadataCaptions },
  ]);
  try {
    await managedTranscript("stdbymode01", "supadata");
    await managedTranscript("stdbymode02", "supadata", {
      generate: true,
      duration: 600,
    });
    await standbyTranscript("stdbymode03", { settings: settings(), now: T });
    const modes = stub
      .calls("supadata")
      .map((c) => new URL(c.url).searchParams.get("mode"));
    assert.deepEqual(modes, ["native", "generate", "native"]);
    assert.equal(
      stub.log.filter((c) => /auto/.test(c.url) || /auto/.test(c.body || ""))
        .length,
      0,
      "mode=auto would spend credits without consent",
    );
  } finally {
    stub.restore();
  }
});

test("The 202 polling path is unchanged when the standby route submits the job", async () => {
  await freshDatabase();
  const stub = stubFetch([
    { url: "transcriptapi", respond: () => new Response("", { status: 503 }) },
    {
      url: /\/v1\/transcript\/[\w-]+$/,
      respond: () =>
        json({
          status: "completed",
          result: {
            lang: "en",
            content: [{ text: "Do not buy.", offset: 0, duration: 8000 }],
          },
        }),
    },
    {
      url: "/v1/transcript",
      respond: () => json({ jobId: "job-standby" }, 202),
    },
  ]);
  try {
    await assert.rejects(
      standbyTranscript("stdbypoll01", { settings: settings(), now: T }),
      SourcePending,
    );
    const polled = await standbyTranscript("stdbypoll01", {
      settings: settings(),
      now: T + minute,
    });
    assert.equal(polled?.source_kind, "native_captions_supadata");
    assert.equal(polled?.segments[0].end_seconds, 8);
    assert.equal(stub.calls(/\/v1\/transcript\/job-standby$/).length, 1);
    assert.equal(
      stub.calls("transcriptapi").length,
      1,
      "the open breaker keeps the poll on the standby provider",
    );
  } finally {
    stub.restore();
  }
});

test("A credit-exhausted answer from Supadata stores a provider alert with the plan allowance", async () => {
  await freshDatabase();
  const stub = stubFetch([
    { url: "transcriptapi", respond: () => new Response("", { status: 503 }) },
    {
      url: "supadata",
      respond: () =>
        json(
          { error: "limit-exceeded", details: "credit balance is zero" },
          429,
        ),
    },
  ]);
  try {
    assert.equal(
      await standbyTranscript("stdbycred01", {
        settings: settings({ standbyPlan: "pro" }),
        now: T,
      }),
      null,
      "out of credits means no captions, not an exception",
    );
    const alerts = await providerAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].vendor, "supadata");
    assert.equal(alerts[0].kind, "credits_exhausted");
    assert.equal(alerts[0].plan, "pro");
    assert.equal(alerts[0].monthlyAllowance, 3000);
    assert.ok(Date.parse(alerts[0].at) > 0);
    assert.equal((await state("transcriptapi"))?.kind, "5xx");
    assert.equal(
      (await state("supadata"))?.kind,
      "429",
      "the standby vendor's own 429 opens its breaker too",
    );
    // With both breakers open the next video asks neither vendor.
    assert.equal(
      await standbyTranscript("stdbycred02", {
        settings: settings({ standbyPlan: "pro" }),
        now: T + minute,
      }),
      null,
    );
    assert.equal(stub.log.length, 2);
    assert.equal((await providerAlerts()).length, 1, "latest alert per vendor");
  } finally {
    stub.restore();
  }
});

test("The breaker is a persisted per-vendor document with an injectable clock", async () => {
  await freshDatabase();
  assert.equal(await state("transcriptapi"), null);
  assert.equal(await isOpen("transcriptapi", T), false);
  const tripped = await trip(
    "transcriptapi",
    "5xx",
    "Provider HTTP 503",
    15,
    T,
  );
  assert.equal(tripped.openUntil, new Date(T + 15 * minute).toISOString());
  assert.equal(tripped.trips, 1);
  assert.equal(await isOpen("transcriptapi", T), true);
  assert.equal(await isOpen("transcriptapi", T + 15 * minute - 1), true);
  assert.equal(await isOpen("transcriptapi", T + 15 * minute), false);
  assert.equal(await isOpen("supadata", T), false, "breakers are per vendor");
  const zero = await trip("supadata", "429", "Provider HTTP 429", 0, T);
  assert.equal(zero.openUntil, new Date(T).toISOString());
  assert.equal(
    await isOpen("supadata", T),
    false,
    "a zero cooldown disables the breaker",
  );
  assert.equal(vendorErrorForStatus(503), "5xx");
  assert.equal(vendorErrorForStatus(500), "5xx");
  assert.equal(vendorErrorForStatus(429), "429");
  assert.equal(vendorErrorForStatus(206), null);
  assert.equal(vendorErrorForStatus(404), null);
  assert.equal(vendorErrorForStatus(200), null);
  assert.equal(vendorErrorForStatus(403), null);
  assert.equal(
    vendorErrorForFailure(new DOMException("aborted", "TimeoutError")),
    "timeout",
  );
  assert.equal(vendorErrorForFailure(new TypeError("fetch failed")), "network");
  assert.equal(vendorErrorForFailure(new RangeError("bad payload")), null);
});

test("supadataBatch posts the batch endpoint, polls the job and returns per-video results", async () => {
  await freshDatabase();
  const stub = stubFetch([
    {
      method: "POST",
      url: "/v1/youtube/transcript/batch",
      respond: () => json({ jobId: "batch-1" }),
    },
    {
      url: "/v1/youtube/batch/batch-1",
      responses: [
        () => json({ status: "active" }),
        () =>
          json({
            status: "completed",
            results: [
              {
                videoId: "stdbybatch1",
                transcript: {
                  lang: "en",
                  content: [{ text: "Do not buy.", offset: 0, duration: 8000 }],
                },
              },
              { videoId: "stdbybatch2", errorCode: "transcript-unavailable" },
            ],
            stats: { total: 2, succeeded: 1, failed: 1 },
          }),
      ],
    },
  ]);
  try {
    const batch = await supadataBatch(["stdbybatch1", "stdbybatch2"], {
      pollIntervalMs: 0,
    });
    assert.equal(batch.jobId, "batch-1");
    assert.deepEqual(batch.stats, { total: 2, succeeded: 1, failed: 1 });
    assert.equal(batch.results.length, 2);
    assert.equal(batch.results[0].videoId, "stdbybatch1");
    assert.equal(
      batch.results[0].source?.source_kind,
      "native_captions_supadata",
    );
    assert.equal(batch.results[0].error, undefined);
    assert.equal(batch.results[1].source, null);
    assert.equal(batch.results[1].error, "transcript-unavailable");
    const submitted = JSON.parse(
      stub.calls("transcript/batch")[0].body || "{}",
    );
    assert.equal(submitted.mode, "native");
    assert.deepEqual(submitted.videoIds, ["stdbybatch1", "stdbybatch2"]);
    assert.equal(stub.calls("/v1/youtube/batch/batch-1").length, 2);
    assert.equal(
      stub.log.filter((c) => /auto/.test(c.body || "")).length,
      0,
      "the batch never asks for mode=auto either",
    );
  } finally {
    stub.restore();
  }
});
