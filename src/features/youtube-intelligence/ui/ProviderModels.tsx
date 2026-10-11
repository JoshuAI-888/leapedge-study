"use client";
import { useCallback, useEffect, useState } from "react";
import type { TeamPreferencesData } from "../settings.ts";
import {
  MODEL_STAGES,
  TEXT_MODEL_STAGES,
  modelSettingsErrors,
  ProviderCatalog,
  changeStageProvider,
  changeTextProvider,
  filterCatalogModels,
  formatTokenPrice,
  illustrativeTextCost,
  referenceCostComparison,
  providerModelId,
  type ModelStage,
  type ProviderCatalogData,
  type ProviderChoice,
} from "../provider-model-settings.ts";
import { action } from "./api.ts";
import { modelFamily } from "../model-family.ts";

const providers: { value: ProviderChoice; label: string }[] = [
  { value: "cheaper-inference", label: "Cheaper Inference" },
  { value: "google-native", label: "Google" },
  { value: "openrouter", label: "OpenRouter" },
];

export function ProviderModels({ value, onChange, disabled }: {
  value: TeamPreferencesData;
  onChange: (next: TeamPreferencesData) => void;
  disabled: boolean;
}) {
  const [catalog, setCatalog] = useState<ProviderCatalogData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<Partial<Record<ModelStage, string>>>({});
  const [catalogSearch, setCatalogSearch] = useState("");
  const [bulkProvider, setBulkProvider] = useState<ProviderChoice>("cheaper-inference");
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await action("settings", "modelCatalog");
      const parsed = ProviderCatalog.parse(response);
      setCatalog(parsed);
      setError(parsed.error ?? null);
    } catch (cause) {
      setCatalog(previous => previous ? { ...previous, stale: true } : null);
      setError(cause instanceof Error ? cause.message : "Model prices could not be loaded.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  const errors = modelSettingsErrors(value);
  const ranking = value.transport.cheaperInferenceRanking ?? "balance";
  const googleForAll = TEXT_MODEL_STAGES.every(stage => modelFamily(value.models[stage].id) === "google");
  const updateModel = (stage: ModelStage, id: string) => onChange({
    ...value, models: { ...value.models, [stage]: { ...value.models[stage], id } },
  });
  return (
    <fieldset className="yi-panel" id="settings-providers" style={{ scrollMarginTop: 90 }}>
      <legend>Providers and models</legend>
      <p className="yi-muted">
        Choose the provider and model for each stage. Save team configuration to apply
        changes to newly queued analyses. Audio stays on Google; Jev has its own settings.
      </p>
      <div className="yi-settings-fields">
        <label>
          Apply one provider to all text stages
          <select value={bulkProvider} disabled={disabled} onChange={e => setBulkProvider(e.target.value as ProviderChoice)}>
            {providers.map(provider => <option key={provider.value} value={provider.value}
              disabled={provider.value === "google-native" && !googleForAll}>{provider.label}{provider.value === "google-native" && !googleForAll ? " — requires Google models in all text stages" : ""}</option>)}
          </select>
        </label>
        <div className="yi-row" style={{ alignSelf: "end" }}>
          <button type="button" className="yi-secondary" disabled={disabled || bulkProvider === "google-native" && !googleForAll}
            onClick={() => onChange(changeTextProvider(value, bulkProvider))}>Apply provider, keep models</button>
        </div>
      </div>
      <div className="yi-settings-fields">
        <label>
          Cheaper Inference routing preference
          <select value={ranking} disabled={disabled}
            aria-describedby="yi-inference-ranking-description"
            onChange={e => onChange({ ...value, transport: { ...value.transport,
              cheaperInferenceRanking: e.target.value as "balance" | "discount" | "speed",
            } })}>
            <option value="balance">Balance speed and cost (default)</option>
            <option value="discount">Lowest price</option>
            <option value="speed">Fastest</option>
          </select>
        </label>
      </div>
      <p id="yi-inference-ranking-description" className="yi-muted">
        {ranking === "discount" ? "Lowest price prioritizes the cheapest eligible route and can take longer. " :
          ranking === "speed" ? "Fastest prioritizes quicker eligible routes and may cost more. " :
          "Balance considers both route speed and cost. "}
        The selected model stays the same. Catalog prices are estimates; route prices
        can vary, and the actual billed charge is recorded with each call.
      </p>
      <p className="yi-muted">Current default: {providers.find(provider => provider.value === value.transport.default)?.label ?? value.transport.default}. Individual stages below can override it.</p>
      <div className="yi-row">
        <button type="button" className="yi-text-button" disabled={loading} onClick={() => void loadCatalog()}>
          {loading ? "Loading model prices…" : "Refresh model prices"}
        </button>
        {catalog?.checkedAt && <small>Prices checked {new Date(catalog.checkedAt).toLocaleString()}.</small>}
      </div>
      {errors.length > 0 && <div className="yi-warning" role="alert">{errors.map(message => <p key={message}>{message}</p>)}</div>}
      {error && <p className="yi-warning" role="alert">{error} Existing model choices are retained.</p>}
      {catalog?.stale && <p className="yi-warning" role="status">These are previously checked prices. Refresh before estimating costs; current route prices may differ.</p>}
      <div className="yi-settings-fields">
        {MODEL_STAGES.map(({ key, label, audio }) => {
          const selection = value.models[key];
          const cheaper = selection.transport === "cheaper-inference";
          const canonical = providerModelId(selection.id, "cheaper-inference");
          const selected = catalog?.models.find(model => model.id === canonical);
          const comparison = referenceCostComparison(selected);
          const filtered = filterCatalogModels(catalog?.models ?? [], search[key] ?? "");
          const options = selected && !filtered.some(model => model.id === selected.id) ? [selected, ...filtered] : filtered;
          return (
            <fieldset key={key}>
              <legend>{label}</legend>
              <div className="yi-settings-fields">
                <label>
                  {label} provider
                  <select value={selection.transport} disabled={disabled || audio}
                    onChange={e => onChange(changeStageProvider(value, key, e.target.value as ProviderChoice))}>
                    {(audio ? providers.filter(provider => provider.value === "google-native" || provider.value === selection.transport && provider.value !== "cheaper-inference") : providers)
                      .map(provider => <option key={provider.value} value={provider.value}
                        disabled={provider.value === "google-native" && modelFamily(selection.id) !== "google"}>{provider.label}</option>)}
                  </select>
                  {audio && <small>Google handles audio and transcription timestamps.</small>}
                </label>
                <label>
                  {label} model
                  {cheaper && catalog ? (
                    <select value={canonical} required disabled={disabled} onChange={e => updateModel(key, e.target.value)}>
                      {!selected && <option value={canonical}>{selection.id} — unavailable in current catalog</option>}
                      {options.map(model => <option key={model.id} value={model.id} disabled={model.maxOutputTokens === null}>{model.id}{model.maxOutputTokens === null ? " — output limit unknown; unavailable" : ""} — {formatTokenPrice(model.inputUsdPerMillion)} in / {formatTokenPrice(model.outputUsdPerMillion)} out</option>)}
                    </select>
                  ) : (
                    <input value={selection.id} required disabled={disabled} autoComplete="off" spellCheck={false}
                      onChange={e => updateModel(key, e.target.value)} />
                  )}
                </label>
                {cheaper && catalog && <label>
                  Search {label.toLowerCase()} models
                  <input type="search" value={search[key] ?? ""} disabled={disabled}
                    placeholder="Model name or vendor" onChange={e => setSearch({ ...search, [key]: e.target.value })} />
                  <small>{filtered.length} matching models.</small>
                </label>}
                {key === "critique" && <label>
                  Critic reasoning budget
                  <select value={value.models.critique.thinkingBudget} disabled={disabled}
                    onChange={e => onChange({ ...value, models: { ...value.models, critique: { ...value.models.critique, thinkingBudget: e.target.value as "low" | "medium" | "high" } } })}>
                    {["low", "medium", "high"].map(budget => <option key={budget}>{budget}</option>)}
                  </select>
                  <small>Critique must use a different model family from extraction.</small>
                </label>}
              </div>
              {cheaper && selected?.maxOutputTokens === null && <p className="yi-warning">This model has no verified output limit and cannot be used until the catalog supplies one. Choose another model.</p>}
              {cheaper ? selected ? (
                <div aria-live="polite">
                  <p>USD per million tokens: input <strong>{formatTokenPrice(selected.inputUsdPerMillion)}</strong>; output <strong>{formatTokenPrice(selected.outputUsdPerMillion)}</strong>; cached input <strong>{formatTokenPrice(selected.cachedInputUsdPerMillion)}</strong>.</p>
                  {selected.cacheWriteUsdPerMillion != null && <p className="yi-muted">Cache write: {formatTokenPrice(selected.cacheWriteUsdPerMillion)} per million tokens.</p>}
                  {selected.inputTokenPriceThreshold && selected.aboveThreshold && <p className="yi-muted">Above {selected.inputTokenPriceThreshold.toLocaleString()} input tokens: input {formatTokenPrice(selected.aboveThreshold.inputUsdPerMillion)} / output {formatTokenPrice(selected.aboveThreshold.outputUsdPerMillion)} / cached input {formatTokenPrice(selected.aboveThreshold.cachedInputUsdPerMillion)} / cache write {formatTokenPrice(selected.aboveThreshold.cacheWriteUsdPerMillion)} per million tokens.</p>}
                  <p className="yi-muted">Context limit: {selected.contextLength.toLocaleString()} tokens · Output limit: {selected.maxOutputTokens?.toLocaleString() ?? "Unknown"} tokens · {selected.reasoning ? "Reasoning supported" : "No reasoning advertised"}.</p>
                  <p className="yi-muted">Example: 10,000 input + 1,000 output tokens ≈ <strong>{formatTokenPrice(illustrativeTextCost(selected))}</strong>. Assumes uncached text; extra reasoning, route tiers and long-context pricing may change the bill.</p>
                  {comparison && <p className="yi-muted">
                    The same example at the {comparison.referenceProvider} reference rates costs <strong>{formatTokenPrice(comparison.referenceCostUsd)}</strong>.
                    {" "}<strong>{new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Math.abs(comparison.savingsPercent))}%
                    {comparison.savingsPercent >= 0 ? " lower" : " higher"}</strong> estimated token cost through Cheaper Inference.
                    {" "}Reference rates were verified on 11 October 2026; this is a pre-switch estimate, not a live quote from {comparison.referenceProvider}.
                  </p>}
                </div>
              ) : <p className="yi-muted">{loading ? "Loading prices…" : "Pricing unavailable for this model. Cost is unknown."}</p>
                : <p className="yi-muted">This provider bills separately. The Cheaper Inference price list below applies only to its routes.</p>}
            </fieldset>
          );
        })}
      </div>
      <details>
        <summary>All Cheaper Inference models and prices{catalog ? ` (${catalog.models.length})` : ""}</summary>
        <p className="yi-muted">USD per million tokens for the catalog's default text tier. These are estimates; the settled charge is recorded with each call.</p>
        <label>Search the price list
          <input type="search" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Model name or vendor" />
        </label>
        {catalog && catalog.models.length > 0 ? <div style={{ overflowX: "auto" }}>
          <table>
            <caption>Cheaper Inference text model prices</caption>
            <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached input</th><th>Cache write</th><th>Context</th><th>Max output</th></tr></thead>
            <tbody>{filterCatalogModels(catalog.models, catalogSearch).map(model => <tr key={model.id}>
              <td style={{ overflowWrap: "anywhere" }}>{model.id}<br /><small>{model.vendor}</small></td>
              <td>{formatTokenPrice(model.inputUsdPerMillion)}{model.aboveThreshold && <><br /><small>{formatTokenPrice(model.aboveThreshold.inputUsdPerMillion)} above {model.inputTokenPriceThreshold?.toLocaleString()} input tokens</small></>}</td><td>{formatTokenPrice(model.outputUsdPerMillion)}{model.aboveThreshold && <><br /><small>{formatTokenPrice(model.aboveThreshold.outputUsdPerMillion)} above threshold</small></>}</td>
              <td>{formatTokenPrice(model.cachedInputUsdPerMillion)}{model.aboveThreshold && <><br /><small>{formatTokenPrice(model.aboveThreshold.cachedInputUsdPerMillion)} above threshold</small></>}</td><td>{formatTokenPrice(model.cacheWriteUsdPerMillion)}{model.aboveThreshold && <><br /><small>{formatTokenPrice(model.aboveThreshold.cacheWriteUsdPerMillion)} above threshold</small></>}</td><td>{model.contextLength.toLocaleString()}</td><td>{model.maxOutputTokens?.toLocaleString() ?? "Unknown"}</td>
            </tr>)}</tbody>
          </table>
          {filterCatalogModels(catalog.models, catalogSearch).length === 0 && <p>No models match this search.</p>}
        </div> : <p className="yi-muted">{loading ? "Loading catalog…" : "Model catalog unavailable. Refresh to try again."}</p>}
      </details>
      <details>
        <summary>Other provider controls</summary>
        <label className="yi-checkbox"><input type="checkbox" disabled={disabled}
          checked={value.transport.fallbackToOpenRouter}
          onChange={e => onChange({ ...value, transport: { ...value.transport, fallbackToOpenRouter: e.target.checked } })} />Allow Google errors to fall back to OpenRouter</label>
        <p className="yi-muted">This does not enable fallback from Cheaper Inference.</p>
        <label className="yi-checkbox"><input type="checkbox" disabled={disabled}
          checked={value.transport.allowOpenRouterInLab}
          onChange={e => onChange({ ...value, transport: { ...value.transport, allowOpenRouterInLab: e.target.checked } })} />Allow OpenRouter in Lab</label>
      </details>
    </fieldset>
  );
}
