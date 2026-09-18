import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type CachedContent,
  type CountTokensParameters,
  type CreateCachedContentParameters,
  type DeleteCachedContentParameters,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import {
  ModelRequest,
  TransportError,
  classifyStatus,
  type CachedContextData,
  type ModelDescription,
  type ModelRequestData,
  type ModelResponseData,
  type ModelTransport,
  type TextPart,
  type TransportErrorKind,
} from "./types.ts";
import { describeFromPrices, costUsd } from "./prices.ts";
import { classifyError } from "../native-google-core.ts";
/**
 * GoogleNativeTransport: the Gemini Developer API through @google/genai, on
 * the same ModelTransport seam as OpenRouter (spec 4.1). It follows
 * native-google-core.ts: one attempt (retries are the pipeline's policy, not
 * the SDK's), a local deadline with an AbortController, classifyError for the
 * failure taxonomy, and responseMimeType "application/json".
 *
 * What it adds over the OpenRouter path: responseSchema on every request that
 * carries one, YouTube URLs with videoMetadata offsets, mediaResolution LOW
 * for media (audio is 32 tokens/second, frames are 100-300 and irrelevant to
 * transcription, spec 5), a cached price table instead of a catalogue
 * download, and countTokens for honest reservations.
 *
 * Tests inject { client }; nothing here reads a key until a call is made.
 */
