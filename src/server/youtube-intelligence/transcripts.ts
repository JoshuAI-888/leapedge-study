import { db } from "./store.ts";
import { z } from "zod";
import {
  Source,
  type SourceData,
} from "../../features/youtube-intelligence/contracts.ts";
import {
  doc,
  docs,
  event,
  events,
  put,
  teamPreferences,
} from "./research-store.ts";
import {
  isOpen,
  trip,
  vendorErrorForFailure,
  vendorErrorForStatus,
  type VendorErrorKindName,
} from "./circuit-breaker.ts";
import type { TeamPreferencesData } from "../../features/youtube-intelligence/settings.ts";
export class SourcePending extends Error {}
export type CaptionProvider = "supadata" | "transcriptapi";
export function captionLanguageMatches(requested?: string, returned?: string) {
  if (!requested) return true;
  const primary = (value: string) =>
    value.toLowerCase().replace(/^asr-/, "").split(/[-_]/)[0];
  return !!returned && primary(requested) === primary(returned);
}
const Native = z.object({
  lang: z.string().optional(),
  content: z
    .array(
      z.object({
        text: z.string().min(1),
        offset: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
      }),
    )
    .min(1),
});
const Alternative = z.object({
  video_id: z.string(),
  language: z.string(),
  transcript: z
    .array(
      z.object({
        text: z.string().min(1),
        start: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
      }),
    )
    .min(1),
});
function separator(language?: string): "" | " " {
  return /^(zh|yue|ja)(-|$)/i.test((language || "").replace(/^asr-/, ""))
    ? ""
    : " ";
}
export function normalizeNative(
  value: unknown,
  videoId: string,
  generated = false,
): SourceData {
  const n = Native.parse(value);
  return Source.parse({
    video_id: videoId,
    language: n.lang,
    segment_separator: separator(n.lang),
    source_kind: generated
      ? "generated_transcript_supadata"
      : "native_captions_supadata",
    segments: n.content.map((s, i) => ({
      id: `s${String(i + 1).padStart(5, "0")}`,
      text: s.text,
      start_seconds: s.offset / 1000,
      end_seconds: (s.offset + s.duration) / 1000,
    })),
  });
}
export function normalizeTranscriptApi(
  value: unknown,
  videoId: string,
): SourceData {
  const n = Alternative.parse(value);
  if (n.video_id !== videoId) throw Error("Caption video ID mismatch.");
  return Source.parse({
    video_id: videoId,
    language: n.language,
    segment_separator: separator(n.language),
    source_kind: "native_captions_transcriptapi",
    segments: n.transcript.map((s, i) => ({
      id: `s${String(i + 1).padStart(5, "0")}`,
      text: s.text,
      start_seconds: s.start,
      end_seconds: s.start + s.duration,
    })),
  });
}
type Attempt = {
  id: string;
  provider: CaptionProvider;
  videoId: string;
  mode: string;
  at: string;
  status: string;
  credits: number;
  jobId?: string;
  http?: number;
  durationMs?: number;
  reason?: string;
  runtime?: string;
  number?: number;
  /** Set when the failure was the vendor's own (5xx, 429, network, timeout). */
  vendorError?: VendorErrorKindName | null;
};
/**
 * The attempt document id for one provider, mode, video and language. The
 * standby route reads the record back to tell "this video has no captions"
 * from "this vendor is down", which is the only distinction the circuit
 * breaker may act on (spec 4.10).
 */
