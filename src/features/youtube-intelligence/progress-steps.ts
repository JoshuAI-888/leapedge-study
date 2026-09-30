/**
 * Live progress (F72, decision D1): the pipeline's internal stages mapped onto
 * five plain steps — Title · Transcript · Extract · Check · Publish — with a
 * typical duration from stored timings of similar-length videos, the "taking
 * longer than usual" threshold, and which step a retry resumes from.
 *
 * Shown only while a run is queued or running; finished runs go back to the
 * four states of spec 7.2. Pure functions, so node:test covers them.
 */

export const STEPS = [
  { short: "Title", label: "Reading the title and video details" },
  { short: "Transcript", label: "Getting the transcript" },
  { short: "Extract", label: "Extracting calls and key points" },
  { short: "Check", label: "Checking calls against the transcript" },
  { short: "Publish", label: "Publishing the analysis" },
] as const;

/** Run stages (yi_runs.stage) by step number, 1-based. */
const RUN_STAGES: Record<string, number> = {
  metadata: 1,
  source: 2,
  "source-window": 2,
  "native-source": 2,
  "native-recovery": 2,
  "asr-source": 2,
  synthesis: 3,
  translate: 3,
  critique: 4,
  agree: 4,
  "asr-evidence": 4,
  "audio-review": 4,
  publish: 5,
  complete: 5,
};

/** The step a run stage belongs to, or null for a stage outside video analysis. */
export function stepOfStage(stage: string): number | null {
  return RUN_STAGES[stage] ?? null;
}

/**
 * The step a paid model call (yi_calls.stage) belongs to. Call stages carry
 * chunk, window and repair suffixes, so they are matched by prefix.
 */
export function stepOfCall(stage: string): number | null {
  if (/^(transcribe|native-source|native-recovery)/.test(stage)) return 2;
  if (/^(synthesis|translate)/.test(stage)) return 3;
  if (/^(critique|audio-review|agree)/.test(stage)) return 4;
  if (/^(publish|entities)/.test(stage)) return 5;
  if (stage === "metadata") return 1;
  return null;
}

export type StepState = "done" | "current" | "pending" | "failed";
export type Progress = {
  /** 1-based step the run is on (or stopped at). */
  step: number;
  total: number;
  short: string;
  label: string;
  states: StepState[];
  working: boolean;
  failed: boolean;
};

const WORKING = new Set(["queued", "running"]);
const STOPPED = new Set(["failed", "needs_review"]);

export function progressOf(run: { status: string; stage: string }): Progress {
  const known = stepOfStage(run.stage);
  const complete = run.status === "completed" || run.stage === "complete";
  const step = complete ? STEPS.length : (known ?? 1);
  const failed = STOPPED.has(run.status);
  const states = STEPS.map((_, i): StepState => {
    const n = i + 1;
    if (complete) return "done";
    if (n < step) return "done";
    if (n === step) return failed ? "failed" : "current";
    return "pending";
  });
  const s = STEPS[step - 1];
  return {
    step,
    total: STEPS.length,
    short: s.short,
    label: s.label,
    states,
    working: WORKING.has(run.status),
    failed,
  };
}

export type TimingSample = {
  /** Video length in seconds, when known. */
  durationSeconds: number | null;
  /** Submission to the last finished step of a completed analysis. */
  elapsedSeconds: number;
};

export type Typical = {
  seconds: number;
  basis: "similar-length" | "all-analyses" | "estimate";
  samples: number;
};

const MIN_SAMPLES = 3;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Typical time for a video of this length: the median of completed analyses
 * of a similar length (half to double), then of all completed analyses, and
 * with fewer than three of either a stated estimate of one minute plus six
 * seconds per minute of video (three minutes when the length is unknown).
 */
