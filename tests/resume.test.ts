import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import {
  modelCall,
  modelCallFingerprint,
} from "../src/server/youtube-intelligence/pipeline.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
test("restart replays retained unsettled and settled responses without provider calls or duplicate cost", async () => {
  const db = await freshDatabase();
  const fake = new FakeModelTransport();
  const restore = injectTransport(fake);
  try {
    const run = await store.create("resume-video", "fixture", {}, "v1");
    const id = await store.reserve(run.id, "extraction", 0.1);
    const settings = teamDefaults();
    const fingerprint = modelCallFingerprint({
      stage: "extraction",
      model: "fixture",
      prompt: "prompt",
      payload: {},
      video: null,
      responseSchema: null,
      maxOutputTokens: null,
      inferenceConfig: null,
      source: null,
      models: settings.models,
      transport: settings.transport,
    });
    const response = {
      requestFingerprint: fingerprint,
      text: JSON.stringify({ calls: ["retained"] }),
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.02 },
      provider: "google-native",
      finishReason: "STOP",
      raw: { fixture: true },
    };
    await store.retainResponse(
      `${id}:normalized`,
      run.id,
      "extraction",
      response,
    );
    assert.deepEqual(
      await modelCall(run, "extraction", "fixture", "prompt", {}, false, {
        settings: teamDefaults(),
      }),
      { calls: ["retained"] },
    );
    assert.deepEqual(
      await modelCall(run, "extraction", "fixture", "prompt", {}, false, {
        settings: teamDefaults(),
      }),
      { calls: ["retained"] },
    );
    assert.equal(fake.requests.length, 0);
    const rows = await store.listAttempts(run.id, "extraction");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 0.02);
    assert.equal(rows[0].status, "completed");
    assert.ok(rows[0].metrics.reservedAt);
    assert.ok(rows[0].metrics.settledAt);
    const unsafe = await store.reserve(run.id, "synthesis", 0.1);
    await store.settle(unsafe, 0.02, {});
    await assert.rejects(
      () => modelCall(run, "synthesis", "fixture", "prompt", {}),
      /no replayable response/,
    );
  } finally {
    restore();
    await db.close();
  }
});

test("recovery replays identical requests but a changed claim payload receives its own paid response", async () => {
  const db = await freshDatabase();
  const fake = new FakeModelTransport({
    responses: {
      critique: [
        { json: { result: "first" }, usage: { costUsd: 0.001 } },
        { json: { result: "second" }, usage: { costUsd: 0.001 } },
      ],
    },
  });
  const restore = injectTransport(fake);
  try {
    const run = await store.create("request-fingerprint", "fixture", {}, "v1");
    const options = { settings: teamDefaults() };
    const first = await modelCall(
      run,
      "critique",
      "fixture",
      "prompt",
      { claim: "c1" },
      false,
      options,
    );
    assert.deepEqual(
      await modelCall(
        run,
        "critique",
        "fixture",
        "prompt",
        { claim: "c1" },
        false,
        options,
      ),
      first,
    );
    await modelCall(
      run,
      "critique",
      "fixture",
      "prompt",
      { claim: "c2" },
      false,
      options,
    );
    assert.equal(fake.requests.length, 2);
    const attempts = await store.listAttempts(run.id, "critique");
    assert.equal(attempts.length, 2);
    assert.notEqual(
      attempts[0].metrics.requestFingerprint,
      attempts[1].metrics.requestFingerprint,
    );
  } finally {
    restore();
    await db.close();
  }
});

test("Output recovery does not send reasoning controls to a model that does not support them", async () => {
  const db = await freshDatabase();
  const fake = new FakeModelTransport({
    describe: { supportedEfforts: [] },
    responses: { synthesis: { json: { claims: [] } } },
  });
  const restore = injectTransport(fake);
  try {
    const run = await store.create("no-reasoning", "fixture", {}, "v1");
    await modelCall(run, "synthesis", "fixture", "prompt", {}, false, {
      settings: teamDefaults(),
      reasoningEffort: "low",
    });
    assert.equal(fake.requests[0].reasoningEffort, undefined);
  } finally {
    restore();
    await db.close();
  }
});