const MIME_VIDEO = "video/*";
const THINKING: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
/** The slice of the SDK this transport uses, so a stub needs no network and no key. */
export type GoogleNativeClient = {
  generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse>;
  countTokens?(request: CountTokensParameters): Promise<{ totalTokens?: number }>;
};
/** The slice of ai.caches explicit caching uses; a stub needs no network and no key. */
export type GoogleNativeCacheClient = {
  create(params: CreateCachedContentParameters): Promise<CachedContent>;
  delete(params: DeleteCachedContentParameters): Promise<unknown>;
};
export type GoogleNativeOptions = {
  apiKey?: string;
  timeoutMs?: number;
  /** "low" (default) asks for MEDIA_RESOLUTION_LOW whenever the request carries media. */
  mediaResolution?: "low" | "default";
  client?: GoogleNativeClient;
  caches?: GoogleNativeCacheClient;
};
/** Default life of an explicit cache: one run's critique, not a day's worth of storage. */
export const DEFAULT_CACHE_TTL_SECONDS = 1800;
export type TokenCount = {
  totalTokens: number;
  /** true when the provider could not be asked and the local bytes/4 floor was used. */
  estimated: boolean;
};
/** Join the model's non-thought text parts; an empty first part is not the whole answer. */
export function textOf(response: GenerateContentResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}
/** usageMetadata → the transport's usage, with cost from the static price table. */
export function usageOf(
  model: string,
  response: GenerateContentResponse,
): ModelResponseData["usage"] {
  const usage = response.usageMetadata;
  if (!usage) return { inputTokens: 0, outputTokens: 0, costUsd: null };
  const prompt = usage.promptTokenCount ?? 0;
  const cached = usage.cachedContentTokenCount ?? 0;
  const candidates = usage.candidatesTokenCount ?? 0;
  const thoughts = usage.thoughtsTokenCount ?? 0;
  const media = (usage.promptTokensDetails ?? [])
    .filter((d) => String(d.modality) === "AUDIO" || String(d.modality) === "VIDEO")
    .reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
  // promptTokenCount already includes the cached and media tokens; bill each
  // slice once, at its own rate, and never let rounding push a slice negative.
  const audioTokens = Math.min(media, Math.max(0, prompt - cached));
  const textTokens = Math.max(0, prompt - cached - audioTokens);
  return {
    inputTokens: prompt,
    // Billed output is what the model produced plus what it thought with, which
    // is what costUsd below is computed from. Reporting `candidates` alone here
    // left every token-derived figure lower than the cost it is meant to explain.
    outputTokens: candidates + thoughts,
    ...(thoughts ? { reasoningTokens: thoughts } : {}),
    costUsd: costUsd(model, {
      inputTokens: textTokens,
      cachedTokens: cached,
      audioTokens,
      outputTokens: candidates + thoughts,
    }),
  };
}
function transportError(error: unknown, aborted: boolean): TransportError {
  const { outcome, httpStatus } = classifyError(error, aborted);
  if (outcome === "transport_uncertain_timeout")
    return new TransportError("timeout", "Provider request timed out before a response.");
  const kind: TransportErrorKind =
    outcome === "quota_or_rate_limit"
      ? "rate_limited"
      : httpStatus === undefined
        ? "unknown"
        : classifyStatus(httpStatus);
  return new TransportError(
    kind,
    httpStatus === undefined
      ? `Provider call failed without a status: ${error instanceof Error ? error.message : "unknown error"}`
      : `Provider HTTP ${httpStatus}. No automatic paid retry.`,
    httpStatus,
  );
}
export class GoogleNativeTransport implements ModelTransport {
  readonly name = "google-native";
  readonly family = "google-native" as const;
  private options: GoogleNativeOptions;
  private sdk: GoogleNativeClient | null = null;
  private cacheSdk: GoogleNativeCacheClient | null = null;
  constructor(options: GoogleNativeOptions = {}) {
    this.options = options;
  }
  private client(): GoogleNativeClient {
    if (this.options.client) return this.options.client;
    if (!this.sdk) {
      const key = this.options.apiKey ?? process.env.GEMINI_API_KEY;
      if (!key) throw Error("GEMINI_API_KEY is not configured.");
      this.sdk = new GoogleGenAI({
        apiKey: key,
        httpOptions: { retryOptions: { attempts: 1 } },
      }).models;
    }
    return this.sdk;
  }
  private cacheClient(): GoogleNativeCacheClient {
    if (this.options.caches) return this.options.caches;
    if (!this.cacheSdk) {
      const key = this.options.apiKey ?? process.env.GEMINI_API_KEY;
      if (!key) throw Error("GEMINI_API_KEY is not configured.");
      this.cacheSdk = new GoogleGenAI({
        apiKey: key,
        httpOptions: { retryOptions: { attempts: 1 } },
      }).caches;
    }
    return this.cacheSdk;
  }
  /** The parts of one request: media first, so an implicit cache can match the prefix. */
  private parts(request: ModelRequestData) {
    const video = request.video;
    const media = video
      ? [
          {
            fileData: { fileUri: video.url, mimeType: MIME_VIDEO },
            ...(video.startSeconds !== undefined || video.endSeconds !== undefined
              ? {
                  videoMetadata: {
                    ...(video.startSeconds !== undefined
                      ? { startOffset: `${video.startSeconds}s` }
                      : {}),
                    ...(video.endSeconds !== undefined
                      ? { endOffset: `${video.endSeconds}s` }
                      : {}),
                  },
                }
              : {}),
          },
        ]
      : [];
    return [...media, ...request.user.map((p) => ({ text: p.text }))];
  }
  /** ModelRequest → generateContent parameters. Pure, so tests can assert the mapping. */
  parameters(
    request: ModelRequestData,
    signal?: AbortSignal,
  ): GenerateContentParameters {
    const r = ModelRequest.parse(request);
    const level = r.reasoningEffort ? THINKING[r.reasoningEffort] : undefined;
    const lowMedia = (this.options.mediaResolution ?? "low") === "low" && !!r.video;
    return {
      model: r.model,
      contents: [{ role: "user", parts: this.parts(r) }],
      config: {
        ...(signal ? { abortSignal: signal } : {}),
        httpOptions: { retryOptions: { attempts: 1 } },
        ...(r.system?.length
          ? { systemInstruction: { role: "system", parts: r.system.map((p) => ({ text: p.text })) } }
          : {}),
        maxOutputTokens: r.maxOutputTokens,
        temperature: r.temperature,
        responseMimeType: "application/json",
        ...(r.responseSchema ? { responseSchema: r.responseSchema } : {}),
        ...(r.cachedContent ? { cachedContent: r.cachedContent } : {}),
        ...(lowMedia ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
        ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
      },
    };
  }
  /** Rates and context window from the static table (transport/prices.ts); no network. */
  async describe(model: string): Promise<ModelDescription> {
    return describeFromPrices(model);
  }
  async call(request: ModelRequestData): Promise<ModelResponseData> {
    const r = ModelRequest.parse(request);
    const client = this.client();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("LOCAL_REQUEST_DEADLINE"));
        }, this.options.timeoutMs ?? 240000);
      });
      const response = await Promise.race([
        client.generateContent(this.parameters(r, controller.signal)),
        deadline,
      ]);
      const blocked = response.promptFeedback?.blockReason;
      return {
        text: textOf(response),
        usage: usageOf(r.model, response),
        model: response.modelVersion ?? r.model,
        provider: this.name,
        finishReason: response.candidates?.[0]?.finishReason ?? blocked ?? undefined,
        raw: response,
      };
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw transportError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * Explicit context caching (spec 5): the transcript is held once per run and
   * read by the batched critique at the cached rate instead of being re-sent.
   * One attempt, like every other call here; the caller decides whether a
   * failure is worth inlining the content for instead.
   */
  async createCache(
    model: string,
    parts: TextPart[],
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  ): Promise<CachedContextData> {
    if (!parts.length) throw Error("A context cache needs at least one part.");
    const client = this.cacheClient();
    try {
      const created = await client.create({
        model,
        config: {
          contents: [{ role: "user", parts: parts.map((p) => ({ text: p.text })) }],
          ttl: `${Math.max(1, Math.round(ttlSeconds))}s`,
        },
      });
      if (!created.name)
        throw new TransportError(
          "unknown",
          "The provider created a context cache without a name.",
        );
      const tokens = created.usageMetadata?.totalTokenCount;
      return {
        name: created.name,
        model: created.model ?? model,
        ...(created.expireTime ? { expireTime: created.expireTime } : {}),
        ...(typeof tokens === "number" && tokens >= 0 ? { tokens } : {}),
      };
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw transportError(error, false);
    }
  }
  /** Release a cache. Storage is billed per hour, so a finished run does not leave one behind. */
  async deleteCache(name: string): Promise<void> {
    const client = this.cacheClient();
    try {
      await client.delete({ name });
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw transportError(error, false);
    }
  }
  /**
   * Tokens the prompt will cost, for the ledger's reservation. Falls back to a
   * local bytes/4 floor when the provider cannot be asked; a video part is not
   * counted there, so an estimated count over media is a floor, not a bound.
   */
  async countTokens(request: ModelRequestData): Promise<TokenCount> {
    const r = ModelRequest.parse(request);
    const local = () => {
      const text = [...(r.system ?? []), ...r.user].map((p) => p.text).join("\n");
      return {
        totalTokens: Math.ceil(Buffer.byteLength(text, "utf8") / 4),
        estimated: true,
      };
    };
    let client: GoogleNativeClient;
    try {
      client = this.client();
    } catch {
      return local();
    }
    if (!client.countTokens) return local();
    try {
      const counted = await client.countTokens({
        model: r.model,
        contents: [{ role: "user", parts: this.parts(r) }],
      });
      if (typeof counted.totalTokens !== "number" || counted.totalTokens < 0)
        return local();
      return { totalTokens: counted.totalTokens, estimated: false };
    } catch {
      return local();
    }
  }
}
