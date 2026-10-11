import { z } from "zod";
import {
  TeamPreferences,
  AccountPreferences,
  teamDefaults,
} from "../../../features/youtube-intelligence/settings.ts";
import { getCheaperInferenceCatalog } from "../transport/cheaper-inference-catalog.ts";
import { assertCriticIndependent } from "../transport/index.ts";
import { modelFamily } from "../../../features/youtube-intelligence/model-family.ts";
import * as R from "../research-store.ts";
import { reads, writes, nothing, type ActionTable } from "./types.ts";
export const settings: ActionTable = {
  teamAccount: reads(nothing, async () => ({
    defaults: teamDefaults(),
    team: await R.teamPreferences(),
    account: await R.accountPreferences(),
    resolved: await R.resolvedAccountPreferences(),
  })),
  modelCatalog: reads(nothing, async () => {
    try {
      const catalog = await getCheaperInferenceCatalog();
      return {
        models: catalog.models.map(m => ({
          id: m.id, vendor: m.provider,
          inputUsdPerMillion: m.pricing.inputPerMillion,
          outputUsdPerMillion: m.pricing.outputPerMillion,
          cachedInputUsdPerMillion: m.pricing.cacheReadPerMillion,
          cacheWriteUsdPerMillion: m.pricing.cacheWritePerMillion,
          contextLength: m.contextLength, maxOutputTokens: m.maxOutputTokens,
          reasoning: m.capabilities.reasoning,
          inputTokenPriceThreshold: m.pricing.inputTokenPriceThreshold,
          aboveThreshold: m.pricing.aboveThreshold ? {
            inputUsdPerMillion: m.pricing.aboveThreshold.inputPerMillion,
            outputUsdPerMillion: m.pricing.aboveThreshold.outputPerMillion,
            cachedInputUsdPerMillion: m.pricing.aboveThreshold.cacheReadPerMillion,
            cacheWriteUsdPerMillion: m.pricing.aboveThreshold.cacheWritePerMillion,
          } : null,
        })),
        checkedAt: catalog.pricingCheckedAt, pricingVersion: catalog.pricingVersion, stale: false,
      };
    } catch {
      return { models: [], checkedAt: null, pricingVersion: null, stale: false,
        error: "Cheaper Inference prices are unavailable. Check the server API key and provider connection." };
    }
  }),
  saveTeam: writes(z.strictObject(TeamPreferences.shape), async (v) => {
    assertCriticIndependent(v);
    for (const [stage, model] of Object.entries(v.models))
      if (model.transport === "google-native" && modelFamily(model.id) !== "google")
        throw Error(`${stage}: Google requires a Google model. Choose another provider for ${model.id}.`);
    return R.saveTeamPreferences(v);
  }),
  saveAccount: writes(z.strictObject(AccountPreferences.shape), (v) =>
    R.saveAccountPreferences(v),
  ),
  current: reads(nothing, async () => ({ preferences: await R.preferences() })),
  preferences: writes(z.strictObject(R.Preferences.shape), (v) =>
    R.savePreferences(v),
  ),
  // "Use as new version" prefills the textarea with a snapshot prompt version,
  // which the registry has decorated with its own hash and created_at. Those
  // two are declared so the operator's paste is accepted, and dropped here so
  // nothing but a version reaches the store.
  prompt: writes(
    z.strictObject({
      ...R.PromptVersion.shape,
      hash: z.string().optional(),
      createdAt: z.string().optional(),
    }),
    ({ hash, createdAt, ...version }) => R.addPrompt(version),
  ),
};
