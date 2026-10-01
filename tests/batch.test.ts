import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import {
  submitBatchStage,
  pollBatch,
  injectBatchClient,
  batchRecord,
} from "../src/server/youtube-intelligence/batch.ts";
import { ModelRequest } from "../src/server/youtube-intelligence/transport/types.ts";
const request = ModelRequest.parse({
  stage: "extraction",
  model: "gemini-3.1-flash-lite",
  user: [{ type: "text", text: "fixture" }],
  maxOutputTokens: 100,
  temperature: 0,
  responseSchema: { type: "object" },
});
test("batch submit is durable/idempotent, maps by key, and settles only the matching discounted response", async () => {
  const db = await freshDatabase();
  let submits = 0;
  let key = "";
  const restore = injectBatchClient({
    create: async (p) => {
      submits++;
      key = (p.src as Array<{ metadata: { key: string } }>)[0].metadata.key;
      return { name: "batches/test", state: "JOB_STATE_PENDING" };
    },
    get: async () => ({
      name: "batches/test",
      state: "JOB_STATE_SUCCEEDED",
      dest: {
        inlinedResponses: [
          {
            metadata: { key: "unrelated" },
            response: {
              candidates: [
                {
                  content: { parts: [{ text: '{"wrong":true}' }] },
                  finishReason: "STOP",
                },
              ],
            },
          },
          {
            metadata: { key },
            response: {
              candidates: [
                {
                  content: { parts: [{ text: '{"correct":true}' }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 100,
                candidatesTokenCount: 10,
              },
            },
          },
        ],
      },
    }),
  });
  try {
    const run = await store.create("batch-video", "fixture", {}, "v1");
    await assert.rejects(() => submitBatchStage(run, request, 0.1, 1), /Batch/);
    await assert.rejects(() => submitBatchStage(run, request, 0.1, 1), /Batch/);
    assert.equal(submits, 1);
    assert.equal(
      (await store.listAttempts(run.id, "extraction"))[0].status,
      "reserved",
    );
    const rec = (await batchRecord(run.id, "extraction"))!;
    await pollBatch(rec.id);
    await pollBatch(rec.id);
    const response = await submitBatchStage(run, request, 0.1, 1);
    assert.equal(response.text, '{"correct":true}');
    assert.equal((await store.listAttempts(run.id, "extraction")).length, 1);
    assert.equal(
      (await store.listAttempts(run.id, "extraction"))[0].amount,
      response.usage.costUsd,
    );
  } finally {
    restore();
    await db.close();
  }
});
test("uncertain submission is never resubmitted or silently released", async () => {
  const db = await freshDatabase();
  let submits = 0;
  const restore = injectBatchClient({
    create: async () => {
      submits++;
      throw Error("connection lost");
    },
    get: async () => {
      throw Error("must not poll without resource name");
    },
  });
  try {
    const run = await store.create("batch-unknown", "fixture", {}, "v1");
    await assert.rejects(
      () => submitBatchStage(run, request, 0.1, 1),
      /uncertain/,
    );
    await assert.rejects(
      () => submitBatchStage(run, request, 0.1, 1),
      /uncertain/,
    );
    assert.equal(submits, 1);
    assert.equal(
      (await store.listAttempts(run.id, "extraction"))[0].status,
      "unknown",
    );
  } finally {
    restore();
    await db.close();
  }
});

test("terminal rejection releases the hold; cancellation and mismatched output retain uncertain spend", async () => {
  for (const state of [
    "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED",
    "JOB_STATE_SUCCEEDED",
  ] as const) {
    const db = await freshDatabase();
    const restore = injectBatchClient({
      create: async () => ({ name: "batches/terminal" }),
      get: async () => ({
        name: "batches/terminal",
        state,
        dest: {
          inlinedResponses: [{ metadata: { key: "wrong" }, response: {} }],
        },
      }),
    });
    try {
      const run = await store.create(`batch-${state}`, "fixture", {}, "v1");
      await assert.rejects(() => submitBatchStage(run, request, 0.1, 1));
      const rec = (await batchRecord(run.id, "extraction"))!;
      if (state === "JOB_STATE_FAILED") await pollBatch(rec.id);
      else await assert.rejects(() => pollBatch(rec.id), /uncertain/);
      const attempt = (await store.listAttempts(run.id, "extraction"))[0];
      assert.equal(
        attempt.status,
        state === "JOB_STATE_FAILED" ? "released" : "unknown",
      );
      assert.equal(attempt.amount, state === "JOB_STATE_FAILED" ? 0 : 0.05);
      assert.equal(
        (await store.unknownCalls("2100-01-01")).length,
        0,
        "batch uncertainty is never released by generic synchronous-call reconciliation",
      );
    } finally {
      restore();
      await db.close();
    }
  }
});

test("worker batch model stage pauses then resumes the same run through durable poll completion", async () => {
  const { modelCall } =
    await import("../src/server/youtube-intelligence/pipeline.ts");
  const { processNext } =
    await import("../src/server/youtube-intelligence/runner.ts");
  const { GoogleNativeTransport } =
    await import("../src/server/youtube-intelligence/transport/google-native.ts");
  const { injectTransport } =
    await import("../src/server/youtube-intelligence/transport/index.ts");
  const { teamDefaults } =
    await import("../src/features/youtube-intelligence/settings.ts");
  const db = await freshDatabase();
  let key = "";
  let submits = 0;
  let polls = 0;
  const restore = injectBatchClient({
    create: async (p) => {
      submits++;
      key = (p.src as Array<{ metadata: { key: string } }>)[0].metadata.key;
      return { name: "batches/worker" };
    },
    get: async () =>
      ++polls === 1
        ? { name: "batches/worker", state: "JOB_STATE_RUNNING" }
        : {
            name: "batches/worker",
            state: "JOB_STATE_SUCCEEDED",
            dest: {
              inlinedResponses: [
                {
                  metadata: { key },
                  response: {
                    candidates: [
                      {
                        content: { parts: [{ text: '{"done":true}' }] },
                        finishReason: "STOP",
                      },
                    ],
                    usageMetadata: {
                      promptTokenCount: 10,
                      candidatesTokenCount: 5,
                    },
                  },
                },
              ],
            },
          },
  });
  const restoreTransport = injectTransport(
    new GoogleNativeTransport({
      client: {
        generateContent: async () => {
          throw Error("Immediate provider must not run");
        },
        countTokens: async () => ({ totalTokens: 10 }),
      },
    }),
  );
  try {
    const run = await store.create(
      "batch-worker",
      request.model,
      { processingMode: "batch" },
      "v1",
    );
    const execute: Parameters<typeof processNext>[0] = async (current) => {
      current.output.result = await modelCall(
        current,
        "extraction",
        request.model,
        "fixture",
        {},
        false,
        { settings: teamDefaults() },
      );
      current.status = "completed";
      current.stage = "done";
    };
    const first = await processNext(execute);
    assert.equal(
      first?.status,
      "queued",
      (await store.get(run.id))?.error ?? "",
    );
    await db
      .prepare("UPDATE jobs SET run_after='2000-01-01' WHERE kind='batch-poll'")
      .run();
    assert.equal(
      (await processNext(execute))?.status,
      "queued",
      "pending provider keeps the same poll job queued",
    );
    await db
      .prepare("UPDATE jobs SET run_after='2000-01-01' WHERE kind='batch-poll'")
      .run();
    assert.equal((await processNext(execute))?.status, "completed");
    await db
      .prepare("UPDATE jobs SET run_after='2000-01-01' WHERE kind='analyze'")
      .run();
    assert.equal((await processNext(execute))?.status, "completed");
    assert.deepEqual((await store.get(run.id))?.output.result, { done: true });
    assert.equal(submits, 1);
  } finally {
    restoreTransport();
    restore();
    await db.close();
  }
});

test("new runs inherit team routes and origin processing policy while explicit lab overrides survive", async () => {
  const { queue, teamPreferences } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const db = await freshDatabase();
  try {
    const team = await teamPreferences();
    const manual = await queue("manual-video");
    assert.equal(manual.model, team.models.extraction.id);
    assert.equal(manual.input.criticModel, team.models.critique.id);
    assert.equal(manual.input.processingMode, team.processing.userSubmitted);
    const historical = await queue(
      "historical-video",
      undefined,
      undefined,
      false,
      { origin: "channel", record: "historical" },
    );
    assert.equal(
      historical.input.processingMode,
      team.processing.channelUploads,
    );
    assert.equal(historical.input.record, "historical");
    const lab = await queue(
      "lab-video",
      undefined,
      { model: "google/gemini-3.8-flash" },
      true,
    );
    assert.equal(lab.model, "google/gemini-3.8-flash");
    assert.equal(lab.input.experiment, true);
  } finally {
    await db.close();
  }
});
