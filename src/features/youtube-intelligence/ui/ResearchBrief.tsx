"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ResearchBriefData, AcceptedSentence } from "../research-brief.ts";
import { researchPipelineLabel } from "../research-pipeline-choice.ts";
import { prioritiseBriefs } from "../research-brief.ts";
import { inspectLimitations } from "../limitation-consistency.ts";
import { researchLifecycle } from "../research-lifecycle.ts";
import { researchReadiness } from "../research-readiness.ts";
import { factualSupportLabel, thesisRobustnessLabel, externalRelationshipLabel, financialFactRows, retainedSourceWarnings } from "../research-presentation.ts";
import type { SourceData } from "../contracts.ts";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
import { NewsReview } from "./NewsReview.tsx";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Unknown";
/** `title`: the heading; the Daily report shows this ranking as "Video briefs" (decision D3). */
export function ResearchOverview({
  title = "Material developments",
}: { title?: string } = {}) {
  const { data } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [timeMode, setTimeMode] = useState<"video_date" | "current">(
    "video_date",
  );
  if (!data) return null;
  const latest = new Map<
    string,
    (typeof data.snapshot.researchBriefs)[number]
  >();
  for (const b of [...data.snapshot.researchBriefs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  ))
    if (!latest.has(b.videoId)) latest.set(b.videoId, b);
  const rows = Array.from(latest.values()).map((b) => ({
    ...b,
    publishedAt:
      timeMode === "current"
        ? b.latestExternalPublishedAt
        : b.context.videoPublishedAt,
    sentences: b.sentences.filter((s) => s.timeMode === timeMode),
    status: "completed",
    readiness: b.readiness,
  }));
  const ranked = prioritiseBriefs(
    rows.filter((b) => b.sentences.length > 0),
    rows,
  );
  return (
    <section className="yi-panel yi-research-overview">
      <div className="yi-section-title">
        <div>
          <span className="yi-eyebrow">Evidence-led research</span>
          <h2>{title}</h2>
        </div>
        <span className="yi-muted">General research · both horizons</span>
      </div>
      <div
        className="yi-view-switch"
        role="group"
        aria-label="Research time view"
      >
        <button
          aria-pressed={timeMode === "video_date"}
          onClick={() => setTimeMode("video_date")}
        >
          Video-date research
        </button>
        <button
          aria-pressed={timeMode === "current"}
          onClick={() => setTimeMode("current")}
        >
          Current updates
        </button>
      </div>
      <p className="yi-muted">
        Ranked by materiality and the publication date of the selected evidence.
        Processing an old video does not make it new information.
      </p>
      {rows.some((b) => b.readiness.status !== "complete") && (
        <div className="yi-warning">
          <strong>Research needs attention</strong>
          <ul>{rows.filter((b) => b.readiness.status !== "complete").map((b) => (
            <li key={b.id}><Link href={`/youtube-intelligence/analysis/${b.sourceRunId}#research-brief`}>{b.title || b.videoId}</Link>: {b.readiness.label} · {b.readiness.issues[0]}</li>
          ))}</ul>
          <p>Processing completion does not establish research completeness. Briefs with no accepted points are included here.</p>
        </div>
      )}
      {ranked.length ? (
        <>
          <div className="yi-brief-feed">
            {ranked.slice(0, expanded ? ranked.length : 2).map((b) => (
              <article key={b.id}>
                <div className="yi-row">
                  <span className="yi-chip">
                    {timeMode === "current"
                      ? "External update"
                      : b.backfill
                        ? "Historical backfill"
                        : "Dated research"}
                  </span>
                  <small>Published {date(b.publishedAt)}</small>
                </div>
                <p className={b.readiness.status === "complete" ? "yi-muted" : "yi-warning"}>{b.readiness.label} · {b.readiness.covered}/{b.readiness.total} retained evidence items represented</p>
                <h3>
                  <Link
                    href={`/youtube-intelligence/analysis/${b.sourceRunId}#research-brief`}
                  >
                    {b.mainTopics[0] || b.title}
                  </Link>
                </h3>
                {b.sentences.some((s) => s.horizon === "general") && (
                  <p>
                    <strong>Cross-cutting: </strong>
                    {
                      b.sentences
                        .filter((s) => s.horizon === "general")
                        .sort((a, b) => b.materiality - a.materiality)[0]?.text
                    }
                  </p>
                )}
                <div className="yi-horizon-grid">
                  {(["tactical", "fundamental"] as const).map((h) => (
                    <div key={h}>
                      <h4>{h === "tactical" ? "Tactical" : "Fundamental"}</h4>
                      <p>
                        {b.sentences
                          .filter(
                            (s) => s.horizon === h || s.horizon === "both",
                          )
                          .sort((a, b) => b.materiality - a.materiality)[0]
                          ?.text ?? "No supported conclusion for this horizon."}
                      </p>
                      <small className="yi-muted">
                        {b.sentences
                          .filter(
                            (s) => s.horizon === h || s.horizon === "both",
                          )
                          .sort((a, b) => b.materiality - a.materiality)[0]
                          ?.fidelity ?? "No assessed source"}{" "}
                        · Facts:{" "}
                        {(() => {
                          const point = b.sentences.filter((s) => s.horizon === h || s.horizon === "both").sort((a, b) => b.materiality - a.materiality)[0];
                          return point ? factualSupportLabel(point) : "Unverified";
                        })()}
                      </small>
                    </div>
                  ))}
                </div>
                <details>
                  <summary>Why this appears here</summary>
                  <ul>
                    {b.rankingReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
                <Link
                  href={`/youtube-intelligence/analysis/${b.sourceRunId}#research-brief`}
                >
                  Read brief and inspect evidence →
                </Link>
              </article>
            ))}
          </div>
          {ranked.length > 2 && (
            <button
              className="yi-text-button"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? "Show fewer briefs"
                : `Show all ${ranked.length} briefs`}
            </button>
          )}
        </>
      ) : (
        <p>
          {timeMode === "current"
            ? "No eligible, dated current updates are available. Open a brief to inspect verification coverage; this does not establish that nothing has changed."
            : "No independently critiqued briefs yet. Open a completed analysis and choose “Generate research brief”. Existing calls remain available below."}
        </p>
      )}
    </section>
  );
}
export function ResearchBrief({
  sourceRunId,
  briefs,
  source,
  onSeek,
  completed,
}: {
  sourceRunId: string;
  briefs: ResearchBriefData[];
  source?: SourceData;
  onSeek: (seconds: number) => void;
  completed: boolean;
}) {
  const { perform, busy, data } = useWorkspace();
  const [horizon, setHorizon] = useState("both");
  const [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [revision, setRevision] = useState("");
  const panel = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const closeEvidence = () => {
    setSelected("");
    trigger.current?.focus();
  };
  useEffect(() => {
    if (selected) panel.current?.focus();
  }, [selected]);
  const ordered = [...briefs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const brief = ordered.find((b) => b.id === revision) ?? ordered[0];
  const lifecycle = researchLifecycle(sourceRunId, data?.snapshot.jobs ?? [], briefs, brief?.id ?? null);
  const selectedResearchJob = data?.snapshot.jobs.find(job => job.id === brief?.runId);
  const lifecyclePanel = <section aria-label="Research attempt status" className={['failed','needs_review','publication_missing','unknown'].includes(lifecycle.state) ? 'yi-warning' : 'yi-current-update'}>
    <h3>{lifecycle.heading}</h3>
    {brief && <p>Selected brief pipeline: {selectedResearchJob ? researchPipelineLabel(selectedResearchJob.researchPipelineIdentity) : "Pipeline identity not loaded for this revision"}</p>}
    <p>{lifecycle.message}</p>
    {lifecycle.latest && <p>Stage: {lifecycle.latest.stage}</p>}
    {lifecycle.selectedRevisionNotice && <p>{lifecycle.selectedRevisionNotice}</p>}
    {lifecycle.showEarlierBriefNotice && <p>{lifecycle.earlierBriefNotice}</p>}
    {lifecycle.history.length > 0 && <details>
      <summary>Inspect {lifecycle.history.length} research attempt(s) and error details</summary>
      <ul>{lifecycle.history.map(attempt => <li key={attempt.id}>
        <strong>{attempt.status} · {attempt.stage}</strong> · {date(attempt.createdAt)}
        <p>Run: {attempt.id} · Updated: {date(attempt.updatedAt)}</p>
        <p>{researchPipelineLabel(data?.snapshot.jobs.find(job => job.id === attempt.id)?.researchPipelineIdentity)}</p>
        {attempt.error && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{attempt.error}</pre>}
      </li>)}</ul>
    </details>}
  </section>;
  const generate = () =>
    void perform(
      () => action("research", "generateResearchBrief", { sourceRunId }),
      "Research brief queued. Original analysis and earlier revisions are retained.",
    );
  if (!brief)
    return (
      <section id="research-brief" className="yi-panel">
        <h2>Investment research brief</h2>
        {lifecyclePanel}
        <p>
          Build a whole-video synthesis from accepted calls and research
          context, with separate tactical and fundamental sections and an
          independent evidence critique.
        </p>
        <button onClick={generate} disabled={busy || !completed || lifecycle.generationDisabled}>
          {lifecycle.generationLabel}
        </button>
        <p className="yi-muted">
          Model and external-search usage is recorded. Missing verification
          remains explicit.
        </p>
      </section>
    );
  const readiness = researchReadiness(brief);
  const noteChecks = inspectLimitations(brief).filter(note=>note.warning);
  const originalDiagnostics = [
    ...brief.omissions.map((text,index)=>({id:`omission:${index}`,origin:'Original omission',text})),
    ...brief.coverageFindings.map((text,index)=>({id:`coverage:${index}`,origin:'Original coverage finding',text})),
    ...brief.retrievalNotes.map((text,index)=>({id:`retrieval:${index}`,origin:'Original retrieval note',text})),
  ];
  const retainedWarnings = brief.sentences.map(sentence=>({sentence,warnings:retainedSourceWarnings(sentence,brief.evidence)})).filter(item=>item.warnings.length>0);
  const retainedWarningCount = retainedWarnings.reduce((count,item)=>count+item.warnings.length,0);
  const unresolved = readiness.coverage.filter((item) => item.status === "unresolved");
  const current = brief.sentences.find((s) => s.id === selected);
  const currentQuantities = current ? financialFactRows(current, brief.evidence) : [];
  const currentWarnings = retainedWarnings.find(item=>item.sentence.id===selected)?.warnings ?? [];
  const cues = source?.segments ?? [];
  const sentence = (s: AcceptedSentence) => {
    const quantities = financialFactRows(s, brief.evidence);
    const sourceWarnings = retainedWarnings.find(item=>item.sentence.id===s.id)?.warnings ?? [];
    const corrected = quantities.filter(q=>q.status === "corrected").length;
    const unresolvedFigures = quantities.filter(q=>q.status === "unresolved").length;
    return (
    <article
      key={s.id}
      className={`yi-research-point ${selected === s.id ? "is-selected" : ""}`}
    >
      <span className="yi-eyebrow">
        {s.topic} · {s.kind === "analysis" ? "Analyst inference" : s.kind === "creator_view" ? "Source view" : s.kind === "reported_fact" ? "Source-reported claim" : s.kind.replaceAll("_", " ")}
      </span>
      {sourceWarnings.length>0 && <details className="yi-warning">
        <summary>Source checks: {[...new Set(sourceWarnings.map(w=>w.label))].join("; ")}</summary>
        <ul>{sourceWarnings.map((warning,index)=><li key={index}>{warning.reason}</li>)}</ul>
        <small>Original sentence retained below; this is not a new factual verification or audit.</small>
      </details>}
      <p>{s.text}</p>
      {s.calculationResult && (
        <p className="yi-muted">
          Arithmetic check:{" "}
          {s.calculationResult.value === null
            ? "Invalid inputs"
            : s.calculationResult.value.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{" "}
          {s.calculationResult.unit}. {s.calculationResult.reason}{" "}
          {s.calculation?.assumptions}
        </p>
      )}
      <small>{s.importanceReason}</small>
      <div className="yi-confidence">
        <span>{sourceWarnings.some(warning=>warning.kind!=="quantity_corrected") ? "Source checks need review" : s.fidelity}</span>
        <span>Facts: {factualSupportLabel(s)}</span>
        <span>
          Novelty: {s.novelty?.status.replaceAll("_", " ") ?? "unknown"}
        </span>
        <span>
          Thesis:{" "}
          {thesisRobustnessLabel(s)}
        </span>
      </div>
      {!!(corrected || unresolvedFigures) && <p className="yi-muted">
        Financial figures: {corrected} source-based unit correction(s), {unresolvedFigures} unresolved field(s). Inspect the original values and source checks below.
      </p>}
      <button
        className="yi-text-button"
        aria-expanded={selected === s.id}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setSelected(selected === s.id ? "" : s.id);
        }}
      >
        Inspect evidence · {s.evidenceIds.length + s.externalIds.length}{" "}
        references
      </button>
    </article>
    );
  };
  return (
    <section id="research-brief" className="yi-panel yi-research-brief">
      {lifecyclePanel}
      <div className="yi-section-title">
        <div>
          <span className="yi-eyebrow">Sceptical investment research</span>
          <h2>{brief.mainTopics[0] || "Research brief"}</h2>
        </div>
        <button
          className="yi-text-button"
          disabled={busy || lifecycle.generationDisabled}
          onClick={generate}
        >
          {lifecycle.generationLabel}
        </button>
      </div>
      {retainedWarnings.length>0 && <section className="yi-warning" aria-label="Retained source consistency warnings">
        <h3>{retainedWarningCount} current source-consistency warning(s) across {retainedWarnings.length} retained sentence(s)</h3>
        <p>Current application checks found corrected or unresolved quantities, financial conventions, or speaker attribution. Original prose and audit history remain unchanged. This is not a new research audit or external factual verification; coverage accounting is separate.</p>
        <details><summary>Inspect affected sentences and source passages</summary><ul>{retainedWarnings.map(({sentence,warnings})=><li key={sentence.id}>
          <button className="yi-text-button" onClick={event=>{trigger.current=event.currentTarget;setSelected(sentence.id);}}>{sentence.topic} · {sentence.id}: {warnings.map(warning=>warning.label).join('; ')}</button>
        </li>)}</ul></details>
      </section>}
      <section aria-label="Research readiness" className={readiness.status === "complete" ? "yi-current-update" : "yi-warning"}>
        <h3>{readiness.label}</h3>
        <p>{readiness.covered}/{readiness.total} retained evidence items represented. Coverage measures the retained inventory, not everything said in the video.</p>
        <p>Readiness is separate from factual confidence. This is research support, not an independently verified investment recommendation.</p>
        <p>{originalDiagnostics.length} original diagnostic note(s) retained. These may include application checks and model assessments; their wording can be stale or conflicting and is not independently verified fact. Categorizing them does not resolve them or improve readiness. <a href="#research-original-diagnostics">Inspect all original notes</a>.</p>
        {noteChecks.length > 0 && <details>
          <summary>{noteChecks.length} recomputed source-consistency check(s) on original limitations</summary>
          {noteChecks.map(note=><article key={note.index}>
            <strong>{note.status==='source_conflict'?'Original limitation — ratio conflicts with source':'Original limitation — ratio unresolved'}</strong>
            <p>{note.warning}</p><blockquote>{note.original}</blockquote>
            {note.evidenceIds.map(id=>{
              const item=brief.evidence.find(e=>e.id===id);
              return item?<div key={id}><p>Source evidence: {id}</p>{item.quotes.map((quote,i)=><div key={i}><blockquote>{quote.text}</blockquote>{quote.start!==null && <button onClick={()=>onSeek(quote.start!)}>Jump to source passage</button>}</div>)}</div>:null;
            })}
          </article>)}
        </details>}
        {readiness.issues.length > 0 && <ul>{readiness.issues.slice(0, 3).map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
        {readiness.issues.length > 3 && <details>
          <summary>{readiness.issues.length - 3} more research gaps or limitations</summary>
          <ul>{readiness.issues.slice(3).map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        </details>}
        {unresolved.length > 0 && <details>
          <summary>Inspect {unresolved.length} unresolved evidence item{unresolved.length === 1 ? "" : "s"}</summary>
          <ul>{unresolved.map((item) => {
            const evidence = brief.evidence.find((e) => e.id === item.evidenceId);
            return <li key={item.evidenceId}>
              <strong>{item.topic}</strong> · {item.evidenceId}
              {evidence && <details><summary>Inspect omitted evidence</summary>
                <p>{evidence.summary}</p>
                {evidence.quotes.map((quote, i) => <div key={i}><blockquote>{quote.text}</blockquote>
                  {quote.translation && <p>{quote.translation}</p>}
                  <button className="yi-text-button" disabled={quote.start === null} onClick={() => onSeek(quote.start ?? 0)}>Play source · {quote.start ?? "untimed"} seconds</button>
                  <small> {quote.startId}–{quote.endId} · {quote.hash ?? "No retained hash"}</small>
                </div>)}
              </details>}
            </li>;
          })}</ul>
        </details>}
        <Link href="/youtube-intelligence/comparison">Inspect retained LeapEdge comparisons →</Link>
      </section>
      <div className="yi-research-dates">
        <span>
          Video published{" "}
          <strong>{date(brief.context.videoPublishedAt)}</strong>
        </span>
        <span>
          Recorded <strong>{date(brief.context.recordedAt)}</strong>
        </span>
        <span>
          Research as of <strong>{date(brief.context.analysedAt)}</strong>
        </span>
      </div>
      {ordered.length > 1 && (
        <label>
          Retained revision{" "}
          <select
            value={brief.id}
            onChange={(e) => {
              setRevision(e.target.value);
              setSelected("");
            }}
          >
            {ordered.map((b) => (
              <option key={b.id} value={b.id}>
                {date(b.createdAt)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="yi-muted">
        Confidence separates source fidelity, external factual corroboration and
        thesis robustness. Model critique is not human verification.
      </p>
      <details>
        <summary>Company and event outline</summary>
        <ul>
          {[...new Set(brief.sentences.map((s) => s.topic))].map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </details>
      <div
        className="yi-view-switch"
        role="group"
        aria-label="Research horizon"
      >
        {["both", "tactical", "fundamental"].map((h) => (
          <button
            key={h}
            aria-pressed={horizon === h}
            onClick={() => setHorizon(h)}
          >
            {h === "both"
              ? "Both horizons"
              : h === "tactical"
                ? "Tactical"
                : "Fundamental"}
          </button>
        ))}
      </div>
      <div
        className={`yi-horizon-grid ${horizon !== "both" ? "yi-single-horizon" : ""}`}
      >
        {(["tactical", "fundamental"] as const)
          .filter((h) => horizon === "both" || horizon === h)
          .map((h) => (
            <div key={h}>
              <h3>
                {h === "tactical"
                  ? "Tactical · catalysts & positioning"
                  : "Fundamental · business & valuation"}
              </h3>
              {brief.sentences
                .filter(
                  (s) =>
                    s.timeMode === "video_date" &&
                    (s.horizon === h || s.horizon === "both"),
                )
                .sort((a, b) => b.materiality - a.materiality)
                .map(sentence)}
              {!brief.sentences.some(
                (s) =>
                  s.timeMode === "video_date" &&
                  (s.horizon === h || s.horizon === "both"),
              ) && <p>No supported conclusion for this horizon.</p>}
            </div>
          ))}
      </div>
      {brief.sentences.some(
        (s) => s.timeMode === "video_date" && s.horizon === "general",
      ) && (
        <div>
          <h3>Cross-cutting context</h3>
          {brief.sentences
            .filter(
              (s) => s.timeMode === "video_date" && s.horizon === "general",
            )
            .map(sentence)}
        </div>
      )}
      {brief.sentences.some((s) => s.timeMode === "current") && (
        <section className="yi-current-update">
          <h3>Current update · separate from the video-date thesis</h3>
          {brief.sentences.filter((s) => s.timeMode === "current").map(sentence)}
        </section>
      )}
      <NewsReview
        briefId={brief.id}
        claims={brief.sentences.filter((s) => s.timeMode === "video_date").map((s) => ({ id: s.id, text: s.text }))}
      />
      {current && (
        <section
          aria-label="Research evidence"
          role="dialog"
          aria-modal={false}
          tabIndex={-1}
          ref={panel}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeEvidence();
          }}
          className="yi-research-evidence"
        >
          <div className="yi-section-title">
            <h3>Evidence for this point</h3>
            <button onClick={closeEvidence}>Close evidence</button>
          </div>
          <p>{current.text}</p>
          {currentWarnings.length>0 && <section className="yi-warning" aria-label="Current source consistency checks">
            <h4>Current source checks — review before use</h4>
            <ul>{currentWarnings.map((warning,index)=><li key={index}><strong>{warning.label}:</strong> {warning.reason}</li>)}</ul>
            <p>The original sentence and model critique below are retained for audit. These current checks do not establish factual verification.</p>
          </section>}
          <p>
            <strong>Retained model critique (historical assessment):</strong> {current.auditReason}
          </p>
          <p><strong>Retained source label:</strong> {current.fidelity}. Current source warnings take precedence when present.</p>
          <p><strong>Factual support:</strong> {factualSupportLabel(current)}</p>
          {!!current.externalSupport?.length && <section aria-label="Assertion support">
            <h4>Assertion-level external evidence</h4>
            {current.externalSupport.map((support, i) => <div key={i}>
              <p><strong>{externalRelationshipLabel(support, !!current.financialFacts?.length)}:</strong> {support.assertion}</p>
              <blockquote>{support.quote}</blockquote>
              <p>{support.reason}</p>
              <p><strong>Comparison basis:</strong> Metric: {support.comparability?.metric ?? "unknown"} · Period: {support.comparability?.period ?? "unknown"} · Units: {support.comparability?.units ?? "unknown"} · Observation convention: {support.comparability?.observationBasis ?? "unknown"}.</p>
              <p>{support.comparability?.reason ?? "No comparison assessment was retained. Different measurement dates, units or observation conventions do not establish a contradiction."}</p>
              <small>Source {support.externalId} · model-assessed relationship; inspect the retained source below.</small>
            </div>)}
          </section>}
          <p>
            <strong>Thesis robustness:</strong>{" "}
            {thesisRobustnessLabel(current)}
          </p>
          <p>
            <strong>Retained audit explanation (historical assessment):</strong>{" "}
            {current.robustnessReason ?? "Not independently established."}
          </p>
          <p>
            <strong>Novelty:</strong>{" "}
            {current.novelty?.reason ?? "No audited comparable baseline."}
          </p>
          {!!currentQuantities.length && (
            <details>
              <summary>Financial figures and source checks</summary>
              <p>These checks preserve source units; they do not independently verify the underlying financial facts.</p>
              {currentQuantities.map((check, i) => {
                const f = check.fact ?? check.original;
                return (
                <p key={i}>
                  {check.status === "unresolved" && <strong>Unresolved proposed figure — do not use for calculations. </strong>}
                  <strong>{f.label}:</strong> {f.currency ? `${f.currency} ` : ""}{f.value.toLocaleString(undefined, {maximumFractionDigits: 10})}{f.scale === "ones" ? "" : ` ${f.scale.replace(/s$/, "")}`} ·{" "}
                  {f.unit.replaceAll("_", " ")} ·{" "}
                  {f.nature.replaceAll("_", " ")}{f.basis === "not_stated" ? "" : ` · ${f.basis}`} ·{" "}
                  {f.period ?? "period unstated"}
                  <br />
                  Dimension: {f.unitDescription ?? (["other", "capacity"].includes(f.unit) ? "not established" : f.unit.replaceAll("_", " "))} · Qualifier: {(f.relation ?? "unknown") === "unknown" ? "not established" : f.relation.replaceAll("_", " ")} (model assessed)
                  <br />
                  Original: “{f.quote}” ({f.evidenceId})
                  {check.status !== "unchanged" && <>
                    <br /><strong>{check.status === "corrected" ? "Source-based correction: " : "Review needed: "}</strong>{check.reason.replaceAll("_", " ")}
                    <br />Retained model proposal: {check.original.value}{check.original.scale === "ones" ? "" : ` ${check.original.scale.replace(/s$/, "")}`} {check.original.unit.replaceAll("_", " ")}.
                  </>}
                </p>
                );
              })}
            </details>
          )}
          {(brief.baseline ?? [])
            .filter((b) => current.novelty?.baselineIds.includes(b.id))
            .map((b) => (
              <details key={b.id}>
                <summary>
                  Compared with: {b.topic} · {date(b.publishedAt)}
                </summary>
                <p>{b.text}</p>
                <Link href={`/youtube-intelligence/analysis/${b.sourceRunId}`}>
                  Inspect earlier analysis →
                </Link>
                {b.evidence
                  .flatMap((e) => e.quotes)
                  .map((q, i) => (
                    <blockquote key={i}>{q.text}</blockquote>
                  ))}
              </details>
            ))}
          <p>
            Attribution: {current.speaker || "Unknown"} (model-labelled; speaker
            identity is not independently verified) ·{" "}
            {current.timeMode === "video_date"
              ? "Video-date analysis"
              : "Later update"}
          </p>
          {brief.evidence
            .filter((e) => current.evidenceIds.includes(e.id))
            .map((e) => (
              <div key={e.id}>
                <h4>
                  {e.instrument || "Video context"} · {e.id}
                </h4>
                {e.quotes.map((q, i) => {
                  const first = cues.findIndex((c) => c.id === q.startId);
                  const last = cues.findIndex((c) => c.id === q.endId);
                  return (
                    <div key={i}>
                      <blockquote>{q.text}</blockquote>
                      {q.translation && (
                        <details
                          open={
                            !!source?.language &&
                            !source.language.startsWith("en")
                          }
                        >
                          <summary>English translation</summary>
                          <p>{q.translation}</p>
                        </details>
                      )}
                      <button
                        className="yi-text-button"
                        disabled={q.start === null}
                        onClick={() => {
                          onSeek(q.start ?? 0);
                          closeEvidence();
                          document
                            .getElementById("source-player")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        Play from{" "}
                        {q.start === null
                          ? "untimed source"
                          : `${Math.floor(q.start / 60)}:${String(Math.floor(q.start % 60)).padStart(2, "0")}`}
                      </button>
                      <details>
                        <summary>Surrounding transcript and provenance</summary>
                        <p>
                          {q.startId}–{q.endId} · {q.start ?? "unknown"}–
                          {q.end ?? "unknown"} seconds
                        </p>
                        <code>{q.hash ?? "No retained hash"}</code>
                        {first >= 0 ? (
                          cues
                            .slice(
                              Math.max(0, first - 2),
                              Math.max(first, last) + 3,
                            )
                            .map((c) => (
                              <p key={c.id}>
                                <strong>{c.id}</strong> {c.text}
                              </p>
                            ))
                        ) : (
                          <p>
                            Original cues are available on the source analysis.
                          </p>
                        )}
                      </details>
                    </div>
                  );
                })}
              </div>
            ))}
          {brief.external
            .filter((e) => current.externalIds.includes(e.id))
            .map((e) => (
              <details key={e.id}>
                <summary>
                  {e.title} · {e.sourceClass}
                </summary>
                <a href={e.url} target="_blank" rel="noreferrer">
                  Open external source ↗
                </a>
                <p>
                  Published {date(e.publishedAt)} · Retrieved{" "}
                  {date(e.retrievedAt)} · {e.dateBasis}
                </p>
                <code>{e.hash}</code>
                <pre>{e.text}</pre>
              </details>
            ))}
        </section>
      )}
      <details>
        <summary>Search the retained transcript</summary>
        <label>
          Transcript text{" "}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find company, number or phrase"
          />
        </label>
        {query.trim().length >= 2 ? (
          cues
            .filter((c) =>
              c.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .slice(0, 60)
            .map((c) => (
              <p key={c.id}>
                <button
                  className="yi-text-button"
                  disabled={c.start_seconds === null}
                  onClick={() => onSeek(c.start_seconds ?? 0)}
                >
                  {c.id} · {c.start_seconds ?? "untimed"}s
                </button>{" "}
                {c.text}
              </p>
            ))
        ) : (
          <p>
            Enter at least two characters. Up to 60 matching cues are shown.
          </p>
        )}
      </details>
      <details id="research-original-diagnostics">
        <summary>Original diagnostics ({originalDiagnostics.length}), limitations and cost audit</summary>
        <p>Historical diagnostics are retained verbatim, including repeated or conflicting notes. A later note saying a gap was addressed does not by itself resolve an earlier warning. Source-anchored structured coverage assessments and recomputed source-consistency checks are shown separately above; note wording alone does not establish its provenance.</p>
        <p>
          Model calls: ${brief.modelCostUsd.toFixed(4)} · External search: $
          {brief.externalCostUsd.toFixed(4)} known charges
          {brief.unknownExternalCosts
            ? ` · ${brief.unknownExternalCosts} search charges unknown`
            : ""}
        </p>
        <Link href={`/youtube-intelligence/analysis/${brief.runId}`}>
          Inspect research processing run →
        </Link>
        <ul>
          {originalDiagnostics.map(note => (
            <li key={note.id}><strong>{note.origin}</strong> · {note.id}<p>{note.text}</p></li>
          ))}
        </ul>
        <p>{brief.rejected.length} unsupported draft points withheld.</p>
        {brief.rejected.map((r) => (
          <details key={r.sentence.id}>
            <summary>Withheld: {r.sentence.topic}</summary>
            <p>{r.sentence.text}</p>
            <p>{r.reasons.join(" · ")}</p>
          </details>
        ))}
      </details>
    </section>
  );
}
