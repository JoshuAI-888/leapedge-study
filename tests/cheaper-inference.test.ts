import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { json, stubFetch } from "./helpers/fetch-stub.ts";
import { CheaperInferenceTransport, fromCheaperInference, settledCheaperInferenceCost } from "../src/server/youtube-intelligence/transport/cheaper-inference.ts";
import { clearCheaperInferenceCatalogCache, getCheaperInferenceCatalog, parseCheaperInferenceCatalog } from "../src/server/youtube-intelligence/transport/cheaper-inference-catalog.ts";
import { callFieldsExtractionResponseSchema, structuredExtractionResponseSchema } from "../src/server/youtube-intelligence/schemas/extraction.ts";

function entry(id = "gemini-3.8-flash") {
  return {
    id, provider: "Google", type: "text", context_length: 1048576, max_output_tokens: 65535,
    supported_endpoints: ["/v1/chat/completions"],
    capabilities: { reasoning: true, vision: true, video: true, streaming: true },
    pricing: {
      currency: "USD", input_per_million: "0.4875", output_per_million: "2.4375",
      cache_read_input_per_million: "0.04875", cache_write_input_per_million: "0.4875",
      list_input_per_million: "0.75", list_output_per_million: "3.75", discount_percent: "35",
      input_token_price_threshold: null, above_threshold: null,
      default_scope: { model: id, protocol: "chat_completions", serviceTier: "standard", pricingVariant: "default", region: null, zdr: false },
      scopes: [{ scope: { model: id, protocol: "chat_completions", serviceTier: "standard", pricingVariant: "default", region: null, zdr: false },
        tiers: [{ minContext: 0, maxContext: null, rates: { input_tokens: "0.0000004875", output_tokens: "0.0000024375" } }],
        makerTiers: [{ minContext: 0, maxContext: null, rates: { input_tokens: "0.00000075", output_tokens: "0.00000375" } }],
      }],
    },
  };
}
function catalog() { return { data: [entry(), entry("claude-sonnet-5")], pricing_version: "sha256:test", pricing_checked_at: "2026-10-11T00:00:00Z", pricing_updated_at: "2026-10-10T00:00:00Z" }; }
const request = { stage: "critique.0", model: "anthropic/claude-sonnet-5", user: [{ type: "text" as const, text: "Check the source." }], maxOutputTokens: 256, temperature: 0, reasoningEffort: "low", responseSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } };
function completion() { return { model: "claude-sonnet-5", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.4 }, cheaper_inference: { billing: { status: "settled", billed_cost_usd: "0.00042", currency: "USD" } } }; }
afterEach(() => clearCheaperInferenceCatalogCache());

