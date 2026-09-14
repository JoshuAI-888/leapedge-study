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
process.env.YTI_YOUTUBEJS_ENABLED = "false";
import {
  managedTranscript,
  nativeTranscript,
  normalizeTranscriptApi,
  SourcePending,
} from "../src/server/youtube-intelligence/transcripts.ts";
import { doc, put } from "../src/server/youtube-intelligence/research-store.ts";
const payload = (id: string) => ({
  video_id: id,
  language: "en",
  transcript: [{ text: "Do not buy.", start: 0, duration: 8 }],
});
test("Managed captions fail over, deduplicate, preserve uncertain charges, poll jobs, and enforce credit caps", async () => {
  const original = globalThis.fetch;
  process.env.SUPADATA_API_KEY = "fixture";
  process.env.TRANSCRIPTAPI_API_KEY = "fixture";
  process.env.YTI_TRANSCRIPT_CREDIT_BUDGET = "90";
  try {
    let primary = 0,
      secondary = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("supadata")) {
        primary++;
        return new Response("", { status: 503 });
      }
      secondary++;
      return Response.json(payload("testvideo01"));
    };
    assert.equal(
      (await nativeTranscript("testvideo01"))?.source_kind,
      "native_captions_transcriptapi",
    );
    await nativeTranscript("testvideo01");
    assert.equal(primary, 1);
    assert.equal(secondary, 1);
    let resolve!: () => void;
    const wait = new Promise<void>((r) => (resolve = r));
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await wait;
      return Response.json(payload("testvideo02"));
    };
    const pending = managedTranscript("testvideo02", "transcriptapi");
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      managedTranscript("testvideo02", "transcriptapi"),
      SourcePending,
    );
    resolve();
    await pending;
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      throw new Error("secret upstream details");
    };
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
    globalThis.fetch = async () => {
      throw Error("Should never resubmit");
    };
    assert.equal(await managedTranscript("testvideo03", "transcriptapi"), null);
    let submissions = 0,
      polls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(String(url)).pathname === "/v1/transcript") {
        submissions++;
        return Response.json({ jobId: "job-1" }, { status: 202 });
      }
      polls++;
      return Response.json({
        status: "completed",
        result: {
          lang: "zh",
          content: [{ text: "原文", offset: 0, duration: 10000 }],
        },
      });
    };
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
    assert.equal(submissions, 1);
    assert.equal(polls, 1);
    assert.equal(
      (
        await doc<any>(
          "managedCaptionAttempt",
          "supadata:generate:testvideo04:original",
        )
      )?.credits,
      20,
    );
    globalThis.fetch = async () => new Response("", { status: 429 });
    assert.equal(await managedTranscript("testvideo06", "supadata"), null);
    const retryId = "supadata:native:testvideo06:original";
    const failed = await doc<any>("managedCaptionAttempt", retryId);
    await put("managedCaptionAttempt", retryId, {
      ...failed,
      at: new Date(Date.now() - 3000).toISOString(),
    });
    globalThis.fetch = async () =>
      Response.json({
        lang: "en",
        content: [{ text: "Exact words", offset: 0, duration: 5000 }],
      });
    assert.ok(await managedTranscript("testvideo06", "supadata"));
    const recovered = await doc<any>("managedCaptionAttempt", retryId);
    assert.equal(recovered.number, 2);
    assert.equal(recovered.credits, 2);
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
    globalThis.fetch = original;
    delete process.env.SUPADATA_API_KEY;
    delete process.env.TRANSCRIPTAPI_API_KEY;
    delete process.env.YTI_TRANSCRIPT_CREDIT_BUDGET;
  }
});
