import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.YTI_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "managed-caption-")),
  "test.sqlite",
);
delete process.env.DATABASE_URL;
import {
  managedTranscript,
  nativeTranscript,
  normalizeTranscriptApi,
  SourcePending,
  captionLanguageMatches,
} from "../src/server/youtube-intelligence/transcripts.ts";
import { doc, put } from "../src/server/youtube-intelligence/research-store.ts";
import { stubFetch, json, type FetchStub } from "./helpers/fetch-stub.ts";
const payload = (id: string) => ({
  video_id: id,
  language: "en",
  transcript: [{ text: "Do not buy.", start: 0, duration: 8 }],
});
test("Managed captions fail over, deduplicate, preserve uncertain charges, poll jobs, and enforce credit caps", async () => {
  process.env.SUPADATA_API_KEY = "fixture";
  process.env.TRANSCRIPTAPI_API_KEY = "fixture";
  process.env.YTI_TRANSCRIPT_CREDIT_BUDGET = "90";
  let stub: FetchStub | undefined;
  // Each phase installs its own routes; the previous phase is unwound first.
  const phase = (routes: Parameters<typeof stubFetch>[0]) => {
    stub?.restore();
    stub = stubFetch(routes);
    return stub;
  };
  try {
    const failover = phase([
      { url: "transcriptapi", respond: () => new Response("", { status: 503 }) },
      {
        url: "supadata",
        respond: () =>
          json({
            lang: "en",
            content: [{ text: "Do not buy.", offset: 0, duration: 8000 }],
          }),
      },
    ]);
    assert.equal(
      (await nativeTranscript("testvideo01"))?.source_kind,
      "native_captions_supadata",
    );
    await nativeTranscript("testvideo01");
    assert.equal(failover.calls("transcriptapi").length, 1);
    assert.equal(failover.calls("supadata").length, 1);
    let resolve!: () => void;
    const wait = new Promise<void>((r) => (resolve = r));
    const inflight = phase([
      {
        url: "transcriptapi",
        respond: async () => {
          await wait;
          return json(payload("testvideo02"));
        },
      },
    ]);
    const pending = managedTranscript("testvideo02", "transcriptapi");
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      managedTranscript("testvideo02", "transcriptapi"),
      SourcePending,
    );
    resolve();
    await pending;
    assert.equal(inflight.log.length, 1);
    phase([
      {
        url: "transcriptapi",
        respond: () => {
          throw new Error("secret upstream details");
        },
      },
    ]);
    assert.equal(await managedTranscript("testvideo03", "transcriptapi"), null);
    assert.equal(
      (
        await doc<any>(
          "managedCaptionAttempt",
          "transcriptapi:native:testvideo03:original",
        )
      )?.status,
      "uncertain",
    );
    // No routes: any call is refused by the stub, so a resubmission would fail loudly.
    const silent = phase([]);
    assert.equal(await managedTranscript("testvideo03", "transcriptapi"), null);
    assert.equal(silent.log.length, 0, "Should never resubmit");
    const jobs = phase([
      {
        url: /\/v1\/transcript\/[\w-]+$/,
        respond: () =>
          json({
            status: "completed",
            result: {
              lang: "zh",
              content: [{ text: "原文", offset: 0, duration: 10000 }],
            },
          }),
      },
      { url: "/v1/transcript", respond: () => json({ jobId: "job-1" }, 202) },
    ]);
    await assert.rejects(
      managedTranscript("testvideo04", "supadata", {
        generate: true,
        duration: 600,
      }),
      SourcePending,
    );
    assert.equal(
      (
        await managedTranscript("testvideo04", "supadata", {
          generate: true,
          duration: 600,
        })
      )?.source_kind,
      "generated_transcript_supadata",
    );
    assert.equal(jobs.log.filter((c) => c.route === 1).length, 1, "one submission");
    assert.equal(jobs.log.filter((c) => c.route === 0).length, 1, "one poll");
    assert.equal(
      (
        await doc<any>(
          "managedCaptionAttempt",
          "supadata:generate:testvideo04:original",
        )
      )?.credits,
      20,
    );
    phase([{ url: "supadata", respond: () => new Response("", { status: 429 }) }]);
    assert.equal(await managedTranscript("testvideo06", "supadata"), null);
    const retryId = "supadata:native:testvideo06:original";
    const failed = await doc<any>("managedCaptionAttempt", retryId);
    await put("managedCaptionAttempt", retryId, {
      ...failed,
      at: new Date(Date.now() - 3000).toISOString(),
    });
    phase([
      {
        url: "supadata",
        respond: () =>
          json({
            lang: "en",
            content: [{ text: "Exact words", offset: 0, duration: 5000 }],
          }),
      },
    ]);
    assert.ok(await managedTranscript("testvideo06", "supadata"));
    const recovered = await doc<any>("managedCaptionAttempt", retryId);
    assert.equal(recovered.number, 2);
    assert.equal(recovered.credits, 2);
    phase([
      {
        url: "supadata",
        respond: () =>
          json({
            lang: "yue",
            content: [{ text: "唔好買", offset: 0, duration: 5000 }],
          }),
      },
    ]);
    assert.equal(
      await managedTranscript("testvideo07", "supadata", { language: "zh-CN" }),
      null,
    );
    assert.equal(
      (
        await doc<any>(
          "managedCaptionAttempt",
          "supadata:native:testvideo07:zh",
        )
      )?.status,
      "language_mismatch",
    );
    assert.equal(
      await doc("managedCaption", "supadata:native:testvideo07:zh"),
      null,
    );
    await put("managedCaption", "supadata:native:testvideo08:zh", {
      source: {
        source_kind: "native_captions_supadata",
        language: "yue",
        segments: [
          { id: "s1", text: "唔好買", start_seconds: 0, end_seconds: 5 },
        ],
      },
    });
    assert.equal(
      await managedTranscript("testvideo08", "supadata", { language: "zh" }),
      null,
    );
    process.env.YTI_TRANSCRIPT_CREDIT_BUDGET = "0";
    await assert.rejects(
      managedTranscript("testvideo05", "transcriptapi"),
      /budget/,
    );
    assert.throws(
      () => normalizeTranscriptApi(payload("different01"), "testvideo01"),
      /mismatch/,
    );
    assert.throws(() =>
      normalizeTranscriptApi(
        {
          ...payload("testvideo01"),
          transcript: [{ text: "x", start: 0, duration: -1 }],
        },
        "testvideo01",
      ),
    );
  } finally {
    stub?.restore();
    delete process.env.SUPADATA_API_KEY;
    delete process.env.TRANSCRIPTAPI_API_KEY;
    delete process.env.YTI_TRANSCRIPT_CREDIT_BUDGET;
  }
});
test("Caption language validation accepts regional variants, rejects different or unreported languages", () => {
  assert.equal(captionLanguageMatches("zh-CN", "zh"), true);
  assert.equal(captionLanguageMatches("zh", "yue"), false);
  assert.equal(captionLanguageMatches("en", undefined), false);
  assert.equal(captionLanguageMatches(undefined, "yue"), true);
});