test("catalog preserves live prices and metadata while excluding incompatible media endpoints", () => {
  const c = catalog(); c.data.push({ ...entry("image"), type: "image", context_length: 0, max_output_tokens: 0 }, { ...entry("responses-only"), supported_endpoints: ["/v1/responses"] });
  const parsed = parseCheaperInferenceCatalog(c, 100);
  assert.equal(parsed.models.length, 2); assert.equal(parsed.pricingVersion, "sha256:test");
  assert.equal(parsed.models[0].pricing.inputPerMillion, 0.4875);
  assert.equal(parsed.models[0].reservationInputRate, 0.75 / 1e6);
  assert.equal(parsed.models[0].reservationOutputRate, 3.75 / 1e6);
  assert.equal(parsed.models[0].maxOutputTokens, 65535);
});
test("reservation ceiling covers default-scope maker tiers and cache writes without using cheaper priority/flex scopes", () => {
  const c = catalog(); const p = c.data[0].pricing;
  p.scopes[0].makerTiers.push({ minContext: 200001, maxContext: null, rates: { input_tokens: "0.000004", output_tokens: "0.000009", cache_write_1h_tokens: "0.000008" } } as typeof p.scopes[0]["makerTiers"][number]);
  const m = parseCheaperInferenceCatalog(c).models[0]; assert.equal(m.reservationInputRate, 0.000008); assert.equal(m.reservationOutputRate, 0.000009);
});
test("unknown or malformed prices never become free reservations", () => {
  const c = catalog(); c.data[0].pricing.input_per_million = "NaN";
  assert.throws(() => parseCheaperInferenceCatalog(c), /catalog/i);
  const unknown = catalog(); delete (unknown.data[0].pricing as Partial<typeof unknown.data[0]["pricing"]>).list_input_per_million;
  delete (unknown.data[0].pricing as Partial<typeof unknown.data[0]["pricing"]>).scopes;
  assert.equal(parseCheaperInferenceCatalog(unknown).models[0].reservationInputRate, null);
});
test("unknown output limits remain visible in the catalog but cannot run paid requests", async () => {
  const c = catalog(); const unknown = { ...entry("unknown-limits"), max_output_tokens: null };
  const raw = { ...c, data: [...c.data, unknown] };
  assert.equal(parseCheaperInferenceCatalog(raw).models[2].maxOutputTokens, null);
  const stub = stubFetch([{ url: "/v1/models", respond: json(raw) }]);
  try { await assert.rejects(new CheaperInferenceTransport({ apiKey: "test-key" }).call({ ...request, model: "unknown-limits" }), /output-token limit/i); }
  finally { stub.restore(); }
});
test("a pricing scope that cannot match the standard chat request is refused", () => {
  const c = catalog(); c.data[0].pricing.default_scope.serviceTier = "priority";
  assert.equal(parseCheaperInferenceCatalog(c).models[0].reservationInputRate, null);
});
test("catalog fetch authenticates, deduplicates, expires, and isolates API-key catalogs", async () => {
  let now = 100;
  const stub = stubFetch([{ url: "/v1/models", respond: json(catalog()) }]);
  try {
    const options = { apiKey: "test-key", ttlMs: 50, now: () => now };
    await Promise.all([getCheaperInferenceCatalog(options), getCheaperInferenceCatalog(options)]);
    assert.equal(stub.log.length, 1); assert.equal(stub.log[0].headers.authorization, "Bearer test-key");
    await getCheaperInferenceCatalog(options); assert.equal(stub.log.length, 1);
    now += 51; await getCheaperInferenceCatalog(options); assert.equal(stub.log.length, 2);
    await getCheaperInferenceCatalog({ ...options, apiKey: "other-key" }); assert.equal(stub.log.length, 3);
  } finally { stub.restore(); }
});
test("callers cannot mutate a cached catalog's reservation ceiling", async () => {
  const stub = stubFetch([{ url: "/v1/models", respond: json(catalog()) }]);
  try {
    const first = await getCheaperInferenceCatalog({ apiKey: "test-key" }); first.models[0].reservationInputRate = 0;
    assert.equal((await getCheaperInferenceCatalog({ apiKey: "test-key" })).models[0].reservationInputRate, 0.75 / 1e6);
  } finally { stub.restore(); }
});
test("an expired catalog refresh fails rather than serving stale prices", async () => {
  let now = 0; const stub = stubFetch([{ url: "/v1/models", responses: [json(catalog()), json({ error: "test-key private detail" }, 503)] }]);
  try { const options = { apiKey: "test-key", ttlMs: 5, now: () => now }; await getCheaperInferenceCatalog(options); now = 10;
    await assert.rejects(getCheaperInferenceCatalog(options), (e: Error) => /HTTP 503/.test(e.message) && !e.message.includes("test-key"));
  } finally { stub.restore(); }
});
test("settled billing is authoritative and preserved with raw usage", () => {
  const raw = completion(), r = fromCheaperInference(raw, request.model);
  assert.equal(r.usage.costUsd, 0.00042); assert.equal(r.raw, raw); assert.equal(r.model, "claude-sonnet-5");
});
test("reconciliation can read settled bills without trusting a malformed content envelope", () => {
  assert.equal(settledCheaperInferenceCost({ cheaper_inference: completion().cheaper_inference }), 0.00042);
  assert.equal(settledCheaperInferenceCost({ cheaper_inference: { billing: { status: "pending", billed_cost_usd: "0.5" } }, usage: { cost: 1 } }), null);
  assert.equal(settledCheaperInferenceCost({ cheaper_inference: { billing: { status: "settled", billed_cost_usd: "0.5", currency: "EUR" } } }), null);
  assert.equal(settledCheaperInferenceCost(null), null);
});
test("numeric or decimal-string usage costs are accepted only without unsettled billing", () => {
  for (const cost of [0.00042, "0.00042"]) {
    const raw = { ...completion(), cheaper_inference: undefined, usage: { prompt_tokens: 10, completion_tokens: 20, cost } };
    assert.equal(fromCheaperInference(raw, request.model).usage.costUsd, 0.00042);
  }
  for (const status of ["pending", "failed", "unsettled"]) {
    const raw = completion(); raw.cheaper_inference.billing.status = status;
    assert.equal(fromCheaperInference(raw, request.model).usage.costUsd, null);
  }
  for (const cost of ["NaN", "Infinity", -1, null]) {
    const raw = { ...completion(), cheaper_inference: undefined, usage: { cost } };
    assert.equal(fromCheaperInference(raw, request.model).usage.costUsd, null);
  }
});
test("substituted models and malformed output envelopes are rejected without echoing provider data", () => {
  const mismatch = { ...completion(), model: "secret-model" };
  assert.throws(() => fromCheaperInference(mismatch, request.model), (e: Error & { receivedResponse?: { raw: unknown; costUsd: number | null } }) => {
    assert.match(e.message, /different model/i); assert.ok(!e.message.includes("secret-model"));
    assert.equal(e.receivedResponse?.raw, mismatch); assert.equal(e.receivedResponse?.costUsd, 0.00042); return true;
  });
  const malformed = { ...completion(), choices: [] };
  assert.throws(() => fromCheaperInference(malformed, request.model), (e: Error & { receivedResponse?: { raw: unknown; costUsd: number | null } }) => {
    assert.match(e.message, /unexpected shape/i); assert.equal(e.receivedResponse?.raw, malformed); assert.equal(e.receivedResponse?.costUsd, 0.00042); return true;
  });
  assert.throws(() => fromCheaperInference({ ...completion(), usage: { prompt_tokens: -1 } }, request.model), /unexpected shape/i);
});
test("a rejected response retains pending billing as unknown without trusting an advertised usage cost", () => {
  const raw = { ...completion(), choices: [], cheaper_inference: { billing: { status: "pending", billed_cost_usd: "0.5" } } };
  assert.throws(() => fromCheaperInference(raw, request.model), (e: Error & { receivedResponse?: { raw: unknown; costUsd: number | null } }) => {
    assert.equal(e.receivedResponse?.raw, raw); assert.equal(e.receivedResponse?.costUsd, null); return true;
  });
});
test("text requests retain strict schema, exact model and independent reasoning without optimizing the prompt", async () => {
  const stub = stubFetch([{ url: "/v1/models", respond: json(catalog()) }, { url: "/v1/chat/completions", method: "POST", respond: json(completion()) }]);
  try {
    const t = new CheaperInferenceTransport({ apiKey: "test-key" });
    const description = await t.describe(request.model); assert.equal(description.inputRate, 0.75 / 1e6);
    await t.call(request); const body = JSON.parse(stub.calls("/chat/completions")[0].body!);
    assert.equal(body.model, "claude-sonnet-5"); assert.equal(body.ranking, "balance"); assert.equal(body.temperature, undefined);
    assert.deepEqual(body.reasoning, { effort: "low" }); assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema, request.responseSchema);
    assert.equal(body.messages[0].content[0].text, request.user[0].text);
    assert.equal(stub.calls("/chat/completions")[0].headers["x-ci-route"], undefined);
    assert.equal(stub.calls("/chat/completions")[0].headers["x-ci-techniques"], "off");
    assert.equal(stub.calls("/chat/completions")[0].headers["x-ci-prompt-cache"], "passthrough");
  } finally { stub.restore(); }
});
test("routing defaults to balance and accepts explicit discount or speed without changing the requested model", () => {
  for (const ranking of ["discount", "speed"] as const) {
    const body = new CheaperInferenceTransport({ apiKey: "test-key", ranking }).body(request);
    assert.equal(body.ranking, ranking); assert.equal(body.model, "claude-sonnet-5");
  }
  assert.throws(() => new CheaperInferenceTransport({ ranking: "invalid" as "balance" }).body(request));
});
test("extraction nulls remain an explicit choice in the standard JSON Schema request without changing replay inputs", () => {
  const original = structuredClone(callFieldsExtractionResponseSchema);
  for (const schema of [structuredExtractionResponseSchema, callFieldsExtractionResponseSchema]) {
    const body = new CheaperInferenceTransport().body({ ...request, responseSchema: schema });
    const sent = body.response_format!.json_schema.schema as any;
    const fields = sent.properties.claims.items.properties;
    assert.deepEqual(fields.ticker, { anyOf: [{ type: "string" }, { type: "null" }] });
    assert.deepEqual(fields.option.anyOf[1], { type: "null" });
    assert.deepEqual(fields.option.anyOf[0].required, ["right", "side", "strike_original", "expiry_original", "premium_original"]);
    assert.deepEqual(fields.option.anyOf[0].properties.strike_original, { anyOf: [{ type: "string" }, { type: "null" }] });
    if (fields.macro_theme) {
      assert.deepEqual(fields.macro_theme.anyOf[1], { type: "null" });
      assert.deepEqual(fields.macro_theme.anyOf[0].enum, original.properties.claims.items.properties.macro_theme.enum);
    }
  }
  assert.deepEqual(callFieldsExtractionResponseSchema, original, "provider conversion must not mutate original request/fingerprint schemas");
});
test("nullable conversion preserves composition, existing types, constraints and data named nullable", () => {
  const value = { nullable: true, type: "object" };
  const schema = {
    type: "object", properties: {
      nullable: { type: "boolean" },
      choice: { nullable: true, anyOf: [{ type: "string", enum: ["x"] }, { type: "integer", minimum: 2 }] },
      alreadyNullable: { nullable: true, type: ["string", "null"], enum: ["x", null] },
      fixed: { type: "string", nullable: false, const: "x", default: value, examples: [value] },
    },
    $defs: { row: { type: "array", items: { nullable: true, type: "integer", enum: [0, 1] }, minItems: 1 } },
    additionalProperties: { type: "string", nullable: true },
    allOf: [{ properties: { constrained: { type: "string", nullable: true, minLength: 1 } } }],
  };
  const original = structuredClone(schema);
  const body = new CheaperInferenceTransport().body({ ...request, responseSchema: schema });
  const sent = body.response_format!.json_schema.schema as any;
  assert.deepEqual(sent.properties.choice, { anyOf: [{ anyOf: original.properties.choice.anyOf }, { type: "null" }] });
  assert.deepEqual(sent.properties.alreadyNullable, { anyOf: [{ type: ["string", "null"], enum: ["x", null] }, { type: "null" }] });
  assert.deepEqual(sent.properties.fixed, { type: "string", const: "x", default: value, examples: [value] });
  assert.deepEqual(sent.properties.nullable, { type: "boolean" });
  assert.deepEqual(sent.$defs.row.items, { anyOf: [{ type: "integer", enum: [0, 1] }, { type: "null" }] });
  assert.equal(sent.$defs.row.minItems, 1);
  assert.deepEqual(sent.additionalProperties, { anyOf: [{ type: "string" }, { type: "null" }] });
  assert.deepEqual(sent.allOf[0].properties.constrained, { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] });
  assert.deepEqual(schema, original);
});
test("only small inclusive safe integer ranges gain an equivalent enum without dropping other constraints", () => {
  const schema = { type: "object", properties: {
    bounded: { type: "integer", minimum: -1, maximum: 2, multipleOf: 2, exclusiveMinimum: -1 },
    large: { type: "integer", minimum: 0, maximum: 100 },
    fraction: { type: "number", minimum: 0, maximum: 3 },
    existing: { type: "integer", minimum: 0, maximum: 3, enum: [1, 3] },
    unsafe: { type: "integer", minimum: Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER + 1 },
  } };
  const original = structuredClone(schema);
  const sent = new CheaperInferenceTransport().body({ ...request, responseSchema: schema }).response_format!.json_schema.schema as any;
  assert.deepEqual(sent.properties.bounded, { ...original.properties.bounded, enum: [-1, 0, 1, 2] });
  for (const key of ["large", "fraction", "existing", "unsafe"]) assert.deepEqual(sent.properties[key], original.properties[key as keyof typeof original.properties]);
  assert.deepEqual(schema, original);
});
test("audio/video, foreign caches, unavailable models and oversized bodies are refused before paid traffic", async () => {
  const stub = stubFetch([{ url: "/v1/models", respond: json(catalog()) }]);
  try {
    const t = new CheaperInferenceTransport({ apiKey: "test-key" });
    await assert.rejects(t.call({ ...request, video: { type: "video", url: "https://youtube.com/watch?v=x" } }), /text/i);
    await assert.rejects(t.call({ ...request, cachedContent: "google-cache" }), /cache/i);
    await assert.rejects(t.call({ ...request, model: "vendor/unknown" }), /unavailable/i);
    await assert.rejects(t.call({ ...request, user: [{ type: "text", text: "a".repeat(4_500_000) }] }), /4.5 MB/i);
    assert.equal(stub.calls("/chat/completions").length, 0);
  } finally { stub.restore(); }
});
test("provider and uncertain network failures are sanitized and never retried", async () => {
  for (const failure of [json({ error: "test-key secret prompt" }, 429), json({ error: "test-key" }, 400), () => { throw new Error("test-key private network detail"); }, () => { throw new DOMException("test-key", "TimeoutError"); }]) {
    clearCheaperInferenceCatalogCache();
    const stub = stubFetch([{ url: "/v1/models", respond: json(catalog()) }, { url: "/v1/chat/completions", respond: failure }]);
    try {
      await assert.rejects(new CheaperInferenceTransport({ apiKey: "test-key" }).call(request), (e: Error) => !e.message.includes("test-key") && /No automatic paid retry/.test(e.message));
      assert.equal(stub.calls("/chat/completions").length, 1);
    } finally { stub.restore(); }
  }
});
