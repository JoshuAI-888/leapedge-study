import { z } from "zod";
import type { TeamPreferencesData } from "./settings.ts";
import { modelFamily } from "./model-family.ts";

export const ProviderCatalogModel = z.object({
  id: z.string().min(1),
  vendor: z.string(),
  inputUsdPerMillion: z.number().finite().nonnegative(),
  outputUsdPerMillion: z.number().finite().nonnegative(),
  cachedInputUsdPerMillion: z.number().finite().nonnegative().nullable(),
  contextLength: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().nullable(),
  reasoning: z.boolean(),
  cacheWriteUsdPerMillion: z.number().finite().nonnegative().nullable().optional(),
  inputTokenPriceThreshold: z.number().int().positive().nullable().optional(),
  aboveThreshold: z.object({
    inputUsdPerMillion: z.number().finite().nonnegative(),
    outputUsdPerMillion: z.number().finite().nonnegative(),
    cachedInputUsdPerMillion: z.number().finite().nonnegative().nullable(),
    cacheWriteUsdPerMillion: z.number().finite().nonnegative().nullable(),
  }).nullable().optional(),
});
export const ProviderCatalog = z.object({
  models: z.array(ProviderCatalogModel),
  checkedAt: z.iso.datetime().nullable(),
  pricingVersion: z.string().min(1).nullable(),
  stale: z.boolean(),
  error: z.string().optional(),
});
export type ProviderCatalogData = z.infer<typeof ProviderCatalog>;
export type ProviderCatalogModelData = z.infer<typeof ProviderCatalogModel>;
export type ProviderChoice = "google-native" | "openrouter" | "cheaper-inference";
export type ModelStage = keyof TeamPreferencesData["models"];
export const TEXT_MODEL_STAGES = ["extraction", "critique", "context", "translation"] as const;
export const MODEL_STAGES: { key: ModelStage; label: string; audio: boolean }[] = [
  { key: "extraction", label: "Extraction and synthesis", audio: false },
  { key: "critique", label: "Independent critique", audio: false },
  { key: "context", label: "Context check", audio: false },
  { key: "translation", label: "Translation", audio: false },
  { key: "transcription", label: "Audio transcription", audio: true },
  { key: "audioReview", label: "Audio review", audio: true },
];
// Verified aliases for the models this workspace currently uses. Unknown IDs
// remain explicit; guessing an identifier could silently select another model.
export function providerModelId(id: string, provider: ProviderChoice): string {
  const known = {
    "gemini-3.8-flash": { "google-native": "gemini-3.8-flash", openrouter: "google/gemini-3.8-flash", "cheaper-inference": "gemini-3.8-flash" },
    "gemini-3.1-flash-lite": { "google-native": "gemini-3.1-flash-lite", openrouter: "google/gemini-3.1-flash-lite", "cheaper-inference": "gemini-3.1-flash-lite" },
    "claude-sonnet-5": { "google-native": "claude-sonnet-5", openrouter: "anthropic/claude-sonnet-5", "cheaper-inference": "claude-sonnet-5" },
  };
  for (const aliases of Object.values(known))
    if (Object.values(aliases).includes(id)) return aliases[provider];
  return id;
}
export function changeStageProvider(
  value: TeamPreferencesData,
  stage: ModelStage,
  provider: ProviderChoice,
): TeamPreferencesData {
  if ((stage === "transcription" || stage === "audioReview") && provider === "cheaper-inference")
    throw new Error("Cheaper Inference is unavailable for audio stages.");
  const previous = value.models[stage];
  if (provider === "google-native" && modelFamily(previous.id) !== "google")
    throw new Error("Google requires a Google model; select a compatible model first.");
  return {
    ...value,
    models: { ...value.models, [stage]: { ...previous, id: providerModelId(previous.id, provider), transport: provider } },
  } as TeamPreferencesData;
}
export function changeTextProvider(value: TeamPreferencesData, provider: ProviderChoice): TeamPreferencesData {
  const next = TEXT_MODEL_STAGES.reduce((current, stage) => changeStageProvider(current, stage, provider), value);
  return { ...next, transport: { ...next.transport, default: provider } } as TeamPreferencesData;
}
export function filterCatalogModels(models: ProviderCatalogModelData[], search: string) {
  const query = search.trim().toLocaleLowerCase();
  return models.filter(model => `${model.id} ${model.vendor}`.toLocaleLowerCase().includes(query));
}
export function formatTokenPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price < 0) return "Unavailable";
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(price)}`;
}
/** A stated example, not a bill: 10,000 uncached input and 1,000 output tokens. */
export function illustrativeTextCost(model: ProviderCatalogModelData | undefined): number | null {
  return model ? (10000 * model.inputUsdPerMillion + 1000 * model.outputUsdPerMillion) / 1000000 : null;
}

/** Immediate feedback; the server remains the authoritative save boundary. */
export function modelSettingsErrors(value: TeamPreferencesData): string[] {
  const errors: string[] = [];
  for (const stage of MODEL_STAGES) {
    const selection = value.models[stage.key];
    if (selection.transport === "google-native" && modelFamily(selection.id) !== "google")
      errors.push(`${stage.label}: choose a Google model for the Google provider.`);
    if (stage.audio && selection.transport === "cheaper-inference")
      errors.push(`${stage.label}: choose Google for audio.`);
  }
  if (value.models.critique.requireDifferentFamily &&
      modelFamily(value.models.extraction.id) === modelFamily(value.models.critique.id))
    errors.push("Independent critique must use a different model family from extraction.");
  return errors;
}

/** Verified pre-switch rates, not a live quote from these other providers. */
const PRE_SWITCH_PRICE_REFERENCE = {
  "gemini-3.8-flash": {
    provider: "Google", modelId: "gemini-3.8-flash",
    inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75,
  },
  "claude-sonnet-5": {
    provider: "OpenRouter", modelId: "anthropic/claude-sonnet-5",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10,
  },
  "gemini-3.1-flash-lite": {
    provider: "Google", modelId: "gemini-3.1-flash-lite",
    inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5,
  },
} as const;

/** Compare exactly the same noncached 10k-input/1k-output example. */
export function referenceCostComparison(model: ProviderCatalogModelData | undefined) {
  if (!model) return null;
  const canonical = providerModelId(model.id, "cheaper-inference");
  if (!Object.hasOwn(PRE_SWITCH_PRICE_REFERENCE, canonical)) return null;
  const reference = PRE_SWITCH_PRICE_REFERENCE[canonical as keyof typeof PRE_SWITCH_PRICE_REFERENCE];
  const referenceCostUsd = (10000 * reference.inputUsdPerMillion + 1000 * reference.outputUsdPerMillion) / 1000000;
  const cheaperInferenceCostUsd = illustrativeTextCost(model)!;
  return {
    referenceProvider: reference.provider,
    referenceModelId: reference.modelId,
    referenceCheckedAt: "2026-10-11",
    pricingVersion: "pre-switch-reference-2026-10-11",
    referenceCostUsd,
    cheaperInferenceCostUsd,
    savingsPercent: (referenceCostUsd - cheaperInferenceCostUsd) / referenceCostUsd * 100,
  };
}
