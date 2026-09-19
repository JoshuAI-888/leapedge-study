import { z } from "zod";
import type { ModelDescription } from "./types.ts";
/**
 * Static, versioned price table for the native Google transport.
 *
 * Spec 4.1 drops OpenRouter's per-call catalogue download; describe() on the
 * native transport therefore reads this table and never touches the network.
 * Rates are US dollars per MILLION tokens as recorded on the date in
 * priceTableVersion: gemini-3.8-flash at US$0.75 in / US$3.75 out is the rate
 * recorded in spec 4.10 and already used by native-google-core.estimateUsd.
 * Cached input is the published 90% explicit-caching discount (spec 5).
 *
 * Nothing here is a billing reconciliation: the ledger settles on the usage
 * the provider reports, and an unknown model falls back to the deliberately
 * expensive default below so a reservation is never an under-estimate.
 */
export const priceTableVersion = "google-native-prices-2026-09-20";
export const ModelPrice = z.object({
  contextLength: z.number().positive(),
  inputPerMillion: z.number().nonnegative(),
  audioPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
  /** Input tokens served from an explicit context cache (spec 5: 90% off). */
  cachedInputPerMillion: z.number().nonnegative(),
  supportedEfforts: z.array(z.string()),
});
export type ModelPriceData = z.infer<typeof ModelPrice>;
const MILLION = 1e6;
const EFFORTS = ["minimal", "low", "medium", "high"];
export const priceTable: Record<string, ModelPriceData> = {
  "gemini-3.8-flash": {
    contextLength: 1048576,
    inputPerMillion: 0.75,
    audioPerMillion: 0.75,
    outputPerMillion: 3.75,
    cachedInputPerMillion: 0.075,
    supportedEfforts: EFFORTS,
  },
  "gemini-3.1-flash-lite": {
    contextLength: 1048576,
    inputPerMillion: 0.25,
    audioPerMillion: 0.5,
    outputPerMillion: 1.5,
    cachedInputPerMillion: 0.025,
    supportedEfforts: EFFORTS,
  },
  "gemini-3.1-pro-preview": {
    contextLength: 1048576,
    inputPerMillion: 1.25,
    audioPerMillion: 1.25,
    outputPerMillion: 10,
    cachedInputPerMillion: 0.125,
    supportedEfforts: EFFORTS,
  },
};
/** Used for any model the table does not name: the most expensive rates we know. */
export const defaultPrice: ModelPriceData = {
  contextLength: 1000000,
  inputPerMillion: 1.25,
  audioPerMillion: 1.25,
  outputPerMillion: 10,
  cachedInputPerMillion: 0.125,
  supportedEfforts: EFFORTS,
};
/** "google/gemini-3.8-flash" and "models/gemini-3.8-flash" name the same model. */
export function normaliseModel(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(google|models)\//, "");
}
export function priceFor(model: string): ModelPriceData {
  return priceTable[normaliseModel(model)] ?? defaultPrice;
}
export function isPriced(model: string) {
  return normaliseModel(model) in priceTable;
}
/** The ledger's view of a model: per-TOKEN rates, as the OpenRouter catalogue returns. */
export function describeFromPrices(model: string): ModelDescription {
  const price = priceFor(model);
  return {
    contextLength: price.contextLength,
    inputRate: price.inputPerMillion / MILLION,
    audioRate: price.audioPerMillion / MILLION,
    outputRate: price.outputPerMillion / MILLION,
    supportedEfforts: [...price.supportedEfforts],
  };
}
export type TokenCounts = {
  /** Prompt tokens billed at the text rate (cached and audio tokens excluded). */
  inputTokens: number;
  /** Prompt tokens served from an explicit cache. */
  cachedTokens?: number;
  /** Prompt tokens of audio or video modality. */
  audioTokens?: number;
  /** Candidate plus thought tokens; Google bills thoughts as output. */
  outputTokens: number;
};
export function costUsd(model: string, counts: TokenCounts): number {
  const price = priceFor(model);
  return (
    (Math.max(0, counts.inputTokens) * price.inputPerMillion +
      Math.max(0, counts.cachedTokens ?? 0) * price.cachedInputPerMillion +
      Math.max(0, counts.audioTokens ?? 0) * price.audioPerMillion +
      Math.max(0, counts.outputTokens) * price.outputPerMillion) /
    MILLION
  );
}
