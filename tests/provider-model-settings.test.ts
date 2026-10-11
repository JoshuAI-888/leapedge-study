import { test } from "node:test";
import assert from "node:assert/strict";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import {
  ProviderCatalog,
  modelSettingsErrors,
  changeStageProvider,
  changeTextProvider,
  filterCatalogModels,
  formatTokenPrice,
  illustrativeTextCost,
  referenceCostComparison,
} from "../src/features/youtube-intelligence/provider-model-settings.ts";

const model = {
  id: "gemini-3.8-flash", vendor: "Google", inputUsdPerMillion: 0.4875,
  outputUsdPerMillion: 2.4375, cachedInputUsdPerMillion: 0.04875,
  contextLength: 1048576, maxOutputTokens: 65535, reasoning: true,
};

test("switching text providers preserves the current models and independent critic controls", () => {
  const initial = teamDefaults();
  initial.models.critique.id = "anthropic/claude-sonnet-5";
  initial.models.critique.transport = "openrouter";
  const next = changeTextProvider(initial, "cheaper-inference");
  assert.equal(next.transport.default, "cheaper-inference");
  assert.equal(next.models.extraction.id, "gemini-3.8-flash");
  assert.equal(next.models.critique.id, "claude-sonnet-5");
  assert.equal(next.models.context.id, "claude-sonnet-5");
  assert.equal(next.models.translation.id, "gemini-3.1-flash-lite");
  assert.equal(next.models.critique.requireDifferentFamily, true);
  assert.equal(next.models.critique.thinkingBudget, "low");
  assert.deepEqual(next.models.transcription, initial.models.transcription);
  assert.deepEqual(next.models.audioReview, initial.models.audioReview);
  assert.equal(initial.models.critique.id, "anthropic/claude-sonnet-5");
  assert.equal(changeStageProvider(next, "critique", "openrouter").models.critique.id, "anthropic/claude-sonnet-5");
});

test("audio stages reject the text gateway and unknown model identifiers are preserved", () => {
  const initial = teamDefaults();
  assert.throws(() => changeStageProvider(initial, "transcription", "cheaper-inference"), /audio/i);
  assert.throws(() => changeStageProvider(initial, "audioReview", "cheaper-inference"), /audio/i);
  initial.models.context.id = "seller/custom-model";
  assert.equal(changeStageProvider(initial, "context", "cheaper-inference").models.context.id, "seller/custom-model");
});

test("the model catalog is searchable by model and vendor without mutating prices", () => {
  const rows = [model, { ...model, id: "claude-sonnet-5", vendor: "Anthropic" }];
  assert.deepEqual(filterCatalogModels(rows, " anthropic ").map(row => row.id), ["claude-sonnet-5"]);
  assert.deepEqual(filterCatalogModels(rows, "FLASH").map(row => row.id), ["gemini-3.8-flash"]);
  assert.equal(filterCatalogModels(rows, "not present").length, 0);
  assert.equal(rows.length, 2);
});

test("prices preserve small dollar amounts and illustrative cost states unknown pricing", () => {
  assert.equal(formatTokenPrice(0.04875), "$0.04875");
  assert.equal(formatTokenPrice(0.00001), "$0.00001");
  assert.equal(formatTokenPrice(null), "Unavailable");
  assert.equal(formatTokenPrice(Number.NaN), "Unavailable");
  assert.equal(illustrativeTextCost(undefined), null);
  assert.ok(Math.abs(illustrativeTextCost(model)! - 0.0073125) < 1e-12);
});

test("catalog boundary rejects malformed prices instead of displaying them as free", () => {
  const input = { models: [model], checkedAt: "2026-10-11T06:52:53.784Z", pricingVersion: "v1", stale: false };
  assert.equal(ProviderCatalog.parse(input).models[0].cachedInputUsdPerMillion, 0.04875);
  assert.equal(ProviderCatalog.safeParse({ ...input, models: [{ ...model, inputUsdPerMillion: -1 }] }).success, false);
  assert.equal(ProviderCatalog.safeParse({ ...input, models: [{ ...model, inputUsdPerMillion: undefined }] }).success, false);
  assert.equal(ProviderCatalog.safeParse({ ...input, checkedAt: "invalid date" }).success, false);
  const unavailable = ProviderCatalog.parse({ models: [], checkedAt: null, pricingVersion: null, stale: false, error: "Prices unavailable" });
  assert.equal(unavailable.error, "Prices unavailable");
  assert.equal(ProviderCatalog.parse({ ...input, models: [{ ...model, maxOutputTokens: null }] }).models[0].maxOutputTokens, null);
});

test("incompatible native models and dependent critics cannot be saved from Settings", () => {
  const value = teamDefaults();
  assert.throws(() => changeTextProvider(value, "google-native"), /Google requires/);
  value.models.context = { id: "claude-sonnet-5", transport: "google-native" };
  value.models.critique.id = value.models.extraction.id;
  assert.deepEqual(modelSettingsErrors(value), [
    "Context check: choose a Google model for the Google provider.",
    "Independent critique must use a different model family from extraction.",
  ]);
});

test("text provider changes preserve the chosen speed and cost ranking", () => {
  const value = teamDefaults();
  assert.equal(value.transport.cheaperInferenceRanking, "balance");
  value.transport.cheaperInferenceRanking = "speed";
  const changed = changeTextProvider(value, "openrouter");
  assert.equal(changed.transport.cheaperInferenceRanking, "speed");
  assert.equal(changeTextProvider(changed, "cheaper-inference").transport.cheaperInferenceRanking, "speed");
});

test("the known Gemini and Claude models compare the same token example against verified reference prices", () => {
  const gemini = referenceCostComparison(model)!;
  assert.equal(gemini.referenceProvider, "Google");
  assert.equal(gemini.referenceCheckedAt, "2026-10-11");
  assert.ok(Math.abs(gemini.referenceCostUsd - 0.01125) < 1e-12);
  assert.ok(Math.abs(gemini.cheaperInferenceCostUsd - 0.0073125) < 1e-12);
  assert.ok(Math.abs(gemini.savingsPercent - 35) < 1e-10);
  const claude = referenceCostComparison({ ...model, id: "claude-sonnet-5", inputUsdPerMillion: 1.3, outputUsdPerMillion: 6.5 })!;
  assert.equal(claude.referenceProvider, "OpenRouter");
  assert.equal(claude.referenceModelId, "anthropic/claude-sonnet-5");
  assert.equal(claude.referenceCostUsd, 0.03);
  assert.ok(Math.abs(claude.savingsPercent - 35) < 1e-10);
  const lite = referenceCostComparison({ ...model, id: "gemini-3.1-flash-lite", inputUsdPerMillion: 0.1625, outputUsdPerMillion: 0.975 })!;
  assert.equal(lite.referenceCostUsd, 0.004);
  assert.ok(Math.abs(lite.savingsPercent - 35) < 1e-10);
});

test("unknown models get no invented comparison and higher prices produce negative savings", () => {
  assert.equal(referenceCostComparison(undefined), null);
  assert.equal(referenceCostComparison({ ...model, id: "gemini-3.8-flash-preview" }), null);
  const expensive = referenceCostComparison({ ...model, inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 })!;
  assert.equal(expensive.savingsPercent, -100);
});
