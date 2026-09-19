import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TeamPreferences,
  AccountPreferences,
  teamDefaults,
  accountDefaults,
  applyHardCeiling,
  configHash,
  resolveAccount,
  migrateLegacyPreferences,
} from "../src/features/youtube-intelligence/settings.ts";
import {
  Env,
  readEnv,
  resolveTeam,
  missingRequired,
} from "../src/server/youtube-intelligence/env.ts";
import { freshDatabase } from "./helpers/db.ts";

test("Team and account defaults parse from an empty object and match spec 6.2 / 6.3", () => {
  const team = teamDefaults();
  assert.equal(team.transport.default, "google-native");
  assert.equal(team.transport.fallbackToOpenRouter, false);
  assert.equal(team.transport.allowOpenRouterInLab, true);
  assert.deepEqual(team.models.transcription, {
    id: "gemini-3.8-flash",
    transport: "google-native",
  });
  assert.deepEqual(team.models.critique, {
    id: "anthropic/claude-sonnet-5",
    transport: "openrouter",
    requireDifferentFamily: true,
    thinkingBudget: "low",
  });
  assert.equal(team.models.translation.id, "gemini-3.1-flash-lite");
  assert.equal(team.sources.captionProvider, "transcriptapi");
  assert.equal(team.sources.standby, "supadata");
  assert.equal(team.sources.standbyPlan, "free");
  assert.equal(team.sources.standbyCooldownMinutes, 15);
  assert.equal(team.sources.asr, "gemini-windowed");
  assert.equal(team.sources.asrPolicy, "when-captions-missing");
  assert.equal(team.sources.windowSeconds, 300);
  assert.equal(team.sources.mediaResolution, "low");
  assert.equal(team.sources.agenticAudioReview, true);
  assert.equal(team.sources.agreementThreshold, 0.92);
  assert.equal(team.sources.tieBreakWithStandby, true);
  assert.deepEqual(team.sources.captionLanguages, [
    "zh",
    "zh-Hans",
    "zh-Hant",
    "en",
  ]);
  assert.deepEqual(team.context, {
    enabled: true,
    windowDaysBefore: 14,
    windowDaysAfter: 2,
    webSearch: "off",
    sinceThenAtSettlement: true,
  });
  assert.deepEqual(team.processing, {
    userSubmitted: "immediate",
    channelUploads: "batch",
    contextCaching: true,
    maxRetriesPerStage: 3,
    parallelVideos: 4,
    chunkAboveTokens: 700000,
  });
  assert.deepEqual(team.budget, {
    monthlyUsd: 150,
    alertAtPercent: 70,
    perVideoMaxUsd: 1.5,
    unknownOutcomeHoldMinutes: 60,
  });
  assert.equal(team.channels.discovery, "push");
  assert.equal(team.channels.pollIntervalMinutes, 60);
  assert.equal(team.channels.seedDefaults, true);
  assert.deepEqual(team.channels.defaultSelection, ["tier1", "leapedge-top20"]);
  assert.deepEqual(team.channels.selection, []);
  assert.equal(team.channels.autoAnalyzeNewChannels, false);
  // A team that has chosen channels has them in its stored document, and the
  // schema is what decides whether the next save keeps them: zod strips what it
  // does not declare, so deleting one of these keys silently discards the
  // choice on the following write rather than failing anywhere visible.
  const chosen = TeamPreferences.parse({
    channels: { selection: ["UC1"], autoAnalyzeNewChannels: true },
  });
  assert.deepEqual(chosen.channels.selection, ["UC1"]);
  assert.equal(chosen.channels.autoAnalyzeNewChannels, true);
  assert.deepEqual(team.channels.historicalReplay, {
    tiers: ["tier1"],
    from: "2026-01-01",
  });
  assert.deepEqual(team.accountDefaults, {
    benchmark: "SPY",
    sentimentPeriodDays: 7,
    changeWindowDays: 30,
    marketFilter: ["us-stock", "us-etf"],
    defaultHorizonDays: 90,
  });
  assert.deepEqual(team.leaderboard, {
    markets: ["us-stock", "us-etf", "hk", "cn-a", "other"],
    minSettledForRank: 20,
    fdrQ: 0.05,
    minSettledPerTicker: 10,
    convictionIncluded: ["high", "medium"],
    minimumTrust: "audio-agreed",
  });
  assert.deepEqual(team.trust, {
    minimumLevelForToday: "audio-agreed",
    showExtractedInLab: true,
  });
  assert.deepEqual(team.sharing, { expiry: "never", allowRevoke: true });
  assert.deepEqual(team.corpus, { fileSearch: true, retentionDays: 365 });
  assert.equal(team.prompts.version, "evidence-first.web.v8");
  // Parsing the defaults again is a no-op.
  assert.deepEqual(TeamPreferences.parse(team), team);

  const account = AccountPreferences.parse({});
  assert.equal(account.benchmark, null);
  assert.equal(account.sentiment.periodDays, null);
  assert.equal(account.sentiment.minimumTrust, "text-checked");
  assert.equal(account.changeWindowDays, null);
  assert.equal(account.marketFilter, null);
  assert.equal(account.defaultHorizonDays, null);
  assert.equal(account.todayTrustFilter, null);
  assert.deepEqual(account.digest, {
    enabled: true,
    hourLocal: 7,
    timezone: "Pacific/Auckland",
    deliverTo: ["finradar-briefing", "email"],
  });
  assert.deepEqual(account.display, { language: "en", theme: "system" });
  assert.deepEqual(AccountPreferences.parse(account), account);
});

