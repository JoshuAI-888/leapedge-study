import { z } from "zod";
import {
  TransportKind,
  TransportError,
  type ModelRequestData,
  type ModelResponseData,
  type ModelTransport,
} from "./types.ts";
import { OpenRouterTransport } from "./openrouter.ts";
import { GoogleNativeTransport } from "./google-native.ts";
import { modelFamily } from "../../../features/youtube-intelligence/model-family.ts";
export * from "./types.ts";
// modelFamily lives with the settings schema: the legacy migration needs the
// same answer this module enforces the critic rule with.
export {
  ModelFamily,
  modelFamily,
} from "../../../features/youtube-intelligence/model-family.ts";
export { OpenRouterTransport } from "./openrouter.ts";
export { GoogleNativeTransport } from "./google-native.ts";
/**
 * Stage routing (spec 4.1, settings 6.2).
 *
 * transportFor(stage, settings) reads the team preferences: the stage's own
 * `models.<key>.transport` first, then `transport.default`. The settings
 * schema below is the read-only subset of TeamPreferences this module needs;
 * a full TeamPreferences document parses through it unchanged, so callers
 * hand over what they already loaded instead of a hand-built object.
 *
 * With `transport.fallbackToOpenRouter` on, a non-OpenRouter transport is
 * wrapped so one retryable provider failure (5xx, 429, timeout) is re-issued
 * once through OpenRouter and the response records `fallbackUsed`. Off by
 * default, so cost stays predictable.
 *
 * Tests inject a transport with injectTransport(fake) and undo it with the
 * returned function; the pipeline never knows the difference.
 */
export const ModelStageKey = z.enum([
  "transcription",
  "extraction",
  "critique",
  "context",
  "translation",
  "audioReview",
]);
export type ModelStageKey = z.infer<typeof ModelStageKey>;
/** The transports a settings document may name; "fake" is a test seam only. */
const StockKind = TransportKind.exclude(["fake"]);
const ModelRoute = z.looseObject({
  id: z.string().min(1).optional(),
  transport: StockKind.optional(),
  requireDifferentFamily: z.boolean().optional(),
});
export const TransportSettings = z.object({
  transport: z
    .object({
      default: StockKind.optional(),
      fallbackToOpenRouter: z.boolean().optional(),
    })
    .optional(),
  models: z
    .object({
      transcription: ModelRoute.optional(),
      extraction: ModelRoute.optional(),
      critique: ModelRoute.optional(),
      context: ModelRoute.optional(),
      translation: ModelRoute.optional(),
      audioReview: ModelRoute.optional(),
    })
    .optional(),
});
export type TransportSettingsData = z.infer<typeof TransportSettings>;
export type TransportFactory = (
  stage: string,
  settings: TransportSettingsData,
) => ModelTransport;
/**
 * The settings key a pipeline stage is configured by. Stage names carry an
 * index (`critique-3`, `synthesis-chunk-1`, `transcribe-window-0`), so the
 * match is by prefix. A stage with no key — `source-repair`, an experiment —
 * falls back to `transport.default` and to the extraction model.
 */
export function stageKey(stage: string): ModelStageKey | undefined {
  if (stage.startsWith("synthesis") || stage === "extraction")
    return "extraction";
  if (stage.startsWith("critique")) return "critique";
  if (stage.startsWith("transcribe") || stage === "native-source")
    return "transcription";
  if (stage === "translate" || stage === "translation") return "translation";
  if (stage === "audio-review") return "audioReview";
  if (stage === "context") return "context";
  return undefined;
}
/** The model id configured for a stage, or the extraction model for an unkeyed stage. */
export function modelIdFor(stage: string, settings?: unknown): string | undefined {
  const parsed = TransportSettings.parse(settings ?? {});
  const key = stageKey(stage);
  return (
    (key ? parsed.models?.[key]?.id : undefined) ?? parsed.models?.extraction?.id
  );
}
/**
 * Spec 4.1: the critic exists to fail differently from the extractor, so a
 * critic from the extractor's own family is a configuration error, not a
 * cheaper option. Checked against the settings, before the first critique
 * call of a run, so the run fails with an explanation instead of billing a
 * correlated audit.
 */
