import { z } from "zod";
import {
  ModelRequest,
  TransportError,
  classifyStatus,
  type ModelDescription,
  type ModelRequestData,
  type ModelResponseData,
  type ModelTransport,
} from "./types.ts";
/**
 * OpenRouter chat/completions, moved out of pipeline.ts modelCall with the
 * request body byte-for-byte unchanged. The per-call catalogue download, the
 * "Google AI Studio" pin for video and the json_object response format are
 * kept here on purpose; F11 replaces them with a cached price table and
 * responseSchema.
 */
const CATALOGUE_URL = "https://openrouter.ai/api/v1/models";
const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const Price = z.looseObject({
  prompt: z.union([z.string(), z.number()]).optional(),
  completion: z.union([z.string(), z.number()]).optional(),
  audio: z.union([z.string(), z.number()]).optional(),
});
const CatalogueModel = z.looseObject({
  id: z.string(),
  context_length: z.union([z.number(), z.string()]),
  pricing: Price.extend({ overrides: z.array(Price).optional() }),
  reasoning: z
    .looseObject({ supported_efforts: z.array(z.string()).optional() })
    .optional(),
});
const Catalogue = z.looseObject({ data: z.array(z.looseObject({ id: z.string() })) });
const Completion = z.looseObject({
  model: z.string().optional(),
  provider: z.string().optional(),
  usage: z
    .looseObject({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.unknown().optional(),
    })
    .optional(),
  choices: z
    .array(
      z.looseObject({
        finish_reason: z.string().nullish(),
        message: z.looseObject({ content: z.unknown() }).optional(),
      }),
    )
    .optional(),
});
/** Normalise an OpenRouter chat completion to the transport response. */
export function fromOpenRouter(data: unknown): ModelResponseData {
  const parsed = Completion.safeParse(data);
  if (!parsed.success)
    throw new TransportError("unknown", "Provider response had an unexpected shape.");
  const c = parsed.data;
  const choice = c.choices?.[0];
  const content = choice?.message?.content;
  const cost = c.usage?.cost;
  return {
    text: typeof content === "string" ? content : "",
    usage: {
      inputTokens: c.usage?.prompt_tokens ?? 0,
      outputTokens: c.usage?.completion_tokens ?? 0,
      costUsd: typeof cost === "number" && cost >= 0 ? cost : null,
    },
    model: c.model,
    provider: c.provider,
    finishReason: choice?.finish_reason ?? undefined,
    raw: data,
  };
}
export type OpenRouterOptions = {
  apiKey?: string;
  timeoutMs?: number;
  catalogueTimeoutMs?: number;
};
export class OpenRouterTransport implements ModelTransport {
  readonly name = "openrouter";
  readonly family = "openrouter" as const;
  private options: OpenRouterOptions;
  constructor(options: OpenRouterOptions = {}) {
    this.options = options;
  }
  private key() {
    const key = this.options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!key) throw Error("OPENROUTER_API_KEY is not configured.");
    return key;
  }
  private async json(url: string, init: RequestInit, timeoutMs: number) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError")
        throw new TransportError("timeout", "Provider request timed out before a response.");
      throw error;
    }
    if (!response.ok)
      throw new TransportError(
        classifyStatus(response.status),
        `Provider HTTP ${response.status}. No automatic paid retry.`,
        response.status,
      );
    return response.json();
  }
  async describe(model: string): Promise<ModelDescription> {
    this.key();
    const catalogue = Catalogue.parse(
      await this.json(CATALOGUE_URL, {}, this.options.catalogueTimeoutMs ?? 30000),
    );
    const entry = catalogue.data.find((m) => m.id === model);
    if (!entry) throw Error("Model is unavailable in the current catalogue.");
    const spec = CatalogueModel.parse(entry);
    const rates = [spec.pricing, ...(spec.pricing.overrides || [])];
    return {
      contextLength: Number(spec.context_length),
      inputRate: Math.max(...rates.map((p) => Number(p.prompt ?? spec.pricing.prompt))),
      audioRate: Math.max(...rates.map((p) => Number(p.audio || 0))),
      outputRate: Math.max(
        ...rates.map((p) => Number(p.completion ?? spec.pricing.completion)),
      ),
      supportedEfforts: spec.reasoning?.supported_efforts ?? [],
    };
  }
  /** The chat/completions body for a request, exactly as modelCall used to build it. */
  body(request: ModelRequestData) {
    const r = ModelRequest.parse(request);
    const content: unknown[] = r.user.map((p) => ({ type: "text", text: p.text }));
    if (r.video) content.push({ type: "video_url", video_url: { url: r.video.url } });
    const messages: unknown[] = [];
    if (r.system?.length)
      messages.push({
        role: "system",
        content: r.system.map((p) => ({ type: "text", text: p.text })),
      });
    messages.push({ role: "user", content });
    return {
      model: r.model,
      messages,
      max_tokens: r.maxOutputTokens,
      temperature: r.temperature,
      ...(r.reasoningEffort ? { reasoning: { effort: r.reasoningEffort } } : {}),
      response_format: { type: "json_object" },
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        ...(r.video ? { only: ["Google AI Studio"] } : {}),
      },
    };
  }
  async call(request: ModelRequestData): Promise<ModelResponseData> {
    const key = this.key();
    const data = await this.json(
      COMPLETIONS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.body(request)),
      },
      this.options.timeoutMs ?? 240000,
    );
    return fromOpenRouter(data);
  }
}
