import { z } from "zod";
/**
 * ModelTransport: the seam between the pipeline and a model provider.
 * Everything above it (ledger reserve/settle, retained responses, prompt
 * snapshots, metrics) is provider-agnostic; everything below it is one
 * provider's HTTP. Spec section 4.1.
 */
export const TransportKind = z.enum(["openrouter", "google-native", "fake"]);
export type TransportKind = z.infer<typeof TransportKind>;
export const TextPart = z.object({ type: z.literal("text"), text: z.string() });
export type TextPart = z.infer<typeof TextPart>;
export const VideoPart = z.object({
  type: z.literal("video"),
  url: z.string().min(1),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().nonnegative().optional(),
});
export type VideoPart = z.infer<typeof VideoPart>;
export const ModelRequest = z.object({
  /** Pipeline stage that makes the call (transcribe, synthesis, critique-0, ...). */
  stage: z.string().min(1),
  model: z.string().min(1),
  system: z.array(TextPart).optional(),
  user: z.array(TextPart).min(1),
  video: VideoPart.optional(),
  /** JSON schema the response must satisfy; transports that support it enforce it. */
  responseSchema: z.record(z.string(), z.unknown()).optional(),
  /**
   * An explicit context cache to read instead of re-sending its content
   * (spec 5). The name is the one createCache returned. A transport that
   * cannot cache ignores the field, so the caller must have inlined the
   * content itself before setting it: only a transport whose createCache
   * produced this name may be asked to read it.
   */
  cachedContent: z.string().min(1).optional(),
  maxOutputTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  reasoningEffort: z.string().min(1).optional(),
});
export type ModelRequestData = z.infer<typeof ModelRequest>;
export const ModelUsage = z.object({
  inputTokens: z.number().nonnegative(),
  /**
   * Every token billed at the output rate, reasoning included. OpenRouter's
   * `completion_tokens` already counts reasoning this way; the native transport
   * adds `thoughtsTokenCount` to match, so a figure derived from tokens agrees
   * with `costUsd` instead of under-reporting whatever the model thought with.
   */
  outputTokens: z.number().nonnegative(),
  /** The reasoning share of outputTokens, when the provider separates it. */
  reasoningTokens: z.number().nonnegative().optional(),
  /** Provider-reported cost in USD, or null when the provider did not report one. */
  costUsd: z.number().nonnegative().nullable(),
});
export type ModelUsage = z.infer<typeof ModelUsage>;
export const ModelResponse = z.object({
  text: z.string(),
  usage: ModelUsage,
  model: z.string().optional(),
  provider: z.string().optional(),
  finishReason: z.string().optional(),
  /** The provider's response as received, retained verbatim by the ledger. */
  raw: z.unknown(),
});
export type ModelResponseData = z.infer<typeof ModelResponse>;
/** What the ledger needs to reserve before a call: prices per token and the context window. */
export const ModelDescription = z.object({
  contextLength: z.number().positive(),
  inputRate: z.number().nonnegative(),
  audioRate: z.number().nonnegative(),
  outputRate: z.number().nonnegative(),
  supportedEfforts: z.array(z.string()),
});
export type ModelDescription = z.infer<typeof ModelDescription>;
/** An explicit context cache the provider holds; `name` is what a request names. */
export const CachedContext = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  /** Provider-reported expiry, when it reported one. */
  expireTime: z.string().optional(),
  /** Tokens the cached content consumes, when the provider counted them. */
  tokens: z.number().nonnegative().optional(),
});
export type CachedContextData = z.infer<typeof CachedContext>;
export type TransportErrorKind = "rate_limited" | "server" | "timeout" | "unknown";
export class TransportError extends Error {
  kind: TransportErrorKind;
  status: number | undefined;
  constructor(kind: TransportErrorKind, message: string, status?: number) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
    this.status = status;
  }
}
export function classifyStatus(status: number): TransportErrorKind {
  return status === 429 ? "rate_limited" : status >= 500 ? "server" : "unknown";
}
export interface ModelTransport {
  /** Instance label, e.g. "openrouter" or "fake". */
  readonly name: string;
  /** Which kind of transport this is; routing and same-family checks key on it. */
  readonly family: TransportKind;
  describe(model: string): Promise<ModelDescription>;
  call(request: ModelRequestData): Promise<ModelResponseData>;
  /**
   * Explicit context caching (spec 5): hold `parts` once for `ttlSeconds` and
   * return the name a later request sets as cachedContent. Present only on a
   * transport that supports it, so a caller checks for the method and inlines
   * the content when it is absent.
   */
  createCache?(
    model: string,
    parts: TextPart[],
    ttlSeconds: number,
  ): Promise<CachedContextData>;
  /** Release a cache created by createCache. Never called for another transport's name. */
  deleteCache?(name: string): Promise<void>;
  /**
   * Tokens this request's text costs, for a reservation or a chunking
   * decision. `estimated` is true when the provider could not be asked and a
   * local floor was used, so a caller can treat the number as a floor.
   */
  countTokens?(
    request: ModelRequestData,
  ): Promise<{ totalTokens: number; estimated: boolean }>;
}