export function captionAttemptId(
  provider: CaptionProvider,
  videoId: string,
  options: { generate?: boolean; language?: string } = {},
): string {
  const generated = !!options.generate;
  const language = generated ? undefined : options.language?.split("-")[0];
  return `${provider}:${generated ? "generate" : "native"}:${videoId}:${language || "original"}`;
}
/** Monthly credit allowance per Supadata plan, for the out-of-credits banner. */
const PLAN_ALLOWANCE = {
  free: 100,
  basic: 300,
  pro: 3000,
  mega: 30000,
} satisfies Record<TeamPreferencesData["sources"]["standbyPlan"], number>;
const ProviderAlert = z.object({
  kind: z.literal("credits_exhausted"),
  at: z.iso.datetime(),
  plan: z.enum(["free", "basic", "pro", "mega"]),
  monthlyAllowance: z.number().int().nonnegative(),
  detail: z.string().max(500).optional(),
});
export type ProviderAlertData = z.infer<typeof ProviderAlert> & {
  vendor: string;
};
/** True when the provider's answer says the account is out of credits. */
function creditsExhausted(
  status: number,
  body: { error?: unknown; details?: unknown; message?: unknown },
): boolean {
  if (status === 429 || body.error === "limit-exceeded") return true;
  return /credit|out of credits|quota/i.test(
    `${body.details ?? ""} ${body.message ?? ""}`,
  );
}
/**
 * Store the out-of-credits alert as an event (spec 4.10), so the portal banner
 * and the Lab cost history read the same record.
 */
