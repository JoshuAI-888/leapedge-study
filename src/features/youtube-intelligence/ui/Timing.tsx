"use client";
import type { RunTimelineData } from "../timing.ts";

const fmt = (s: number | null) =>
  s === null ? "—" : s < 90 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

/** Submission-to-result timing from stored step rows. Queue time is waiting
 * for a worker slot; execution is the step itself, mostly provider calls. */
export function Timing({ timeline }: { timeline: RunTimelineData | undefined }) {
  if (!timeline) return null;
  const rows = [
    ...timeline.analysis.stages.map((s) => ({ ...s, part: "Analysis" })),
    ...(timeline.brief?.stages ?? []).map((s) => ({ ...s, part: "Research brief" })),
  ];
  return (
    <section className="yi-panel" aria-label="Timing">
      <h3>Timing</h3>
      <dl>
        <dt>First step started</dt>
        <dd>{fmt(timeline.firstStepSeconds)} after submission</dd>
        <dt>Analysis finished</dt>
        <dd>{fmt(timeline.analysisSeconds)}</dd>
        <dt>Research brief finished</dt>
        <dd>{timeline.brief ? fmt(timeline.briefSeconds) : "No brief queued"}</dd>
        <dt>End to end</dt>
        <dd>{timeline.complete ? fmt(timeline.endToEndSeconds) : "In progress"}</dd>
      </dl>
      <div className="yi-table-wrap">
      <table>
        <thead>
          <tr><th>Part</th><th>Stage</th><th>Steps</th><th>Execution</th><th>Queue wait</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.part + r.stage}>
              <td>{r.part}</td><td>{r.stage}</td><td>{r.steps}</td>
              <td>{fmt(r.executionSeconds)}</td><td>{fmt(r.queueSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
