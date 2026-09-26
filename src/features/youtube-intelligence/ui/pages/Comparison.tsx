import Link from "next/link";
import manifestJson from "../../../../../docs/delivery/comparison-readiness-20260927.json";
import { comparisonManifestSchema, summarizeComparison } from "../../comparison.ts";
import { PageTitle } from "../components.tsx";

const manifest = comparisonManifestSchema.parse(manifestJson);
const summary = summarizeComparison(manifest);
const usd = (amount: number | null) => amount === null ? "Unknown" : `$${amount.toFixed(4)}`;

/** Server-rendered release evidence: this register never starts a paid run. */
export function Comparison() {
  return <>
    <PageTitle title="Retained LeapEdge comparison" description="All 20 original cases, retained attempts and explicit measurement gaps. Agreement is not independently verified accuracy." />
    <section className="yi-panel">
      <h2>What this evidence establishes</h2>
      <p>{summary.cases} cases · {summary.uniqueRuns} distinct runs · {summary.observations} retained observations · {summary.failedObservations} failed observations · {summary.reviewObservations} needing review.</p>
      <p>Known ledger charges: <strong>{usd(summary.knownLedgerUsd)}</strong> · {summary.unsettledCalls} unsettled calls. Repeated observations are not summed as new charges. Unpriced transcript and other missing charges are excluded.</p>
      <p>{summary.retainedLeapedgeReports} retained LeapEdge reports · {summary.missingLeapedgeTiming} cases lack comparable LeapEdge timing · {summary.browserMeasuredCases} cases include measured browser display time.</p>
      <div className="yi-warning"><strong>Quality and timing are separate acceptance checks</strong><ul>{manifest.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
      <p className="yi-muted">Evidence register generated {manifest.generatedAt}. This is a retained release snapshot, not a live status monitor. Failed and review-required attempts remain visible. No new LeapEdge analyses are triggered.</p>
      <Link href="/youtube-intelligence/lab">Back to Lab</Link>
    </section>
    {manifest.cases.map((item) => <section className="yi-panel" style={{overflowWrap:"anywhere"}} key={item.videoId} id={`case-${item.case}`}>
      <h2>{item.case}. {item.title}</h2>
      <p>{item.channel} · <a href={item.url} target="_blank" rel="noreferrer">Open source video ↗</a></p>
      <p>{item.attempts.length} retained observations · {item.attempts.filter((attempt) => attempt.status === "failed").length} failures · Quality: {item.qualityChecks.length > 0 && item.qualityChecks.every((check) => check.status === "pass") ? "checks passed" : "not established"}.</p>
      <details>
      <summary>Compare retained reference, attempts and quality gaps</summary>
      <div className="yi-two-col">
        <section>
          <h3>Retained LeapEdge reference</h3>
          <p>Status: {item.leapedge.status}</p>
          <p>{item.leapedge.assessment}</p>
          {item.leapedge.summaryExcerpt ? <><h4>Retained summary excerpt</h4><blockquote style={{whiteSpace:"pre-wrap"}}>{item.leapedge.summaryExcerpt}</blockquote></> : <p className="yi-warning">No retained summary excerpt is available for side-by-side review.</p>}
          <p>Displayed charge: {usd(item.leapedge.displayedUsd)} · Duration: {item.leapedge.durationSeconds === null ? "Not captured" : `${item.leapedge.durationSeconds.toFixed(2)} seconds`} · Timing boundary: unknown.</p>
          {item.leapedge.reportUrl && <a href={item.leapedge.reportUrl} target="_blank" rel="noreferrer">Open existing LeapEdge report ↗</a>}
          <p className="yi-muted">Captured: {item.leapedge.capturedAt ?? "Unknown"}. An existing report link may require LeapEdge sign-in.</p>
          <details><summary>Reference provenance</summary><p>Retained report SHA-256: <code style={{overflowWrap:"anywhere"}}>{item.leapedge.reportSha256 ?? "No retained report hash"}</code></p></details>
        </section>
        <section>
          <h3>Our retained results</h3>
          <p>{item.originalAssessment}</p>
          {item.attempts.length === 0 && <p className="yi-warning">No retained attempt is available. This case has not passed.</p>}
          {item.attempts.map((attempt) => <article key={attempt.id} className="yi-research-point">
            <h4>{attempt.cohort}</h4>
            <p><strong>{attempt.status.replaceAll("_", " ")}</strong> · {attempt.stage}</p>
            {attempt.error && <p className="yi-warning">{attempt.error}</p>}
            <p>{attempt.acceptedClaims ?? "Unknown"} accepted calls · {attempt.acceptedSentences ?? "Unknown"} published research sentences. Counts do not establish completeness.</p>
            <p>Output basis: {attempt.outputKind.replaceAll("-", " ")}{attempt.modelAcceptedDraftSentences === null ? "" : ` · ${attempt.modelAcceptedDraftSentences} model-accepted draft sentences before publication checks`}.</p>
            {attempt.outputSummary.length > 0 ? <details><summary>Read {attempt.outputKind.replaceAll("-", " ")} ({attempt.outputSummary.length} points)</summary><p className="yi-muted">Historical output, preserved as generated. It has not been revalidated by the new assertion-support checks.</p><ul>{attempt.outputSummary.map((text, i) => <li key={i}>{text}</li>)}</ul></details> : <p className="yi-warning">No accepted output text retained in this observation.</p>}
            <p>{attempt.timing.seconds === null ? "Duration unknown" : `${attempt.timing.seconds.toFixed(2)} seconds`} · {attempt.timing.boundary.replaceAll("-", " ")} · {attempt.timing.includesQueue ? "includes queue" : "queue excluded or unmeasured"} · {attempt.timing.includesBrowser ? "includes browser" : "browser excluded"}.</p>
            <p>Settled charges: {usd(attempt.cost.settledUsd)} · {attempt.cost.unsettledCalls} unsettled calls. {attempt.cost.scope}.</p>
            {attempt.coverageFindings.length > 0 && <ul className="yi-warning">{attempt.coverageFindings.map((finding, i) => <li key={i}>{finding}</li>)}</ul>}
            <details><summary>Run configuration and provenance</summary>
              <p>Run: <code style={{overflowWrap:"anywhere"}}>{attempt.runId}</code></p>
              <p>{attempt.model} · Prompt {attempt.promptVersion} · Created {attempt.createdAt} · Updated {attempt.updatedAt}</p>
              <p>Configuration SHA-256: <code style={{overflowWrap:"anywhere"}}>{attempt.configSha256}</code></p>
              <p>Transcript SHA-256: <code style={{overflowWrap:"anywhere"}}>{attempt.transcriptSha256 ?? "Not retained"}</code></p>
              <p>Output SHA-256: <code style={{overflowWrap:"anywhere"}}>{attempt.outputSha256}</code></p>
              <p className="yi-muted">Run artifacts may belong to an isolated benchmark database and are not assumed to exist in this workspace.</p>
            </details>
          </article>)}
        </section>
      </div>
      <h3>Quality acceptance</h3>
      <ul>{item.qualityChecks.map((check) => <li key={check.id}><strong>{check.status.replaceAll("_", " ")}</strong>: {check.description}</li>)}</ul>
      </details>
    </section>)}
  </>;
}
