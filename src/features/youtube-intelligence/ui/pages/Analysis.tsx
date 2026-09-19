"use client";
import { useEffect, useState } from "react";
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
  const [run, setRun] = useState<Run | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [seconds, setSeconds] = useState(0),
    [reviewNote, setReviewNote] = useState(""),
    [listened, setListened] = useState(false),
    [spans, setSpans] = useState<EvidenceSpanRow[]>([]),
    [storedClaims, setStoredClaims] = useState<ClaimRow[]>([]),
    [reviewerConfigured, setReviewerConfigured] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request<{
      run: Run;
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
        }
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, data]);
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
        quote_translation_en: s.translationEn ?? "Translation unavailable",
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
  return (
    <>
      <PageTitle
        title={run.title || "Video analysis"}
        description="Inspect the call, then listen to the words behind it."
      />
      <div className="yi-trust-strip">
        <span className="yi-chip">{processingState(run.status)}</span>
        {["L0", "L1", "L2", "L3"].map((level) => (
          <span key={level}>
            <TrustBadge level={level} />{" "}
            {claims.filter((c) => c.trustLevel === level).length}
          </span>
        ))}
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
            {claims.map((c) => (
              <div
                id={c.id}
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setListened(false);
                  setReviewNote("");
                  const matched = checked.find(
                    (x) => x.id === localClaimId(c.id, id),
                  );
                  setSeconds(
                    matched?.claim.evidence[0]?.source_span?.start_seconds ?? 0,
                  );
                }}
              >
                <button
                  className="yi-text-button"
                  aria-pressed={current?.id === c.id}
                  onClick={() => setSelected(c.id)}
                >
                  Select {c.ticker || "call"} evidence
                </button>
                <ClaimCard claim={c} selected={current?.id === c.id} />
              </div>
            ))}
          </section>
          <aside className="yi-evidence yi-panel">
            <h2>Evidence · {current?.ticker || current?.instrument}</h2>
            <SourcePlayer videoId={run.videoId} seconds={seconds} />
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
                  <p>{e.quote_translation_en}</p>
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
                <dl className="yi-levels">
                  {original.claim.levels.map((l, i) => (
                    <div key={i}>
                      <dt>{l.kind}</dt>
                      <dd>{l.value_original}</dd>
                    </div>
                  ))}
                </dl>
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
          </aside>
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
                    <blockquote>{e.quote_original}</blockquote>
                    {e.quote_translation_en &&
                      e.quote_translation_en !== e.quote_original && (
                        <p>{e.quote_translation_en}</p>
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
      <Collapsible title="Processing details">
        <dl>
          <dt>Run</dt>
          <dd>{run.id}</dd>
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
