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
export const Env = z.object({
  GEMINI_API_KEY: secret, // required; production transport
  OPENROUTER_API_KEY: secret, // required; critic and context check
  YOUTUBE_API_KEY: secret, // required; metadata and discovery
  TRANSCRIPTAPI_API_KEY: secret, // required; caption draft
  SUPADATA_API_KEY: secret, // optional; standby provider
  FMP_API_KEY: secret, // required; prices, filings, news
  EXA_API_KEY: secret, // optional; date-bounded web sources
  DATABASE_URL: secret, // required; Postgres
  YTI_PUSH_CALLBACK_SECRET: secret, // required when channels.discovery=push
  YTI_HARD_BUDGET_USD_MONTH: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().finite().min(0).optional(),
  ), // absolute ceiling the UI cannot raise
  RESEND_API_KEY: secret, // optional; digest delivery
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
