import { createHash } from "node:crypto";
import { z } from "zod";
import { TransportError, classifyStatus } from "./types.ts";

const CATALOG_URL = "https://api.cheaperinference.com/v1/models";
const Amount = z.union([
  z.number().finite().nonnegative(),
  z.string().regex(/^(?:\d+(?:\.\d*)?|\.\d+)$/).transform(Number).pipe(z.number().finite().nonnegative()),
]);
const Scope = z.object({
  model: z.string(), protocol: z.string(), serviceTier: z.string(),
  pricingVariant: z.string(), region: z.string().nullable(), zdr: z.boolean(),
});
const Tier = z.object({
  rates: z.record(z.string(), Amount),
  minContext: z.number().nonnegative(), maxContext: z.number().positive().nullable(),
});
const ThresholdPrice = z.object({
  input_per_million: Amount, output_per_million: Amount,
  cache_read_input_per_million: Amount.nullish(), cache_write_input_per_million: Amount.nullish(),
  list_input_per_million: Amount.nullish(), list_output_per_million: Amount.nullish(),
  list_cache_read_input_per_million: Amount.nullish(), list_cache_write_input_per_million: Amount.nullish(),
});
const Price = z.object({
  currency: z.literal("USD"), input_per_million: Amount, output_per_million: Amount,
  cache_read_input_per_million: Amount.nullish(), cache_write_input_per_million: Amount.nullish(),
  list_input_per_million: Amount.nullish(), list_output_per_million: Amount.nullish(),
  discount_percent: Amount.nullish(), input_token_price_threshold: z.number().nonnegative().nullish(),
  above_threshold: ThresholdPrice.nullish(), default_scope: Scope.nullish(),
  scopes: z.array(z.object({ scope: Scope, tiers: z.array(Tier), makerTiers: z.array(Tier) })).optional(),
});
const Entry = z.object({
  id: z.string().min(1), provider: z.string().optional(), owned_by: z.string().optional(),
  type: z.string(), context_length: z.number().int().positive(), max_output_tokens: z.number().int().positive().nullable(),
  supported_endpoints: z.array(z.string()),
  capabilities: z.object({ vision: z.boolean(), video: z.boolean(), reasoning: z.boolean(), streaming: z.boolean() }),
  pricing: Price,
});
const Catalog = z.object({
  // Media rows have different price and limit schemas; validate their routing envelope,
  // then validate all fields of the compatible text rows separately.
  data: z.array(z.looseObject({ id: z.string().min(1), type: z.string(), supported_endpoints: z.array(z.string()) })), pricing_version: z.string().min(1),
  pricing_checked_at: z.iso.datetime({ offset: true }), pricing_updated_at: z.iso.datetime({ offset: true }),
});
type CatalogEntry = z.infer<typeof Entry>;
/** Only these migrations have been verified against the live catalog. */
const VERIFIED_ALIASES: Record<string, string> = {
  "anthropic/claude-sonnet-5": "claude-sonnet-5",
  "google/gemini-3.8-flash": "gemini-3.8-flash",
  "google/gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
};
export function cheaperInferenceModelId(model: string) { return VERIFIED_ALIASES[model] ?? model; }

