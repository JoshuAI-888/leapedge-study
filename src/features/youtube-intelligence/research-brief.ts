import { financialBasisIssue, semanticBasisIssues } from "./semantic-basis.ts";
import {mixedTurnAttribution} from './research-attribution.ts';
import {sourceNumericCheck, numericalSentenceDisposition} from './research-numeric-check.ts';
import { EvidenceCoverage } from "./research-readiness.ts";
import { z } from "zod";
import { stockSplitDirectionCheck, explicitPercentagePointConflict, explicitRateQuantities, explicitBasisPointProseConflict } from "./source-quantity-checks.ts";
import type { Run, CheckedClaim, SourceData } from "./contracts.ts";
export const RESEARCH_VERSION = "research-brief.v1";
export const AnalysisContext = z.object({
  videoPublishedAt: z.iso.datetime().nullable(),
  recordedAt: z.iso.datetime().nullable(),
  analysedAt: z.iso.datetime(),
  language: z.string().nullable(),
  videoId: z.string(),
  channelId: z.string().nullable().default(null),
  temporalPolicy: z.literal(
    "video-date evidence and later updates are separate",
  ),
});
export type AnalysisContextData = z.infer<typeof AnalysisContext>;
const date = (x: unknown) => {
  const d = z.iso.datetime().safeParse(x);
  return d.success ? d.data : null;
};
export function analysisContext(run: Run): AnalysisContextData {
  const m = run.output.metadata as Record<string, unknown> | undefined;
  return AnalysisContext.parse({
    videoPublishedAt: date(m?.publishedAt),
    recordedAt: date(m?.recordedAt),
    analysedAt: run.createdAt,
    language: m?.language ?? null,
    videoId: run.videoId,
    channelId: typeof m?.channelId === "string" ? m.channelId : null,
    temporalPolicy: "video-date evidence and later updates are separate",
  });
}
export function extractionContext(run: Run, chunk: SourceData["segments"]) {
  const source = (run.output.source as SourceData).segments;
  const start = source.findIndex((s) => s.id === chunk[0]?.id);
  const previousSection = source.slice(
    Math.max(0, start - 40),
    Math.max(0, start),
  );
  return {
    analysisContext: analysisContext(run),
    previousSection,
    instructions:
      "Previous section is context for attribution and conditions. Cite original IDs. Do not turn publication time into recording time. Preserve relative dates if recording time is unknown.",
  };
}
export const EvidenceRecord = z.object({
  id: z.string(),
  kind: z.enum(["creator_call", "research_context"]),
  summary: z.string(),
  instrument: z.string().nullable(),
  ticker: z.string().nullable(),
  stance: z.string(),
  horizon: z.string().nullable(),
  conditions: z.array(z.string()),
  risks: z.array(z.string()),
  levels: z.array(z.object({ kind: z.string(), value_original: z.string() })),
  trust: z.enum(["L0", "L1", "L2", "L3"]),
  quotes: z.array(
    z.object({
      startId: z.string(),
      endId: z.string(),
      text: z.string(),
      translation: z.string(),
      start: z.number().nullable(),
      end: z.number().nullable(),
      hash: z.string().nullable(),
    }),
  ),
});
export type EvidenceRecordData = z.infer<typeof EvidenceRecord>;
export function evidenceInventory(run: Run): EvidenceRecordData[] {
  return (["claims", "keyPoints"] as const).flatMap((key) =>
    ((run.output[key] ?? []) as CheckedClaim[])
      .filter((c) => c.passed && !c.reasons?.length)
      .map((c) =>
        EvidenceRecord.parse({
          id: c.id,
          kind: key === "claims" ? "creator_call" : "research_context",
          summary: c.claim.thesis_en,
          instrument: c.claim.instrument_as_spoken ?? null,
          ticker: c.claim.ticker ?? null,
          stance: c.claim.stance ?? "neutral",
          horizon: c.claim.horizon_en ?? null,
          conditions: c.claim.conditions_en ?? [],
          risks: c.claim.risks_en ?? [],
          levels: c.claim.levels ?? [],
          trust:
            (c as { trust?: string }).trust ??
            (c.audit?.verdict === "accept" ? "L1" : "L0"),
          quotes: c.claim.evidence.map((e) => ({
            startId: e.segment_id,
            endId: e.end_segment_id ?? e.segment_id,
            text: e.quote_original,
            translation: e.quote_translation_en ?? "",
            start: e.source_span?.start_seconds ?? null,
            end: e.source_span?.end_seconds ?? null,
            hash: e.source_span?.text_hash ?? null,
          })),
        }),
      ),
  );
}
export const ExternalEvidence = z.object({
  id: z.string(),
  url: z
    .url()
    .refine(
      (value) => ["https:", "http:"].includes(new URL(value).protocol),
      "Web sources require HTTP(S).",
    ),
  title: z.string(),
  text: z.string().max(30000),
  publishedAt: z.iso.datetime().nullable(),
  retrievedAt: z.iso.datetime(),
  publicationConfirmed: z.boolean(),
  publicationPrecision: z.enum(["day", "timestamp"]).optional(),
  dateBasis: z.string(),
  sourceClass: z.enum(["primary", "secondary", "unknown"]),
  hash: z.string(),
  query: z.string(),
  timeMode: z.enum(["video_date", "current"]),
  provider: z.string(),
});
export type ExternalEvidenceData = z.infer<typeof ExternalEvidence>;
export function eligibleExternal(
  source: Pick<ExternalEvidenceData, "publishedAt" | "publicationConfirmed"> & {publicationPrecision?: "day" | "timestamp"},
  context: AnalysisContextData,
  mode: "video_date" | "current",
) {
  if (!source.publicationConfirmed || !source.publishedAt) return false;
  const day = source.publishedAt.slice(0,10);
  const earliest = source.publicationPrecision === "timestamp" ? Date.parse(source.publishedAt) : Date.parse(day+"T00:00:00.000Z");
  const latest = source.publicationPrecision === "timestamp" ? Date.parse(source.publishedAt) : Date.parse(day+"T23:59:59.999Z");
  if (latest > Date.parse(context.analysedAt)) return false;
  if (mode === "current") {
    const originalCutoff = context.recordedAt ?? context.videoPublishedAt;
    return !!originalCutoff && earliest > Date.parse(originalCutoff);
  }
  const cutoff = context.recordedAt ?? context.videoPublishedAt;
  return !!cutoff && latest <= Date.parse(cutoff);
}
export const BaselinePoint = z.object({
  id: z.string(),
  sourceRunId: z.string(),
  publishedAt: z.iso.datetime(),
  topic: z.string(),
  text: z.string(),
  evidence: z.array(EvidenceRecord),
  channelId: z.string().nullable().default(null),
  speaker: z.string().default("unknown"),
});
export const Novelty = z.object({
  status: z.enum([
    "unknown",
    "repeated",
    "new_detail",
    "changed_stance",
    "contradiction",
  ]),
  baselineIds: z.array(z.string()).max(8),
  reason: z.string().max(500),
});
export const FinancialFact = z.object({
  label: z.string().max(150),
  value: z.number(),
  currency: z.string().nullable(),
  unit: z.enum([
    "total",
    "per_share",
    "per_barrel",
    "percent",
    "percentage_points",
    "basis_points",
    "multiple",
    "contracts",
    "shares",
    "capacity",
    "other",
  ]),
  unitDescription: z.string().max(150).nullable().default(null),
  relation: z.enum(["exact", "approximate", "greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal", "unknown"]).default("unknown"),
  scale: z.enum(["ones", "thousands", "millions", "billions", "trillions"]),
  period: z.string().nullable(),
  basis: z.enum(["GAAP", "non_GAAP", "not_stated"]),
  nature: z.enum([
    "reported",
    "forecast",
    "scenario",
    "contract_ceiling",
    "backlog",
    "committed",
    "funded",
    "realized",
    "unknown",
  ]),
  evidenceId: z.string(),
  quote: z.string().min(1).max(2000),
});
export type FinancialFactData = z.infer<typeof FinancialFact>;
export function reviewFinancialFact(fact: FinancialFactData, retainedQuotes: string[]): {
  fact: FinancialFactData | null; original: FinancialFactData;
  status: "unchanged" | "corrected" | "unresolved"; reason: string;
} {
  const result = (status: "unchanged" | "corrected" | "unresolved", value: FinancialFactData | null, reason: string) => ({fact:value, original:fact, status, reason});
  if (typeof fact.quote !== "string" || !fact.quote.trim() || !retainedQuotes.some(quote => quote.includes(fact.quote)))
    return result("unresolved", null, "Proposed quantity withheld: its exact original quote is not anchored to the sentence’s retained evidence; no figure or unit was confirmed.");
  const basisIssue = financialBasisIssue(fact, retainedQuotes);
  if (basisIssue) return result("unresolved", null, basisIssue);
  if (/\b(?:peak|all[ -]time high|record high)\b|高[点點]|峰值/i.test(fact.label) && !/\b(?:peak|all[ -]time high|record high)\b|高[点點]|峰值/i.test(fact.quote))
    return result("unresolved", null, "Proposed quantity withheld: the explicit peak baseline in its label is not established by its original quote; no comparison baseline was inferred.");
  if (/\bconstant[ -]maturity\b|恒定到期|固定期限/i.test(`${fact.label} ${fact.unitDescription ?? ""}`) && !/\bconstant[ -]maturity\b|恒定到期|固定期限/i.test(fact.quote))
    return result("unresolved", null, "Proposed quantity withheld: constant-maturity observation convention is not established by the retained original quote; a generic Treasury maturity does not establish a constant-maturity series. No replacement convention was inferred.");
  const qualifiers = new Set<string>();
  if (/\b(?:about|approximately|roughly|around)\s+[$¥€£]?\s*\d|(?:大约|大約|约|約)\s*\d|\d+(?:\.\d+)?\s*(?:[%％]|percent\b)?\s*左右|\blike\s+\d+(?:\.\d+)?\s*(?:basis[ -]points?\b|bps?\b|percentage[ -]points?\b|percent\b|%)/i.test(fact.quote)) qualifiers.add("approximate");
  if (/(?<!no )\b(?:more than|over)\s+[$¥€£]?\s*\d|(?:超过|超過)\s*\d/i.test(fact.quote)) qualifiers.add("greater_than");
  if (/(?<!no )\b(?:less than|under)\s+[$¥€£]?\s*\d|不到\s*\d/i.test(fact.quote)) qualifiers.add("less_than");
  if (/\b(?:at least|no less than)\s+[$¥€£]?\s*\d|至少\s*\d|\d+(?:\.\d+)?\s*(?:[%％]|percent\b)?\s*以上/i.test(fact.quote)) qualifiers.add("greater_than_or_equal");
  if (/\b(?:at most|up to|no more than)\s+[$¥€£]?\s*\d|\d+(?:\.\d+)?\s*(?:[%％]|percent\b)?\s*以下/i.test(fact.quote)) qualifiers.add("less_than_or_equal");
  if ((qualifiers.size > 0 && (qualifiers.size !== 1 || !qualifiers.has(fact.relation ?? "unknown"))) ||
      (qualifiers.size === 0 && ["approximate", "greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal"].includes(fact.relation ?? "unknown")))
    return result("unresolved", null, "Proposed quantity withheld: the typed qualifier is missing, mismatched or not representable from the original quote (including mixed bounds). Preserve the original wording; no exactness or inequality direction was inferred.");
  const fractions = [...fact.quote.matchAll(/(?<![\w/])(\d+)\s*\/\s*(\d+)(?![\d/])/g)];
  if (fractions.length && fact.unit === "percent") {
    const match = fractions[0];
    const numerator = Number(match[1]), denominator = Number(match[2]);
    const tail = fact.quote.slice((match.index ?? 0) + match[0].length);
    const residual = fact.quote.replace(match[0], "").replace(/\b[A-Za-z]+\d+[A-Za-z]*\b/g, "");
    if (fractions.length !== 1 || denominator === 0 || numerator > denominator || fact.currency !== null || fact.scale !== "ones" ||
        !/^\s+of\s+(?:the\s+)?/i.test(tail) || !/\b(?:supply|share|portion|proportion|output|revenue|sales|orders|production)\b/i.test(fact.quote) ||
        /[$€£¥]|\b(?:USD|EUR|GBP|date|dated|January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(fact.quote) || /\d/.test(residual))
      return result("unresolved", null, "Fraction-to-percent mapping unresolved: date, currency, mixed numbers or missing proportion context prevents an unambiguous conversion.");
    const ratio = numerator / denominator, percent = ratio * 100;
    if (Math.abs(fact.value - percent) <= 0.005)
      return result("unchanged", fact, "Fraction proportion matches the stated percent within displayed rounding; approximation remains explicit.");
    if (fact.relation !== "approximate" || Math.abs(fact.value - ratio) > 0.00005)
      return result("unresolved", null, "Fraction-to-percent mismatch unresolved: no unambiguous approximate ratio-as-percent representation was established.");
    return result("corrected", {...fact, value:Number(percent.toFixed(4))}, `Typed approximate proportion corrected from ratio ${fact.value} labelled percent to approximately ${Number(percent.toFixed(4))} percent using exact retained ${match[0]}. Original proposal preserved; display rounding is not calculated precision.`);
  }
  const barrelPrices = [...fact.quote.matchAll(/每桶\s*(\d+(?:\.\d+)?)\s*美元|(?:USD\s*|US\$)(\d+(?:\.\d+)?)\s*(?:per\s+|a\s+|\/\s*)barrel\b|(\d+(?:\.\d+)?)\s*(?:USD|US dollars?)\s*(?:per\s+|a\s+)barrel\b/gi)];
  if ((barrelPrices.length || /每桶|\b(?:per|a)\s+barrel\b/i.test(fact.quote)) && ["total", "other", "per_barrel"].includes(fact.unit)) {
    if (!retainedQuotes.some(quote => quote.includes(fact.quote)) || barrelPrices.length !== 1 || fact.currency !== "USD" || fact.scale !== "ones" || Number(barrelPrices[0][1] ?? barrelPrices[0][2] ?? barrelPrices[0][3]) !== fact.value)
      return result("unresolved", null, "Per-barrel quantity withheld: source anchor, currency, value or scale is not an unambiguous match.");
    if (fact.unit === "per_barrel") return result("unchanged", fact, "Per-barrel denomination matches the retained quote.");
    return result("corrected", {...fact, unit:"per_barrel", unitDescription:"USD per barrel"}, `Typed unit corrected from ${fact.unit} to per_barrel using the exact USD-per-barrel quote. Original model quantity remains in the audit record.`);
  }
  const shareMatches = [...fact.quote.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(thousand|million|billion|trillion)?\s*(?:(?:ordinary|common)\s+)?shares?\b|(\d+(?:\.\d+)?)\s*(万|萬|亿|億)?\s*股/gi)];
  if (shareMatches.length && ["shares", "contracts", "per_share", "other"].includes(fact.unit)) {
    if (!retainedQuotes.some(quote => quote.includes(fact.quote)))
      return result("unresolved", null, "Share-count quantity withheld: exact original quote is not anchored to retained evidence.");
    if (shareMatches.length !== 1 || /\b(?:options?|puts?|calls?|contracts?)\b|\bper[ -]share\b/i.test(fact.quote) || fact.currency !== null)
      return result("unresolved", null, "Share-count quantity withheld: mixed quantities, option contracts, per-share prices or currency prevent an unambiguous ordinary-share mapping.");
    const match = shareMatches[0];
    const multipliers: Record<string, number> = {ones:1,thousands:1e3,millions:1e6,billions:1e9,trillions:1e12,thousand:1e3,million:1e6,billion:1e9,trillion:1e12,"万":1e4,"萬":1e4,"亿":1e8,"億":1e8};
    const quotedCount = Number((match[1] ?? match[3]).replaceAll(",", "")) * (multipliers[(match[2] ?? match[4] ?? "ones").toLowerCase()] ?? 1);
    if (Math.abs(quotedCount - fact.value * multipliers[fact.scale]) > 1e-6)
      return result("unresolved", null, "Share-count quantity withheld: typed value/scale does not match the exact source count; no quantity was inferred.");
    if (fact.unit === "shares") return result("unchanged", fact, "Share count and scale match the exact retained quote.");
    return result("corrected", {...fact, unit:"shares"}, `Typed unit corrected from ${fact.unit} to shares using the exact retained ordinary-share count and scale. Original model quantity remains in the audit record.`);
  }
  const rates = explicitRateQuantities(fact.quote);
  const related = fact.unit === "basis_points" || /\bbasis[ -]points?\b|\bbps?\b|基[点點]/i.test(fact.quote);
  if (!related) {
    if (["capacity", "other"].includes(fact.unit) && !fact.unitDescription?.trim())
      return result("unresolved", null, "Proposed quantity withheld: measurement dimension or denominator is unspecified; no GW, per-MW, FX or other unit was inferred from its label.");
    const chineseScales = [...fact.quote.matchAll(/(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*([万萬][亿億]|[万萬亿億])/g)];
    if (chineseScales.length) {
      const numerals = [...fact.quote.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?/g)];
      const match = chineseScales[0];
      const denomination = fact.quote.slice((match.index ?? 0) + match[0].length).trimStart();
      const people = /^(?:人(?:口)?|名)/.test(denomination) && fact.currency === null && fact.unit === "other" && /^(?:people|persons?|population)$/i.test(fact.unitDescription?.trim() ?? "");
      const namedCurrency=/^美元/.test(denomination)?'USD':/^韩元|^韓元/.test(denomination)?'KRW':/^人民币|^人民幣/.test(denomination)?'CNY':null;
      const bareYuan=/^元/.test(denomination) && ["total", "other"].includes(fact.unit);
      const money=namedCurrency!==null && fact.currency===namedCurrency && ["total", "other"].includes(fact.unit);
      if(chineseScales.length!==1 || numerals.length!==1 || (!people && !money && !bareYuan)) {
        const literalCheck=sourceNumericCheck(fact,retainedQuotes);
        if(literalCheck.status!=='unresolved') return result('unchanged',fact,'A matching numeric literal is retained without automatic conversion; association with this metric and currency remains model-assessed, not independently verified.');
      }
      if (chineseScales.length !== 1 || numerals.length !== 1 || (!people && !money && !bareYuan))
        return result("unresolved", null, "Chinese numeric scale withheld: multiple numbers, compound scales or unmatched measurement denomination prevent a unique source mapping; no quantity was guessed.");
      const multiplier = {ones:1, thousands:1e3, millions:1e6, billions:1e9, trillions:1e12}[fact.scale];
      const literal = Number(match[1].replaceAll(",", ""));
      const sourceValue = literal * (/[万萬][亿億]/.test(match[2]) ? 1e12 : /[亿億]/.test(match[2]) ? 1e8 : 1e4);
      const proposedValue = fact.value * multiplier;
      if (Math.abs(sourceValue - proposedValue) <= Math.max(1e-8, Math.abs(sourceValue)*1e-12))
        return result("unchanged", fact, bareYuan ? "Numeric magnitude matches, but bare 元 does not establish the proposed currency; currency remains model-assessed, not independently verified." : "Chinese numeric value and scale match the exact retained literal; other dimensional metadata remains model-assessed.");
      if (bareYuan || match[2].length > 1 || fact.value !== literal || !Number.isFinite(sourceValue) || Math.abs(sourceValue) > Number.MAX_SAFE_INTEGER)
        return result("unresolved", null, "Chinese numeric scale withheld: proposed mantissa differs from the exact unique source literal; no number was inferred.");
      return result("corrected", {...fact, value:sourceValue/multiplier}, `Typed value corrected using exact retained ${match[0]} (${sourceValue} base units), preserving proposed ${fact.scale} scale. Original model value/scale remain in the audit record.`);
    }
    const literalCheck=sourceNumericCheck(fact, retainedQuotes);
    if(literalCheck.status === "unresolved") return result("unresolved", null, literalCheck.reason);
    return result("unchanged", fact, "No deterministic unit correction applied; qualifier and dimensional metadata are not independent proof of calculation readiness.");
  }
  if (!retainedQuotes.some(quote => quote.includes(fact.quote)))
    return result("unresolved", null, "Basis-point quantity withheld: exact original quote is not anchored to retained evidence.");
  if (fact.scale !== "ones" || fact.currency !== null)
    return result("unresolved", null, "Basis-point quantity withheld: non-unit scale or currency on a rate requires review; no scale/currency conversion was inferred.");
  if (rates.length !== 1)
    return result("unresolved", null, "Basis-point quantity withheld: mixed or ambiguous rate quantities cannot be mapped to this metric safely.");
  const rate = rates[0];
  if (rate.unit === fact.unit && Math.abs(rate.value - fact.value) < 1e-10)
    return result("unchanged", fact, "Typed quantity matches the exact retained rate quote.");
  if ((rate.unit === "basis_points" && fact.unit === "percentage_points" && Math.abs(rate.value / 100 - fact.value) < 1e-10) ||
      (rate.unit === "percentage_points" && fact.unit === "basis_points" && Math.abs(rate.value * 100 - fact.value) < 1e-10))
    return result("unchanged", fact, "Equivalent conversion confirmed: 100 basis points equals 1 percentage point.");
  if (rate.unit === "basis_points" && ["percentage_points", "percent", "other"].includes(fact.unit) && rate.value === fact.value)
    return result("corrected", {...fact, unit:"basis_points"}, `Typed unit corrected from ${fact.unit} to basis_points using the exact retained quote; ${rate.value} basis points equals ${rate.value / 100} percentage points. Original model value and unit remain in the audit record.`);
  return result("unresolved", null, "Basis-point quantity withheld: typed value or unit does not match the unambiguous original rate; no value was guessed.");
}
export const Calculation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("enterprise_value_bridge"),
    equityValue: z.number(),
    debt: z.number(),
    cash: z.number(),
    preferred: z.number(),
    nonControllingInterest: z.number(),
  }),
  z.object({
    kind: z.literal("percentage_change"),
    initial: z.number(),
    final: z.number(),
  }),
  z.object({
    kind: z.literal("percentage_point_change"),
    initialPercent: z.number(),
    finalPercent: z.number(),
  }),
  z.object({
    kind: z.literal("option_premium_total"),
    premiumPerShare: z.number(),
    contractMultiplier: z.number(),
    contracts: z.number(),
  }),
  z.object({
    kind: z.literal("cagr"),
    initial: z.number(),
    final: z.number(),
    years: z.number(),
  }),
  z.object({
    kind: z.literal("market_cap"),
    earnings: z.number(),
    multiple: z.number(),
  }),
  z.object({
    kind: z.literal("short_put_breakeven"),
    strike: z.number(),
    premiumPerShare: z.number(),
  }),
]);

