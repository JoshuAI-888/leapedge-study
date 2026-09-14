import { createHash } from "node:crypto";
import {
  Source,
  coverage,
  type Run,
} from "../../features/youtube-intelligence/contracts.ts";
import {
  Input,
  execute,
  createTransport,
  MODEL,
  PROMPT_VERSION,
} from "./native-google-core.ts";
import { reserve, settle, retainResponse } from "./store.ts";

// Recovery acquires alternative evidence; it does not silently patch a transcript.
export function recoveryWindows(data: unknown, duration: number) {
  const rows = (
    data as { segments?: { start_seconds: number; end_seconds: number }[] }
  )?.segments;
  const bad = rows?.find(
    (s) =>
      Number.isFinite(s.start_seconds) &&
      s.start_seconds >= 0 &&
      s.start_seconds < duration &&
      (s.end_seconds > duration || s.end_seconds < s.start_seconds),
  );
  if (!bad) return [];
  const start = Math.max(
    0,
    Math.min(duration - 90, Math.floor(bad.start_seconds / 30) * 30 - 30),
  );
  return [...new Set([start, Math.min(duration - 90, start + 30)])].map(
    (start) => ({
      startSeconds: Math.max(0, start),
      endSeconds: Math.min(duration, start + 90),
    }),
  );
}

export async function nativeGoogleStep(
  run: Run,
  executeRequest: typeof execute = execute,
) {
  // Runtime kill switch also stops jobs queued while the experiment was enabled.
  if (process.env.YTI_NATIVE_GOOGLE_ENABLED !== "true") {
    run.status = "needs_review";
    run.error = "Native Google experiment is disabled. No media request sent.";
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Error("Native Google key is not configured.");
  const duration = (run.output.metadata as { duration: number }).duration;
  const windows = (run.output.nativeRecoveryWindows || []) as {
    startSeconds: number;
    endSeconds: number;
  }[];
  const recovered = (run.output.nativeRecovery || []) as unknown[];
  const recovering = run.stage === "native-recovery";
  if (recovering && (recovered.length >= 2 || !windows[recovered.length]))
    throw Error("Native recovery bound reached.");
  const input = Input.parse({
    videoId: run.videoId,
    durationSeconds: duration,
    startSeconds: 0,
    endSeconds: duration,
    mode: "STATIC",
    ...(recovering ? windows[recovered.length] : {}),
  });
  const stage = recovering
    ? `native-recovery-${recovered.length}`
    : "native-source";
  // At most one full source and two diagnostic clips. Unknown billing stays reserved.
  const callId = await reserve(run.id, stage, 1.25);
  const result = await executeRequest(input, createTransport(key), 150000);
  const retained = JSON.parse(
    JSON.stringify({
      ...result,
      input,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
    }).replaceAll(key, "[REDACTED]"),
  );
  await retainResponse(callId, run.id, stage, retained);
  await settle(callId, null, {
    nativeGoogle: true,
    outcome: result.assessment.outcome,
    estimatedUsd: "estimatedUsd" in result ? result.estimatedUsd : null,
    billing: "unreconciled_reservation_held",
    latencyMs: result.latencyMs,
  });
  run.output.metrics = [
    ...((run.output.metrics || []) as unknown[]),
    {
      stage,
      provider: "Google native",
      model: MODEL,
      seconds: result.latencyMs / 1000,
      outcome: result.assessment.outcome,
      callId,
      estimatedUsd: "estimatedUsd" in result ? result.estimatedUsd : null,
    },
  ];
  if (recovering) {
    recovered.push({ callId, input, assessment: result.assessment });
    run.output.nativeRecovery = recovered;
    if (
      recovered.length < windows.length &&
      result.assessment.outcome === "structurally_valid_unverified"
    )
      return;
    run.status = "needs_review";
    run.error =
      "Bounded native clip recovery retained. Compare original audio and candidate windows before accepting any replacement; no automatic merge.";
    return;
  }
  run.output.nativeSourceAssessment = result.assessment;
  if (
    result.assessment.outcome !== "structurally_valid_unverified" ||
    !("data" in result.assessment) ||
    !result.assessment.data
  ) {
    const windows =
      result.assessment.outcome === "invalid_timing_or_coordinate_system" &&
      "data" in result.assessment
        ? recoveryWindows(result.assessment.data, duration)
        : [];
    if (windows.length) {
      run.output.nativeRecoveryWindows = windows;
      run.stage = "native-recovery";
      return;
    }
    run.status = "needs_review";
    run.error = `Native acquisition held: ${result.assessment.outcome}. No automatic paid retry or fallback.`;
    return;
  }
  const data = result.assessment.data;
  const source = Source.parse({
    video_id: data.video_id,
    language: data.language ?? undefined,
    source_kind: "native_google_generated_transcript",
    segment_separator: "",
    segments: data.segments.map((s, i) => ({
      id: `s${String(i + 1).padStart(5, "0")}`,
      text: s.text,
      start_seconds: s.start_seconds,
      end_seconds: s.end_seconds,
    })),
  });
  run.output.source = source;
  run.output.sourceHash = createHash("sha256")
    .update(JSON.stringify(source))
    .digest("hex");
  run.output.coverage = coverage(source, duration);
  run.output.audioVerified = false;
  if (coverage(source, duration).status !== "timestamps_cover_most_video") {
    run.status = "needs_review";
    run.error =
      "Native source has insufficient timestamp coverage; audio completeness remains unverified.";
    return;
  }
  run.stage = "synthesis";
  run.error = null;
}
