import { z } from "zod";
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
  dateBasis: z.string(),
  sourceClass: z.enum(["primary", "secondary", "unknown"]),
  hash: z.string(),
  query: z.string(),
  timeMode: z.enum(["video_date", "current"]),
  provider: z.string(),
});
export type ExternalEvidenceData = z.infer<typeof ExternalEvidence>;
export function eligibleExternal(
  source: Pick<ExternalEvidenceData, "publishedAt" | "publicationConfirmed">,
  context: AnalysisContextData,
  mode: "video_date" | "current",
) {
  if (!source.publicationConfirmed || !source.publishedAt) return false;
  if (Date.parse(source.publishedAt) > Date.parse(context.analysedAt))
    return false;
  if (mode === "current")
    return Date.parse(source.publishedAt) <= Date.parse(context.analysedAt);
  const cutoff = context.recordedAt ?? context.videoPublishedAt;
  return !!cutoff && Date.parse(source.publishedAt) <= Date.parse(cutoff);
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
    "percent",
    "percentage_points",
    "multiple",
    "contracts",
    "capacity",
    "other",
  ]),
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
  mainTopics: z.array(z.string()).max(8),
  omissions: z.array(z.string()).max(30),
});
export const ResearchVerdict = z.object({
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
  thesisSupportIds: z.array(z.string()).max(8).default([]),
});
export const ResearchAudit = z.object({
  verdicts: z.array(ResearchVerdict).max(48),
  coverageFindings: z.array(z.string()).max(30),
});
export type AcceptedSentence = ResearchSentenceData & {
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
    if (reasons.length) {
      rejected.push({ sentence, reasons });
      continue;
    }
    const sources = sentence.externalIds.map((id) => ext.get(id)!);
    const primary = sources.some((s) => s.sourceClass === "primary");
    const factualStatus = primary ? audit!.factualStatus : "unverified";
    const withheldExternalAudit = !primary && audit!.factualStatus !== "unverified";
    const withheldReason = "External-verification assessment withheld: this sentence has no eligible cited primary evidence. The original audit is retained in the run trace; external corroboration or contradiction has not been established.";
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
      factualStatus,
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
    mainTopics: envelope.mainTopics.slice(0, 8),
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
    /\b(?:I\s*(?:am|'m|’m)\s+(?:(?:not|still|very)\s+)?(?:bullish|bearish|long|short|holding|buying|selling)|I\s+(?:will buy|would buy|own|bought|sold|hold|recommend)|stocks\s+(?:that\s+)?I\s+will\s+buy)\b|我.{0,6}(?:看好|看空|买入|持有|减仓|加仓|卖出)/i;
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