export function assertCriticIndependent(settings?: unknown): void {
  const parsed = TransportSettings.parse(settings ?? {});
  const critique = parsed.models?.critique;
  const extraction = parsed.models?.extraction;
  if (critique?.requireDifferentFamily !== true) return;
  if (!critique.id || !extraction?.id) return;
  const criticFamily = modelFamily(critique.id);
  if (criticFamily !== modelFamily(extraction.id)) return;
  throw Error(
    `The critic model "${critique.id}" is from the same family (${criticFamily}) as the extraction model "${extraction.id}". ` +
      "Settings require a critic from a different family: choose a critic from another vendor, or turn off models.critique.requireDifferentFamily.",
  );
}
const FALLBACK_KINDS = new Set(["server", "rate_limited", "timeout"]);
/** Whether a failure is one a second transport could plausibly answer. */
function fallbackWorthy(error: unknown): error is TransportError {
  return error instanceof TransportError && FALLBACK_KINDS.has(error.kind);
}
function markFallback(
  raw: unknown,
  from: string,
  error: TransportError,
): unknown {
  const note = {
    fallbackUsed: true,
    fallbackFrom: from,
    fallbackReason: error.kind,
  };
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>), ...note }
    : { ...note, response: raw };
}
/**
 * One retryable failure of `primary` re-issues the same request through
 * `secondary` (OpenRouter) exactly once; anything else is rethrown untouched.
 * The reservation, retention and metrics above the transport do not change,
 * and the retained raw response says the fallback was used, so a run whose
 * numbers came from the other vendor is never silently comparable to one that
 * did not fall back.
 */
export function withOpenRouterFallback(
  primary: ModelTransport,
  secondary: ModelTransport,
): ModelTransport {
  return {
    name: `${primary.name}+openrouter-fallback`,
    family: primary.family,
    describe: (model: string) => primary.describe(model),
    // Optional capabilities belong to the primary: a cache name is only
    // meaningful to the transport that created it, and a token count is a
    // count for the model the call will run on.
    ...(primary.createCache
      ? { createCache: primary.createCache.bind(primary) }
      : {}),
    ...(primary.deleteCache
      ? { deleteCache: primary.deleteCache.bind(primary) }
      : {}),
    ...(primary.countTokens
      ? { countTokens: primary.countTokens.bind(primary) }
      : {}),
    async call(request: ModelRequestData): Promise<ModelResponseData> {
      try {
        return await primary.call(request);
      } catch (error) {
        if (!fallbackWorthy(error)) throw error;
        // A request that reads the primary's context cache carries only the
        // cache name, not the transcript; the other vendor cannot serve it.
        if (request.cachedContent) throw error;
        const response = await secondary.call(request);
        return {
          ...response,
          raw: markFallback(response.raw, primary.name, error),
        };
      }
    },
  };
}
const openrouter = new OpenRouterTransport();
const googleNative = new GoogleNativeTransport();
// Neither constructor reads a key or opens a socket; both are shared instances.
const stock: Partial<Record<TransportKind, () => ModelTransport>> = {
  openrouter: () => openrouter,
  "google-native": () => googleNative,
};
let override: TransportFactory | null = null;
export function transportFor(stage: string, settings?: unknown): ModelTransport {
  const parsed = TransportSettings.parse(settings ?? {});
  if (override) return override(stage, parsed);
  const key = stageKey(stage);
  // teamPreferences() always fills transport.default (spec 6.2 defaults it to
  // google-native), so "openrouter" here is only for a caller that supplied
  // no settings at all: the transport that needs no per-stage configuration.
  const kind =
    (key ? parsed.models?.[key]?.transport : undefined) ??
    parsed.transport?.default ??
    "openrouter";
  const make = stock[kind];
  if (!make) throw Error(`Transport "${kind}" is not available yet.`);
  const chosen = make();
  return parsed.transport?.fallbackToOpenRouter === true && kind !== "openrouter"
    ? withOpenRouterFallback(chosen, openrouter)
    : chosen;
}
/** Test seam: route every stage through the given transport (or factory) until the returned function is called. */
export function injectTransport(
  transport: ModelTransport | TransportFactory | null,
): () => void {
  const previous = override;
  override =
    transport === null
      ? null
      : typeof transport === "function"
        ? transport
        : () => transport;
  return () => {
    override = previous;
  };
}