test("Schemas reject values outside the spec enums and ranges", () => {
  assert.throws(() =>
    TeamPreferences.parse({ sources: { windowSeconds: 30 } }),
  );
  assert.throws(() =>
    TeamPreferences.parse({ transport: { default: "anthropic" } }),
  );
  assert.throws(() =>
    TeamPreferences.parse({ sources: { agreementThreshold: 1.5 } }),
  );
  assert.throws(() => AccountPreferences.parse({ benchmark: "custom:" }));
  assert.throws(() => AccountPreferences.parse({ defaultHorizonDays: 45 }));
  assert.throws(() =>
    AccountPreferences.parse({ digest: { timezone: "Mars/Olympus" } }),
  );
  assert.equal(
    AccountPreferences.parse({ benchmark: "custom:NVDA" }).benchmark,
    "custom:NVDA",
  );
  assert.equal(
    AccountPreferences.parse({ changeWindowDays: "2026-03-01" })
      .changeWindowDays,
    "2026-03-01",
  );
});

test("The hard monthly ceiling caps budget.monthlyUsd but never raises it", () => {
  const team = TeamPreferences.parse({ budget: { monthlyUsd: 900 } });
  assert.equal(applyHardCeiling(team, 200).budget.monthlyUsd, 200);
  assert.equal(applyHardCeiling(team, undefined).budget.monthlyUsd, 900);
  assert.equal(applyHardCeiling(team, 5000).budget.monthlyUsd, 900);
  // The per-video cap can never exceed the month.
  const capped = applyHardCeiling(
    TeamPreferences.parse({ budget: { monthlyUsd: 900, perVideoMaxUsd: 3 } }),
    2,
  );
  assert.equal(capped.budget.monthlyUsd, 2);
  assert.equal(capped.budget.perVideoMaxUsd, 2);
  // Through the environment.
  const env = Env.parse({ YTI_HARD_BUDGET_USD_MONTH: "120" });
  assert.equal(env.YTI_HARD_BUDGET_USD_MONTH, 120);
  assert.equal(resolveTeam(team, env).budget.monthlyUsd, 120);
  assert.equal(resolveTeam(team, Env.parse({})).budget.monthlyUsd, 900);
  assert.throws(() => Env.parse({ YTI_HARD_BUDGET_USD_MONTH: "lots" }));
});

test("readEnv validates lazily and reports key names, never values", () => {
  const good = readEnv({
    GEMINI_API_KEY: "sk-secret-value",
    YTI_HARD_BUDGET_USD_MONTH: "80",
  });
  assert.equal(good.GEMINI_API_KEY, "sk-secret-value");
  assert.equal(good.YTI_HARD_BUDGET_USD_MONTH, 80);
  assert.equal(good.OPENROUTER_API_KEY, undefined);
  // An empty string counts as unset.
  assert.equal(readEnv({ FMP_API_KEY: "" }).FMP_API_KEY, undefined);
  assert.throws(
    () => readEnv({ YTI_HARD_BUDGET_USD_MONTH: "-3" }),
    (e: unknown) => {
      const m = (e as Error).message;
      assert.match(m, /YTI_HARD_BUDGET_USD_MONTH/);
      assert.doesNotMatch(m, /-3/);
      return true;
    },
  );
  assert.throws(
    () => readEnv({ YTI_HARD_BUDGET_USD_MONTH: "hunter2" }),
    (e: unknown) => {
      assert.doesNotMatch((e as Error).message, /hunter2/);
      return true;
    },
  );
  const team = teamDefaults();
  const missing = missingRequired(readEnv({}), team);
  assert.ok(missing.includes("GEMINI_API_KEY"));
  assert.ok(missing.includes("DATABASE_URL"));
  assert.ok(missing.includes("YTI_PUSH_CALLBACK_SECRET"));
  assert.ok(!missing.includes("SUPADATA_API_KEY"));
  assert.ok(!missing.includes("RESEND_API_KEY"));
  const polled = TeamPreferences.parse({
    ...team,
    channels: { ...team.channels, discovery: "poll" },
  });
  assert.ok(
    !missingRequired(readEnv({}), polled).includes("YTI_PUSH_CALLBACK_SECRET"),
  );
  assert.deepEqual(
    missingRequired(
      readEnv({
        GEMINI_API_KEY: "a",
        OPENROUTER_API_KEY: "b",
        YOUTUBE_API_KEY: "c",
        TRANSCRIPTAPI_API_KEY: "d",
        FMP_API_KEY: "e",
        DATABASE_URL: "f",
        YTI_PUSH_CALLBACK_SECRET: "g",
      }),
      team,
    ),
    [],
  );
});

