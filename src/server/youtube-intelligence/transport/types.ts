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
  maxOutputTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  reasoningEffort: z.string().min(1).optional(),
});
export type ModelRequestData = z.infer<typeof ModelRequest>;
export const ModelUsage = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
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
}
