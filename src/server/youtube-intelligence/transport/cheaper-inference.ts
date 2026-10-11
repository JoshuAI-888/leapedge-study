import { z } from "zod";
import { ModelRequest, TransportError, classifyStatus, type ModelDescription, type ModelRequestData, type ModelResponseData, type ModelTransport } from "./types.ts";
import { cheaperInferenceKey, cheaperInferenceModelId, getCheaperInferenceCatalog, type CheaperInferenceCatalogOptions } from "./cheaper-inference-catalog.ts";

const COMPLETIONS_URL = "https://api.cheaperinference.com/v1/chat/completions";
const Completion = z.looseObject({
  model: z.string().min(1),
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string() }), finish_reason: z.string().nullish() })).min(1),
  usage: z.looseObject({ prompt_tokens: z.number().finite().nonnegative().optional(), completion_tokens: z.number().finite().nonnegative().optional(),
    completion_tokens_details: z.looseObject({ reasoning_tokens: z.number().finite().nonnegative().optional() }).nullish(), cost: z.unknown().optional() }).optional(),
  cheaper_inference: z.looseObject({ billing: z.looseObject({ status: z.string().optional(), billed_cost_usd: z.unknown().optional(), currency: z.string().optional() }).optional() }).optional(),
});
function amount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
}
const Settlement = z.looseObject({
  usage: z.looseObject({ cost: z.unknown().optional() }).nullish(),
  cheaper_inference: z.looseObject({ billing: z.looseObject({ status: z.string().optional(), billed_cost_usd: z.unknown().optional(), currency: z.string().optional() }).optional() }).nullish(),
});
/** Reconciliation reads retained billing even if the text envelope was rejected. */
export function settledCheaperInferenceCost(payload: unknown): number | null {
  const parsed = Settlement.safeParse(payload);
  if (!parsed.success) return null;
  const c = parsed.data, billing = c.cheaper_inference?.billing;
  if (billing && billing.status !== "settled") return null;
  if (billing?.currency && billing.currency !== "USD") return null;
  return amount(billing?.billed_cost_usd) ?? amount(c.usage?.cost);
}
export function fromCheaperInference(data: unknown, expectedModel: string): ModelResponseData {
  const parsed = Completion.safeParse(data);
  const receivedResponse = { raw: data, costUsd: settledCheaperInferenceCost(data) };
  if (!parsed.success) throw new TransportError("unknown", "Provider response had an unexpected shape. No automatic paid retry.", undefined, receivedResponse);
  const c = parsed.data;
  if (cheaperInferenceModelId(c.model) !== cheaperInferenceModelId(expectedModel))
    throw new TransportError("unknown", "Provider returned a different model. No automatic paid retry.", undefined, receivedResponse);
  const costUsd = receivedResponse.costUsd;
  return {
    text: c.choices[0].message.content,
    usage: { inputTokens: c.usage?.prompt_tokens ?? 0, outputTokens: c.usage?.completion_tokens ?? 0,
      ...(c.usage?.completion_tokens_details?.reasoning_tokens !== undefined ? { reasoningTokens: c.usage.completion_tokens_details.reasoning_tokens } : {}), costUsd },
    model: c.model, provider: "Cheaper Inference", finishReason: c.choices[0].finish_reason ?? undefined, raw: data,
  };
}
export type CheaperInferenceOptions = { apiKey?: string; timeoutMs?: number; catalogueTimeoutMs?: number; catalogOptions?: Omit<CheaperInferenceCatalogOptions, "apiKey">; ranking?: "balance" | "discount" | "speed" };
/** Legacy Gemini schemas express the application's nullable domain with
 * nullable:true. Chat completions consumes standard JSON Schema instead.
 * Convert schema positions only: enum/default/examples may contain user data
 * named nullable. The original schema remains the paid-replay fingerprint. */
function standardResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const maps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
  const arrays = new Set(["anyOf", "allOf", "oneOf", "prefixItems"]);
  const singles = new Set(["items", "additionalItems", "additionalProperties", "unevaluatedItems", "unevaluatedProperties", "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"]);
  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    const converted = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "nullable").map(([key, child]) => {
      if (maps.has(key) && child && typeof child === "object" && !Array.isArray(child))
        return [key, Object.fromEntries(Object.entries(child).map(([name, entry]) => [name, visit(entry)]))];
      if (arrays.has(key) && Array.isArray(child)) return [key, child.map(visit)];
      if (singles.has(key)) return [key, Array.isArray(child) ? child.map(visit) : visit(child)];
      if (key === "dependencies" && child && typeof child === "object" && !Array.isArray(child))
        return [key, Object.fromEntries(Object.entries(child).map(([name, entry]) => [name, Array.isArray(entry) ? entry : visit(entry)]))];
      return [key, child];
    }));
    // Some serving providers honor an explicit numeric enum more reliably
    // than integer min/max. Preserve every original constraint and fingerprint;
    // listing an equivalent small domain here cannot clamp/coerce the output.
    if (converted.type === "integer" && converted.enum === undefined &&
      Number.isSafeInteger(converted.minimum) && Number.isSafeInteger(converted.maximum)) {
      const min = converted.minimum as number, max = converted.maximum as number;
      if (max >= min && max - min < 16)
        converted.enum = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    }
    // Wrap the entire non-null branch, preserving enum/const and composition
    // rather than dropping constraints or mixing null into only a nested type.
    return source.nullable === true ? { anyOf: [converted, { type: "null" }] } : converted;
  }
  return visit(structuredClone(schema)) as Record<string, unknown>;
}
export class CheaperInferenceTransport implements ModelTransport {
  readonly name = "cheaper-inference";
  readonly family = "cheaper-inference" as const;
  private options: CheaperInferenceOptions;
  constructor(options: CheaperInferenceOptions = {}) { this.options = options; }
  private async catalog() {
    return getCheaperInferenceCatalog({ ...this.options.catalogOptions, timeoutMs: this.options.catalogueTimeoutMs ?? this.options.catalogOptions?.timeoutMs, apiKey: this.options.apiKey });
  }
  async describe(model: string): Promise<ModelDescription> {
    const catalog = await this.catalog();
    const entry = catalog.models.find((m) => m.id === cheaperInferenceModelId(model));
    if (!entry) throw Error("Model is unavailable in the current Cheaper Inference catalog.");
    if (entry.maxOutputTokens == null) throw Error("Model lacks a verified output-token limit in the current Cheaper Inference catalog.");
    if (entry.reservationInputRate == null || entry.reservationOutputRate == null)
      throw Error("Model lacks a verified billing ceiling in the current Cheaper Inference catalog.");
    return { contextLength: entry.contextLength, maxOutputTokens: entry.maxOutputTokens,
      inputRate: entry.reservationInputRate, audioRate: 0, outputRate: entry.reservationOutputRate,
      supportedEfforts: entry.capabilities.reasoning ? ["low", "medium", "high"] : [],
      pricingVersion: catalog.pricingVersion, pricingCheckedAt: catalog.pricingCheckedAt };
  }
  body(request: ModelRequestData) {
    const r = ModelRequest.parse(request);
    if (r.video) throw Error("Cheaper Inference supports text stages here; audio/video stays on Google native.");
    if (r.cachedContent) throw Error("Cheaper Inference cannot read another transport's cached content. Inline the source first.");
    const model = cheaperInferenceModelId(r.model);
    const messages: unknown[] = [];
    if (r.system?.length) messages.push({ role: "system", content: r.system });
    messages.push({ role: "user", content: r.user });
    const body = {
      model, messages, max_tokens: r.maxOutputTokens, stream: false,
      ranking: z.enum(["balance", "discount", "speed"]).parse(this.options.ranking ?? "balance"),
      // Sonnet 5 rejects sampling temperature; omit controls on reasoning-only models as well.
      ...(/^(?:claude-sonnet-5|claude-opus-5|o[134](?:-|$)|gpt-.*-pro$)/.test(model) ? {} : { temperature: r.temperature }),
      ...(r.reasoningEffort ? { reasoning: { effort: r.reasoningEffort } } : {}),
      ...(r.responseSchema ? { response_format: { type: "json_schema", json_schema: { name: r.stage.replace(/[^A-Za-z0-9_-]/g, "_"), schema: standardResponseSchema(r.responseSchema), strict: true } } } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 4_500_000) throw Error("Cheaper Inference request exceeds the 4.5 MB body limit.");
    return body;
  }
  async call(request: ModelRequestData): Promise<ModelResponseData> {
    const key = cheaperInferenceKey(this.options.apiKey), body = this.body(request);
    const description = await this.describe(request.model);
    if (request.maxOutputTokens > (description.maxOutputTokens ?? description.contextLength))
      throw Error("Requested output exceeds the model's current output-token limit.");
    let response: Response;
    try {
      response = await fetch(COMPLETIONS_URL, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        // OpenAPI explicitly supports this benchmark override: no optional workspace
        // prompt transforms, output changes, model routing or exact-answer replay.
        "X-CI-Techniques": "off", "X-CI-Prompt-Cache": "passthrough" },
        cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(this.options.timeoutMs ?? 240_000) });
    } catch {
      // A disconnect/timeout cannot establish whether paid work completed. The ledger must hold it.
      throw new TransportError("unknown", "Provider request outcome is unknown. No automatic paid retry.");
    }
    if (!response.ok) throw new TransportError(classifyStatus(response.status), `Provider HTTP ${response.status}. No automatic paid retry.`, response.status);
    let data: unknown;
    try { data = await response.json(); } catch { throw new TransportError("unknown", "Provider response had an unexpected shape. No automatic paid retry."); }
    return fromCheaperInference(data, request.model);
  }
}
