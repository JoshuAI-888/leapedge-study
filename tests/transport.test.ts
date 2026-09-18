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
  withOpenRouterFallback,
  assertCriticIndependent,
  modelFamily,
  modelIdFor,
  stageKey,
} from "../src/server/youtube-intelligence/transport/index.ts";
import {
  GoogleNativeTransport,
  type GoogleNativeClient,
} from "../src/server/youtube-intelligence/transport/google-native.ts";
import {
  priceTable,
  priceTableVersion,
  defaultPrice,
  isPriced,
} from "../src/server/youtube-intelligence/transport/prices.ts";
import {
  TeamPreferences,
  teamDefaults,
  migrateLegacyPreferences,
} from "../src/features/youtube-intelligence/settings.ts";

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
/**
 * The chat/completions body after F11: no json_object response format and no
 * provider.only pin, even for a video request.
 */
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
  provider: { allow_fallbacks: false, require_parameters: true },
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
test("OpenRouter transport serialises a request without a json_object format or a provider pin", async () => {
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
test("transportFor routes each stage by its settings key and honours the injected seam", () => {
  // Spec 4.1: the Gemini stages go native, the critic and the context check
  // go through OpenRouter. The defaults in settings 6.2 already say so, so a
  // team that changed nothing gets that routing.
  const team = teamDefaults();
  const familyOf = (stage: string) => transportFor(stage, team).family;
  assert.equal(familyOf("synthesis"), "google-native");
  assert.equal(familyOf("synthesis-chunk-2"), "google-native");
  assert.equal(familyOf("extraction"), "google-native");
  assert.equal(familyOf("transcribe"), "google-native");
  assert.equal(familyOf("transcribe-window-0"), "google-native");
  assert.equal(familyOf("native-source"), "google-native");
  assert.equal(familyOf("translate"), "google-native");
  assert.equal(familyOf("audio-review"), "google-native");
  assert.equal(familyOf("critique-0"), "openrouter");
  assert.equal(familyOf("context"), "openrouter");
  // A stage with no settings key of its own follows transport.default.
  assert.equal(familyOf("source-repair"), "google-native");
  assert.ok(transportFor("critique-3", team) instanceof OpenRouterTransport);
  assert.ok(transportFor("synthesis", team) instanceof GoogleNativeTransport);
  // The stage's own key beats the default, in either direction.
  const mixed = teamDefaults();
  mixed.transport.default = "openrouter";
  mixed.models.extraction = { id: "gemini-3.8-flash", transport: "google-native" };
  mixed.models.transcription = { id: "gpt-4o-mini", transport: "openrouter" };
  assert.equal(transportFor("synthesis", mixed).family, "google-native");
  assert.equal(transportFor("transcribe", mixed).family, "openrouter");
  assert.equal(transportFor("source-repair", mixed).family, "openrouter");
  // Stage keys also name the model id a stage runs when the run pins none.
  assert.equal(modelIdFor("synthesis-chunk-1", team), team.models.extraction.id);
  assert.equal(modelIdFor("critique-7", team), team.models.critique.id);
  assert.equal(modelIdFor("transcribe-window-4", team), team.models.transcription.id);
  assert.equal(modelIdFor("audio-review", team), team.models.audioReview.id);
  assert.equal(modelIdFor("translate", team), team.models.translation.id);
  assert.equal(modelIdFor("context", team), team.models.context.id);
  assert.equal(
    modelIdFor("source-repair", team),
    team.models.extraction.id,
    "an unkeyed stage falls back to the general-purpose extraction model",
  );
  assert.equal(modelIdFor("synthesis", {}), undefined);
  assert.equal(stageKey("experiment-x"), undefined);
  // With no settings at all, the transport that needs no per-stage configuration.
  assert.ok(transportFor("synthesis") instanceof OpenRouterTransport);
  assert.equal(transportFor("critique-0", { transport: { default: "openrouter" } }).family, "openrouter");
  assert.throws(() => transportFor("synthesis", { transport: { default: "carrier-pigeon" } }));
  const fake = new FakeModelTransport();
  const restore = injectTransport(fake);
  try {
    assert.equal(transportFor("synthesis"), fake);
    assert.equal(transportFor("critique-0", team), fake);
  } finally {
    restore();
  }
  assert.ok(transportFor("synthesis") instanceof OpenRouterTransport);
  const seen: { stage: string; critique?: string }[] = [];
  const restoreFactory = injectTransport((stage, settings) => {
    seen.push({ stage, critique: settings.models?.critique?.id });
    return fake;
  });
  try {
    transportFor("audio-review", team);
    assert.deepEqual(seen, [
      { stage: "audio-review", critique: team.models.critique.id },
    ]);
  } finally {
    restoreFactory();
  }
});
test("The OpenRouter fallback wraps a native stage only when the team enabled it", () => {
  const team = teamDefaults();
  assert.equal(transportFor("synthesis", team).name, "google-native");
  const withFallback = teamDefaults();
  withFallback.transport.fallbackToOpenRouter = true;
  assert.equal(
    transportFor("synthesis", withFallback).name,
    "google-native+openrouter-fallback",
  );
  assert.equal(transportFor("synthesis", withFallback).family, "google-native");
  assert.equal(
    transportFor("critique-0", withFallback).name,
    "openrouter",
    "a stage already on OpenRouter has nothing to fall back to",
  );
});
test("withOpenRouterFallback re-issues one retryable failure and records fallbackUsed", async () => {
  const request = { ...textRequest, stage: "transcribe" };
  const secondaryReply = { json: { segments: ["from openrouter"] } };
  const attempt = (failure: "429" | "5xx" | "timeout" | "unknown" | null) => {
    const primary = new FakeModelTransport({
      responses: { transcribe: { json: { segments: ["from google"] } } },
    });
    if (failure) primary.failOn(1, failure);
    const secondary = new FakeModelTransport({
      responses: { transcribe: secondaryReply },
    });
    return { primary, secondary, transport: withOpenRouterFallback(primary, secondary) };
  };
  for (const kind of ["429", "5xx", "timeout"] as const) {
    const { primary, secondary, transport } = attempt(kind);
    const response = await transport.call(request);
    assert.deepEqual(JSON.parse(response.text), { segments: ["from openrouter"] });
    const raw = response.raw as Record<string, unknown>;
    assert.equal(raw.fallbackUsed, true, `${kind} should fall back`);
    assert.equal(raw.fallbackFrom, "fake");
    assert.ok(typeof raw.fallbackReason === "string");
    assert.equal(primary.requests.length, 1);
    assert.equal(secondary.requests.length, 1, "re-issued exactly once");
    assert.deepEqual(secondary.requests[0], request, "the same request, byte for byte");
  }
  // A non-retryable failure and a failure that is not a TransportError at all
  // both stop the call; paying a second vendor would not help.
  const unknown = attempt("unknown");
  await assert.rejects(() => unknown.transport.call(request), /unknown reason/);
  assert.equal(unknown.secondary.requests.length, 0);
  const plain = attempt(null);
  const restoreCall = plain.primary.call.bind(plain.primary);
  plain.primary.call = async () => {
    throw Error("the client blew up");
  };
  await assert.rejects(() => plain.transport.call(request), /the client blew up/);
  assert.equal(plain.secondary.requests.length, 0);
  plain.primary.call = restoreCall;
  // A healthy primary neither calls the secondary nor marks the response.
  const healthy = attempt(null);
  const response = await healthy.transport.call(request);
  assert.deepEqual(JSON.parse(response.text), { segments: ["from google"] });
  assert.equal((response.raw as Record<string, unknown>).fallbackUsed, undefined);
  assert.equal(healthy.secondary.requests.length, 0);
  // describe() stays with the primary: it is the model the call will run on.
  const described = await healthy.transport.describe(MODEL);
  assert.ok(described.contextLength > 0);
  // A request that reads the primary's context cache is never re-issued: the
  // other vendor has no transcript to read, so the original error surfaces.
  const cached = attempt("5xx");
  await assert.rejects(() =>
    cached.transport.call({ ...request, cachedContent: "caches/abc" }),
  );
  assert.equal(cached.secondary.requests.length, 0);
  // Optional capabilities are forwarded from the primary when it has them.
  const capable = attempt(null);
  const withCache = Object.assign(capable.primary, {
    createCache: async () => ({ name: "caches/from-primary", model: MODEL }),
    deleteCache: async () => undefined,
    countTokens: async () => ({ totalTokens: 7, estimated: false }),
  });
  const wrapped = withOpenRouterFallback(withCache, capable.secondary);
  assert.equal(typeof wrapped.createCache, "function");
  assert.equal(typeof wrapped.deleteCache, "function");
  assert.equal(typeof wrapped.countTokens, "function");
  assert.equal((await wrapped.createCache!(MODEL, [], 300)).name, "caches/from-primary");
  assert.equal((await wrapped.countTokens!(request)).totalTokens, 7);
  // A primary without the capabilities leaves them undefined on the wrapper.
  const minimal = attempt(null).primary;
  const bare = withOpenRouterFallback(
    {
      name: minimal.name,
      family: minimal.family,
      describe: (model: string) => minimal.describe(model),
      call: (r: typeof request) => minimal.call(r),
    },
    capable.secondary,
  );
  assert.equal(bare.createCache, undefined);
  assert.equal(bare.countTokens, undefined);
});
test("A critic from the extraction model's family is refused by the settings check", () => {
  assert.equal(modelFamily("gemini-3.8-flash"), "google");
  assert.equal(modelFamily("google/gemini-3.1-flash-lite"), "google");
  assert.equal(modelFamily("anthropic/claude-sonnet-5"), "anthropic");
  assert.equal(modelFamily("openai/gpt-5-mini"), "openai");
  assert.equal(modelFamily("openai/o3-mini"), "openai");
  assert.equal(modelFamily("mistralai/mistral-large"), "mistral");
  assert.equal(modelFamily("meta-llama/llama-4-maverick"), "meta");
  assert.equal(modelFamily("deepseek/deepseek-chat"), "other");
  // The defaults pair a Gemini extractor with an Anthropic critic.
  assert.doesNotThrow(() => assertCriticIndependent(teamDefaults()));
  assert.doesNotThrow(() => assertCriticIndependent({}));
  const sameFamily = teamDefaults();
  sameFamily.models.critique.id = "google/gemini-3.5-flash";
  assert.throws(
    () => assertCriticIndependent(sameFamily),
    /same family \(google\) as the extraction model/,
  );
  const allowed = teamDefaults();
  allowed.models.critique.id = "google/gemini-3.5-flash";
  allowed.models.critique.requireDifferentFamily = false;
  assert.doesNotThrow(() => assertCriticIndependent(allowed));
});
test("A migrated legacy team may audit itself: the family requirement is off when it cannot be met", async () => {
  // Every id the old document could name is a Google one, so a migration that
  // kept the v2 default on would make the first critique call of every
  // migrated install throw instead of auditing (spec 4.1: a Google-only
  // configuration remains valid).
  const legacy = migrateLegacyPreferences({
    model: "google/gemini-3.8-flash",
    criticModel: "google/gemini-3.5-flash",
  }).team;
  assert.equal(legacy.models.critique.requireDifferentFamily, false);
  assert.doesNotThrow(() => assertCriticIndependent(legacy));
  // The legacy defaults name no extraction model, so the default Gemini
  // extractor meets the migrated Gemini critic: same case, same answer.
  const criticOnly = migrateLegacyPreferences({
    criticModel: "google/gemini-3.5-flash",
  }).team;
  assert.equal(modelFamily(criticOnly.models.extraction.id), "google");
  assert.doesNotThrow(() => assertCriticIndependent(criticOnly));
  // A cross-family legacy pair can meet the requirement, so it keeps it.
  const crossFamily = migrateLegacyPreferences({
    model: "google/gemini-3.8-flash",
    criticModel: "anthropic/claude-sonnet-5",
  }).team;
  assert.equal(crossFamily.models.critique.requireDifferentFamily, true);
  assert.doesNotThrow(() => assertCriticIndependent(crossFamily));
  // The same holds through the store, which is where a real install migrates.
  await freshDatabase();
  const R = await import("../src/server/youtube-intelligence/research-store.ts");
  await R.savePreferences({
    timezone: "Pacific/Auckland",
    model: "google/gemini-3.8-flash",
    criticModel: "google/gemini-3.5-flash",
    transcriptionModel: "google/gemini-3.1-flash-lite",
    promptVersion: "evidence-first.web.v5",
    theme: "light",
    digestHour: 8,
    digestEnabled: false,
    autoPullEnabled: false,
  });
  const migrated = await R.teamPreferences();
  assert.equal(migrated.models.critique.id, "google/gemini-3.5-flash");
  assert.doesNotThrow(() => assertCriticIndependent(migrated));
});
test("The critique stage refuses a same-family critic before it bills a call", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const claim = {
    thesis_en: "The creator is buying this name.",
    stance: "long",
    horizon_en: "into next year",
    evidence: [{ segment_id: "s1", quote_original: "q", quote_translation_en: "q" }],
  };
  const run = {
    id: "critic-family",
    videoId: "wkAqHlYL7bQ",
    url: "https://www.youtube.com/watch?v=wkAqHlYL7bQ",
    model: MODEL,
    promptVersion: "v1",
    title: "Fixture",
    status: "running",
    stage: "critique",
    createdAt: "",
    updatedAt: "",
    error: null,
    input: {},
    output: {
      claims: [{ id: "c1", claim, passed: false, reasons: [] }],
      source: { source_kind: "imported_transcript", segments: [] },
    },
    cost: 0,
  } as unknown as Parameters<typeof step>[0];
  const sameFamily = teamDefaults();
  sameFamily.models.critique.id = "google/gemini-3.8-flash";
  const fake = new FakeModelTransport();
  const restore = injectTransport(fake);
  try {
    await assert.rejects(() => step(run, sameFamily), /same family \(google\)/);
    assert.equal(fake.requests.length, 0, "no critique call was made");
  } finally {
    restore();
  }
});
test("The OpenRouter body asks for strict json_schema only when the request carries one", async () => {
  const transport = new OpenRouterTransport();
  const schema = {
    type: "object",
    properties: { claims: { type: "array", items: { type: "string" } } },
    required: ["claims"],
    additionalProperties: false,
  };
  const withSchema = transport.body(
    ModelRequest.parse({ ...textRequest, stage: "synthesis-chunk-1", responseSchema: schema }),
  ) as Record<string, unknown>;
  assert.deepEqual(withSchema.response_format, {
    type: "json_schema",
    json_schema: { name: "synthesis-chunk-1", schema, strict: true },
  });
  const without = transport.body(textRequest) as Record<string, unknown>;
  assert.equal(
    without.response_format,
    undefined,
    "no responseSchema means no response_format: json_object enforced nothing and is gone",
  );
  // provider.only pinned OpenRouter to one upstream; the native transport
  // reaches it directly now, so the pin is gone from every request shape.
  for (const body of [withSchema, without, transport.body(videoRequest)]) {
    const text = JSON.stringify(body);
    assert.ok(!text.includes('"only"'), "no provider.only in the request body");
    assert.ok(!text.includes("json_object"));
    assert.deepEqual((body as { provider: unknown }).provider, {
      allow_fallbacks: false,
      require_parameters: true,
    });
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
      .prepare("SELECT status, amount, metrics FROM yi_calls WHERE run_id=$1 AND stage=$2")
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
      .prepare("SELECT payload FROM yi_responses WHERE run_id=$1 AND stage=$2")
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
      .prepare("SELECT status FROM yi_calls WHERE run_id=$1 AND stage=$2")
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
      .prepare("SELECT metrics FROM yi_calls WHERE run_id=$1 AND stage=$2")
      .get(run.id, "critique-0")) as { metrics: string };
    assert.deepEqual(
      JSON.parse(critiqueCall.metrics).usage,
      { prompt_tokens: 0, completion_tokens: 0, cost: null },
      "a shorthand fake reply still stores provider-shaped usage",
    );
    const stored = (await d
      .prepare("SELECT metrics FROM yi_calls WHERE run_id=$1")
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
test("modelCall takes the model id and the transport from the settings when the run pins none", async () => {
  const d = await freshDatabase();
  const oldBudget = process.env.YTI_BUDGET_USD;
  process.env.YTI_BUDGET_USD = "10";
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const { modelCall } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const fake = new FakeModelTransport({
    responses: {
      "critique-0": { json: { verdict: "accept" } },
      synthesis: { json: { claims: [] } },
      transcribe: { json: { segments: [] } },
    },
  });
  const routed: string[] = [];
  const restore = injectTransport((stage, settings) => {
    routed.push(`${stage}->${settings.models?.[stageKey(stage) ?? "extraction"]?.transport}`);
    return fake;
  });
  const settings = teamDefaults();
  try {
    const run = await create("settings-routing", MODEL, {}, "fixture");
    await modelCall(run, "critique-0", undefined, "CRITIC", { claim: 1 }, false, {
      settings,
    });
    assert.equal(
      fake.requestsFor("critique-0")[0].model,
      settings.models.critique.id,
      "an unpinned critique runs the configured critic, not the extraction model",
    );
    await modelCall(run, "transcribe", undefined, "T", {}, false, { settings });
    assert.equal(
      fake.requestsFor("transcribe")[0].model,
      settings.models.transcription.id,
    );
    await modelCall(run, "synthesis", MODEL, "P", { a: 1 }, false, { settings });
    assert.equal(
      fake.requestsFor("synthesis")[0].model,
      MODEL,
      "a model the run pins still wins over the settings",
    );
    assert.deepEqual(routed, [
      "critique-0->openrouter",
      "transcribe->google-native",
      "synthesis->google-native",
    ]);
  } finally {
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

/* --- F10: the native Gemini transport ------------------------------------ */

const NATIVE_MODEL = "gemini-3.8-flash";
const nativeSchema = {
  type: "object",
  properties: { claims: { type: "array", items: { type: "string" } } },
  required: ["claims"],
};
const nativeVideoRequest = ModelRequest.parse({
  stage: "transcribe-window-2",
  model: NATIVE_MODEL,
  system: [{ type: "text", text: "SYSTEM RULES" }],
  user: [{ type: "text", text: "TRANSCRIBE THE WINDOW" }],
  video: {
    type: "video",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    startSeconds: 300,
    endSeconds: 600,
  },
  responseSchema: nativeSchema,
  maxOutputTokens: 12000,
  temperature: 0,
  reasoningEffort: "low",
});
const nativeTextRequest = ModelRequest.parse({
  stage: "extraction",
  model: NATIVE_MODEL,
  user: [{ type: "text", text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' }],
  maxOutputTokens: 16000,
  temperature: 0,
});
/** A client with the two SDK methods the transport uses; no key, no socket. */
function stubClient(
  respond: (r: unknown) => unknown | Promise<unknown>,
  counted?: (r: unknown) => unknown,
) {
  const generate: unknown[] = [];
  const counts: unknown[] = [];
  const client = {
    generateContent: async (request: unknown) => {
      generate.push(request);
      return (await respond(request)) as never;
    },
    ...(counted
      ? {
          countTokens: async (request: unknown) => {
            counts.push(request);
            return counted(request) as never;
          },
        }
      : {}),
  } as GoogleNativeClient;
  return { client, generate, counts };
}
const nativeReply = {
  modelVersion: "gemini-3.8-flash-001",
  candidates: [
    {
      finishReason: "STOP",
      content: {
        parts: [
          { text: "thinking out loud", thought: true },
          { text: '{"claims":' },
          { text: "[]}" },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 1000,
    cachedContentTokenCount: 200,
    candidatesTokenCount: 300,
    thoughtsTokenCount: 100,
    promptTokensDetails: [
      { modality: "TEXT", tokenCount: 200 },
      { modality: "AUDIO", tokenCount: 600 },
    ],
  },
};
test("GoogleNativeTransport maps a ModelRequest onto generateContent with offsets, schema and LOW media resolution", () => {
  const transport = new GoogleNativeTransport({ client: stubClient(() => nativeReply).client });
  assert.equal(transport.name, "google-native");
  assert.equal(transport.family, "google-native");
  const video = transport.parameters(nativeVideoRequest);
  assert.deepEqual(video, {
    model: NATIVE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: "https://www.youtube.com/watch?v=abcdefghijk",
              mimeType: "video/*",
            },
            videoMetadata: { startOffset: "300s", endOffset: "600s" },
          },
          { text: "TRANSCRIBE THE WINDOW" },
        ],
      },
    ],
    config: {
      httpOptions: { retryOptions: { attempts: 1 } },
      systemInstruction: { role: "system", parts: [{ text: "SYSTEM RULES" }] },
      maxOutputTokens: 12000,
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: nativeSchema,
      mediaResolution: "MEDIA_RESOLUTION_LOW",
      thinkingConfig: { thinkingLevel: "LOW" },
    },
  });
  assert.deepEqual(
    video.config?.responseSchema,
    nativeSchema,
    "the JSON schema is passed through verbatim, not translated into an SDK shape",
  );
  const text = transport.parameters(nativeTextRequest);
  assert.equal(
    text.config?.mediaResolution,
    undefined,
    "no media part, so no media resolution is sent",
  );
  assert.deepEqual(text, {
    model: NATIVE_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' }],
      },
    ],
    config: {
      httpOptions: { retryOptions: { attempts: 1 } },
      maxOutputTokens: 16000,
      temperature: 0,
      responseMimeType: "application/json",
    },
  });
  const asDefault = new GoogleNativeTransport({
    mediaResolution: "default",
    client: stubClient(() => nativeReply).client,
  }).parameters(nativeVideoRequest);
  assert.equal(asDefault.config?.mediaResolution, undefined);
  const openEnded = new GoogleNativeTransport({ client: stubClient(() => nativeReply).client })
    .parameters({
      ...nativeVideoRequest,
      video: { type: "video", url: "https://www.youtube.com/watch?v=abcdefghijk" },
    });
  const parts = (openEnded.contents as { parts: Record<string, unknown>[] }[])[0].parts;
  assert.equal(parts[0].videoMetadata, undefined, "no offsets, no videoMetadata");
});
test("GoogleNativeTransport reports usage and a price-table cost from usageMetadata", async () => {
  const stub = stubClient(() => nativeReply);
  const fetchStub = stubFetch([]);
  try {
    const transport = new GoogleNativeTransport({ client: stub.client });
    const response = await transport.call(nativeVideoRequest);
    assert.equal(response.text, '{"claims":[]}', "thought parts are not the answer");
    assert.equal(response.finishReason, "STOP");
    assert.equal(response.model, "gemini-3.8-flash-001");
    assert.equal(response.provider, "google-native");
    assert.equal(response.raw, nativeReply);
    // 200 text @0.75 + 200 cached @0.075 + 600 audio @0.75 + (300+100) output @3.75,
    // all per million: 150 + 15 + 450 + 1500 = 2115 millionths of a dollar.
    assert.deepEqual(response.usage, {
      inputTokens: 1000,
      outputTokens: 300,
      costUsd: 0.002115,
    });
    assert.equal(stub.generate.length, 1);
    const sent = stub.generate[0] as { config: { abortSignal?: AbortSignal } };
    assert.ok(sent.config.abortSignal instanceof AbortSignal, "the deadline can abort the call");
    const bare = await new GoogleNativeTransport({
      client: stubClient(() => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }))
        .client,
    }).call(nativeTextRequest);
    assert.deepEqual(bare.usage, { inputTokens: 0, outputTokens: 0, costUsd: null });
    assert.equal(bare.finishReason, undefined);
    const blocked = await new GoogleNativeTransport({
      client: stubClient(() => ({ promptFeedback: { blockReason: "SAFETY" } })).client,
    }).call(nativeTextRequest);
    assert.equal(blocked.text, "");
    assert.equal(blocked.finishReason, "SAFETY");
    assert.equal(fetchStub.log.length, 0, "the stubbed client never reaches the network");
  } finally {
    fetchStub.restore();
  }
});
test("GoogleNativeTransport classifies provider failures as TransportError kinds", async () => {
  const fail = (error: unknown) =>
    new GoogleNativeTransport({
      client: stubClient(() => {
        throw error;
      }).client,
    });
  const kindOf = async (transport: GoogleNativeTransport) => {
    const error = await transport.call(nativeTextRequest).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof TransportError, "every provider failure is a TransportError");
    return [error.kind, error.status, error.message] as const;
  };
  assert.deepEqual(await kindOf(fail(Object.assign(new Error("slow down"), { status: 429 }))), [
    "rate_limited",
    429,
    "Provider HTTP 429. No automatic paid retry.",
  ]);
  assert.deepEqual(
    (await kindOf(fail(Object.assign(new Error("down"), { status: 503 })))).slice(0, 2),
    ["server", 503],
  );
  assert.deepEqual(
    (await kindOf(fail(Object.assign(new Error("bad"), { code: 400 })))).slice(0, 2),
    ["unknown", 400],
  );
  assert.deepEqual(
    (await kindOf(fail(Object.assign(new Error("nope"), { status: 401 })))).slice(0, 2),
    ["unknown", 401],
  );
  const [kind, status, message] = await kindOf(fail(new Error("socket closed")));
  assert.equal(kind, "unknown");
  assert.equal(status, undefined);
  assert.match(message, /without a status: socket closed/);
  const slow = new GoogleNativeTransport({
    timeoutMs: 5,
    client: stubClient(() => new Promise(() => {})).client,
  });
  const [timedOut, noStatus, timeoutMessage] = await kindOf(slow);
  assert.equal(timedOut, "timeout");
  assert.equal(noStatus, undefined);
  assert.equal(timeoutMessage, "Provider request timed out before a response.");
});
test("the static price table covers every native model the defaults name and needs no network", async () => {
  const fetchStub = stubFetch([]);
  try {
    assert.match(priceTableVersion, /\d{4}-\d{2}-\d{2}/);
    const defaults = teamDefaults();
    const native = Object.values(defaults.models)
      .filter((m) => m.transport === "google-native")
      .map((m) => m.id);
    assert.ok(native.length > 0);
    for (const id of native)
      assert.ok(isPriced(id), `${id} is a default native model but has no price`);
    const transport = new GoogleNativeTransport();
    const flash = await transport.describe(NATIVE_MODEL);
    assert.deepEqual(flash, {
      contextLength: 1048576,
      inputRate: 0.00000075,
      audioRate: 0.00000075,
      outputRate: 0.00000375,
      supportedEfforts: ["minimal", "low", "medium", "high"],
    });
    assert.deepEqual(
      await transport.describe("google/Gemini-3.8-Flash"),
      flash,
      "a vendor prefix and case name the same model",
    );
    const unknown = await transport.describe("gemini-9-unreleased");
    assert.equal(unknown.inputRate, defaultPrice.inputPerMillion / 1e6);
    for (const price of Object.values(priceTable)) {
      assert.ok(defaultPrice.inputPerMillion >= price.inputPerMillion);
      assert.ok(defaultPrice.outputPerMillion >= price.outputPerMillion);
      assert.ok(price.cachedInputPerMillion <= price.inputPerMillion);
      assert.ok(price.contextLength > 0);
    }
    assert.equal(fetchStub.log.length, 0, "describe() reads the table, never the catalogue");
  } finally {
    fetchStub.restore();
  }
});
test("GoogleNativeTransport counts tokens through the SDK and falls back to a local estimate", async () => {
  const counted = stubClient(
    () => nativeReply,
    () => ({ totalTokens: 4242 }),
  );
  const transport = new GoogleNativeTransport({ client: counted.client });
  assert.deepEqual(await transport.countTokens(nativeTextRequest), {
    totalTokens: 4242,
    estimated: false,
  });
  const asked = counted.counts[0] as { model: string; contents: { parts: unknown[] }[] };
  assert.equal(asked.model, NATIVE_MODEL);
  assert.deepEqual(asked.contents[0].parts, [
    { text: 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}' },
  ]);
  const text = 'PROMPT\nSOURCE DATA (untrusted):\n{"a":1}';
  const expected = {
    totalTokens: Math.ceil(Buffer.byteLength(text, "utf8") / 4),
    estimated: true,
  };
  const noCount = new GoogleNativeTransport({ client: stubClient(() => nativeReply).client });
  assert.deepEqual(await noCount.countTokens(nativeTextRequest), expected);
  const broken = new GoogleNativeTransport({
    client: stubClient(
      () => nativeReply,
      () => {
        throw Object.assign(new Error("no"), { status: 500 });
      },
    ).client,
  });
  assert.deepEqual(await broken.countTokens(nativeTextRequest), expected);
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const keyless = new GoogleNativeTransport();
    assert.deepEqual(await keyless.countTokens(nativeTextRequest), expected);
    await assert.rejects(
      () => keyless.call(nativeTextRequest),
      /GEMINI_API_KEY is not configured/,
    );
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});
test("The comparison week: transport.default openrouter keeps the old path selectable for every stage", () => {
  // Spec 4.1 and 4.10: F20 retires the extra caption adapters, not the
  // OpenRouter route. For one comparison week a team must be able to run the
  // whole pipeline on the old path, so the settings schema still accepts
  // "openrouter" as transport.default and nothing may reach another vendor.
  const stored = TeamPreferences.parse({ transport: { default: "openrouter" } });
  assert.equal(stored.transport.default, "openrouter");
  const STAGES = [
    "metadata",
    "extraction",
    "synthesis",
    "synthesis-chunk-3",
    "transcribe",
    "transcribe-window-0",
    "native-source",
    "translate",
    "critique",
    "critique-2",
    "context",
    "audio-review",
    "experiment-x",
  ];
  // The flag on its own: a document that pins no per-stage transport sends
  // every stage, keyed or not, through OpenRouter.
  const flagOnly = { transport: { default: "openrouter" } };
  for (const stage of STAGES) {
    const transport = transportFor(stage, flagOnly);
    assert.ok(
      transport instanceof OpenRouterTransport,
      `${stage} should run on OpenRouter for the comparison week`,
    );
    assert.equal(transport.family, "openrouter");
    assert.equal(transport.name, "openrouter");
  }
  // The comparison-week team document: the default plus the per-stage routes
  // the settings schema always writes, all on the old path.
  const team = teamDefaults();
  team.transport.default = "openrouter";
  for (const key of Object.keys(team.models) as (keyof typeof team.models)[])
    team.models[key].transport = "openrouter";
  const week = TeamPreferences.parse(team);
  assert.equal(week.transport.default, "openrouter");
  for (const stage of STAGES) {
    assert.ok(
      transportFor(stage, week) instanceof OpenRouterTransport,
      `${stage} should follow the comparison-week settings`,
    );
  }
  // A stage already on OpenRouter is never wrapped in the OpenRouter fallback.
  week.transport.fallbackToOpenRouter = true;
  for (const stage of STAGES)
    assert.equal(transportFor(stage, week).name, "openrouter");
  // The other arm of the comparison is untouched: the defaults still go native.
  assert.equal(transportFor("synthesis", teamDefaults()).name, "google-native");
});