export const ResearchSentence = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(1000),
  evidenceIds: z.array(z.string()).min(1).max(20),
  externalIds: z.array(z.string()).max(12),
  financialFacts: z.array(FinancialFact).max(6).default([]),
  novelty: Novelty.default({
    status: "unknown",
    baselineIds: [],
    reason: "No audited comparable baseline.",
  }),
  calculation: z
    .object({
      expression: Calculation,
      units: z.string().min(1).max(120),
      assumptions: z.string().min(1).max(500),
    })
    .nullable()
    .default(null),
  kind: z.enum([
    "reported_fact",
    "creator_view",
    "third_party_forecast",
    "scenario",
    "action",
    "holding",
    "analysis",
    "countercase",
    "invalidation",
    "next_check",
    "education",
  ]),
  horizon: z.enum(["tactical", "fundamental", "both", "general"]),
  topic: z.string().min(1).max(120),
  materiality: z.number().int().min(0).max(3),
  importanceReason: z.string().max(300),
  speaker: z.string().max(150),
  timeMode: z.enum(["video_date", "current"]),
});
export type ResearchSentenceData = z.infer<typeof ResearchSentence>;
export const ResearchDraft = z.object({
  sentences: z.array(ResearchSentence).max(48),
  mainTopics: z.array(z.string()).max(100),
  omissions: z.array(z.string()).max(30),
});
const ComparisonStatus = z.enum(["matched", "not_applicable", "unknown", "mismatched"]);
export const ExternalComparability = z.object({
  metric: ComparisonStatus.default("unknown"),
  period: ComparisonStatus.default("unknown"),
  units: ComparisonStatus.default("unknown"),
  observationBasis: ComparisonStatus.default("unknown"),
  reason: z.string().min(1).max(1000).default("Comparability has not been established."),
});
export const ExternalSupport = z.object({
  externalId: z.string(),
  assertion: z.string().min(1).max(4000),
  quote: z.string().min(1).max(6000),
  relationship: z.enum(["supports", "contradicts"]),
  comparability: ExternalComparability.default(() => ExternalComparability.parse({})),
  reason: z.string().min(1).max(1000),
});
// Legacy records without comparison metadata remain readable but cannot
// establish a contradiction. Shared with presentation so a badge cannot bypass
// the publication rule merely because a retained link says "contradicts".
export function externalComparisonEstablished(
  link: { assertion?: string; comparability?: z.input<typeof ExternalComparability> },
  hasFinancialFacts = false,
): boolean {
  const parsed = ExternalComparability.safeParse(link.comparability ?? {});
  if (!parsed.success || !link.comparability?.reason?.trim() || parsed.data.reason === "Comparability has not been established.") return false;
  const comparison = parsed.data;
  const quantitative = hasFinancialFacts || /[0-9%]|\b(?:yield|margin|revenue|earnings|profit|ratio|multiple|basis points?|percent)\b/i.test(link.assertion ?? "");
  return comparison.metric === "matched" &&
    [comparison.period, comparison.units, comparison.observationBasis].every(status =>
      status === "matched" || (!quantitative && status === "not_applicable"));
}
export const ResearchVerdict = z.object({
  externalSupport: z.array(ExternalSupport).max(16).default([]),
  id: z.string(),
  accepted: z.boolean(),
  reason: z.string(),
  factualStatus: z.enum(["unverified", "corroborated", "partial", "disputed"]),
  noveltyAccepted: z.boolean().default(false),
  robustness: z
    .enum(["insufficient", "fragile", "supported"])
    .default("insufficient"),
  robustnessReason: z
    .string()
    .max(1000)
    .default("Independent thesis robustness has not been established."),
  // Support references are IDs in the same bounded draft (at most 48 sentences).
  thesisSupportIds: z.array(z.string()).max(48).default([]),
});
export const ResearchAudit = z.object({
  verdicts: z.array(ResearchVerdict).max(48),
  coverageFindings: z.array(z.string()).max(30),
  evidenceCoverage: z.array(EvidenceCoverage).default([]),
});
// New model calls must return explicit comparison assessments. The retained
// artifact parser above keeps defaults solely for backward compatibility.
export const ResearchAuditResponse = ResearchAudit.extend({
  evidenceCoverage: z.array(EvidenceCoverage),
  verdicts: z.array(ResearchVerdict.extend({
    externalSupport: z.array(ExternalSupport.extend({
      comparability: z.object({
        metric: ComparisonStatus,
        period: ComparisonStatus,
        units: ComparisonStatus,
        observationBasis: ComparisonStatus,
        reason: z.string().min(1).max(1000),
      }),
    })).max(16),
  })).max(48),
});
export type AcceptedSentence = ResearchSentenceData & {
  financialFactChecks?: ReturnType<typeof reviewFinancialFact>[];
  externalSupport?: z.infer<typeof ExternalSupport>[];
  factualStatus: "unverified" | "corroborated" | "partial" | "disputed";
  fidelity: string;
  robustness: "insufficient" | "fragile" | "supported";
  auditReason: string;
  robustnessReason: string;
  calculationResult: ReturnType<typeof financialCheck> | null;
};
export function validateBrief(
  raw: unknown,
  evidence: EvidenceRecordData[],
  external: ExternalEvidenceData[],
  context: AnalysisContextData,
  verdicts: z.input<typeof ResearchVerdict>[],
  baseline: z.input<typeof BaselinePoint>[] = [],
  options: { phase?: "structural_preflight" | "publication" } = {},
) {
  const audits = verdicts.map((v) => ResearchVerdict.parse(v));
  const prior = baseline.map((b) => BaselinePoint.parse(b));
  const draft = ResearchDraft.parse(raw);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const ext = new Map(external.map((e) => [e.id, e]));
  if (
    new Set(draft.sentences.map((s) => s.id)).size !== draft.sentences.length ||
    new Set(verdicts.map((v) => v.id)).size !== verdicts.length
  )
    throw Error("Duplicate research sentence or audit ID.");
  const sentences: AcceptedSentence[] = [];
  const rejected: { sentence: ResearchSentenceData; reasons: string[] }[] = [];
  for (const sentence of draft.sentences) {
    const audit = audits.find((v) => v.id === sentence.id);
    const originalQuotes = sentence.evidenceIds.flatMap(id => (byId.get(id)?.quotes ?? []).map(q=>q.text));
    const reasons: string[] = [];
    if (!audit?.accepted)
      reasons.push(audit?.reason ?? "No independent audit verdict.");
    if (sentence.evidenceIds.some((id) => !byId.has(id)))
      reasons.push("Unknown or rejected video evidence.");
    if (
      sentence.externalIds.some(
        (id) =>
          !ext.has(id) ||
          !eligibleExternal(ext.get(id)!, context, sentence.timeMode),
      )
    )
      reasons.push(
        "External evidence is missing, undated, unconfirmed or outside the time boundary.",
      );
    if (sentence.timeMode === "current" && !sentence.externalIds.length)
      reasons.push("A current update requires dated external evidence.");
    if (sentence.timeMode === "video_date") {
      const ratio = stockSplitDirectionCheck(sentence.text, sentence.evidenceIds.flatMap(id =>
        (byId.get(id)?.quotes ?? []).map(quote => quote.text)));
      if (ratio.conflict)
        reasons.push("Stock-split ratio direction conflicts with the explicit original share counts. The original evidence and rejected sentence are retained; resolve new shares versus old shares before publication.");
      if (ratio.unresolved)
        draft.omissions.push(`Stock-split ratio direction remains unresolved for ${sentence.id}: the original evidence is ambiguous, missing an explicit direction, or contains multiple ratios. No corrected ratio has been inferred.`);
    }
    if (options.phase !== "structural_preflight")
      reasons.push(...semanticBasisIssues(sentence.text, originalQuotes, sentence.calculation));
    if (explicitBasisPointProseConflict(sentence.text, originalQuotes))
      reasons.push("The sentence's explicit rate unit/value conflicts with the original basis-point quantity. Review the prose before publication; correcting a typed field cannot cure this claim.");
    if (sentence.financialFacts.some(f => f.unit === "percent" && explicitPercentagePointConflict(f.value, f.quote)))
      reasons.push("The cited source uses percentage points, but the typed fact uses percent. Resolve the unit distinction before publication; no corrected value has been inferred.");
    if (sentence.calculation?.expression.kind === "short_put_breakeven") {
      const computed = financialCheck(sentence.calculation.expression).value;
      // Model prose can disagree with its structured calculation even when
      // no separate breakeven financialFact was emitted. Check both surfaces.
      const statedBreakevens = [
        ...sentence.text.matchAll(/\bbreak[\s-]*even(?:\s+(?:price|level|of|is|at|was|equals|would|be|around|approximately|about|near|effectively))*\s*(?:USD\s*)?\$?\s*(-?\d[\d,]*(?:\.\d+)?)/gi),
        ...sentence.text.matchAll(/(?:\$|USD\s*)(-?\d[\d,]*(?:\.\d+)?)\s+(?:(?:per.share|expiry|calculated|effective)\s+)*break[\s-]*even\b/gi),
      ].map(match => Number(match[1].replaceAll(",", "")));
      const inconsistentFact = sentence.financialFacts.some(f =>
        /break[\s-]*even/i.test(f.label) && f.unit === "per_share" &&
        f.scale === "ones" && computed !== null && Math.abs(f.value - computed) > 0.011,
      );
      if (computed !== null && (inconsistentFact || statedBreakevens.some(value => Math.abs(value - computed) > 0.011)))
        reasons.push(`Quoted breakeven conflicts with the supplied option inputs: strike minus premium is ${computed.toFixed(2)} before fees. The source discrepancy must be resolved before this sentence can appear in the summary.`);
    }
    if (
      sentence.financialFacts.some(
        (f) =>
          !sentence.evidenceIds.includes(f.evidenceId) ||
          !byId.get(f.evidenceId)?.quotes.some((q) => q.text.includes(f.quote)),
      )
    )
      reasons.push(
        "A typed financial fact does not quote its cited original evidence.",
      );
    const attribution=mixedTurnAttribution(sentence,evidence);
    if(attribution.requiresNeutralRepair) reasons.push(attribution.reason);
    if (reasons.length) {
      rejected.push({ sentence, reasons });
      continue;
    }
    const financialReviews = sentence.financialFacts.map(f => reviewFinancialFact(f,
      sentence.evidenceIds.includes(f.evidenceId) ? (byId.get(f.evidenceId)?.quotes ?? []).map(q=>q.text) : []));
    const financialFactChecks = financialReviews.filter(check => check.status !== "unchanged");
    for (const check of financialFactChecks) draft.omissions.push(`${sentence.id}: ${check.reason}`);
    const numericDisposition=numericalSentenceDisposition({...sentence, financialFacts:financialReviews.filter(check=>check.status==='unresolved').map(check=>check.original)}, evidence);
    const sources = sentence.externalIds.map((id) => ext.get(id)!);
    // A primary URL is only eligibility. Require the independent critic to
    // identify the exact assertion and retained supporting/contradicting passage.
    const externalSupport = audit!.externalSupport.filter(link =>
      sentence.text.includes(link.assertion) && sources.some(source =>
        source.id === link.externalId && source.sourceClass === "primary" &&
        source.text.includes(link.quote)),
    );
    const comparableSupport = externalSupport.filter(s => s.relationship === "supports" && externalComparisonEstablished(s, sentence.financialFacts.length > 0));
    const fullSupport = comparableSupport.some(s => s.assertion === sentence.text);
    // Retain possible conflicting passages even when their measurements cannot
    // be compared. A different measurement is not a contradiction.
    const fullConflict = externalSupport.some(s => s.relationship === "contradicts" && externalComparisonEstablished(s, sentence.financialFacts.length > 0));
    const unresolvedConflict = externalSupport.some(s => s.relationship === "contradicts" && !externalComparisonEstablished(s, sentence.financialFacts.length > 0));
    const permitted = audit!.factualStatus === "corroborated" ? fullSupport && !externalSupport.some(s => s.relationship === "contradicts")
      : audit!.factualStatus === "disputed" ? fullConflict
      : audit!.factualStatus === "partial" ? comparableSupport.length > 0 : true;
    const factualStatus = fullConflict ? "disputed" : unresolvedConflict ? "unverified" : permitted ? audit!.factualStatus : "unverified";
    const disclosedCaptionAmbiguity=/\b(?:caption|transcript|transcription)s?\b/i.test(sentence.text) && /\b(?:ambiguous|ambiguity|decimal|uncertain|error|errors)\b/i.test(sentence.text);
    const verifiedCaptionExplanation=disclosedCaptionAmbiguity && factualStatus==='corroborated' && fullSupport && !fullConflict && !unresolvedConflict;
    if(options.phase!=='structural_preflight' && numericDisposition.status==='neutral_repair_required' && !verifiedCaptionExplanation) {
      rejected.push({sentence,reasons:[numericDisposition.reason, ...numericDisposition.checks.filter(check=>check.status==='unresolved').map(check=>check.reason)]});
      continue;
    }
    const withheldExternalAudit = !fullConflict && (unresolvedConflict || !permitted);
    const withheldReason = unresolvedConflict
      ? "External-verification assessment withheld: potential conflict retained, but comparable metric, period, units and observation convention have not been established. A different measurement is not a contradiction. Review the retained passage and comparability reason; the original audit remains in the run trace."
      : "External-verification assessment withheld: no valid assertion-level primary-source passage with established comparability supports the proposed label. The original audit remains in the run trace; source eligibility alone is not corroboration.";
    // Only the full independent audit can supply valid externalSupport. Never
    // preflight-reject this claim before that audit has had an opportunity to run.
    const confirmationClauses = sentence.text.split(/[;.!?]+|\b(?:but|however|yet)\b/i).filter(clause => {
      if(!/\b(?:external(?:ly)?|independent(?:ly)?|corporate releases?|press releases?|filings?)\b/i.test(clause)) return false;
      const verbs=[...clause.matchAll(/\b(?:confirm(?:s|ed|ing)?|corroborat(?:es|ed|ing)|validat(?:es|ed|ing)|acknowledg(?:es|ed|ing)|verif(?:ies|ied|ying)|establish(?:es|ed|ing)?)\b/gi)];
      return verbs.some(verb=>{
        const before=clause.slice(0,verb.index);
        // Negation/modal language must govern the confirmation verb. A negative
        // object ("confirm no decline") does not negate the claimed verification.
        const qualified=/\b(?:not|never|cannot|can't|couldn't|isn't|wasn't|aren't|weren't|hasn't|haven't|hadn't|may|might|could|would|should|needs?|requires?|awaits?|pending|whether)\s+(?:(?:to|be|been|being|have|has|independently|externally|yet|fully|directly|actually)\s+){0,5}$/i.test(before);
        const absentSource=/\bno\s+(?:(?:external|independent|corporate|press)\s+)*(?:filings?|releases?|sources?)\s+(?:(?:have|has)\s+)?$/i.test(before);
        return !qualified&&!absentSource;
      });
    });
    const claimsExternalConfirmation = confirmationClauses.length > 0;
    const confirmationCovered = confirmationClauses.every(clause => comparableSupport.some(link => link.assertion.includes(clause.trim())));
    if (options.phase !== "structural_preflight" && claimsExternalConfirmation &&
        (!["corroborated", "partial"].includes(factualStatus) || !confirmationCovered || fullConflict || unresolvedConflict)) {
      rejected.push({sentence, reasons:["Prose asserts external confirmation, but the full audit did not establish exact assertion-level primary support. Original candidate retained; independently audit a neutral source-attributed repair rather than publishing a confirmation claim with an unverified badge."]});
      continue;
    }
    const trust = Math.min(
      ...sentence.evidenceIds.map((id) => Number(byId.get(id)!.trust.slice(1))),
    );
    const baselineValid =
      sentence.novelty.baselineIds.length > 0 &&
      sentence.novelty.baselineIds.every((id) =>
        prior.some(
          (p) =>
            p.id === id &&
            !!context.videoPublishedAt &&
            p.publishedAt < context.videoPublishedAt &&
            (sentence.novelty.status !== "changed_stance" ||
              (p.channelId !== null &&
                p.channelId === context.channelId &&
                p.speaker !== "unknown" &&
                p.speaker === sentence.speaker)),
        ),
      );
    const novelty =
      baselineValid && audit!.noveltyAccepted
        ? sentence.novelty
        : {
            status: "unknown" as const,
            baselineIds: [],
            reason: "No independently audited, dated comparable baseline.",
          };
    sentences.push({
      ...sentence,
      financialFacts: financialReviews.flatMap(check => check.fact ? [check.fact] : []),
      ...(financialFactChecks.length ? {financialFactChecks} : {}),
      factualStatus,
      externalSupport,
      novelty,
      fidelity:
        trust >= 3
          ? "Human-verified source"
          : trust >= 2
            ? "Audio-agreed source"
            : trust >= 1
              ? "Text-checked source"
              : "Extracted source",
      robustness:
        !withheldExternalAudit && (factualStatus === "disputed" || audit!.robustness === "fragile")
          ? "fragile"
          : "insufficient",
      robustnessReason: withheldExternalAudit ? withheldReason : audit!.robustnessReason,
      auditReason: withheldExternalAudit ? withheldReason : audit!.reason,
      calculationResult: sentence.calculation
        ? financialCheck(sentence.calculation.expression)
        : null,
    });
  }
  for (const sentence of sentences) {
    const verdict = audits.find((v) => v.id === sentence.id)!;
    const support = sentences.filter(
      (s) =>
        verdict.thesisSupportIds.includes(s.id) &&
        s.topic === sentence.topic &&
        s.timeMode === sentence.timeMode &&
        (s.horizon === sentence.horizon ||
          s.horizon === "both" ||
          sentence.horizon === "both"),
    );
    if (
      verdict.robustness === "supported" &&
      sentence.factualStatus === "corroborated" &&
      support.some((s) => s.kind === "countercase") &&
      support.some((s) => s.kind === "invalidation")
    )
      sentence.robustness = "supported";
    else if (verdict.robustness === "supported")
      sentence.robustnessReason =
        "Support threshold not met: requires primary factual corroboration plus retained countercase and invalidation for the same topic and time boundary.";
  }
  return {
    version: RESEARCH_VERSION,
    context,
    mainTopics: draft.mainTopics.filter((t) =>
      sentences.some((s) => s.topic === t),
    ),
    sentences,
    rejected,
    omissions: draft.omissions,
  };
}
function financialResult(raw: unknown): {
  value: number | null;
  unit: string;
  reason: string;
} {
  const c = Calculation.parse(raw);
  if (c.kind === "enterprise_value_bridge")
    return {
      value: [
        c.equityValue,
        c.debt,
        c.cash,
        c.preferred,
        c.nonControllingInterest,
      ].every((v) => v >= 0)
        ? c.equityValue +
          c.debt +
          c.preferred +
          c.nonControllingInterest -
          c.cash
        : null,
      unit: "same currency and scale",
      reason:
        "EV bridge: equity + debt + preferred + non-controlling interests − cash; all inputs must share a reporting date.",
    };
  if (c.kind === "percentage_change")
    return {
      value: c.initial > 0 ? (c.final - c.initial) / c.initial : null,
      unit: "fraction change",
      reason: "Relative change; not a percentage-point change.",
    };
  if (c.kind === "percentage_point_change")
    return {
      value: c.finalPercent - c.initialPercent,
      unit: "percentage points",
      reason: "Absolute difference between percentage levels.",
    };
  if (c.kind === "option_premium_total")
    return {
      value:
        c.premiumPerShare >= 0 &&
        Number.isInteger(c.contractMultiplier) &&
        c.contractMultiplier > 0 &&
        Number.isInteger(c.contracts) &&
        c.contracts >= 0
          ? c.premiumPerShare * c.contractMultiplier * c.contracts
          : null,
      unit: "cash in premium currency",
      reason:
        "Premium × stated contract multiplier × contract count; before fees, assignment and collateral costs.",
    };
  if (c.kind === "cagr")
    return c.initial > 0 && c.final > 0 && c.years > 0
      ? {
          value: (c.final / c.initial) ** (1 / c.years) - 1,
          unit: "fraction per year",
          reason:
            "Same currency and scale required; growth is a scenario, not a forecast.",
        }
      : {
          value: null,
          unit: "fraction per year",
          reason: "Positive initial/final values and duration required.",
        };
  if (c.kind === "market_cap")
    return c.earnings >= 0 && c.multiple >= 0
      ? {
          value: c.earnings * c.multiple,
          unit: "same currency/scale as earnings",
          reason:
            "Equity value, not enterprise value; share dilution is not included.",
        }
      : {
          value: null,
          unit: "unknown",
          reason: "Nonnegative earnings/multiple required.",
        };
  return c.strike > 0 && c.premiumPerShare >= 0 && c.premiumPerShare < c.strike
    ? {
        value: c.strike - c.premiumPerShare,
        unit: "currency per share",
        reason:
          "Short-put expiry breakeven before fees; assignment/collateral risks remain.",
      }
    : {
        value: null,
        unit: "currency per share",
        reason: "Invalid strike or per-share premium.",
      };
}
export function financialCheck(raw: unknown) {
  const result = financialResult(raw);
  return result.value !== null && !Number.isFinite(result.value)
    ? {
        ...result,
        value: null,
        reason:
          "Arithmetic exceeds finite numerical limits; check the source inputs and scale.",
      }
    : result;
}
export type BriefFeedRow = {
  id: string;
  videoId: string;
  publishedAt: string | null;
  createdAt: string;
  sentences: (Pick<
    ResearchSentenceData,
    "text" | "topic" | "horizon" | "materiality" | "importanceReason"
  > & { novelty?: z.infer<typeof Novelty> })[];
  status: string;
};
export function prioritiseBriefs<T extends BriefFeedRow>(
  rows: T[],
  prior: BriefFeedRow[] = [],
  now = new Date(),
) {
  const normal = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return rows
    .filter((r) => r.status === "completed")
    .map((r) => {
      const age = r.publishedAt
        ? Math.max(0, (now.getTime() - Date.parse(r.publishedAt)) / 86400000)
        : null;
      const backfill =
        !!r.publishedAt &&
        Date.parse(r.createdAt) - Date.parse(r.publishedAt) > 14 * 86400000;
      const earlier = prior.filter(
        (p) =>
          p.videoId !== r.videoId &&
          p.publishedAt &&
          r.publishedAt &&
          p.publishedAt < r.publishedAt,
      );
      const repeated =
        r.sentences.length > 0 &&
        r.sentences.every((s) =>
          earlier.some((p) =>
            p.sentences.some((x) => normal(x.text) === normal(s.text)),
          ),
        );
      const changes = r.sentences.filter(
        (s) =>
          s.novelty &&
          ["new_detail", "changed_stance", "contradiction"].includes(
            s.novelty.status,
          ) &&
          s.novelty.baselineIds.length,
      );
      const novelty = changes.length
        ? "audited_change"
        : repeated
          ? "repeated"
          : "unknown";
      const materiality = Math.max(0, ...r.sentences.map((s) => s.materiality));
      const freshness =
        age === null ? 0 : age <= 3 ? 3 : age <= 14 ? 2 : age <= 30 ? 1 : 0;
      const priority =
        materiality * 2 +
        freshness +
        (changes.length ? 2 : 0) -
        (repeated ? 2 : 0);
      return {
        ...r,
        novelty,
        backfill,
        priority,
        rankingReasons: [
          `Materiality ${materiality}/3: ${r.sentences.find((s) => s.materiality === materiality)?.importanceReason ?? "not assessed"}`,
          age === null
            ? "Publication date unknown"
            : `Published ${Math.floor(age)} days ago`,
          changes.length
            ? `Audited change against retained coverage: ${changes[0].novelty!.reason}`
            : repeated
              ? "Exact previously retained statement repeated"
              : "Novelty not established",
          ...(backfill
            ? ["Historical backfill; processing time is not news time"]
            : []),
        ],
      };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
        a.id.localeCompare(b.id),
    );
}

export type ResearchBriefData = ReturnType<typeof validateBrief> & {
  id: string;
  runId: string;
  sourceRunId: string;
  title: string;
  videoId: string;
  createdAt: string;
  evidence: EvidenceRecordData[];
  external: ExternalEvidenceData[];
  coverageFindings: string[];
  evidenceCoverage?: z.infer<typeof EvidenceCoverage>[];
  retrievalNotes: string[];
  externalCostUsd: number;
  unknownExternalCosts: number;
  modelCostUsd: number;
  baseline?: z.infer<typeof BaselinePoint>[];
};

/** Optional arithmetic cannot discard an otherwise reviewable cited draft. The
 * original response is retained by modelCall; the omission is visible in UI. */
export function parseResearchDraft(raw: unknown) {
  const envelope = z
    .object({
      sentences: z.array(z.record(z.string(), z.unknown())).max(48),
      mainTopics: z.array(z.string()).max(100),
      omissions: z.array(z.string()).max(30),
    })
    .parse(raw);
  const omissions = [...envelope.omissions];
  const sentences = envelope.sentences.map((original) => {
    let s = { ...original };
    if (
      s.financialFacts !== undefined &&
      !ResearchSentence.shape.financialFacts.safeParse(s.financialFacts).success
    ) {
      omissions.push(
        `Optional typed financial quantities for ${String(s.id)} withheld because their fields were invalid.`,
      );
      s = { ...s, financialFacts: [] };
    }
    if (s.novelty !== undefined && !Novelty.safeParse(s.novelty).success) {
      omissions.push(
        `Novelty for ${String(s.id)} was invalid and remains unknown.`,
      );
      s = {
        ...s,
        novelty: {
          status: "unknown",
          baselineIds: [],
          reason: "Invalid proposed novelty.",
        },
      };
    }

    if (
      s.calculation != null &&
      !ResearchSentence.shape.calculation.safeParse(s.calculation).success
    ) {
      omissions.push(
        `Optional calculation for ${String(s.id)} withheld: unsupported expression or invalid inputs. The underlying sentence still requires independent review.`,
      );
      return { ...s, calculation: null };
    }
    return s;
  });
  // Keep the UI bounded and explicitly disclose any additional retained limitations.
  const draft = ResearchDraft.parse({
    ...envelope,
    mainTopics: envelope.mainTopics,
    sentences,
    omissions:
      omissions.length > 30
        ? [
            ...omissions.slice(0, 29),
            `${omissions.length - 29} additional limitations are retained in the model response.`,
          ]
        : omissions,
  });
  return draft;
}

/** Candidate coverage only, never a recommendation classifier. A later model
 * and the independent critic must both evaluate the surrounding source. */
export function actionRecallWindows(run: Run) {
  const source = (run.output.source as SourceData).segments;
  const covered = new Set<string>();
  for (const item of ((run.output.claims ?? []) as CheckedClaim[]).filter(
    (c) => c.passed && !c.reasons?.length,
  ))
    for (const e of item.claim.evidence) {
      const first = source.findIndex((c) => c.id === e.segment_id),
        last = source.findIndex(
          (c) => c.id === (e.end_segment_id ?? e.segment_id),
        );
      if (first >= 0 && last >= first)
        for (const c of source.slice(first, last + 1)) covered.add(c.id);
    }
  const expression =
    /\b(?:I\s*(?:am|'m|’m)\s+(?:(?:not|still|very)\s+)?(?:bullish|bearish|long|short|holding|buying|selling)|I\s+(?:will buy|would buy|own|bought|sold|hold|recommend)|stocks\s+(?:that\s+)?I\s+will\s+buy)\b|\b(?:valuation|moat|cash.flow|leverage|dilution|entry.price|countercase|not.(?:own|hold|short)|hypothetical|margin.pressure)\b|\b(?:one\s+of\s+my\s+(?:core\s+)?holdings?|my\s+(?:core|largest)\s+(?:holdings?|positions?)|not\s+(?:a|the)\s+sector\s+that\s+I\s+(?:absolutely\s+)?(?:love|like))\b|我.{0,6}(?:看好|看空|买入|持有|减仓|加仓|卖出)|估值|护城河|現金流|现金流|杠杆|槓桿|稀释|稀釋|沒有持倉|没有持仓/i;
  const ranges: { start: number; end: number }[] = [];
  source.forEach((cue, i) => {
    if (
      covered.has(cue.id) ||
      !expression.test(
        source
          .slice(Math.max(0, i - 1), i + 2)
          .map((c) => c.text)
          .join(" "),
      )
    )
      return;
    const start = Math.max(0, i - 18),
      end = Math.min(source.length, i + 28);
    const prior = ranges.at(-1);
    if (prior && start <= prior.end) prior.end = Math.max(prior.end, end);
    else ranges.push({ start, end });
  });
  return ranges.map((r) => source.slice(r.start, r.end));
}