test("configHash is stable across key order and irrelevant keys, and changes when a model changes", () => {
  const team = teamDefaults();
  const reordered = JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(team).reverse())),
  ) as typeof team;
  reordered.models = Object.fromEntries(
    Object.entries(team.models).reverse(),
  ) as typeof team.models;
  const base = configHash(team);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(configHash(reordered), base);
  // Budget, channels, sharing and account defaults do not affect the hash.
  assert.equal(
    configHash({
      ...team,
      budget: { ...team.budget, monthlyUsd: 10 },
      channels: { ...team.channels, selection: ["UC1"] },
      accountDefaults: { ...team.accountDefaults, benchmark: "QQQ" },
    }),
    base,
  );
  assert.notEqual(
    configHash({
      ...team,
      models: {
        ...team.models,
        critique: { ...team.models.critique, id: "openai/gpt-6" },
      },
    }),
    base,
  );
  assert.notEqual(
    configHash({
      ...team,
      sources: { ...team.sources, agreementThreshold: 0.9 },
    }),
    base,
  );
  assert.notEqual(
    configHash({
      ...team,
      trust: { ...team.trust, minimumLevelForToday: "human-verified" },
    }),
    base,
  );
  assert.notEqual(
    configHash({ ...team, prompts: { version: "evidence-first.web.v6" } }),
    base,
  );
});

test("resolveAccount fills nulls from the team's account defaults and keeps explicit choices", () => {
  const team = TeamPreferences.parse({
    accountDefaults: {
      benchmark: "QQQ",
      sentimentPeriodDays: 14,
      changeWindowDays: 90,
      marketFilter: ["hk"],
      defaultHorizonDays: 180,
    },
    trust: { minimumLevelForToday: "human-verified" },
  });
  const defaults = accountDefaults(team);
  assert.equal(defaults.benchmark, "QQQ");
  assert.equal(defaults.sentiment.periodDays, 14);
  assert.equal(defaults.changeWindowDays, 90);
  assert.deepEqual(defaults.marketFilter, ["hk"]);
  assert.equal(defaults.defaultHorizonDays, 180);
  assert.equal(defaults.todayTrustFilter, "human-verified");
  const resolved = resolveAccount(team, AccountPreferences.parse({}));
  assert.deepEqual(resolved, defaults);
  const chosen = resolveAccount(
    team,
    AccountPreferences.parse({
      benchmark: "none",
      sentiment: { periodDays: 30, minimumTrust: "audio-agreed" },
      marketFilter: ["us-stock", "cn-a"],
      todayTrustFilter: "text-checked",
    }),
  );
  assert.equal(chosen.benchmark, "none");
  assert.equal(chosen.sentiment.periodDays, 30);
  assert.equal(chosen.sentiment.minimumTrust, "audio-agreed");
  assert.equal(chosen.changeWindowDays, 90);
  assert.deepEqual(chosen.marketFilter, ["us-stock", "cn-a"]);
  assert.equal(chosen.defaultHorizonDays, 180);
  assert.equal(chosen.todayTrustFilter, "text-checked");
  // Resolution is pure: the account object is not mutated.
  const account = AccountPreferences.parse({});
  resolveAccount(team, account);
  assert.equal(account.benchmark, null);
});