function sameScope(a: z.infer<typeof Scope>, b: z.infer<typeof Scope>) {
  return a.model === b.model && a.protocol === b.protocol && a.serviceTier === b.serviceTier &&
    a.pricingVariant === b.pricingVariant && a.region === b.region && a.zdr === b.zdr;
}
/** Fallback routes can reach direct list price; never reserve just the cheapest advertised route. */
function reservationRates(entry: CatalogEntry) {
  const p = entry.pricing;
  if (p.list_input_per_million == null || p.list_output_per_million == null)
    return { input: null, output: null };
  const input = [p.list_input_per_million / 1e6];
  const output = [p.list_output_per_million / 1e6];
  if (p.above_threshold) {
    const a = p.above_threshold;
    if (a.list_input_per_million == null || a.list_output_per_million == null)
      return { input: null, output: null };
    input.push(a.list_input_per_million / 1e6, (a.list_cache_write_input_per_million ?? a.list_input_per_million) / 1e6);
    output.push(a.list_output_per_million / 1e6);
  }
  const defaultScope = p.default_scope;
  if (defaultScope && (defaultScope.protocol !== "chat_completions" || defaultScope.serviceTier !== "standard" || defaultScope.model !== entry.id))
    return { input: null, output: null };
  const scope = defaultScope ? p.scopes?.find((s) => sameScope(s.scope, defaultScope)) : undefined;
  if (scope) {
    if (!scope.makerTiers.length) return { input: null, output: null };
    for (const tier of scope.makerTiers) {
      if (tier.rates.input_tokens == null || tier.rates.output_tokens == null)
        return { input: null, output: null };
      for (const [kind, rate] of Object.entries(tier.rates)) {
        if (kind === "input_tokens" || kind.startsWith("cache_")) input.push(rate);
        if (kind === "output_tokens") output.push(rate);
      }
    }
  } else {
    // Missing scope metadata cannot prove a ceiling for cache writes or tiered pricing.
    if (p.default_scope || p.above_threshold || (p.cache_write_input_per_million ?? 0) > p.input_per_million)
      return { input: null, output: null };
  }
  return { input: Math.max(...input), output: Math.max(...output) };
}
/** The returned object is safe for Settings; raw provider metadata and credentials are excluded. */
export function parseCheaperInferenceCatalog(data: unknown, fetchedAt = Date.now()) {
  const parsed = Catalog.safeParse(data);
  if (!parsed.success) throw new TransportError("unknown", "Cheaper Inference catalog had an unexpected shape or invalid prices.");
  const c = parsed.data;
  const ids = new Set<string>();
  const models = c.data.filter((m) => m.type === "text" && m.supported_endpoints.includes("/v1/chat/completions")).map((raw) => {
    const result = Entry.safeParse(raw);
    if (!result.success) throw new TransportError("unknown", "Cheaper Inference catalog had an unexpected shape or invalid prices.");
    const m = result.data;
    if (ids.has(m.id)) throw new TransportError("unknown", "Cheaper Inference catalog contained duplicate model IDs.");
    ids.add(m.id);
    const p = m.pricing, rates = reservationRates(m), a = p.above_threshold;
    return {
      id: m.id, provider: m.provider ?? m.owned_by ?? "Unknown", contextLength: m.context_length,
      maxOutputTokens: m.max_output_tokens, capabilities: m.capabilities,
      pricing: {
        inputPerMillion: p.input_per_million, outputPerMillion: p.output_per_million,
        cacheReadPerMillion: p.cache_read_input_per_million ?? null, cacheWritePerMillion: p.cache_write_input_per_million ?? null,
        listInputPerMillion: p.list_input_per_million ?? null, listOutputPerMillion: p.list_output_per_million ?? null,
        discountPercent: p.discount_percent ?? null, inputTokenPriceThreshold: p.input_token_price_threshold ?? null,
        aboveThreshold: a ? { inputPerMillion: a.input_per_million, outputPerMillion: a.output_per_million,
          cacheReadPerMillion: a.cache_read_input_per_million ?? null, cacheWritePerMillion: a.cache_write_input_per_million ?? null,
          listInputPerMillion: a.list_input_per_million ?? null, listOutputPerMillion: a.list_output_per_million ?? null } : null,
      },
      reservationInputRate: rates.input, reservationOutputRate: rates.output,
    };
  });
  return { models, pricingVersion: c.pricing_version, pricingCheckedAt: c.pricing_checked_at, pricingUpdatedAt: c.pricing_updated_at, fetchedAt };
}
export type CheaperInferenceCatalog = ReturnType<typeof parseCheaperInferenceCatalog>;
export type CheaperInferenceCatalogModel = CheaperInferenceCatalog["models"][number];
export type CheaperInferenceCatalogOptions = { apiKey?: string; timeoutMs?: number; ttlMs?: number; now?: () => number; forceRefresh?: boolean };
const cache = new Map<string, CheaperInferenceCatalog>();
const pending = new Map<string, Promise<CheaperInferenceCatalog>>();
export function clearCheaperInferenceCatalogCache() { cache.clear(); pending.clear(); }
export function cheaperInferenceKey(apiKey?: string) {
  const key = apiKey ?? process.env.CHEAPER_INFERENCE_API_KEY;
  if (!key) throw Error("CHEAPER_INFERENCE_API_KEY is not configured.");
  return key;
}
export async function getCheaperInferenceCatalog(options: CheaperInferenceCatalogOptions = {}): Promise<CheaperInferenceCatalog> {
  const key = cheaperInferenceKey(options.apiKey);
  const cacheKey = createHash("sha256").update(key).digest("hex");
  const now = options.now ?? Date.now;
  const ttlMs = z.number().int().min(0).max(300_000).parse(options.ttlMs ?? 60_000);
  const current = cache.get(cacheKey);
  if (!options.forceRefresh && current && now() >= current.fetchedAt && now() - current.fetchedAt < ttlMs)
    return structuredClone(current);
  const running = pending.get(cacheKey);
  if (running) return structuredClone(await running);
  const refresh = (async () => {
    let response: Response;
    try {
      response = await fetch(CATALOG_URL, {
        headers: { Authorization: `Bearer ${key}` }, cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch {
      throw new TransportError("unknown", "Cheaper Inference catalog could not be fetched.");
    }
    if (!response.ok) throw new TransportError(classifyStatus(response.status), `Cheaper Inference catalog HTTP ${response.status}.`, response.status);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new TransportError("unknown", "Cheaper Inference catalog had an unexpected shape."); }
    const result = parseCheaperInferenceCatalog(raw, now());
    cache.set(cacheKey, result);
    // Workspace keys can change; bound the process-local cache independently of TTL.
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return result;
  })();
  pending.set(cacheKey, refresh);
  try { return structuredClone(await refresh); } finally { if (pending.get(cacheKey) === refresh) pending.delete(cacheKey); }
}
