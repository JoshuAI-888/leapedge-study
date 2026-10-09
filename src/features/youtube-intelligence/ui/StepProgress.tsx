"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
import { money } from "./viewmodel.ts";
import {
  STEPS,
  aboutText,
  durationText,
  failureReason,
  isStuck,
  progressOf,
  retryCostEstimate,
  retryPlan,
  type Typical,
} from "../progress-steps.ts";

type RunLike = {
  id: string;
  status: string;
  stage: string;
  createdAt: string;
  error: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

/** Seconds since `since`, ticking each second while mounted. */
function useElapsed(since: string) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const start = Date.parse(since);
  return now === null || !Number.isFinite(start)
    ? null
    : Math.max(0, (now - start) / 1000);
}

function Segments({ states }: { states: string[] }) {
  return (
    <ol className="yi-steps" aria-hidden="true">
      {STEPS.map((s, i) => (
        <li key={s.short} className={`yi-step yi-step-${states[i]}`}>
          <i />
          <span>{s.short}</span>
        </li>
      ))}
    </ol>
  );
}

function useRetry(runId: string) {
  const { perform, busy } = useWorkspace();
  return {
    busy,
    retry: () =>
      void perform(
        () => action("runs", "retry", runId),
        "Processing resumed. Completed steps are kept and not charged again.",
      ),
    audio: () =>
      void perform(
        () => action("trust", "requestAudioTrust", { runId }),
        "Audio transcription queued.",
      ),
    check: () =>
      void perform(
        () => action("runs", "recoverAudit", runId),
        "The check will run again. Evidence is kept.",
      ),
  };
}

/**
 * The step progress bar (F72). Renders only while the run is queued or
 * running (decision D1): segments, the current step in words, elapsed time
 * and the typical total, with Retry once it has run three times too long.
 */
export function StepProgress({
  run,
  typical,
  durationSeconds,
}: {
  run: RunLike;
  typical: Typical | null;
  durationSeconds: number | null;
}) {
  const p = progressOf(run);
  const elapsed = useElapsed(run.createdAt);
  const { retry, busy } = useRetry(run.id);
  if (!p.working) return null;
  const stuck = typical !== null && elapsed !== null && isStuck(elapsed, typical.seconds);
  const minutes = durationSeconds ? Math.round(durationSeconds / 60) : null;
  return (
    <section className="yi-progress" aria-label="Analysis progress">
      <div className="yi-progress-head">
        <p role="status">
          <strong>
            {run.status === "queued" && run.stage === "metadata"
              ? "Queued"
              : "Analysing"}{" "}
            · step {p.step} of {p.total}
          </strong>{" "}
          · {p.label}
        </p>
        {elapsed !== null && (
          <span className="yi-progress-elapsed">{durationText(elapsed)}</span>
        )}
      </div>
      <Segments states={p.states} />
      {typical && (
        <p className="yi-muted yi-progress-note">
          {typical.basis === "estimate"
            ? `Expected total ${aboutText(typical.seconds)} (an estimate; too few earlier analyses to measure).`
            : `Typical total${minutes ? ` for a ${minutes}-minute video` : ""}: ${aboutText(typical.seconds)}.`}{" "}
          You can leave this page.
        </p>
      )}
      {run.status === "queued" && !stuck && (
        <div className="yi-row">
          <button type="button" className="yi-secondary" disabled={busy} onClick={retry}>
            Resume processing
          </button>
          <span className="yi-muted">Continue this analysis from its saved step.</span>
        </div>
      )}
      {stuck && (
        <div className="yi-progress-stuck" role="alert">
          <p>This is taking longer than usual.</p>
          <button
            type="button"
            className="yi-secondary"
            disabled={busy}
            onClick={retry}
          >
            Resume from step {p.step}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The failure banner (F72): the stopped step and the reason in plain words,
 * Retry from that step with its estimate, "Transcribe audio instead" when the
 * transcript failed, "Retry the check" for a failed critic, and details.
 */
export function FailureBanner({
  run,
  stepCostUsd,
}: {
  run: RunLike;
  stepCostUsd: Record<string, number> | null;
}) {
  const { retry, audio, check, busy } = useRetry(run.id);
  if (!["failed", "needs_review"].includes(run.status) || run.input.task)
    return null;
  const plan = retryPlan(run);
  const estimate = stepCostUsd
    ? retryCostEstimate(
        plan.step,
        new Map(Object.entries(stepCostUsd).map(([k, v]) => [Number(k), v])),
      )
    : null;
  return (
    <section className="yi-warning yi-failure" role="alert" aria-label="Analysis stopped">
      <p>
        <strong>
          Stopped at step {plan.step} · {plan.short}
        </strong>
      </p>
      <p>{failureReason(run.error, plan.step)}</p>
      {plan.canRetry && (
        <p className="yi-failure-cost">
          Steps already completed won&apos;t be charged again.
          {estimate !== null
            ? ` Estimated retry cost ${money(estimate)}.`
            : " No retry estimate yet."}
        </p>
      )}
      <Segments states={progressOf(run).states} />
      <div className="yi-row">
        {plan.canRetry && (
          <button type="button" disabled={busy} onClick={retry}>
            Retry from step {plan.step}
          </button>
        )}
        {plan.offerCheckRecovery && (
          <button type="button" className="yi-secondary" disabled={busy} onClick={check}>
            Retry the check
          </button>
        )}
        {plan.offerAudio && (
          <button type="button" className="yi-secondary" disabled={busy} onClick={audio}>
            Transcribe audio instead
          </button>
        )}
      </div>
      {run.error && (
        <details className="yi-failure-details">
          <summary>Details</summary>
          <p>{run.error}</p>
        </details>
      )}
    </section>
  );
}

/** A compact bar for list rows (Today's activity): segments and the step name. */
export function MiniProgress({ run }: { run: { status: string; stage: string } }) {
  const p = progressOf(run);
  if (!p.working) return null;
  return (
    <span
      className="yi-mini-progress"
      role="img"
      aria-label={`Step ${p.step} of ${p.total}: ${p.label}`}
      title={`Step ${p.step} of ${p.total}: ${p.label}`}
    >
      <span className="yi-mini-steps" aria-hidden="true">
        {p.states.map((s, i) => (
          <i key={i} className={`yi-step-${s}`} />
        ))}
      </span>
      <small aria-hidden="true">{p.short}</small>
    </span>
  );
}

/** Inline Retry for a failed list row; nothing for other states. */
export function InlineRetry({
  run,
}: {
  run: { id: string; status: string; stage: string; error: string | null; input: Record<string, unknown>; output: Record<string, unknown> };
}) {
  const { retry, busy } = useRetry(run.id);
  if (!retryPlan(run).canRetry) return null;
  return (
    <button
      type="button"
      className="yi-text-button yi-inline-retry"
      disabled={busy}
      onClick={retry}
      title={failureReason(run.error, progressOf(run).step)}
    >
      Retry
    </button>
  );
}
