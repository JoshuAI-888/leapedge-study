"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery, useStickyTop } from "../layout-hooks.ts";
import { researchPipelineLabelFromInput } from "../../research-pipeline-choice.ts";
import { ResearchBrief } from "../ResearchBrief.tsx";
import { Timing } from "../Timing.tsx";
import type { RunTimelineData } from "../../timing.ts";
import type { ResearchBriefData } from "../../research-brief.ts";
import type { SourceData } from "../../contracts.ts";
import { request, action } from "../api.ts";
import type { EvidenceSpanRow } from "../../../../server/youtube-intelligence/repos/evidence-spans.ts";
import type { ClaimRow } from "../../../../server/youtube-intelligence/repos/claims.ts";
import type { Run, CheckedClaim } from "../../contracts.ts";
import { Agreement } from "../../agreement.ts";
import { SourcePlayer } from "../../SourcePlayer.tsx";
import { useWorkspace } from "../workspace.tsx";
import {
  ClaimCard,
  Collapsible,
  Empty,
  LevelChips,
  PageTitle,
  TrustBadge,
} from "../components.tsx";
import {
  money,
  processingState,
  visibleClaims,
  localClaimId,
} from "../viewmodel.ts";
export function Analysis({ id }: { id: string }) {
  const { data, perform, busy } = useWorkspace();
  const [briefs, setBriefs] = useState<ResearchBriefData[]>([]);
  const [researchSeek, setResearchSeek] = useState(false);
  const [run, setRun] = useState<Run | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [seconds, setSeconds] = useState(0),
    [reviewNote, setReviewNote] = useState(""),
    [listened, setListened] = useState(false),
    [spans, setSpans] = useState<EvidenceSpanRow[]>([]),
    [storedClaims, setStoredClaims] = useState<ClaimRow[]>([]),
    [reviewerConfigured, setReviewerConfigured] = useState(false);
  // Below 900 px the evidence panel is portalled into a slot directly under
  // the selected card; above, it is a sticky column whose top keeps a tall
  // panel fully reachable without an internal scroll box.
  const narrow = useMediaQuery("(max-width: 899.98px)");
  const [evidenceSlot, setEvidenceSlot] = useState<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement>(null);
  const evidenceTop = useStickyTop(
    evidenceRef,
    76,
    !narrow && !!run && !!data && storedClaims.length > 0,
  );
  useEffect(() => {
    const controller = new AbortController();
    request<{
      run: Run;
      researchBriefs: ResearchBriefData[];
      evidenceSpans: EvidenceSpanRow[];
      claims: ClaimRow[];
      reviewerConfigured: boolean;
    }>(
      `/api/intelligence/runs/${encodeURIComponent(id)}`,
      undefined,
      controller.signal,
    )
      .then((x) => {
        setRun(x.run);
        setBriefs(x.researchBriefs ?? []);
        setSpans(x.evidenceSpans ?? []);
        setStoredClaims(x.claims ?? []);
        setReviewerConfigured(x.reviewerConfigured);
        const hash = decodeURIComponent(window.location.hash.slice(1));
        if (!run || run.id !== id) {
          const ordered = visibleClaims(x.claims ?? [], "", "L0");
          const initial = ordered.find((c) => c.id === hash) ?? ordered[0];
          setSelected(initial?.id ?? "");
          const starts = (x.evidenceSpans ?? [])
            .filter((s) => s.claimId === initial?.id && s.startSeconds !== null)
            .map((s) => s.startSeconds!);
          setSeconds(starts.length ? Math.min(...starts) : 0);
          setListened(false);
          setResearchSeek(false);
        }
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, data?.snapshot.runs, data?.snapshot.researchBriefs]);
  if (error)
    return (
      <div role="alert" className="yi-warning">
        {error}
      </div>
    );
  if (!run || !data) return <p role="status">Loading analysis…</p>;
  const claims = visibleClaims(storedClaims, "", "L0");
  const current = claims.find((c) => c.id === selected) ?? claims[0];
  const checked = (
    Array.isArray(run.output.claims) ? run.output.claims : []
  ) as CheckedClaim[];
  const context = (
    (Array.isArray(run.output.keyPoints)
      ? run.output.keyPoints
      : []) as CheckedClaim[]
  ).filter((point) => point.passed && point.reasons.length === 0);
  const original = checked.find(
    (c) => c.id === (current ? localClaimId(current.id, id) : ""),
  );
  const persistedSpans = spans.filter((s) => s.claimId === current?.id);
  const evidence = persistedSpans.length
    ? persistedSpans.map((s) => ({
        quote_original: s.textOriginal,
        quote_translation_en: s.translationEn ?? "",
        source_span: {
          start_seconds: s.startSeconds,
          end_seconds: s.endSeconds,
        },
      }))
    : (original?.claim.evidence ?? []);
  const rawAgreement =
    current?.trustBasis &&
    typeof current.trustBasis === "object" &&
    "agreement" in current.trustBasis
      ? current.trustBasis.agreement
      : [];
  const parsedAgreement = Agreement.array().safeParse(rawAgreement);
  const agreements = parsedAgreement.success ? parsedAgreement.data : [];
  const timed =
    evidence.every(
      (e) =>
        e.source_span?.start_seconds != null &&
        e.source_span?.end_seconds != null,
    ) && evidence.length > 0;
  const startSeconds = Math.min(
    ...evidence.map((e) => e.source_span?.start_seconds ?? 0),
  );
  const endSeconds = Math.max(
    ...evidence.map((e) => e.source_span?.end_seconds ?? 0),
  );
  const audio = run.output.audioTrust as
    | { windows?: unknown[]; agreement?: unknown }
    | undefined;
  const placeEvidence = (panel: ReactNode) =>
    narrow && evidenceSlot ? createPortal(panel, evidenceSlot) : panel;
  return (
    <>
      <PageTitle
        title={run.title || "Video analysis"}
        description="Read the research brief, inspect its evidence, and listen to the original source."
      />
      {(run.output.coverage as { status?: string } | undefined)?.status ===
        "incomplete_or_unknown" && (
        <p className="yi-warning">
          Timed transcript cues cover{" "}
          {(
            ((run.output.coverage as { ratio?: number }).ratio ?? 0) * 100
          ).toFixed(1)}
          % of the video duration. Short gaps may be pauses; speech completeness
          has not been independently verified. Inspect the transcript and source
          before relying on omitted details.
        </p>
      )}
      <ResearchBrief
        key={id}
        sourceRunId={briefs[0]?.sourceRunId ?? id}
        briefs={briefs}
        source={run.output.source as SourceData | undefined}
        onSeek={(seconds) => {
          setSeconds(seconds);
          setResearchSeek(true);
          setListened(false);
          setReviewNote("");
        }}
        completed={run.status === "completed"}
      />
      <div className="yi-trust-strip">
        <span className="yi-chip">{run.status === "completed" ? "Source processing complete" : processingState(run.status)}</span>
        {["L0", "L1", "L2", "L3"].map((level) => {
          const count = claims.filter((c) => c.trustLevel === level).length;
          return (
            <span key={level} className={count ? undefined : "yi-trust-zero"}>
              <TrustBadge level={level} /> {count}
            </span>
          );
        })}
        <span className="yi-muted">
          Source:{" "}
          {String(
            (run.output.source as { source_kind?: string } | undefined)
              ?.source_kind ?? "See evidence details",
          )}
        </span>
      </div>
      {run.error && (
        <p className="yi-warning" role="alert">
          This analysis needs attention. {run.error}
        </p>
      )}
      {claims.length ? (
        <div className="yi-analysis-grid">
          <section className="yi-claim-stack">
            {claims.map((c) => {
              const pressed = current?.id === c.id;
              const select = () => {
                setSelected(c.id);
                setResearchSeek(false);
                setListened(false);
                setReviewNote("");
                const matched = checked.find(
                  (x) => x.id === localClaimId(c.id, id),
                );
                setSeconds(
                  matched?.claim.evidence[0]?.source_span?.start_seconds ?? 0,
                );
              };
              return (
                <Fragment key={c.id}>
                  <div
                    id={c.id}
                    className="yi-claim-select"
                    role="button"
                    tabIndex={0}
                    aria-pressed={pressed}
                    aria-label={`Show evidence for ${c.ticker || c.instrument || "this call"}: ${c.thesisEn}`}
                    onClick={(e) => {
                      // Save and other controls inside the card act on their own.
                      const control = (e.target as HTMLElement).closest(
                        "button, input, select, textarea, summary, [role=button]",
                      );
                      if (control && control !== e.currentTarget) return;
                      select();
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select();
                      }
                    }}
                  >
                    <ClaimCard claim={c} selected={pressed} />
                  </div>
                  {narrow && pressed && (
                    <div className="yi-evidence-slot" ref={setEvidenceSlot} />
                  )}
                </Fragment>
              );
            })}
          </section>
          {placeEvidence(
          <aside
            className="yi-evidence yi-panel"
            ref={evidenceRef}
            style={narrow ? undefined : { top: evidenceTop }}
          >
            <h2>Evidence · {current?.ticker || current?.instrument}</h2>
            <div id="source-player">
              {researchSeek && (
                <p className="yi-warning">
                  Playing the research-brief reference at{" "}
                  {Math.floor(seconds / 60)}:
                  {String(Math.floor(seconds % 60)).padStart(2, "0")}. The call
                  details below refer to the selected creator call.
                </p>
              )}
              <SourcePlayer videoId={run.videoId} seconds={seconds} />
            </div>
            {evidence.length ? (
              evidence.map((e, i) => (
                <div className="yi-evidence-pair" key={i}>
                  <button
                    className="yi-text-button"
                    onClick={() =>
                      setSeconds(e.source_span?.start_seconds ?? 0)
                    }
                  >
                    ▶ Listen from{" "}
                    {e.source_span?.start_seconds == null
                      ? "video start (timestamp unavailable)"
                      : `${Math.floor(e.source_span.start_seconds / 60)}:${String(Math.floor(e.source_span.start_seconds % 60)).padStart(2, "0")}`}
                  </button>
                  <h3>What the creator said</h3>
                  <blockquote>{e.quote_original}</blockquote>
                  <h3>English translation</h3>
                  <p>{e.quote_translation_en || (
                    /^(?:asr-)?(?:en(?:[-_].*)?|eng|english)$/i.test(String((run.output.source as SourceData | undefined)?.language ?? "")) && !/\p{Script=Han}/u.test(e.quote_original)
                      ? "Original evidence is already in English."
                      : "Translation unavailable"
                  )}</p>
                  <p className="yi-muted">
                    Span agreement:{" "}
                    {agreements[i]
                      ? `${Math.round(agreements[i].agreementScore * 100)}%${agreements[i].agreed ? " · agreed" : " · needs review"}`
                      : "Not measured"}
                  </p>
                  {agreements[i]?.referenceText &&
                    agreements[i].referenceText !== e.quote_original && (
                      <>
                        <h3>What we heard</h3>
                        <blockquote>{agreements[i].referenceText}</blockquote>
                      </>
                    )}
                </div>
              ))
            ) : (
              <p className="yi-warning">
                Copied source evidence is unavailable for this call.
              </p>
            )}
            {current && (
              <>
                <h3>Evidence basis</h3>
                <p>
                  Trust:{" "}
                  <TrustBadge
                    level={current.trustLevel}
                    basis={current.trustBasis}
                  />
                </p>
                <Collapsible title="How this trust level was assigned">
                  <pre>{JSON.stringify(current.trustBasis, null, 2)}</pre>
                </Collapsible>
              </>
            )}
            {original?.claim.levels.length ? (
              <>
                <h3>Levels mentioned</h3>
                <LevelChips levels={original.claim.levels} />
              </>
            ) : null}
            {current?.risksEn.length ? (
              <>
                <h3>Risks mentioned</h3>
                <ul>
                  {current.risksEn.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <Collapsible title="Review this evidence">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (current)
                    void perform(
                      () =>
                        action("trust", "signClaimReview", {
                          claimId: current.id,
                          verdict: "verified",
                          note: reviewNote,
                          listenedSpan: { startSeconds, endSeconds },
                        }),
                      "Your signed review was recorded.",
                    ).then((ok) => {
                      if (ok) {
                        setListened(false);
                        setReviewNote("");
                      }
                    });
                }}
              >
                <p>
                  A verified badge requires your signed review of all cited
                  audio.
                </p>
                <label className="yi-checkbox">
                  <input
                    type="checkbox"
                    checked={listened}
                    onChange={(e) => setListened(e.target.checked)}
                  />
                  I listened to every cited span and verified this call.
                </label>
                <label>
                  Review note
                  <textarea
                    required
                    maxLength={4000}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    !listened ||
                    !timed ||
                    !reviewNote.trim() ||
                    !reviewerConfigured
                  }
                >
                  Sign as verified
                </button>
                {!reviewerConfigured && (
                  <p className="yi-warning">
                    A signed-in reviewer identity must be configured before
                    signing.
                  </p>
                )}
                {!timed && (
                  <p className="yi-warning">
                    Every cited span needs a timestamp before it can be signed.
                  </p>
                )}
              </form>
            </Collapsible>
          </aside>,
          )}
        </div>
      ) : (
        <Empty
          title={
            run.status === "completed"
              ? "No accepted calls in this video"
              : "Analysis is still being prepared"
          }
        >
          {run.status === "completed"
            ? "An analysis can finish without finding an actionable call. Any accepted background analysis appears in Research context below. Processing details retain rejected extractions."
            : "Progress refreshes automatically. You can leave this page and return later."}
        </Empty>
      )}
      {context.length > 0 && (
        <section className="yi-panel" aria-label="Research context">
          <h2>Research context · {context.length} points</h2>
          <p className="yi-muted">
            Background, risks and scenarios from the video, with supporting
            evidence.
          </p>
          {context.map((point) => (
            <Collapsible key={point.id} title={point.claim.thesis_en}>
              {point.claim.horizon_en && (
                <p>
                  <strong>Timeframe:</strong> {point.claim.horizon_en}
                </p>
              )}
              {point.claim.conditions_en.length > 0 && (
                <p>
                  <strong>Conditions:</strong>{" "}
                  {point.claim.conditions_en.join(" · ")}
                </p>
              )}
              {point.claim.risks_en.length > 0 && (
                <p>
                  <strong>Risks:</strong> {point.claim.risks_en.join(" · ")}
                </p>
              )}
              {point.claim.levels.length > 0 && (
                <dl className="yi-levels">
                  {point.claim.levels.map((level, index) => (
                    <div key={index}>
                      <dt>{level.kind}</dt>
                      <dd>{level.value_original}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {point.claim.evidence.map((e, index) => {
                const start = e.source_span?.start_seconds;
                return (
                  <div key={`${point.id}-${index}`}>
                    <p>
                      <strong>Original evidence</strong>
                    </p>
                    <blockquote>{e.quote_original}</blockquote>
                    {e.quote_translation_en &&
                      e.quote_translation_en !== e.quote_original && (
                        <p>
                          <strong>English translation:</strong>{" "}
                          {e.quote_translation_en}
                        </p>
                      )}
                    {start != null && (
                      <a
                        href={`https://www.youtube.com/watch?v=${encodeURIComponent(run.videoId)}&t=${Math.floor(start)}s`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source at {Math.floor(start / 60)}:
                        {String(Math.floor(start % 60)).padStart(2, "0")}
                      </a>
                    )}
                  </div>
                );
              })}
            </Collapsible>
          ))}
        </section>
      )}
      <Timing timeline={run.output.timeline as RunTimelineData | undefined} />
      <Collapsible title="Processing details">
        <dl>
          <dt>Run</dt>
          <dd>{run.id}</dd>
          <dt>Frozen analysis pipeline</dt>
          <dd>{researchPipelineLabelFromInput(run.input)}</dd>
          <dt>Stage</dt>
          <dd>{run.stage}</dd>
          <dt>Measured or reserved cost</dt>
          <dd>{money(run.cost)}</dd>
          <dt>Model</dt>
          <dd>{run.model}</dd>
        </dl>
        <pre>
          {JSON.stringify(
            {
              stageTimings: run.output.stageTimings,
              coverage: run.output.coverage,
              audioTrust: audio,
              transcriptionCompleteness: run.output.transcriptionCompleteness,
              rejectedEvidence: run.output.rejectedEvidence,
              tickerProposals: run.output.tickerProposals,
              rejected: checked.filter((c) => !c.passed),
            },
            null,
            2,
          )}
        </pre>
        <button
          disabled={
            busy ||
            !(
              run.status === "completed" ||
              (["needs_review", "failed"].includes(run.status) &&
                ["metadata", "source", "asr-source"].includes(run.stage))
            )
          }
          onClick={() =>
            void perform(
              () => action("trust", "requestAudioTrust", { runId: id }),
              "Audio review queued.",
            )
          }
        >
          {run.status !== "completed"
            ? "Transcribe audio & resume"
            : "Request audio review"}
        </button>
      </Collapsible>
    </>
  );
}
