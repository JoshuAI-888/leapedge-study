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

test("successful output with incomplete usage remains replayable but keeps an unresolved billing hold", async () => {
    for (const usageMetadata of [undefined, {}, { promptTokenCount: 100 }, { promptTokenCount: -1, candidatesTokenCount: 10 }, { promptTokenCount: 0, candidatesTokenCount: 0 }, { promptTokenCount: 100, candidatesTokenCount: 0 }]) {
        const db = await freshDatabase();
        let key = "";
        const restore = injectBatchClient({
            create: async (p) => { key = (p.src as Array<{
                metadata: {
                    key: string;
                };
            }>)[0].metadata.key; return { name: "batches/usage" }; },
            get: async () => ({ state: "JOB_STATE_SUCCEEDED", dest: { inlinedResponses: [{ metadata: { key }, response: {
                                candidates: [{ content: { parts: [{ text: '{"done":true}' }] }, finishReason: "STOP" }], usageMetadata,
                            } }] } }),
        });
        try {
            const run = await store.create("usage-fixture", "fixture", {}, "v1");
            await assert.rejects(() => submitBatchStage(run, request, 0.1, 1));
            const rec = (await batchRecord(run.id, request.stage))!;
            await pollBatch(rec.id);
            const response = await submitBatchStage(run, request, 0.1, 1);
            assert.equal(response.text, '{"done":true}');
            assert.equal(response.usage.costUsd, null);
            const [attempt] = await store.listAttempts(run.id, request.stage);
            assert.equal(attempt.status, "unknown");
            assert.equal(attempt.amount, 0.05);
            assert.equal((await store.unknownCalls("2100-01-01")).length, 0);
        }
        finally {
            restore();
            await db.close();
        }
    }
});
test("unsupported batch models and invalid media windows fail before any paid submission", async () => {
    const db = await freshDatabase();
    let submits = 0;
    const restore = injectBatchClient({ create: async () => { submits++; return { name: "batches/invalid" }; }, get: async () => ({}) });
    try {
        for (const input of [
            { ...request, model: "anthropic/claude-sonnet-5" },
            { ...request, model: "gemini-unpriced-future" },
            { ...request, video: { type: "video" as const, url: "https://www.youtube.com/watch?v=9hE5-98ZeCg", startSeconds: 30, endSeconds: 10 } },
            { ...request, cachedContent: "cachedContents/without-inline-source" },
        ]) {
            const run = await store.create(`invalid-${submits}-${JSON.stringify(input).length}`, "fixture", {}, "v1");
            await assert.rejects(() => submitBatchStage(run, input, 0.1, 1), /model|window|cache/i);
            assert.equal((await store.listAttempts(run.id, request.stage)).length, 0);
        }
        assert.equal(submits, 0);
    }
    finally {
        restore();
        await db.close();
    }
});
test("pipeline replay never converts unresolved batch billing into a settled or generic reservation", async () => {
    const { modelCall } = await import("../src/server/youtube-intelligence/pipeline.ts");
    const { GoogleNativeTransport } = await import("../src/server/youtube-intelligence/transport/google-native.ts");
    const { injectTransport } = await import("../src/server/youtube-intelligence/transport/index.ts");
    const { teamDefaults } = await import("../src/features/youtube-intelligence/settings.ts");
    const db = await freshDatabase();
    let key = "";
    const restore = injectBatchClient({ create: async (p) => { key = (p.src as Array<{
            metadata: {
                key: string;
            };
        }>)[0].metadata.key; return { name: "batches/replay-usage" }; }, get: async () => ({ state: "JOB_STATE_SUCCEEDED", dest: { inlinedResponses: [{ metadata: { key }, response: { candidates: [{ content: { parts: [{ text: '{"done":true}' }] }, finishReason: "STOP" }] } }] } }) });
    const restoreTransport = injectTransport(new GoogleNativeTransport({ client: { generateContent: async () => { throw Error("synchronous route must not run"); }, countTokens: async () => ({ totalTokens: 10 }) } }));
    try {
        const run = await store.create("usage-replay", request.model, { processingMode: "batch" }, "v1");
        const call = () => modelCall(run, request.stage, request.model, "fixture", {}, false, { settings: teamDefaults() });
        await assert.rejects(call);
        await pollBatch((await batchRecord(run.id, request.stage))!.id);
        assert.deepEqual(await call(), { done: true });
        assert.equal((await store.listAttempts(run.id, request.stage))[0].status, "unknown");
    }
    finally {
        restoreTransport();
        restore();
        await db.close();
    }
});
test("duplicate response keys retain the hold and never publish an arbitrary match", async () => {
    const db = await freshDatabase();
    let key = "";
    const restore = injectBatchClient({ create: async (p) => { key = (p.src as Array<{
            metadata: {
                key: string;
            };
        }>)[0].metadata.key; return { name: "batches/duplicates" }; }, get: async () => ({ state: "JOB_STATE_SUCCEEDED", dest: { inlinedResponses: [{ metadata: { key }, response: {} }, { metadata: { key }, response: {} }] } }) });
    try {
        const run = await store.create("duplicate-keys", "fixture", {}, "v1");
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1));
        await assert.rejects(() => pollBatchRecord(run.id), /duplicate/);
        assert.equal((await store.listAttempts(run.id, request.stage))[0].status, "unknown");
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1), /uncertain/);
    }
    finally {
        restore();
        await db.close();
    }
});
async function pollBatchRecord(runId: string) { await pollBatch((await batchRecord(runId, request.stage))!.id); }
test("polling failures leave the same pending job and reservation available for retry", async () => {
    const db = await freshDatabase();
    let creates = 0, polls = 0;
    const restore = injectBatchClient({ create: async () => { creates++; return { name: "batches/transient" }; }, get: async () => { polls++; throw Error("temporary network failure"); } });
    try {
        const run = await store.create("temporary-poll", "fixture", {}, "v1");
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1));
        for (let i = 0; i < 2; i++)
            await assert.rejects(() => pollBatchRecord(run.id), /temporarily unavailable/);
        assert.equal((await batchRecord(run.id, request.stage))!.status, "pending");
        assert.equal((await store.listAttempts(run.id, request.stage))[0].status, "reserved");
        assert.equal(creates, 1);
        assert.equal(polls, 2);
    }
    finally {
        restore();
        await db.close();
    }
});
test("expired provider jobs retain unknown spend and cannot trigger a duplicate submission", async () => {
    const db = await freshDatabase();
    let creates = 0;
    const restore = injectBatchClient({ create: async () => { creates++; return { name: "batches/expired" }; }, get: async () => ({ state: "JOB_STATE_EXPIRED" }) });
    try {
        const run = await store.create("expired", "fixture", {}, "v1");
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1));
        await assert.rejects(() => pollBatchRecord(run.id), /uncertain/);
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1), /uncertain/);
        assert.equal(creates, 1);
        assert.equal((await store.listAttempts(run.id, request.stage))[0].status, "unknown");
    }
    finally {
        restore();
        await db.close();
    }
});
test("per-video and cumulative budget exhaustion refuse batch IO", async () => {
    const db = await freshDatabase();
    const previous = process.env.YTI_BUDGET_USD;
    let creates = 0;
    const restore = injectBatchClient({ create: async () => { creates++; return { name: "batches/budget" }; }, get: async () => ({}) });
    try {
        const run = await store.create("budget", "fixture", {}, "v1");
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 0.01), /per-video/);
        process.env.YTI_BUDGET_USD = "0.01";
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1), /Lifetime budget/);
        assert.equal(creates, 0);
        assert.equal((await store.listAttempts(run.id, request.stage)).length, 0);
    }
    finally {
        if (previous === undefined)
            delete process.env.YTI_BUDGET_USD;
        else
            process.env.YTI_BUDGET_USD = previous;
        restore();
        await db.close();
    }
});
test("one stage per provider job preserves partial success across independent requests", async () => {
    const db = await freshDatabase();
    const keys: string[] = [];
    let submittedRows = 0;
    const restore = injectBatchClient({ create: async (p) => { const src = p.src as Array<{
            metadata: {
                key: string;
            };
        }>; submittedRows += src.length; keys.push(src[0].metadata.key); return { name: `batches/item-${keys.length}` }; }, get: async ({ name }) => ({ state: "JOB_STATE_SUCCEEDED", dest: { inlinedResponses: name.endsWith("1") ? [{ metadata: { key: keys[0] }, response: { modelVersion: "gemini-3.1-flash-lite-version-fixture", candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 } } }] : [{ metadata: { key: keys[1] }, error: { code: 3, message: "Unsupported or inaccessible video" } }] } }) });
    try {
        const run = await store.create("mixed", "fixture", { sourceHash: "frozen-source" }, "prompt-fixture-v1");
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1));
        await assert.rejects(() => submitBatchStage(run, { ...request, stage: "translation" }, 0.1, 1));
        assert.equal(keys.length, 2);
        assert.equal(submittedRows, 2);
        await pollBatchRecord(run.id);
        await pollBatch((await batchRecord(run.id, "translation"))!.id);
        const good = await submitBatchStage(run, request, 0.1, 1);
        assert.equal(good.text, '{"ok":true}');
        assert.equal(good.usage.outputTokens, 15);
        assert.equal((good.raw as {
            modelVersion: string;
        }).modelVersion, "gemini-3.1-flash-lite-version-fixture");
        assert.equal((await store.get(run.id))!.promptVersion, "prompt-fixture-v1");
        assert.equal((await store.get(run.id))!.input.sourceHash, "frozen-source");
        await assert.rejects(() => submitBatchStage(run, { ...request, stage: "translation" }, 0.1, 1), /failed/);
    }
    finally {
        restore();
        await db.close();
    }
});
test("rejected submissions retain sanitized provider diagnostics instead of only the HTTP status", async () => {
    const db = await freshDatabase();
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'secret-fixture-do-not-record';
    const restore = injectBatchClient({ create: async () => { throw Object.assign(Error('INVALID_ARGUMENT: video URLs are unavailable; key=secret-fixture-do-not-record'), { status: 400 }); }, get: async () => ({}) });
    try {
        const run = await store.create('rejection-detail', 'fixture', {}, 'v1');
        await assert.rejects(() => submitBatchStage(run, request, 0.1, 1), /INVALID_ARGUMENT/);
        const rec = (await batchRecord(run.id, request.stage))!;
        assert.match(rec.error!, /video URLs are unavailable/);
        assert.ok(!JSON.stringify(rec).includes('secret-fixture-do-not-record'));
        assert.equal((await store.listAttempts(run.id, request.stage))[0].status, 'released');
    }
    finally {
        restore();
        if (previous === undefined)
            delete process.env.GEMINI_API_KEY;
        else
            process.env.GEMINI_API_KEY = previous;
        await db.close();
    }
});
test('malformed generated response becomes uncertain and cannot strand a silently pending charge', async () => {
    const db = await freshDatabase();
    let key = '';
    const restore = injectBatchClient({ create: async (p) => { key = (p.src as Array<{
            metadata: {
                key: string;
            };
        }>)[0].metadata.key; return { name: 'batches/malformed' }; }, get: async () => ({ state: 'JOB_STATE_SUCCEEDED', dest: { inlinedResponses: [{ metadata: { key }, response: { candidates: 'invalid' } }] } }) });
    try {
        const run = await store.create('malformed-response', 'fixture', {}, 'v1');
        await assert.rejects(() => submitBatchStage(run, request, .1, 1));
        await assert.rejects(() => pollBatchRecord(run.id), /malformed|candidates/i);
        assert.equal((await batchRecord(run.id, request.stage))!.status, 'uncertain');
        assert.equal((await store.listAttempts(run.id, request.stage))[0].status, 'unknown');
    }
    finally {
        restore();
        await db.close();
    }
});
