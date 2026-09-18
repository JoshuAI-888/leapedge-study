import { createHash } from "node:crypto";
import { z } from "zod";
import { modelFamily } from "./model-family.ts";
/**
 * Settings schemas from spec section 6.
 *
 * Three layers: the server environment (env.ts) holds credentials and hard
 * limits; TeamPreferences holds what an administrator sets for everyone;
 * AccountPreferences holds what each viewer may change for their own view.
 * Every key has a default that is safe on cost. Account keys that mirror
 * `team.accountDefaults` are nullable, and null means "use the team default";
 * resolveAccount() fills them.
 */
const timezone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Unknown timezone");
export const Transport = z.enum(["google-native", "openrouter"]);
export const TrustLevel = z.enum([
  "text-checked",
  "audio-agreed",
  "human-verified",
]);
export const Market = z.enum(["us-stock", "us-etf", "hk", "cn-a", "other"]);
export const Conviction = z.enum(["high", "medium", "low"]);
export const ThinkingBudget = z.enum(["low", "medium", "high"]);
export const Benchmark = z.union([
  z.enum(["SPY", "QQQ", "IWM", "sector-etf", "none"]),
  z.string().regex(/^custom:[A-Z0-9.^=-]{1,20}$/, "custom:<TICKER>"),
]);
export const SentimentPeriodDays = z.union([
  z.literal(7),
  z.literal(14),
  z.literal(30),
]);
export const ChangeWindow = z.union([
  z.literal(7),
  z.literal(14),
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.iso.date(),
]);
export const HorizonDays = z.union([
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);
const share = z.number().min(0).max(1);
/** Promotion-gate thresholds (spec 4.9). Shares are 0..1; the cost cap is USD per accepted claim. */
export const GateThresholds = z
  .object({
    goldPrecisionMin: share.default(0.9),
    goldRecallMin: share.default(0.8),
    anchorWithin2sMin: share.default(0.95),
    costPerAcceptedClaimMaxUsd: z.number().min(0).default(0.25),
    // Advisory results are reported but can never fail the gate.
    advisoryPolicy: z.literal("report-only").default("report-only"),
  })
  .prefault({});
export type GateThresholdsData = z.infer<typeof GateThresholds>;
const modelSpec = (id: string, transport: z.infer<typeof Transport>) =>
  z
    .object({
      id: z.string().min(1).default(id),
      transport: Transport.default(transport),
    })
    .prefault({});
export const TeamPreferences = z.object({
  transport: z
    .object({
      default: Transport.default("google-native"),
      fallbackToOpenRouter: z.boolean().default(false),
      allowOpenRouterInLab: z.boolean().default(true),
    })
    .prefault({}),
  models: z
    .object({
      transcription: modelSpec("gemini-3.8-flash", "google-native"),
      extraction: modelSpec("gemini-3.8-flash", "google-native"),
      critique: z
        .object({
          id: z.string().min(1).default("anthropic/claude-sonnet-5"),
          transport: Transport.default("openrouter"),
          requireDifferentFamily: z.boolean().default(true),
          thinkingBudget: ThinkingBudget.default("low"),
        })
        .prefault({}),
      context: modelSpec("anthropic/claude-sonnet-5", "openrouter"),
      translation: modelSpec("gemini-3.1-flash-lite", "google-native"),
      audioReview: modelSpec("gemini-3.8-flash", "google-native"),
    })
    .prefault({}),
  sources: z
    .object({
      captionProvider: z.enum(["transcriptapi", "none"]).default("transcriptapi"),
      standby: z.enum(["supadata", "none"]).default("supadata"),
      standbyPlan: z.enum(["free", "basic", "pro", "mega"]).default("free"),
      standbyCooldownMinutes: z.number().int().min(0).max(1440).default(15),
      asr: z
        .enum(["gemini-windowed", "gemini-file", "chirp3", "off"])
        .default("gemini-windowed"),
      asrPolicy: z
        .enum(["always", "when-captions-missing", "on-demand"])
        .default("when-captions-missing"),
      windowSeconds: z.number().int().min(120).max(600).default(300),
      mediaResolution: z.enum(["low", "default"]).default("low"),
      agenticAudioReview: z.boolean().default(true),
      agreementThreshold: z.number().min(0).max(1).default(0.92),
      tieBreakWithStandby: z.boolean().default(true),
      captionLanguages: z
        .array(z.string().min(2).max(12))
        .min(1)
        .default(["zh", "zh-Hans", "zh-Hant", "en"]),
    })
    .prefault({}),
  context: z
    .object({
      enabled: z.boolean().default(true),
      windowDaysBefore: z.number().int().min(0).max(365).default(14),
      windowDaysAfter: z.number().int().min(0).max(365).default(2),
      webSearch: z.enum(["off", "exa"]).default("off"),
      sinceThenAtSettlement: z.boolean().default(true),
    })
    .prefault({}),
  processing: z
    .object({
      userSubmitted: z.enum(["immediate", "batch"]).default("immediate"),
      channelUploads: z.enum(["immediate", "batch"]).default("batch"),
      contextCaching: z.boolean().default(true),
      maxRetriesPerStage: z.number().int().min(0).max(10).default(3),
      parallelVideos: z.number().int().min(1).max(32).default(4),
      chunkAboveTokens: z.number().int().min(10000).default(700000),
    })
    .prefault({}),
  budget: z
    .object({
      monthlyUsd: z.number().min(0).default(150),
      alertAtPercent: z.number().int().min(1).max(100).default(70),
      perVideoMaxUsd: z.number().min(0).default(1.5),
      unknownOutcomeHoldMinutes: z.number().int().min(0).default(60),
    })
    .prefault({}),
  channels: z
    .object({
      discovery: z.enum(["push", "poll"]).default("push"),
      pollIntervalMinutes: z.number().int().min(5).max(1440).default(60),
      // Spec 6.2 states these four, and a stored team preferences document may
      // carry them, so they stay parsed: dropping a key here does not tidy it
      // away, it makes the next save discard whatever a team had chosen.
      //
      // What they are NOT is the rule the seed runs on. seed/channels.ts holds
      // that, and every selection it puts into force is recorded as a versioned
      // document, so the history reads as a series of decisions. Until a
      // Settings surface exists to edit them (phase 3b, F48), these are stored
      // and round-tripped, and the seed does not read them.
      seedDefaults: z.boolean().default(true),
      defaultSelection: z
        .array(z.string().min(1))
        .default(["tier1", "leapedge-top20"]),
      selection: z.array(z.string().min(1)).default([]),
      autoAnalyzeNewChannels: z.boolean().default(false),
      historicalReplay: z
        .object({
          tiers: z.array(z.string().min(1)).default(["tier1"]),
          from: z.iso.date().default("2026-01-01"),
        })
        .prefault({}),
    })
    .prefault({}),
  accountDefaults: z
    .object({
      benchmark: Benchmark.default("SPY"),
      sentimentPeriodDays: SentimentPeriodDays.default(7),
      changeWindowDays: ChangeWindow.default(30),
      marketFilter: z.array(Market).min(1).default(["us-stock", "us-etf"]),
      defaultHorizonDays: HorizonDays.default(90),
    })
    .prefault({}),
  leaderboard: z
    .object({
      markets: z
        .array(Market)
        .min(1)
        .default(["us-stock", "us-etf", "hk", "cn-a", "other"]),
      minSettledForRank: z.number().int().min(1).default(20),
      fdrQ: z.number().gt(0).lt(1).default(0.05),
      minSettledPerTicker: z.number().int().min(1).default(10),
      convictionIncluded: z.array(Conviction).min(1).default(["high", "medium"]),
      minimumTrust: TrustLevel.default("audio-agreed"),
    })
    .prefault({}),
  trust: z
    .object({
      minimumLevelForToday: TrustLevel.default("audio-agreed"),
      showExtractedInLab: z.boolean().default(true),
    })
    .prefault({}),
  sharing: z
    .object({
      expiry: z.enum(["never", "7d", "30d", "90d"]).default("never"),
      allowRevoke: z.boolean().default(true),
    })
    .prefault({}),
  corpus: z
    .object({
      fileSearch: z.boolean().default(true),
      retentionDays: z.number().int().min(1).default(365),
    })
    .prefault({}),
  // Lab settings. `gates` holds the promotion-gate thresholds (spec 4.9, 9)
  // read by scripts/promotion-gate.ts. They decide whether a configuration
  // may be promoted, not how a run is produced, so they are outside the
  // configuration hash. Advisory results (a gold set below its minimum of
  // verified cases) are reported next to the binding ones but never fail
  // the gate; `advisoryPolicy` fixes that rule at the boundary.
  lab: z
    .object({
      gates: GateThresholds,
    })
    .prefault({}),
  // Not in the 6.2 listing, but the spec's rule "changing a model, transport,
  // prompt or provider creates a new configuration hash" needs the active
  // prompt version to live with the other hashed keys.
  prompts: z
    .object({
      version: z
        .string()
        .regex(/^[a-zA-Z0-9._-]{3,100}$/)
        .default("evidence-first.web.v5"),
    })
    .prefault({}),
});
export type TeamPreferencesData = z.infer<typeof TeamPreferences>;
export const AccountPreferences = z.object({
  benchmark: Benchmark.nullable().default(null),
  sentiment: z
    .object({
      periodDays: SentimentPeriodDays.nullable().default(null),
      minimumTrust: TrustLevel.default("text-checked"),
    })
    .prefault({}),
  changeWindowDays: ChangeWindow.nullable().default(null),
  marketFilter: z.array(Market).min(1).nullable().default(null),
  defaultHorizonDays: HorizonDays.nullable().default(null),
  todayTrustFilter: TrustLevel.nullable().default(null),
  digest: z
    .object({
      enabled: z.boolean().default(true),
      hourLocal: z.number().int().min(0).max(23).default(7),
      timezone: timezone.default("Pacific/Auckland"),
      deliverTo: z
        .array(z.enum(["finradar-briefing", "email"]))
        .default(["finradar-briefing", "email"]),
    })
    .prefault({}),
  display: z
    .object({
      language: z.enum(["en", "zh"]).default("en"),
      theme: z.enum(["light", "dark", "system"]).default("system"),
    })
    .prefault({}),
});
export type AccountPreferencesData = z.infer<typeof AccountPreferences>;
/** An account document with every team-defaulted key filled in. */
export const ResolvedAccountPreferences = AccountPreferences.extend({
  benchmark: Benchmark,
  sentiment: z.object({
    periodDays: SentimentPeriodDays,
    minimumTrust: TrustLevel,
  }),
  changeWindowDays: ChangeWindow,
  marketFilter: z.array(Market).min(1),
  defaultHorizonDays: HorizonDays,
  todayTrustFilter: TrustLevel,
});
export type ResolvedAccountPreferencesData = z.infer<
  typeof ResolvedAccountPreferences
>;
export function teamDefaults(): TeamPreferencesData {
  return TeamPreferences.parse({});
}
/** The account view a new viewer gets under this team's defaults. */
export function accountDefaults(
  team: TeamPreferencesData,
): ResolvedAccountPreferencesData {
  return resolveAccount(team, AccountPreferences.parse({}));
}
/** Fills every null account key from the team's accountDefaults and trust. */
export function resolveAccount(
  team: TeamPreferencesData,
  account: AccountPreferencesData,
): ResolvedAccountPreferencesData {
  const d = team.accountDefaults;
  return ResolvedAccountPreferences.parse({
    ...account,
    benchmark: account.benchmark ?? d.benchmark,
    sentiment: {
      ...account.sentiment,
      periodDays: account.sentiment.periodDays ?? d.sentimentPeriodDays,
    },
    changeWindowDays: account.changeWindowDays ?? d.changeWindowDays,
    marketFilter: account.marketFilter ?? [...d.marketFilter],
    defaultHorizonDays: account.defaultHorizonDays ?? d.defaultHorizonDays,
    todayTrustFilter:
      account.todayTrustFilter ?? team.trust.minimumLevelForToday,
  });
}
/**
 * Applies YTI_HARD_BUDGET_USD_MONTH: an absolute ceiling the UI cannot raise.
 * The per-video cap can never exceed the month. Pure; returns a new object.
 */
export function applyHardCeiling(
  team: TeamPreferencesData,
  hardBudgetUsdMonth: number | undefined,
): TeamPreferencesData {
  if (hardBudgetUsdMonth === undefined || !Number.isFinite(hardBudgetUsdMonth))
    return team;
  const monthlyUsd = Math.min(team.budget.monthlyUsd, hardBudgetUsdMonth);
  return {
    ...team,
    budget: {
      ...team.budget,
      monthlyUsd,
      perVideoMaxUsd: Math.min(team.budget.perVideoMaxUsd, monthlyUsd),
    },
  };
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  return value;
}
/** The keys whose change produces a new immutable configuration hash. */
export function hashedConfiguration(team: TeamPreferencesData) {
  return {
    transport: team.transport,
    models: team.models,
    sources: team.sources,
    context: team.context,
    processing: {
      contextCaching: team.processing.contextCaching,
      chunkAboveTokens: team.processing.chunkAboveTokens,
    },
    trust: team.trust,
    prompts: team.prompts,
  };
}
/**
 * SHA-256 over a key-sorted JSON of the trust- and model-affecting keys.
 * Independent of key order and of budget, channel, sharing, corpus and
 * account-default settings, which change nothing about how a run is produced.
 */
export function configHash(team: TeamPreferencesData): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(hashedConfiguration(team))))
    .digest("hex");
}
/** The pre-v2 flat preferences document (research-store `Preferences`). */
export const LegacyPreferences = z.object({
  timezone: z.string().optional(),
  model: z.string().min(1).optional(),
  criticModel: z.string().min(1).optional(),
  transcriptionModel: z.string().min(1).optional(),
  windowedTranscription: z.boolean().optional(),
  nativeGoogleExperimental: z.boolean().optional(),
  promptVersion: z.string().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  digestEnabled: z.boolean().optional(),
  autoPullEnabled: z.boolean().optional(),
});
export type LegacyPreferencesData = z.infer<typeof LegacyPreferences>;
/**
 * One-way mapping of the old flat document into the two v2 documents. Model
 * ids stay as they were (OpenRouter ids) on the OpenRouter transport, which
 * is what the old system ran them through; the native transcription
 * experiment maps to the google-native transport.
 */