export function typicalDuration(
  history: TimingSample[],
  durationSeconds: number | null,
): Typical {
  const valid = history.filter(
    (h) => Number.isFinite(h.elapsedSeconds) && h.elapsedSeconds > 0,
  );
  if (durationSeconds && durationSeconds > 0) {
    const similar = valid.filter(
      (h) =>
        h.durationSeconds !== null &&
        h.durationSeconds >= durationSeconds / 2 &&
        h.durationSeconds <= durationSeconds * 2,
    );
    if (similar.length >= MIN_SAMPLES)
      return {
        seconds: median(similar.map((h) => h.elapsedSeconds)),
        basis: "similar-length",
        samples: similar.length,
      };
  }
  if (valid.length >= MIN_SAMPLES)
    return {
      seconds: median(valid.map((h) => h.elapsedSeconds)),
      basis: "all-analyses",
      samples: valid.length,
    };
  return {
    seconds:
      durationSeconds && durationSeconds > 0
        ? 60 + (durationSeconds / 60) * 6
        : 180,
    basis: "estimate",
    samples: valid.length,
  };
}

export const STUCK_FACTOR = 3;
/** "This is taking longer than usual" after three times the typical total. */
export function isStuck(elapsedSeconds: number, typicalSeconds: number) {
  return (
    typicalSeconds > 0 && elapsedSeconds > STUCK_FACTOR * typicalSeconds
  );
}

/** "1 min 12 s", "45 s", "5 h 34 min"; aboutText gives "about 3 minutes". */
export function durationText(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s >= 3600) {
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
export function aboutText(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export type RetryPlan = {
  /** Step a retry resumes from (the stopped step; earlier steps are kept). */
  step: number;
  short: string;
  /** A plain retry of the stopped step is offered. */
  canRetry: boolean;
  /** Captions failed: offer audio transcription instead. */
  offerAudio: boolean;
  /** The critic failed within its limit: offer "Retry the check". */
  offerCheckRecovery: boolean;
};

/**
 * What a failed (or stuck) run can do next. Only analyses retry here; a run
 * with a task (a research brief) has its own lifecycle.
 */
export function retryPlan(run: {
  status: string;
  stage: string;
  error: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  stuck?: boolean;
}): RetryPlan {
  const p = progressOf(run);
  const analysis = !run.input.task;
  const failed = run.status === "failed";
  const sourceStep = p.step <= 2;
  return {
    step: p.step,
    short: p.short,
    canRetry: analysis && (failed || run.stuck === true),
    offerAudio:
      analysis &&
      ["failed", "needs_review"].includes(run.status) &&
      ["metadata", "source", "asr-source"].includes(run.stage) &&
      sourceStep &&
      !run.output.audioTrustProcessed,
    offerCheckRecovery:
      analysis &&
      failed &&
      run.stage === "critique" &&
      !/budget|quota|401|402|403|429|key|auth|open|unknown|uncertain/i.test(
        run.error || "",
      ) &&
      Number(run.output.auditRecoveryAttempts ?? 0) < 2,
  };
}

/**
 * Estimated cost of a retry: the average per-analysis spend of the steps
 * still to run (from the stopped step on), measured over completed analyses.
 * Null when no step to run has a measured average.
 */
export function retryCostEstimate(
  fromStep: number,
  perStepAverageUsd: Map<number, number>,
): number | null {
  let total = 0,
    known = false;
  for (let s = fromStep; s <= STEPS.length; s++) {
    const v = perStepAverageUsd.get(s);
    if (v !== undefined) {
      total += v;
      known = true;
    }
  }
  return known ? total : null;
}

/** Plain words for a stored failure, without internal names. */
export function failureReason(error: string | null, step: number) {
  const text = (error ?? "").trim();
  if (/caption|transcript unavailable|asr is on demand/i.test(text))
    return "Captions are not available for this video.";
  if (/budget|cost limit/i.test(text))
    return "The spending limit was reached before this step could run.";
  if (/metadata unavailable|duration is unknown|live stream/i.test(text))
    return "YouTube did not return the video's details. Live streams are not supported.";
  if (/open or unknown|still open|uncertain/i.test(text))
    return "An earlier paid request for this step has an unknown outcome and must be settled first.";
  if (/incomplete|not valid JSON|refusing partial/i.test(text))
    return "The model returned an incomplete answer.";
  if (text) return text.length > 220 ? `${text.slice(0, 217)}…` : text;
  return `The ${STEPS[step - 1]?.short.toLowerCase() ?? "analysis"} step stopped without a recorded reason.`;
}
