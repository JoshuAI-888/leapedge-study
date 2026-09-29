"use client";
import { MetricHeading } from "./components.tsx";
import {
  callUsageRows,
  costText,
  secondsText,
  tokenText,
  usageByStep,
  usageTotals,
  type LedgerRow,
} from "../call-usage.ts";
import { STEPS, stepOfStage, durationText } from "../progress-steps.ts";
import type { RunTimelineData } from "../timing.ts";

/** Column ids, in order; each is a registry metric (metrics/ui-columns.ts). */
export const CALL_USAGE_COLUMNS = [
  "usage.step",
  "usage.model",
  "usage.inputTokens",
  "usage.cachedTokens",
  "usage.outputTokens",
  "usage.seconds",
  "usage.costUsd",
] as const;

/**
 * Processing details (F73): one row per model call, retries included, with a
 * total row; then the step timing that used to be the Timing card.
 */
export function CallUsageTable({
  calls,
  timeline,
  finished,
}: {
  calls: LedgerRow[];
  timeline: RunTimelineData | undefined;
  finished: boolean;
}) {
  const rows = callUsageRows(calls);
  const totals = usageTotals(rows);
  return (
    <>
      <h3>Model calls</h3>
      {rows.length ? (
        <div className="yi-table-wrap">
          <table className="yi-usage-table yi-usage-calls">
            <thead>
              <tr>
                {CALL_USAGE_COLUMNS.map((id) => (
                  <MetricHeading key={id} id={id} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.stepLabel}
                    {r.retry && <span className="yi-usage-flag"> · retry</span>}
                    {r.note && <small className="yi-usage-note">{r.note}</small>}
                  </td>
                  <td>{r.model ?? "—"}</td>
                  <td className="yi-num">{tokenText(r.inputTokens)}</td>
                  <td className="yi-num">{tokenText(r.cachedTokens)}</td>
                  <td className="yi-num">{tokenText(r.outputTokens)}</td>
                  <td className="yi-num">{secondsText(r.seconds)}</td>
                  <td className="yi-num">{costText(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  Total · {totals.calls} {totals.calls === 1 ? "call" : "calls"}
                </th>
                <td />
                <td className="yi-num">{tokenText(totals.inputTokens)}</td>
                <td className="yi-num">{tokenText(totals.cachedTokens)}</td>
                <td className="yi-num">{tokenText(totals.outputTokens)}</td>
                <td className="yi-num">{secondsText(totals.seconds)}</td>
                <td className="yi-num">{costText(totals.costUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="yi-muted">
          No paid model calls are recorded for this analysis. Imported
          transcripts and reused results cost nothing.
        </p>
      )}
      <StepTiming timeline={timeline} finished={finished} />
    </>
  );
}

/** Time per step from stored step rows (formerly the Timing card). */
function StepTiming({
  timeline,
  finished,
}: {
  timeline: RunTimelineData | undefined;
  finished: boolean;
}) {
  if (!timeline) return null;
  const perStep = new Map<number, { execution: number; queue: number; steps: number }>();
  for (const s of timeline.analysis.stages) {
    const step = stepOfStage(s.stage) ?? 0;
    const e = perStep.get(step) ?? { execution: 0, queue: 0, steps: 0 };
    e.execution += s.executionSeconds;
    e.queue += s.queueSeconds;
    e.steps += s.steps;
    perStep.set(step, e);
  }
  const total = timeline.analysisSeconds;
  return (
    <>
      <h3>Timing</h3>
      <p className="yi-muted">
        {total !== null
          ? `Analysis finished ${durationText(total)} after submission`
          : finished
            ? "Step timings were not recorded for this analysis"
            : "Still running"}
        {timeline.firstStepSeconds !== null
          ? ` · first step started ${durationText(timeline.firstStepSeconds)} after submission`
          : ""}
        {timeline.brief
          ? timeline.briefSeconds !== null
            ? ` · research brief ready ${durationText(timeline.briefSeconds)} after submission`
            : " · research brief still running"
          : ""}
        .
      </p>
      {perStep.size > 0 && (
        <div className="yi-table-wrap">
          <table className="yi-usage-table">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Working</th>
                <th scope="col">Waiting for a worker</th>
              </tr>
            </thead>
            <tbody>
              {[...perStep.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([step, e]) => (
                  <tr key={step}>
                    <td>{step ? STEPS[step - 1].short : "Other"}</td>
                    <td className="yi-num">{secondsText(e.execution)}</td>
                    <td className="yi-num">{secondsText(e.queue)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export const STEP_USAGE_COLUMNS = [
  "usage.step",
  "usage.calls",
  "usage.runs",
  "usage.inputTokens",
  "usage.cachedTokens",
  "usage.outputTokens",
  "usage.seconds",
  "usage.costUsd",
  "usage.costPerRun",
] as const;

/** Lab: the same columns aggregated per step across runs. */
export function StepUsageTable({ calls }: { calls: LedgerRow[] }) {
  const steps = usageByStep(calls);
  if (!steps.length)
    return <p className="yi-muted">No model calls are recorded yet.</p>;
  return (
    <div className="yi-table-wrap">
      <table className="yi-usage-table">
        <thead>
          <tr>
            {STEP_USAGE_COLUMNS.map((id) => (
              <MetricHeading key={id} id={id} />
            ))}
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={String(s.step)}>
              <td>{s.stepLabel}</td>
              <td className="yi-num">
                {s.calls}
                {s.retries ? ` (${s.retries} retr${s.retries === 1 ? "y" : "ies"})` : ""}
              </td>
              <td className="yi-num">{s.runs}</td>
              <td className="yi-num">{tokenText(s.inputTokens)}</td>
              <td className="yi-num">{tokenText(s.cachedTokens)}</td>
              <td className="yi-num">{tokenText(s.outputTokens)}</td>
              <td className="yi-num">{secondsText(s.seconds)}</td>
              <td className="yi-num">{costText(s.costUsd)}</td>
              <td className="yi-num">{costText(s.costPerRunUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