export function migrateLegacyPreferences(input: unknown): {
  team: TeamPreferencesData;
  account: AccountPreferencesData;
} {
  const old = LegacyPreferences.parse(input ?? {});
  const team = teamDefaults();
  const account = AccountPreferences.parse({});
  if (old.model) {
    team.models.extraction = { id: old.model, transport: "openrouter" };
    team.models.audioReview = { id: old.model, transport: "openrouter" };
  }
  if (old.criticModel)
    team.models.critique = {
      ...team.models.critique,
      id: old.criticModel,
      transport: "openrouter",
    };
  if (old.transcriptionModel)
    team.models.transcription = {
      id: old.transcriptionModel,
      transport: old.nativeGoogleExperimental ? "google-native" : "openrouter",
    };
  // The legacy document has no critic-family requirement, and every model it
  // could name is a Google one, so carrying the v2 default over would leave
  // the migrated team rejecting its own critic on the first critique call.
  // Spec 4.1: a Google-only configuration remains valid; the requirement is a
  // setting an administrator turns on once a cross-family critic is chosen.
  if (
    modelFamily(team.models.critique.id) ===
    modelFamily(team.models.extraction.id)
  )
    team.models.critique.requireDifferentFamily = false;
  if (old.promptVersion) team.prompts.version = old.promptVersion;
  if (old.autoPullEnabled !== undefined)
    team.channels.discovery = old.autoPullEnabled ? "poll" : "push";
  if (old.windowedTranscription) team.sources.windowSeconds = 600;
  if (old.timezone && timezone.safeParse(old.timezone).success)
    account.digest.timezone = old.timezone;
  if (old.digestHour !== undefined) account.digest.hourLocal = old.digestHour;
  if (old.digestEnabled !== undefined)
    account.digest.enabled = old.digestEnabled;
  if (old.theme) account.display.theme = old.theme;
  return {
    team: TeamPreferences.parse(team),
    account: AccountPreferences.parse(account),
  };
}
