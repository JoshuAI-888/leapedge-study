"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useMediaQuery, useStickyTop } from "../layout-hooks.ts";
import { researchPipelineLabelFromInput } from "../../research-pipeline-choice.ts";
import { ResearchBrief } from "../ResearchBrief.tsx";
import { Timing } from "../Timing.tsx";
import { CallUsageTable } from "../CallUsageTable.tsx";
import type { LedgerRow } from "../../call-usage.ts";
import { AnalystViewPanel } from "../AnalystView.tsx";
import type { AnalystViewData } from "../../analyst-view.ts";
import type { RunTimelineData } from "../../timing.ts";
import type { ResearchBriefData } from "../../research-brief.ts";
import type { SourceData } from "../../contracts.ts";
import { request, action, analyseRun } from "../api.ts";
import type { EvidenceSpanRow } from "../../../../server/youtube-intelligence/repos/evidence-spans.ts";
import type { ClaimRow } from "../../../../server/youtube-intelligence/repos/claims.ts";
import type { Run, CheckedClaim } from "../../contracts.ts";
import { Agreement } from "../../agreement.ts";
import { SourcePlayer } from "../../SourcePlayer.tsx";
import { useWorkspace } from "../workspace.tsx";
import { useUrlState } from "../url-state.ts";
import { TradingDay } from "../TradingDay.tsx";
import { KeyPoints, VerdictBox } from "../Verdict.tsx";
import { FollowPrompt } from "../FollowPrompt.tsx";
import { FailureBanner, StepProgress } from "../StepProgress.tsx";
import type { Typical } from "../../progress-steps.ts";
import {
  briefCostEstimate,
  clock,
  keyPointItems,
  keyPointsOf,
  sourceKindText,
  sourceLanguageLabel,
  summaryOf,
} from "../../verdict.ts";
import {
  ClaimCard,
  Collapsible,
  Empty,
  LevelChips,
  TrustBadge,
} from "../components.tsx";
import {
  dateLabel,
  money,
  processingState,
  visibleClaims,
  localClaimId,
} from "../viewmodel.ts";
import { useMarkSeen } from "../unread.ts";
const TABS = [
  { id: "calls", label: "Calls" },
  { id: "brief", label: "Research brief" },
  { id: "processing", label: "Processing details" },
] as const;
const TabState = z.object({
  tab: z.enum(["calls", "brief", "processing"]),
});
type Metadata = {
  channel?: string;
  channelId?: string;
  publishedAt?: string;
  language?: string;
};
export function Analysis({ id }: { id: string }) {
  const { data, perform, busy } = useWorkspace();
  useMarkSeen(id); // F70: opening an analysis marks it seen on this browser.
  const router = useRouter();
  const [view, setView] = useUrlState(TabState, { tab: "calls" });
  const [briefs, setBriefs] = useState<ResearchBriefData[]>([]);
  // Why the player is not at the selected call's evidence: a research-brief
  // reference or a key point was played instead.
  const [seekNote, setSeekNote] = useState("");
  const [run, setRun] = useState<Run | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [seconds, setSeconds] = useState(0),
    [reviewNote, setReviewNote] = useState(""),
    [listened, setListened] = useState(false),
    [spans, setSpans] = useState<EvidenceSpanRow[]>([]),
    [storedClaims, setStoredClaims] = useState<ClaimRow[]>([]),
    [analyst, setAnalyst] = useState<{ view: AnalystViewData; note: string } | null>(null),
    [reviewerConfigured, setReviewerConfigured] = useState(false),
    [reuse, setReuse] = useState<{ count: number; last_at: string | null }>({
      count: 0,
      last_at: null,
    }),
    [confirmRerun, setConfirmRerun] = useState(false),
    [calls, setCalls] = useState<LedgerRow[]>([]),
    [progress, setProgress] = useState<{
      typical: Typical;
      stepCostUsd: Record<string, number>;
    } | null>(null),
    [thumbFailed, setThumbFailed] = useState(false),
    [scrollRequest, setScrollRequest] = useState(0);
  // A key point or brief reference was played: bring the player into view
  // once the Calls tab (which holds it) has rendered.
  useEffect(() => {
    if (!scrollRequest || view.tab !== "calls") return;
    document
      .getElementById("source-player")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollRequest(0);
  }, [scrollRequest, view.tab]);
  // Below 900 px the evidence panel is portalled into a slot directly under
  // the selected card; above, it is a sticky column whose top keeps a tall
  // panel fully reachable without an internal scroll box.
  const narrow = useMediaQuery("(max-width: 899.98px)");
  const [evidenceSlot, setEvidenceSlot] = useState<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement>(null);
  const evidenceTop = useStickyTop(
    evidenceRef,
    76,
    !narrow && !!run && !!data && storedClaims.length > 0 && view.tab === "calls",
  );
  // The activity poll updates the loaded summary's stage and status; refetch
  // the detail when either moves so a running analysis stays current.
  const live = data?.runs.find((r) => r.id === id);
  useEffect(() => {
    const controller = new AbortController();
    request<{
      run: Run;
      researchBriefs: ResearchBriefData[];
      evidenceSpans: EvidenceSpanRow[];
      claims: ClaimRow[];
      reviewerConfigured: boolean;
      reuse?: { count: number; last_at: string | null };
      progress?: { typical: Typical; stepCostUsd: Record<string, number> } | null;
      calls?: LedgerRow[];
      analystView?: AnalystViewData | null;
      analystNote?: string | null;
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
        setAnalyst(x.analystView && x.analystNote ? { view: x.analystView, note: x.analystNote } : null);
        setReviewerConfigured(x.reviewerConfigured);
        setReuse(x.reuse ?? { count: 0, last_at: null });
        setProgress(x.progress ?? null);
        setCalls(x.calls ?? []);
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
          setSeekNote("");
          setConfirmRerun(false);
        }
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [
    id,
    data?.snapshot.runs,
    data?.snapshot.researchBriefs,
    live?.stage,
    live?.status,
  ]);
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
  // Live status from the activity poll when it is newer than the detail.
  const status = live && live.updatedAt >= run.updatedAt ? live.status : run.status;
  const working = status === "queued" || status === "running";
  // F72: a failed or held analysis shows the failure banner in place of the verdict.
  const stopped =
    (status === "failed" || status === "needs_review") && !run.input.task;
  const liveRun = {
    ...run,
    status,
    stage: live && live.updatedAt >= run.updatedAt ? live.stage : run.stage,
  };
  const durationSeconds =
    Number((run.output.metadata as { duration?: unknown } | undefined)?.duration) ||
    null;
  const metadata = (run.output.metadata ?? {}) as Metadata;
  const source = run.output.source as SourceData | undefined;
  const channelId = metadata.channelId;
  const channelTitle =
    data.snapshot.channels.find((c) => c.id === channelId)?.title ||
    metadata.channel;
  const language = sourceLanguageLabel(source?.language ?? metadata.language);
  const summary = summaryOf({ briefs, extractionSummary: run.output.summary });
  const pointItems = keyPointItems({
    runId: id,
    keyPoints: run.output.keyPoints,
    checkedClaims: run.output.claims,
    acceptedClaimIds: storedClaims.map((c) => c.id),
    spans,
  });
  const points = keyPointsOf(pointItems);
  const briefEstimate = briefCostEstimate(data.snapshot.researchBriefs);
  const rerunEstimate = data.cost.projection.measuredCostPerVideoUsd;
  const remaining = data.cost.budget.remainingUsd;
  // A stopped run offers Retry from its step instead (F72).
  const canRerun = !working && !stopped && !run.input.task;
  const seekTo = (to: number, note: string) => {
    setSeconds(to);
    setSeekNote(note);
    setListened(false);
    setReviewNote("");
    if (view.tab !== "calls") setView({ tab: "calls" });
    setScrollRequest((n) => n + 1);
  };
  const player = (
    <div id="source-player">
      {seekNote && (
        <p className="yi-warning">
          {seekNote} The call details below refer to the selected creator call.
        </p>
      )}
      <SourcePlayer videoId={run.videoId} seconds={seconds} />
    </div>
  );
  const rerun = () =>
    void perform(
      async () => {
        const result = await analyseRun({
          url: run.url || `https://www.youtube.com/watch?v=${run.videoId}`,
          force: true,
        });
        setConfirmRerun(false);
        router.push(
          `/youtube-intelligence/analysis/${encodeURIComponent(result.runId)}`,
        );
        return result;
      },
      "Re-run queued with the current pipeline. The earlier analysis stays available.",
    );
  return (
    <>
      <header className="yi-an-header">
        {thumbFailed ? (
          <span className="yi-an-thumb yi-an-thumb-empty" aria-hidden="true">
            ▶
          </span>
        ) : (
          <img
            className="yi-an-thumb"
            src={`https://i.ytimg.com/vi/${encodeURIComponent(run.videoId)}/mqdefault.jpg`}
            alt=""
            width={160}
            height={90}
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        )}
        <div className="yi-an-head-text">
          <p className="yi-eyebrow">VIDEO ANALYSIS</p>
          <h1>{run.title || "Video analysis"}</h1>
          <p className="yi-an-meta">
            {channelId ? (
              <Link
                href={`/youtube-intelligence/channels/${encodeURIComponent(channelId)}`}
              >
                {channelTitle || "Channel"}
              </Link>
            ) : (
              <span>{channelTitle || "Channel unknown"}</span>
            )}
            <span aria-hidden="true"> · </span>
            <TradingDay at={metadata.publishedAt ?? null} />
            {language && (
              <>
                <span aria-hidden="true"> · </span>
                <span>{language}</span>
              </>
            )}
          </p>
          <div className="yi-an-chips">
            {reuse.count > 0 && (
              <span
                className="yi-chip"
                title={`A later submission of this video opened this analysis instead of starting a paid run${reuse.last_at ? ` (last on ${dateLabel(reuse.last_at)})` : ""}.`}
              >
                Reused · analysed {dateLabel(run.updatedAt)}
              </span>
            )}
            {Boolean(run.input.rerun) && (
              <span className="yi-chip">Re-run of an earlier analysis</span>
            )}
            {canRerun && !confirmRerun && (
              <button
                type="button"
                className="yi-secondary yi-an-rerun"
                disabled={busy}
                onClick={() => setConfirmRerun(true)}
              >
                Re-run with current pipeline
              </button>
            )}
          </div>
        </div>
      </header>
      {confirmRerun && (
        <section
          className="yi-panel yi-an-confirm"
          role="group"
          aria-label="Confirm re-run"
        >
          <p>
            <strong>Re-run this video with the current pipeline?</strong> This
            starts a new paid analysis. The earlier one stays available.
          </p>
          <p className="yi-muted">
            Estimated cost:{" "}
            {rerunEstimate === null
              ? "not yet measured"
              : `about ${money(rerunEstimate)} (average measured cost per video)`}
            {" · "}Budget left this month: {money(remaining)}
          </p>
          <div className="yi-row">
            <button type="button" disabled={busy} onClick={rerun}>
              Re-run now
            </button>
            <button
              type="button"
              className="yi-secondary"
              onClick={() => setConfirmRerun(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {working ? (
        <StepProgress
          run={liveRun}
          typical={progress?.typical ?? null}
          durationSeconds={durationSeconds}
        />
      ) : stopped ? (
        <FailureBanner run={liveRun} stepCostUsd={progress?.stepCostUsd ?? null} />
      ) : (
        <VerdictBox claims={claims} />
      )}
      {channelId && (
        <FollowPrompt channelId={channelId} channelTitle={channelTitle} />
      )}
      {analyst ? (
        // The analyst view (built on main) is the page a PM reads: when a run
        // has one it replaces the derived summary and key points, so the same
        // points never appear twice.
        <AnalystViewPanel
          view={analyst.view}
          note={analyst.note}
          onSeek={(to) => seekTo(to, `Playing the analyst view reference at ${clock(to)}.`)}
        />
      ) : (
        <>
        {summary ? (
          <p className="yi-an-summary">{summary.text}</p>
        ) : (
          !working &&
          !stopped && (
            <p className="yi-muted yi-an-summary-empty">
              Summary appears after the research brief is generated.
            </p>
          )
        )}
        <KeyPoints
          points={points}
          total={pointItems.length}
          onSeek={(to) => seekTo(to, `Playing the key point at ${clock(to)}.`)}
        />
        </>
      )}
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
      {run.error && !stopped && (
        <p className="yi-warning" role="alert">
          This analysis needs attention. {run.error}
        </p>
      )}
      <div className="yi-an-tabs" role="tablist" aria-label="Analysis sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`yi-an-tab-${t.id}`}
            aria-selected={view.tab === t.id}
            aria-controls={`yi-an-panel-${t.id}`}
            tabIndex={view.tab === t.id ? 0 : -1}
            className="yi-an-tab"
            onClick={() => setView({ tab: t.id })}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next =
                TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
              setView({ tab: next.id });
              document.getElementById(`yi-an-tab-${next.id}`)?.focus();
            }}
          >
            {t.label}
            {t.id === "calls" ? ` (${claims.length})` : ""}
          </button>
        ))}
      </div>
      {view.tab === "calls" && (
        <div
          role="tabpanel"
          id="yi-an-panel-calls"
          aria-labelledby="yi-an-tab-calls"
          className="yi-an-panel"
        >
          <div className="yi-trust-strip">
            <span className="yi-chip">
              {status === "completed"
                ? "Source processing complete"
                : processingState(status)}
            </span>
            {["L0", "L1", "L2", "L3"].map((level) => {
              const count = claims.filter((c) => c.trustLevel === level).length;
              return (
                <span key={level} className={count ? undefined : "yi-trust-zero"}>
                  <TrustBadge level={level} /> {count}
                </span>
              );
            })}
            <span className="yi-muted">
              Source: {sourceKindText(source?.source_kind)}
            </span>
          </div>
          {claims.length ? (
            <div className="yi-analysis-grid">
              <section className="yi-claim-stack">
                {claims.map((c) => {
                  const pressed = current?.id === c.id;
                  const select = () => {
                    setSelected(c.id);
                    setSeekNote("");
                    setListened(false);
                    setReviewNote("");
                    const matched = checked.find(
                      (x) => x.id === localClaimId(c.id, id),
                    );
                    setSeconds(
                      matched?.claim.evidence[0]?.source_span?.start_seconds ??
                        0,
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
                        <div
                          className="yi-evidence-slot"
                          ref={setEvidenceSlot}
                        />
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
                  {player}
                  {evidence.length ? (
                    evidence.map((e, i) => (
                      <div className="yi-evidence-pair" key={i}>
                        <button
                          className="yi-text-button"
                          onClick={() => {
                            setSeekNote("");
                            setSeconds(e.source_span?.start_seconds ?? 0);
                          }}
                        >
                          ▶ Listen from{" "}
                          {e.source_span?.start_seconds == null
                            ? "video start (timestamp unavailable)"
                            : clock(e.source_span.start_seconds)}
                        </button>
                        <h3>What the creator said</h3>
                        <blockquote>{e.quote_original}</blockquote>
                        <h3>English translation</h3>
                        <p>
                          {e.quote_translation_en ||
                            (/^(?:asr-)?(?:en(?:[-_].*)?|eng|english)$/i.test(
                              String(source?.language ?? ""),
                            ) && !/\p{Script=Han}/u.test(e.quote_original)
                              ? "Original evidence is already in English."
                              : "Translation unavailable")}
                        </p>
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
                        A verified badge requires your signed review of all
                        cited audio.
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
                          A signed-in reviewer identity must be configured
                          before signing.
                        </p>
                      )}
                      {!timed && (
                        <p className="yi-warning">
                          Every cited span needs a timestamp before it can be
                          signed.
                        </p>
                      )}
                    </form>
                  </Collapsible>
                </aside>,
              )}
            </div>
          ) : (
            <div className="yi-analysis-grid">
              <Empty
                title={
                  working
                    ? "Analysis is still being prepared"
                    : stopped
                      ? "No calls yet: the analysis stopped"
                      : "No accepted calls in this video"
                }
              >
                {working
                  ? "Progress refreshes automatically. You can leave this page and return later."
                  : stopped
                    ? "Calls appear here once the analysis finishes. Use Retry above to resume from the step where it stopped."
                    : `An analysis can finish without finding an actionable call.${
                        points.length ? " The key points above come from the video." : ""
                      }${
                        context.length ? " Research context below adds background from it." : ""
                      } Processing details keep any rejected extractions.`}
              </Empty>
              <aside className="yi-evidence yi-panel">
                <h2>Source</h2>
                {player}
              </aside>
            </div>
          )}
          {context.length > 0 && (
            <section className="yi-panel" aria-label="Research context">
              <h2>
                Research context · {context.length}{" "}
                {context.length === 1 ? "point" : "points"}
              </h2>
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
                          <button
                            type="button"
                            className="yi-text-button"
                            onClick={() =>
                              seekTo(start, `Playing research context at ${clock(start)}.`)
                            }
                          >
                            ▶ Play from {clock(start)}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </Collapsible>
              ))}
            </section>
          )}
        </div>
      )}
      {view.tab === "brief" && (
        <div
          role="tabpanel"
          id="yi-an-panel-brief"
          aria-labelledby="yi-an-tab-brief"
          className="yi-an-panel yi-an-brief-tab"
        >
          <p className="yi-muted">
            A research brief is optional: a whole-video synthesis with an
            independent evidence critique.{" "}
            {briefEstimate
              ? `Generating one has cost about ${money(briefEstimate.averageUsd)} on average (${briefEstimate.samples} earlier ${briefEstimate.samples === 1 ? "brief" : "briefs"}).`
              : "No cost estimate yet: no earlier brief recorded its cost."}{" "}
            Budget left this month: {money(remaining)}.
          </p>
          <ResearchBrief
            key={id}
            sourceRunId={briefs[0]?.sourceRunId ?? id}
            briefs={briefs}
            source={source}
            onSeek={(to) =>
              seekTo(to, `Playing the research-brief reference at ${clock(to)}.`)
            }
            completed={status === "completed"}
          />
        </div>
      )}
      {view.tab === "processing" && (
        <div
          role="tabpanel"
          id="yi-an-panel-processing"
          aria-labelledby="yi-an-tab-processing"
          className="yi-an-panel"
        >
          <section className="yi-panel">
            <h2>Processing details</h2>
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
            <CallUsageTable
              calls={calls}
              timeline={run.output.timeline as RunTimelineData | undefined}
              finished={!working}
            />
            <Collapsible title="Timing by pipeline stage">
              <Timing
                timeline={run.output.timeline as RunTimelineData | undefined}
              />
            </Collapsible>
            <Collapsible title="Show raw data">
              <pre>
                {JSON.stringify(
                  {
                    stageTimings: run.output.stageTimings,
                    coverage: run.output.coverage,
                    audioTrust: audio,
                    transcriptionCompleteness:
                      run.output.transcriptionCompleteness,
                    rejectedEvidence: run.output.rejectedEvidence,
                    tickerProposals: run.output.tickerProposals,
                    rejected: checked.filter((c) => !c.passed),
                  },
                  null,
                  2,
                )}
              </pre>
            </Collapsible>
            <button
              className="yi-secondary"
              disabled={
                busy ||
                !(
                  status === "completed" ||
                  (["needs_review", "failed"].includes(status) &&
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
              {status !== "completed"
                ? "Transcribe audio & resume"
                : "Request audio review"}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
