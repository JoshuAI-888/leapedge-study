import { db } from "./store.ts";
import { youtubeJsTranscript } from "./youtubejs.ts";
import { z } from "zod";
import {
  Source,
  type SourceData,
} from "../../features/youtube-intelligence/contracts.ts";
import { doc, docs, put } from "./research-store.ts";
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
};
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
  options: { generate?: boolean; duration?: number; language?: string } = {},
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
  const id = `${provider}:${generated ? "generate" : "native"}:${videoId}:${language || "original"}`;
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
      await put("managedCaptionAttempt", id, {
        ...record,
        status: "unavailable",
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
      await put("managedCaptionAttempt", id, {
        providerError,
        accessRestriction,
        ...record,
        status: "failed",
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
      reason:
        "Invalid response or interrupted request; original reservation retained.",
    });
    return null;
  }
}
export async function nativeTranscript(
  videoId: string,
  options: { duration?: number; language?: string } = {},
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
  const free = await youtubeJsTranscript(videoId);
  if (free) return free;
  if (process.env.YTI_GENERATED_TRANSCRIPTS === "true" && options.duration)
    return managedTranscript(videoId, "supadata", {
      ...options,
      generate: true,
    });
  return null;
}