async function recordCreditAlert(
  vendor: string,
  settings?: TeamPreferencesData,
  detail?: string,
) {
  const plan = (settings ?? (await teamPreferences())).sources.standbyPlan;
  await event(
    "providerAlert",
    vendor,
    ProviderAlert.parse({
      kind: "credits_exhausted",
      at: new Date().toISOString(),
      plan,
      monthlyAllowance: PLAN_ALLOWANCE[plan],
      ...(detail ? { detail: detail.slice(0, 500) } : {}),
    }),
  );
}
/** The latest provider alert per vendor, newest last, for the UI banner. */
export async function providerAlerts(): Promise<ProviderAlertData[]> {
  const latest = new Map<string, ProviderAlertData>();
  for (const stored of await events("providerAlert"))
    latest.set(stored.entityId, {
      vendor: stored.entityId,
      ...ProviderAlert.parse(stored.payload),
    });
  return [...latest.values()];
}
async function pace(provider: CaptionProvider) {
  if (provider !== "supadata") return;
  const delay = await db().transaction(async () => {
    const old = await doc<{ nextAt: number }>("captionRate", provider);
    const at = Math.max(Date.now(), old?.nextAt || 0);
    await put("captionRate", provider, { nextAt: at + 1100 });
    return at - Date.now();
  });
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
export async function managedTranscript(
  videoId: string,
  provider: CaptionProvider,
  options: {
    generate?: boolean;
    duration?: number;
    language?: string;
    /** Team settings already in hand; only the standby plan is read from it. */
    settings?: TeamPreferencesData;
  } = {},
): Promise<SourceData | null> {
  if (!/^[\w-]{11}$/.test(videoId)) throw Error("Invalid video ID.");
  const key =
    provider === "supadata"
      ? process.env.SUPADATA_API_KEY
      : process.env.TRANSCRIPTAPI_API_KEY;
  if (!key) return null;
  const generated = !!options.generate;
  if (generated && provider !== "supadata")
    throw Error("Generation requires Supadata.");
  if (generated && (!options.duration || options.duration > 7200))
    throw Error(
      "Generated transcript requires a known duration of at most two hours.",
    );
  // ASR must detect spoken language rather than translate toward metadata preferences.
  const language = generated ? undefined : options.language?.split("-")[0];
  const id = captionAttemptId(provider, videoId, {
    generate: generated,
    language: options.language,
  });
  const cached = await doc<{ source: SourceData }>("managedCaption", id);
  let prior = await doc<Attempt>("managedCaptionAttempt", id);
  const acceptLanguage = async (
    source: SourceData,
    record: object = prior || {},
  ) => {
    if (captionLanguageMatches(language, source.language)) return true;
    await put("managedCaptionAttempt", id, {
      ...record,
      id,
      provider,
      videoId,
      mode: generated ? "generate" : "native",
      status: "language_mismatch",
      requestedLanguage: language,
      returnedLanguage: source.language || null,
      reason:
        "Returned caption language differs from requested language; source withheld and reservation retained.",
    });
    return false;
  };
  if (cached) {
    const source = Source.parse(cached.source);
    return (await acceptLanguage(source)) ? source : null;
  }
  const headers: Record<string, string> =
    provider === "supadata"
      ? { "x-api-key": key }
      : { Authorization: `Bearer ${key}` };
  const normalize = (value: unknown) =>
    provider === "supadata"
      ? normalizeNative(value, videoId, generated)
      : normalizeTranscriptApi(value, videoId);
  if (prior?.status === "pending") {
    if (!/^[\w-]{1,150}$/.test(prior.jobId || ""))
      throw Error("Invalid transcript job identifier.");
    if (Date.now() - Date.parse(prior.at) > 50 * 60000) {
      await put("managedCaptionAttempt", id, {
        ...prior,
        status: "expired",
        reason: "Provider job exceeded the polling window; no resubmission.",
      });
      return null;
    }
    await pace(provider);
    const response = await fetch(
      `https://api.supadata.ai/v1/transcript/${encodeURIComponent(prior.jobId!)}`,
      { headers, signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw new SourcePending(
        "Transcript poll temporarily unavailable; existing job retained.",
      );
    const value = await response.json();
    if (value.status === "failed") {
      await put("managedCaptionAttempt", id, {
        ...prior,
        status: "failed",
        reason: "Provider job failed.",
      });
      return null;
    }
    if (value.status !== "completed")
      throw new SourcePending("Waiting for transcript provider.");
    const source = normalize(value.result || value);
    if (!(await acceptLanguage(source))) return null;
    await put("managedCaption", id, {
      source,
      at: new Date().toISOString(),
      provider,
      mode: prior.mode,
    });
    await put("managedCaptionAttempt", id, { ...prior, status: "completed" });
    return source;
  }
  if (prior?.status === "submitted") {
    if (Date.now() - Date.parse(prior.at) < 90000)
      throw new SourcePending("Caption request already in progress.");
    await put("managedCaptionAttempt", id, {
      ...prior,
      status: "uncertain",
      reason: "Request result unknown; no automatic resubmission.",
    });
    return null;
  }
  // Retry only explicit temporary HTTP failures, at most three submissions.
  // Transport timeouts stay uncertain and are never automatically resubmitted.
  const retry =
    !!prior &&
    prior.status === "failed" &&
    [408, 429, 500, 502, 503, 504].includes(prior.http || 0) &&
    (prior.number || 1) < 3 &&
    Date.now() - Date.parse(prior.at) > 2000;
  if (prior && !retry) return null;
  const previousCredits = prior?.credits || 0;
  const previousNumber = prior?.number || (prior ? 1 : 0);
  const previousAt = prior?.at;
  const reserve = generated ? Math.ceil(options.duration! / 60) * 2 : 1;
  const cap = Number(process.env.YTI_TRANSCRIPT_CREDIT_BUDGET || 90);
  const admitted = await db().transaction(async () => {
    const current = await doc<Attempt>("managedCaptionAttempt", id);
    if (
      current &&
      (!retry || current.at !== previousAt || current.status !== "failed")
    )
      return false;
    const spent = (await docs<Attempt>("managedCaptionAttempt"))
      .filter((a) => a.provider === provider)
      .reduce((n, a) => n + a.credits, 0);
    if (!Number.isFinite(cap) || cap < 0 || spent + reserve > cap)
      throw Error("Transcript provider credit budget reached.");
    prior = {
      id,
      provider,
      videoId,
      mode: generated ? "generate" : "native",
      at: new Date().toISOString(),
      status: "submitted",
      credits: previousCredits + reserve,
      number: previousNumber + 1,
      runtime: process.env.VERCEL ? "vercel" : "local",
    };
    await put("managedCaptionAttempt", id, prior);
    return true;
  });
  if (!admitted) throw new SourcePending("Caption request already recorded.");
  const url = new URL(
    provider === "supadata"
      ? "https://api.supadata.ai/v1/transcript"
      : "https://transcriptapi.com/api/v2/youtube/transcript",
  );
  url.search = new URLSearchParams(
    provider === "supadata"
      ? {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          text: "false",
          mode: generated ? "generate" : "native",
          ...(language ? { lang: language } : {}),
        }
      : {
          video_url: videoId,
          format: "json",
          include_timestamp: "true",
          ...(language ? { language } : {}),
        },
  ).toString();
  const started = Date.now();
  try {
    await pace(provider);
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(60000),
    });
    const reported = response.headers.get("x-billable-requests");
    const credits =
      reported !== null && /^\d+$/.test(reported)
        ? Number(reported)
        : provider === "transcriptapi" && !response.ok
          ? 0
          : reserve;
    const record = {
      ...prior!,
      http: response.status,
      credits: previousCredits + credits,
      durationMs: Date.now() - started,
    };
    if (response.status === 206 || response.status === 404) {
      // "No captions for this video" is a fact about the video, not a vendor
      // failure: it is correlated across providers and never opens a breaker.
      await put("managedCaptionAttempt", id, {
        ...record,
        status: "unavailable",
        vendorError: null,
      });
      return null;
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const allowed = [
        "forbidden",
        "upgrade-required",
        "unauthorized",
        "limit-exceeded",
        "not-found",
        "internal-error",
        "invalid-request",
      ];
      const providerError = allowed.includes(errorBody.error)
        ? errorBody.error
        : undefined;
      const accessRestriction = /age-restricted/i.test(
        String(errorBody.details || ""),
      )
        ? "provider_reports_age_restriction"
        : undefined;
      if (
        provider === "supadata" &&
        creditsExhausted(response.status, errorBody)
      )
        await recordCreditAlert(
          "supadata",
          options.settings,
          `Provider HTTP ${response.status}${providerError ? `: ${providerError}` : ""}`,
        );
      await put("managedCaptionAttempt", id, {
        providerError,
        accessRestriction,
        ...record,
        status: "failed",
        vendorError: vendorErrorForStatus(response.status),
        reason: `Provider HTTP ${response.status}.`,
      });
      return null;
    }
    const value = await response.json();
    if (response.status === 202) {
      const jobId = z
        .string()
        .regex(/^[\w-]{1,150}$/)
        .parse(value.jobId);
      await put("managedCaptionAttempt", id, {
        ...record,
        status: "pending",
        jobId,
      });
      throw new SourcePending("Waiting for transcript provider.");
    }
    const source = normalize(value);
    if (!(await acceptLanguage(source, record))) return null;
    await put("managedCaption", id, {
      source,
      at: new Date().toISOString(),
      provider,
      mode: record.mode,
    });
    await put("managedCaptionAttempt", id, { ...record, status: "completed" });
    return source;
  } catch (e) {
    if (e instanceof SourcePending) throw e;
    await put("managedCaptionAttempt", id, {
      ...prior!,
      status: "uncertain",
      durationMs: Date.now() - started,
      vendorError: vendorErrorForFailure(e),
      reason:
        "Invalid response or interrupted request; original reservation retained.",
    });
    return null;
  }
}
export async function nativeTranscript(
  videoId: string,
  options: {
    duration?: number;
    language?: string;
    managedCaptionsOnly?: boolean;
  } = {},
): Promise<SourceData | null> {
  for (const provider of ["transcriptapi", "supadata"] as const) {
    try {
      const source = await managedTranscript(videoId, provider, options);
      if (source) return source;
    } catch (e) {
      if (e instanceof SourcePending) throw e;
      await put("captionProviderNotice", provider, {
        provider,
        at: new Date().toISOString(),
        reason:
          "Provider configuration or credit limit prevented retrieval; trying the next source.",
      });
    }
  }
  if (options.managedCaptionsOnly) return null;
  if (process.env.YTI_GENERATED_TRANSCRIPTS === "true" && options.duration)
    return managedTranscript(videoId, "supadata", {
      ...options,
      generate: true,
    });
  return null;
}
/**
 * The vendor failure recorded for one attempt, or null when the attempt did
 * not fail in a way the vendor is responsible for. "No captions" (206, 404),
 * a language mismatch and an unparsable payload all return null: only 5xx,
 * 429 and network or timeout failures may open a breaker (spec 4.10).
 */
async function vendorFailure(
  provider: CaptionProvider,
  videoId: string,
  options: { generate?: boolean; language?: string },
): Promise<{ kind: VendorErrorKindName; reason: string } | null> {
  const record = await doc<Attempt>(
    "managedCaptionAttempt",
    captionAttemptId(provider, videoId, options),
  );
  if (!record || !record.vendorError) return null;
  if (record.status !== "failed" && record.status !== "uncertain") return null;
  return {
    kind: record.vendorError,
    reason:
      record.reason ||
      `${provider} reported ${record.vendorError}${record.http ? ` (HTTP ${record.http})` : ""}.`,
  };
}
/**
 * Captions for one video with the standby provider behind a circuit breaker
 * (spec 4.10). TranscriptAPI is the draft; when it answers with a vendor error
 * the breaker opens for `sources.standbyCooldownMinutes` and Supadata native
 * serves captions until it closes. A "no captions" answer is correlated across
 * both providers, so it neither opens the breaker nor falls back.
 *
 * `settings` overrides the stored team preferences and `now` the clock, so a
 * test can drive the cooldown without waiting for it.
 */
export async function standbyTranscript(
  videoId: string,
  options: {
    duration?: number;
    language?: string;
    settings?: TeamPreferencesData;
    now?: number;
  } = {},
): Promise<SourceData | null> {
  const team = options.settings ?? (await teamPreferences());
  const { captionProvider, standby, standbyCooldownMinutes } = team.sources;
  const now = options.now ?? Date.now();
  const call = {
    duration: options.duration,
    language: options.language,
    settings: team,
  };
  // Asking one provider: the source when it answered, and separately whether
  // the vendor itself failed, which is what opens its breaker.
  const ask = async (
    provider: CaptionProvider,
  ): Promise<{ source: SourceData | null; vendorDown: boolean }> => {
    let source: SourceData | null = null;
    try {
      source = await managedTranscript(videoId, provider, call);
    } catch (e) {
      if (e instanceof SourcePending) throw e;
      // A configuration or credit-budget refusal is ours, not the vendor's:
      // it never opens the breaker and never spends the other provider.
      await put("captionProviderNotice", provider, {
        provider,
        at: new Date().toISOString(),
        reason:
          "Provider configuration or credit budget prevented retrieval; the circuit breaker was not opened.",
      });
      return { source: null, vendorDown: false };
    }
    if (source) return { source, vendorDown: false };
    const failure = await vendorFailure(provider, videoId, options);
    if (!failure) return { source: null, vendorDown: false };
    await trip(
      provider,
      failure.kind,
      failure.reason,
      standbyCooldownMinutes,
      now,
    );
    return { source: null, vendorDown: true };
  };
  const useStandby = async () => {
    if (standby !== "supadata") return null;
    if (await isOpen("supadata", now)) return null;
    return (await ask("supadata")).source;
  };
  if (captionProvider !== "transcriptapi") return null;
  if (await isOpen("transcriptapi", now)) return await useStandby();
  const draft = await ask("transcriptapi");
  if (draft.source) return draft.source;
  return draft.vendorDown ? await useStandby() : null;
}
const BatchJob = z.object({
  jobId: z.string().regex(/^[\w-]{1,150}$/),
});
const BatchResults = z.object({
  status: z.enum(["queued", "active", "completed", "failed"]),
  results: z
    .array(
      z.object({
        videoId: z.string().min(1),
        transcript: z.unknown().optional(),
        errorCode: z.string().max(200).optional(),
      }),
    )
    .default([]),
  stats: z
    .object({
      total: z.number().int().nonnegative(),
      succeeded: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    })
    .optional(),
  error: z.string().max(500).optional(),
});
export type BatchTranscript = {
  videoId: string;
  source: SourceData | null;
  error?: string;
};
export type SupadataBatch = {
  jobId: string;
  status: "queued" | "active" | "completed" | "failed";
  results: BatchTranscript[];
  stats?: { total: number; succeeded: number; failed: number };
};
/**
 * Supadata's batch endpoint: one POST for many videos, then the job is polled
 * until it completes (spec 4.10). One credit per video, captions only unless
 * `mode` says otherwise, and never mode=auto. Kept out of the pipeline: the
 * historical replay is its only intended caller.
 */
export async function supadataBatch(
  videoIds: string[],
  options: {
    mode?: "native" | "generate";
    language?: string;
    pollIntervalMs?: number;
    maxPolls?: number;
    settings?: TeamPreferencesData;
  } = {},
): Promise<SupadataBatch> {
  const ids = z
    .array(z.string().regex(/^[\w-]{11}$/))
    .min(1)
    .max(1000)
    .parse(videoIds);
  const key = process.env.SUPADATA_API_KEY;
  if (!key) throw Error("Supadata is not configured.");
  const mode = options.mode || "native";
  const headers = { "x-api-key": key, "content-type": "application/json" };
  await pace("supadata");
  const submitted = await fetch(
    "https://api.supadata.ai/v1/youtube/transcript/batch",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        videoIds: ids,
        mode,
        text: false,
        ...(options.language ? { lang: options.language } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!submitted.ok) {
    const body = await submitted.json().catch(() => ({}));
    if (creditsExhausted(submitted.status, body))
      await recordCreditAlert(
        "supadata",
        options.settings,
        `Batch submission HTTP ${submitted.status}`,
      );
    throw Error(`Supadata batch submission failed: HTTP ${submitted.status}.`);
  }
  const { jobId } = BatchJob.parse(await submitted.json());
  const interval = options.pollIntervalMs ?? 2000;
  const maxPolls = options.maxPolls ?? 60;
  for (let poll = 0; poll < maxPolls; poll++) {
    if (interval > 0)
      await new Promise((resolve) => setTimeout(resolve, interval));
    await pace("supadata");
    const response = await fetch(
      `https://api.supadata.ai/v1/youtube/batch/${encodeURIComponent(jobId)}`,
      { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw new SourcePending(
        `Supadata batch poll unavailable: HTTP ${response.status}.`,
      );
    const job = BatchResults.parse(await response.json());
    if (job.status !== "completed" && job.status !== "failed") continue;
    const results: BatchTranscript[] = job.results.map((row) => {
      if (row.transcript === undefined || row.transcript === null)
        return {
          videoId: row.videoId,
          source: null,
          error: row.errorCode || "transcript-unavailable",
        };
      try {
        return {
          videoId: row.videoId,
          source: normalizeNative(row.transcript, row.videoId),
        };
      } catch {
        return {
          videoId: row.videoId,
          source: null,
          error: "invalid-transcript",
        };
      }
    });
    const batch: SupadataBatch = {
      jobId,
      status: job.status,
      results,
      ...(job.stats ? { stats: job.stats } : {}),
    };
    await put("supadataBatch", jobId, {
      jobId,
      status: job.status,
      mode,
      videoIds: ids,
      at: new Date().toISOString(),
      ...(job.stats ? { stats: job.stats } : {}),
      ...(job.error ? { error: job.error } : {}),
    });
    return batch;
  }
  throw new SourcePending("Supadata batch job is still running.");
}
