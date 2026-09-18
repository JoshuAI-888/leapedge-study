import { z } from "zod";
import {
  applyHardCeiling,
  type TeamPreferencesData,
} from "../../features/youtube-intelligence/settings.ts";
/**
 * Server environment (spec 6.1). Credentials and hard limits only; nothing
 * here is user-editable. Keys are read lazily by readEnv() so importing this
 * module never throws, and validation errors name keys, never values.
 */
const secret = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);
/** A non-negative amount of money or credits; blank counts as unset. */
const amount = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().finite().min(0).optional(),
);
export const Env = z.object({
  GEMINI_API_KEY: secret, // required; production transport
  OPENROUTER_API_KEY: secret, // required; critic and context check
  YOUTUBE_API_KEY: secret, // required; metadata and discovery
  TRANSCRIPTAPI_API_KEY: secret, // required; caption draft
  SUPADATA_API_KEY: secret, // optional; standby provider
  FMP_API_KEY: secret, // required; prices, filings, news
  EXA_API_KEY: secret, // optional; date-bounded web sources
  DATABASE_URL: secret, // required; the POOLED Postgres endpoint
  DATABASE_URL_UNPOOLED: secret, // required when hosted; the DIRECT endpoint
  YTI_PRODUCTION_DB_HOST: secret, // required when hosted; both database guards
  YTI_POOL_MAX: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(1).max(64).optional(),
  ), // clients per serving instance; database.ts owns the default
  YTI_QUEUE_PAUSED: secret, // "true" drains the queue before a migration
  YTI_PUSH_CALLBACK_SECRET: secret, // required when channels.discovery=push
  YTI_HARD_BUDGET_USD_MONTH: amount, // absolute ceiling the UI cannot raise
  RESEND_API_KEY: secret, // optional; digest delivery
  CRON_SECRET: secret, // required when hosted; the cron route rejects without it
  YTI_ACCESS_TOKEN: secret, // required when hosted; the workspace passcode
  YTI_APP_ORIGIN: secret, // required when hosted; the canonical origin
  YTI_PREVIEW_READ_ONLY: secret, // optional; "true" stops a preview dispatching
  YTI_EMAIL_TO: secret, // optional; digest recipient
  YTI_EMAIL_FROM: secret, // optional; digest sender
  YTI_EMAIL_SEND_ENABLED: secret, // optional; "true" allows live sending
  RESEND_WEBHOOK_SECRET: secret, // optional; delivery-event signatures
  YTI_BUDGET_USD: amount, // optional; cumulative ledger ceiling
  YTI_TRANSCRIPT_CREDIT_BUDGET: amount, // optional; per-provider credit cap
});
export type EnvData = z.infer<typeof Env>;
export type EnvKey = keyof EnvData;
export const ENV_KEYS = Object.keys(Env.shape) as EnvKey[];
const ALWAYS_REQUIRED: EnvKey[] = [
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "YOUTUBE_API_KEY",
  "TRANSCRIPTAPI_API_KEY",
  "FMP_API_KEY",
  "DATABASE_URL",
];
/**
 * Variables a hosted deployment cannot work without, and which a local run or a
 * test legitimately leaves unset, so they are reported separately rather than
 * folded into missingRequired(). DATABASE_URL_UNPOOLED belongs here and not in
 * ALWAYS_REQUIRED because a serving instance never opens the direct endpoint:
 * the build step and the maintenance scripts do, and directConnectionString()
 * already refuses when it is unset.
 */
const HOSTED_REQUIRED: EnvKey[] = [
  "DATABASE_URL_UNPOOLED",
  "YTI_PRODUCTION_DB_HOST",
  "CRON_SECRET",
  "YTI_ACCESS_TOKEN",
  "YTI_APP_ORIGIN",
];
/**
 * Validates the environment on demand. Throws an Error whose message lists
 * the offending key names and the rule they broke, never the values.
 */
export function readEnv(
  source: Record<string, string | undefined> = process.env,
): EnvData {
  const picked: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) picked[k] = source[k];
  const r = Env.safeParse(picked);
  if (r.success) return r.data;
  const problems = r.error.issues.map(
    (i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
  );
  throw Error(
    `Invalid server environment: ${[...new Set(problems)].join("; ")}.`,
  );
}
/** Required keys that are unset, given what the team settings enable. */
export function missingRequired(
  env: EnvData,
  team: TeamPreferencesData,
): EnvKey[] {
  const required = new Set<EnvKey>(ALWAYS_REQUIRED);
  // SUPADATA_API_KEY, EXA_API_KEY and RESEND_API_KEY are optional per spec
  // 6.1: without them the standby provider, web search and digest delivery
  // simply stay unavailable.
  if (team.channels.discovery === "push")
    required.add("YTI_PUSH_CALLBACK_SECRET");
  return [...required].filter((k) => env[k] === undefined);
}
/** Hosted-only keys that are unset. Names only; no value is ever returned. */
export function missingRequiredHosted(env: EnvData = readEnv()): EnvKey[] {
  return HOSTED_REQUIRED.filter((k) => env[k] === undefined);
}
/** Throws when a key the caller needs is unset; the message names the key only. */
export function requireEnv(key: EnvKey, env: EnvData = readEnv()): string {
  const v = env[key];
  if (typeof v !== "string" || !v) throw Error(`${key} is not set.`);
  return v;
}
/** Team preferences with the server's hard budget ceiling applied. */
export function resolveTeam(
  team: TeamPreferencesData,
  env: EnvData = readEnv(),
): TeamPreferencesData {
  return applyHardCeiling(team, env.YTI_HARD_BUDGET_USD_MONTH);
}
