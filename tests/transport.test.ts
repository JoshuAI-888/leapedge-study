import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { requestHash, frozenPath } from "./helpers/frozen.ts";
import { freshDatabase } from "./helpers/db.ts";
import {
  ModelRequest,
  TransportError,
  type ModelRequestData,
} from "../src/server/youtube-intelligence/transport/types.ts";
import {
  OpenRouterTransport,
  fromOpenRouter,
} from "../src/server/youtube-intelligence/transport/openrouter.ts";
import {
  FakeModelTransport,
  requestHash as fakeRequestHash,
} from "../src/server/youtube-intelligence/transport/fake.ts";
import {
  transportFor,
  injectTransport,
} from "../src/server/youtube-intelligence/transport/index.ts";

const MODEL = "google/gemini-3.8-flash";
const catalogue = {
  data: [
    {
      id: MODEL,
      context_length: 100000,
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        audio: "0.000003",
        overrides: [{ prompt: "0.000004" }],
      },
      reasoning: { supported_efforts: ["low", "high"] },
    },
  ],
};
const completion = {
  id: "gen-1",
  model: MODEL,
  provider: "Google AI Studio",
  usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0123 },
  choices: [
    {
      finish_reason: "stop",
      message: { role: "assistant", content: '{"segments":[]}' },
    },
  ],
};
const videoRequest = ModelRequest.parse({
  stage: "critique-0",
  model: MODEL,
  user: [{ type: "text", text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' }],
  video: { type: "video", url: "https://www.youtube.com/watch?v=abcdefghijk" },
  maxOutputTokens: 3000,
  temperature: 0,
  reasoningEffort: "low",
});
const textRequest = ModelRequest.parse({
  stage: "synthesis",
  model: MODEL,
  user: [{ type: "text", text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' }],
  maxOutputTokens: 16000,
  temperature: 0,
});
/** The exact chat/completions body modelCall sent before the transport existed. */
const expectedVideoBody = {
  model: MODEL,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' },
        {
          type: "video_url",
          video_url: { url: "https://www.youtube.com/watch?v=abcdefghijk" },
        },
      ],
    },
  ],
  max_tokens: 3000,
  temperature: 0,
  reasoning: { effort: "low" },
  response_format: { type: "json_object" },
  provider: {
    allow_fallbacks: false,
    require_parameters: true,
    only: ["Google AI Studio"],
  },
};
const expectedTextBody = {
  model: MODEL,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' },
      ],
    },
  ],
  max_tokens: 16000,
  temperature: 0,
  response_format: { type: "json_object" },
  provider: { allow_fallbacks: false, require_parameters: true },
};
function withKey<T>(fn: () => Promise<T>) {
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-key";
  return fn().finally(() => {
    if (old === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = old;
  });
}
test("OpenRouter transport serialises the same request body as the inline modelCall did", async () => {
  await withKey(async () => {
    const stub = stubFetch([
      {
        method: "POST",
        url: "openrouter.ai/api/v1/chat/completions",
        respond: () => json(completion),
      },
    ]);
    try {
      const transport = new OpenRouterTransport();
      assert.equal(transport.name, "openrouter");
      assert.equal(transport.family, "openrouter");
      const video = await transport.call(videoRequest);
      const text = await transport.call(textRequest);
      const calls = stub.calls("chat/completions");
      assert.equal(calls.length, 2);
      assert.deepEqual(JSON.parse(calls[0].body!), expectedVideoBody);
      assert.deepEqual(JSON.parse(calls[1].body!), expectedTextBody);
      assert.equal(calls[0].headers.authorization, "Bearer fixture-key");
      assert.equal(calls[0].headers["content-type"], "application/json");
      assert.equal(video.text, '{"segments":[]}');
      assert.deepEqual(video.usage, {
        inputTokens: 120,
        outputTokens: 30,
        costUsd: 0.0123,
      });
      assert.equal(video.model, MODEL);
      assert.equal(video.provider, "Google AI Studio");
      assert.equal(video.finishReason, "stop");
      assert.deepEqual(video.raw, completion);
      assert.equal(text.text, '{"segments":[]}');
    } finally {
      stub.restore();
    }
  });
});
test("OpenRouter transport describes a model from the catalogue with the same rates as before", async () => {
  await withKey(async () => {
    const stub = stubFetch([
      { url: "openrouter.ai/api/v1/models", respond: () => json(catalogue) },
    ]);
    try {
      const transport = new OpenRouterTransport();
      const spec = await transport.describe(MODEL);
      assert.deepEqual(spec, {
        contextLength: 100000,
        inputRate: 0.000004,
        audioRate: 0.000003,
        outputRate: 0.000002,
        supportedEfforts: ["low", "high"],
      });
      await assert.rejects(
        () => transport.describe("vendor/absent"),
        /unavailable in the current catalogue/,
      );
      assert.equal(stub.calls("/models").length, 2);
    } finally {
      stub.restore();
    }
  });
});
test("OpenRouter transport refuses to run without a key and classifies HTTP failures", async () => {
  const old = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const transport = new OpenRouterTransport();
    await assert.rejects(
      () => transport.call(textRequest),
      /OPENROUTER_API_KEY is not configured/,
    );
    await assert.rejects(
      () => transport.describe(MODEL),
      /OPENROUTER_API_KEY is not configured/,
    );
  } finally {
    if (old !== undefined) process.env.OPENROUTER_API_KEY = old;
  }
  await withKey(async () => {
    const stub = stubFetch([
      {
        url: "chat/completions",
        responses: [
          () => json({ error: "slow down" }, 429),
          () => json({ error: "down" }, 503),
          () => json({ error: "nope" }, 400),
          () => {
            throw new DOMException("The operation timed out.", "TimeoutError");
          },
        ],
      },
    ]);
    try {
      const transport = new OpenRouterTransport();
      const expectKind = async (kind: string, status?: number) => {
        const error = await transport.call(textRequest).then(
          () => null,
          (e: unknown) => e,
        );
        assert.ok(error instanceof TransportError, `expected TransportError for ${kind}`);
        assert.equal(error.kind, kind);
        assert.equal(error.status, status);
        if (status)
          assert.equal(
            error.message,
            `Provider HTTP ${status}. No automatic paid retry.`,
          );
      };
      await expectKind("rate_limited", 429);
      await expectKind("server", 503);
      await expectKind("unknown", 400);
      await expectKind("timeout", undefined);
    } finally {
      stub.restore();
    }
  });
});
test("fromOpenRouter normalises usage and tolerates a partial completion", () => {
  const partial = fromOpenRouter({
    model: MODEL,
    usage: { prompt_tokens: 5, completion_tokens: 7, cost: -1 },
    choices: [{ finish_reason: "length", message: { content: "{" } }],
  });
  assert.equal(partial.finishReason, "length");
  assert.deepEqual(partial.usage, { inputTokens: 5, outputTokens: 7, costUsd: null });
  const empty = fromOpenRouter({ choices: [] });
  assert.equal(empty.text, "");
  assert.equal(empty.finishReason, undefined);
  assert.deepEqual(empty.usage, { inputTokens: 0, outputTokens: 0, costUsd: null });
});
test("FakeModelTransport replays in-memory responses by stage and records every request", async () => {
  const fake = new FakeModelTransport({
    responses: {
      synthesis: [{ json: { claims: [1] } }, { json: { claims: [2] } }],
      "critique-0": completion,
    },
  });
  assert.equal(fake.name, "fake");
  assert.equal(fake.family, "fake");
  const first = await fake.call(textRequest);
  const second = await fake.call(textRequest);
  const critique = await fake.call(videoRequest);
  assert.equal(first.text, '{"claims":[1]}');
  assert.equal(second.text, '{"claims":[2]}');
  assert.equal(first.finishReason, "stop");
  assert.equal(critique.text, '{"segments":[]}');
  assert.equal(critique.usage.costUsd, 0.0123);
  assert.deepEqual(critique.raw, completion);
  assert.equal(fake.requests.length, 3);
  assert.deepEqual(fake.requests[2], videoRequest);
  assert.deepEqual(fake.requestsFor("synthesis").length, 2);
  await assert.rejects(() => fake.call(textRequest), /queue exhausted/);
  fake.respond("synthesis", (request: ModelRequestData) => ({
    json: { echo: request.user[0].text.length },
  }));
  assert.equal((await fake.call(textRequest)).text, '{"echo":39}');
  await assert.rejects(
    () => fake.call({ ...textRequest, stage: "translation" }),
    /No frozen response at .*translation-[0-9a-f]{16}\.json.*tests\/fixtures\/model\/README\.md/,
  );
  const spec = await fake.describe(MODEL);
  assert.ok(spec.contextLength > 0 && spec.inputRate > 0 && spec.outputRate > 0);
});
test("FakeModelTransport fails on the Nth call with the requested failure kind", async () => {
  const fake = new FakeModelTransport({ responses: { synthesis: { json: {} } } })
    .failOn(2, "429")
    .failOn(3, "5xx")
    .failOn(4, "timeout")
    .failOn(5, "unknown");
  await fake.call(textRequest);
  const kinds: [string, number | undefined][] = [];
  for (let i = 0; i < 4; i++) {
    const error = await fake.call(textRequest).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof TransportError);
    kinds.push([error.kind, error.status]);
  }
  assert.deepEqual(kinds, [
    ["rate_limited", 429],
    ["server", 503],
    ["timeout", undefined],
    ["unknown", undefined],
  ]);
  assert.equal((await fake.call(textRequest)).text, "{}");
  assert.equal(fake.requests.length, 6);
});
test("FakeModelTransport replays frozen files named by the helper's request hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yti-frozen-"));
  const hash = requestHash(textRequest);
  assert.equal(fakeRequestHash(textRequest), hash);
  writeFileSync(
    frozenPath("synthesis", hash, dir),
    JSON.stringify({
      stage: "synthesis",
      hash,
      model: MODEL,
      capturedAt: "2026-09-10T08:00:00.000Z",
      request: textRequest,
      response: completion,
      note: "transport test",
    }),
  );
  const fake = new FakeModelTransport({ frozenDir: dir });
  const replayed = await fake.call(textRequest);
  assert.equal(replayed.text, '{"segments":[]}');
  assert.equal(replayed.model, MODEL);
  assert.deepEqual(replayed.raw, completion);
  await assert.rejects(
    () => fake.call(videoRequest),
    /No frozen response at .*critique-0-[0-9a-f]{16}\.json/,
  );
  writeFileSync(
    frozenPath("critique-0", requestHash(videoRequest), dir),
    JSON.stringify({ stage: "critique-0", hash: "0000000000000000", model: MODEL, capturedAt: "x", response: {} }),
  );
  await assert.rejects(() => fake.call(videoRequest), /malformed/);
});
test("transportFor returns OpenRouter by default and honours the injected seam", () => {
  const stock = transportFor("synthesis");
  assert.ok(stock instanceof OpenRouterTransport);
  assert.equal(transportFor("critique-0", { transport: { default: "openrouter" } }).family, "openrouter");
  assert.throws(
    () => transportFor("synthesis", { transport: { default: "google-native" } }),
    /google-native.*not available/,
  );
  assert.throws(() => transportFor("synthesis", { transport: { default: "carrier-pigeon" } }));
  const fake = new FakeModelTransport();
  const restore = injectTransport(fake);
  try {
    assert.equal(transportFor("synthesis"), fake);
    assert.equal(transportFor("critique-0", { transport: { default: "google-native" } }), fake);
  } finally {
    restore();
  }
  assert.ok(transportFor("synthesis") instanceof OpenRouterTransport);
  const seen: string[] = [];
  const restoreFactory = injectTransport((stage) => {
    seen.push(stage);
    return fake;
  });
  try {
    transportFor("audio-review");
    assert.deepEqual(seen, ["audio-review"]);
  } finally {
    restoreFactory();
  }
});
test("modelCall builds a ModelRequest, calls the transport and keeps the ledger, retention and metrics above it", async () => {
  const d = await freshDatabase();
  const oldBudget = process.env.YTI_BUDGET_USD;
  process.env.YTI_BUDGET_USD = "10";
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const { modelCall } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const fake = new FakeModelTransport({
    responses: {
      synthesis: {
        model: MODEL,
        provider: "fixture",
        usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.02 },
        choices: [{ finish_reason: "stop", message: { content: '{"claims":[]}' } }],
      },
      "audio-review": { json: { passed: true }, finishReason: "length" },
      "critique-0": { json: { passed: true } },
      "transcribe": { json: { error: "unreadable" } },
    },
  });
  const restore = injectTransport(fake);
  const stub = stubFetch([]);
  try {
    const run = await create(
      "transport-test",
      MODEL,
      { inferenceConfig: { reasoningEffort: "low", critiqueMaxTokens: 2500 } },
      "fixture",
    );
    const value = await modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 });
    assert.deepEqual(value, { claims: [] });
    assert.equal(fake.requests.length, 1);
    const request = fake.requests[0];
    assert.equal(request.stage, "synthesis");
    assert.equal(request.model, MODEL);
    assert.deepEqual(request.user, [
      { type: "text", text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' },
    ]);
    assert.equal(request.video, undefined);
    assert.equal(request.maxOutputTokens, 16000);
    assert.equal(request.temperature, 0);
    assert.equal(request.reasoningEffort, undefined);
    const call = (await d
      .prepare("SELECT status, amount, metrics FROM yi_calls WHERE run_id=? AND stage=?")
      .get(run.id, "synthesis")) as { status: string; amount: number; metrics: string };
    assert.equal(call.status, "completed");
    assert.equal(Number(call.amount), 0.02);
    const metrics = JSON.parse(call.metrics);
    assert.equal(metrics.model, MODEL);
    assert.equal(metrics.provider, "fixture");
    assert.equal(metrics.maxTokens, 16000);
    assert.equal(metrics.reasoningEffort, "provider default");
    assert.deepEqual(
      metrics.usage,
      { prompt_tokens: 10, completion_tokens: 4, cost: 0.02 },
      "metrics.usage keeps the provider's raw usage; scripts/report-results.ts sums prompt_tokens/completion_tokens from it",
    );
    assert.deepEqual(metrics.tokens, { inputTokens: 10, outputTokens: 4, costUsd: 0.02 });
    const retained = (await d
      .prepare("SELECT payload FROM yi_responses WHERE run_id=? AND stage=?")
      .get(run.id, "synthesis")) as { payload: string };
    assert.equal(JSON.parse(retained.payload).choices[0].message.content, '{"claims":[]}');
    assert.deepEqual(
      (run.output.metrics as { stage: string }[]).map((m) => m.stage),
      ["synthesis"],
    );
    await assert.rejects(
      () => modelCall(run, "audio-review", MODEL, "REVIEW", { samples: [] }, true),
      /incomplete/,
    );
    const review = fake.requests[1];
    assert.deepEqual(review.video, { type: "video", url: run.url });
    assert.equal(review.maxOutputTokens, 2500);
    assert.equal(review.reasoningEffort, "low");
    const settled = (await d
      .prepare("SELECT status FROM yi_calls WHERE run_id=? AND stage=?")
      .get(run.id, "audio-review")) as { status: string };
    assert.equal(settled.status, "reserved");
    assert.deepEqual(
      await modelCall(run, "critique-0", MODEL, "CRITIC", { claim: 1 }),
      { passed: true },
    );
    const critique = fake.requests[2];
    assert.equal(critique.video, undefined);
    assert.equal(critique.maxOutputTokens, 2500);
    assert.equal(critique.reasoningEffort, "low");
    const critiqueCall = (await d
      .prepare("SELECT metrics FROM yi_calls WHERE run_id=? AND stage=?")
      .get(run.id, "critique-0")) as { metrics: string };
    assert.deepEqual(
      JSON.parse(critiqueCall.metrics).usage,
      { prompt_tokens: 0, completion_tokens: 0, cost: null },
      "a shorthand fake reply still stores provider-shaped usage",
    );
    const stored = (await d
      .prepare("SELECT metrics FROM yi_calls WHERE run_id=?")
      .all(run.id)) as { metrics: string }[];
    const sums = stored
      .map((c) => JSON.parse(c.metrics))
      .reduce(
        (acc, m) => ({
          inputTokens: acc.inputTokens + Number(m.usage?.prompt_tokens || 0),
          outputTokens: acc.outputTokens + Number(m.usage?.completion_tokens || 0),
        }),
        { inputTokens: 0, outputTokens: 0 },
      );
    assert.deepEqual(sums, { inputTokens: 10, outputTokens: 4 }, "report-results.ts token sum over yi_calls.metrics");
    await assert.rejects(
      () => modelCall(run, "transcribe", MODEL, "T", {}, true),
      /could not be processed/,
    );
    assert.equal(stub.log.length, 0, "no HTTP call reaches fetch through the fake transport");
  } finally {
    stub.restore();
    restore();
    if (oldBudget === undefined) delete process.env.YTI_BUDGET_USD;
    else process.env.YTI_BUDGET_USD = oldBudget;
    await d.close();
  }
});
test("pipeline.ts no longer talks to openrouter.ai directly", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/server/youtube-intelligence/pipeline.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(!source.includes("openrouter.ai"));
  assert.ok(!source.includes("OPENROUTER_API_KEY"));
});