test("migrateLegacyPreferences maps the old flat document into team and account documents", () => {
  const { team, account } = migrateLegacyPreferences({
    timezone: "Europe/London",
    model: "google/gemini-3.8-flash",
    criticModel: "google/gemini-3.5-flash",
    transcriptionModel: "google/gemini-3.1-flash-lite",
    promptVersion: "evidence-first.web.v4",
    theme: "dark",
    digestHour: 6,
    digestEnabled: true,
    autoPullEnabled: true,
    windowedTranscription: true,
    nativeGoogleExperimental: false,
  });
  assert.equal(team.models.extraction.id, "google/gemini-3.8-flash");
  assert.equal(team.models.extraction.transport, "openrouter");
  assert.equal(team.models.audioReview.id, "google/gemini-3.8-flash");
  assert.equal(team.models.critique.id, "google/gemini-3.5-flash");
  assert.equal(team.models.critique.transport, "openrouter");
  assert.equal(team.models.transcription.id, "google/gemini-3.1-flash-lite");
  assert.equal(team.prompts.version, "evidence-first.web.v4");
  assert.equal(team.channels.discovery, "poll");
  assert.equal(team.sources.windowSeconds, 600);
  assert.equal(account.digest.timezone, "Europe/London");
  assert.equal(account.digest.hourLocal, 6);
  assert.equal(account.digest.enabled, true);
  assert.equal(account.display.theme, "dark");
  assert.deepEqual(TeamPreferences.parse(team), team);
  assert.deepEqual(AccountPreferences.parse(account), account);
});

test("Store: team and account documents migrate once from the old preferences doc, then live on their own", async () => {
  await freshDatabase();
  const R =
    await import("../src/server/youtube-intelligence/research-store.ts");
  await R.savePreferences({
    timezone: "Asia/Tokyo",
    model: "google/gemini-3.1-pro-preview",
    criticModel: "google/gemini-3.5-flash",
    promptVersion: "evidence-first.web.v5",
    theme: "light",
    digestHour: 21,
    digestEnabled: true,
    autoPullEnabled: false,
  });
  const team = await R.teamPreferences();
  assert.equal(team.models.extraction.id, "google/gemini-3.1-pro-preview");
  assert.equal(team.models.critique.id, "google/gemini-3.5-flash");
  assert.equal(team.channels.discovery, "push");
  assert.ok(await R.doc("teamPreferences", "default"));
  const account = await R.accountPreferences();
  assert.equal(account.digest.timezone, "Asia/Tokyo");
  assert.equal(account.digest.hourLocal, 21);
  assert.ok(await R.doc("accountPreferences", "default"));
  // The old API still works and later changes to it do not flow into the new docs.
  const legacy = await R.preferences();
  assert.equal(legacy.model, "google/gemini-3.1-pro-preview");
  await R.savePreferences({ ...legacy, model: "google/gemini-3.8-flash" });
  assert.equal(
    (await R.teamPreferences()).models.extraction.id,
    "google/gemini-3.1-pro-preview",
  );
  // Saving the new documents round-trips, and the hard ceiling is applied.
  const previous = process.env.YTI_HARD_BUDGET_USD_MONTH;
  process.env.YTI_HARD_BUDGET_USD_MONTH = "50";
  try {
    const saved = await R.saveTeamPreferences({
      ...team,
      budget: { ...team.budget, monthlyUsd: 400 },
      models: {
        ...team.models,
        critique: { ...team.models.critique, id: "anthropic/claude-sonnet-5" },
      },
    });
    assert.equal(saved.budget.monthlyUsd, 50);
    assert.equal(
      (await R.teamPreferences()).models.critique.id,
      "anthropic/claude-sonnet-5",
    );
    assert.equal((await R.teamPreferences()).budget.monthlyUsd, 50);
  } finally {
    if (previous === undefined) delete process.env.YTI_HARD_BUDGET_USD_MONTH;
    else process.env.YTI_HARD_BUDGET_USD_MONTH = previous;
  }
  await R.saveAccountPreferences({ ...account, benchmark: "IWM" }, "alice");
  assert.equal((await R.accountPreferences("alice")).benchmark, "IWM");
  assert.equal((await R.accountPreferences()).benchmark, null);
  await assert.rejects(R.saveTeamPreferences({ transport: { default: "x" } }));
});

test("Store: with no old document the team and account documents start from the spec defaults", async () => {
  await freshDatabase();
  const R =
    await import("../src/server/youtube-intelligence/research-store.ts");
  assert.deepEqual(await R.teamPreferences(), teamDefaults());
  assert.deepEqual(await R.accountPreferences(), AccountPreferences.parse({}));
  const resolved = await R.resolvedAccountPreferences();
  assert.equal(resolved.benchmark, "SPY");
});
