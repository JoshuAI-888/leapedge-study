import {
  GoogleGenAI,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { z } from "zod";
export const SDK_VERSION = "2.22.0";
export const MODEL = "gemini-3.8-flash";
export const PROMPT_VERSION = "native-source.v2";
export const Input = z
  .object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    durationSeconds: z.number().positive().max(7200),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    mode: z.enum(["STATIC", "AGENTIC"]).default("STATIC"),
  })
  .superRefine((x, c) => {
    if (x.endSeconds > x.durationSeconds || x.startSeconds >= x.endSeconds)
      c.addIssue({ code: "custom", message: "Invalid requested interval" });
  });
export type TestInput = z.infer<typeof Input>;
export const Transcript = z.object({
  video_id: z.string(),
  language: z.string().trim().min(1).nullable(),
  segments: z
    .array(
      z.object({
        start_seconds: z.number().finite().nonnegative(),
        end_seconds: z.number().finite().nonnegative(),
        text: z.string().refine((s) => s.trim().length > 0, "Empty speech"),
        uncertainty: z.string().nullable(),
      }),
    )
    .max(20000),
  model_reported_omissions: z.array(z.string()),
});
export function requestFor(
  input: TestInput,
  signal: AbortSignal,
): GenerateContentParameters {
  const x = Input.parse(input);
  if(x.mode !== "STATIC") throw Error("Agentic mode requires a separate validated experiment");
  return {
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: `https://www.youtube.com/watch?v=${x.videoId}`,
            },
            ...(x.startSeconds > 0 || x.endSeconds < x.durationSeconds ? {videoMetadata:{startOffset:`${x.startSeconds}s`,endOffset:`${x.endSeconds}s`}} : {}),
          },
          {
            text: `Transcribe ALL audible speech in the supplied video interval, ${x.startSeconds} through ${x.endSeconds} seconds. This is source acquisition, not a summary or trading analysis. Preserve the original spoken language, words, repeated letters, tickers, numbers and negations. Do not translate, correct a symbol using outside knowledge, or substitute chart text for speech. Use short consecutive segments. Report uncertain/inaudible speech explicitly; do not invent words. Timestamps must be seconds from the ORIGINAL video origin, not clip-relative; do not claim that this instruction verifies alignment. video_id must be ${x.videoId}. Return an empty array if no speech is accessible. Report any known omissions separately; do not invent completeness.`,
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      httpOptions: { retryOptions: { attempts: 1 } },
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: {type:Type.OBJECT,properties:{video_id:{type:Type.STRING},language:{type:Type.STRING},segments:{type:Type.ARRAY,items:{type:Type.OBJECT,properties:{start_seconds:{type:Type.NUMBER},end_seconds:{type:Type.NUMBER},text:{type:Type.STRING},uncertainty:{type:Type.STRING,nullable:true}},required:['start_seconds','end_seconds','text','uncertainty']}},model_reported_omissions:{type:Type.ARRAY,items:{type:Type.STRING}}},required:['video_id','language','segments','model_reported_omissions']},
    },
  };
}
export function createTransport(key: string) {
  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
  return (request: GenerateContentParameters) =>
    ai.models.generateContent(request);
}
export function assess(response: GenerateContentResponse, input: TestInput) {
  const blocked = response.promptFeedback?.blockReason;
  if (blocked) return { outcome: "prompt_blocked", detail: blocked };
  const c = response.candidates?.[0];
  if (!c) return { outcome: "missing_candidates" };
  if (c.finishReason === "MAX_TOKENS") return { outcome: "output_truncated" };
  if (c.finishReason !== "STOP")
    return {
      outcome: "generation_not_completed",
      detail: c.finishReason ?? "missing_finish_reason",
    };
  // Join all non-thought text parts; an empty first part is not the entire response.
  const text = (c.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { outcome: "invalid_json" };
  }
  const checked = Transcript.safeParse(parsed);
  if (!checked.success)
    return { outcome: "invalid_schema", issues: checked.error.issues };
  const data = checked.data;
  if (data.video_id !== input.videoId) return { outcome: "wrong_video" };
  if (!data.segments.length) return { outcome: "empty_transcript", data };
  let prior = -1,
    coveredUntil = input.startSeconds;
  const warnings: string[] = [];
  const intervals: { start: number; end: number }[] = [];
  for (const s of data.segments) {
    if (
      s.start_seconds > s.end_seconds ||
      s.end_seconds > input.durationSeconds ||
      s.start_seconds < input.startSeconds ||
      s.end_seconds > input.endSeconds
    )
      return { outcome: "invalid_timing_or_coordinate_system", data };
    if (s.start_seconds < prior) return { outcome: "out_of_order", data };
    if (s.start_seconds - coveredUntil > 30)
      warnings.push(
        `Review possible speech gap ${coveredUntil}-${s.start_seconds}`,
      );
    prior = s.start_seconds;
    coveredUntil = Math.max(coveredUntil, s.end_seconds);
    intervals.push({ start: s.start_seconds, end: s.end_seconds });
  }
  if (input.endSeconds - coveredUntil > 30)
    warnings.push(
      `Review possible missing tail ${coveredUntil}-${input.endSeconds}`,
    );
  if (data.segments.some((s) => s.uncertainty))
    warnings.push("Model reported uncertain speech");
  if (data.model_reported_omissions.length)
    warnings.push("Model reported omissions");
  let duration = 0,
    end = input.startSeconds;
  for (const i of intervals) {
    duration += Math.max(0, i.end - Math.max(end, i.start));
    end = Math.max(end, i.end);
  }
  return {
    outcome: warnings.length
      ? "source_needs_review"
      : "structurally_valid_unverified",
    data,
    warnings,
    coverageFraction: duration / (input.endSeconds - input.startSeconds),
    audioVerified: false,
    timestampAlignmentVerified: false,
  };
}
export function estimateUsd(
  usage: GenerateContentResponse["usageMetadata"],
): number | null {
  // Conservative non-cached estimate at the recorded uniform 3.8 Flash rates.
  // Missing thought counts stay unknown; no billing reconciliation is implied.
  if (
    !usage ||
    [
      usage.promptTokenCount,
      usage.candidatesTokenCount,
      usage.thoughtsTokenCount,
    ].some((x) => typeof x !== "number" || x < 0)
  )
    return null;
  return (
    (usage.promptTokenCount! * 0.75 +
      (usage.candidatesTokenCount! + usage.thoughtsTokenCount!) * 3.75) /
    1e6
  );
}
export function classifyError(e: unknown, aborted: boolean) {
  const err = e as { status?: number; code?: number };
  const httpStatus =
    typeof err.status === "number"
      ? err.status
      : typeof err.code === "number"
        ? err.code
        : undefined;
  if (aborted) return { outcome: "transport_uncertain_timeout", httpStatus };
  if (httpStatus === 401 || httpStatus === 403)
    return { outcome: "api_access_rejected", httpStatus };
  if (httpStatus === 429) return { outcome: "quota_or_rate_limit", httpStatus };
  if (httpStatus && httpStatus >= 400)
    return { outcome: "api_error_requires_diagnosis", httpStatus };
  return { outcome: "transport_uncertain", httpStatus };
}
export async function execute(
  input: TestInput,
  send: (r: GenerateContentParameters) => Promise<GenerateContentResponse>,
  timeoutMs = 180000,
) {
  Input.parse(input);
  const controller = new AbortController();
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("LOCAL_REQUEST_DEADLINE"));
      }, timeoutMs);
    });
    const response = await Promise.race([
      send(requestFor(input, controller.signal)),
      timeout,
    ]);
    return {
      latencyMs: Date.now() - start,
      response,
      assessment: assess(response, input),
      estimatedUsd: estimateUsd(response.usageMetadata),
      billing: "unreconciled" as const,
    };
  } catch (e) {
    return {
      latencyMs: Date.now() - start,
      assessment: classifyError(e, controller.signal.aborted),
      error: {
        name: e instanceof Error ? e.name : "Unknown",
        message: e instanceof Error ? e.message : "Unknown error",
      },
      billing: "potentially_billable" as const,
    };
  } finally {
    clearTimeout(timer);
  }
}
