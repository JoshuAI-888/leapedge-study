"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ResearchBriefData, AcceptedSentence } from "../research-brief.ts";
import { prioritiseBriefs } from "../research-brief.ts";
import type { SourceData } from "../contracts.ts";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Unknown";
export function ResearchOverview() {
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
          <h2>Material developments</h2>
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
                        {b.sentences
                          .filter(
                            (s) => s.horizon === h || s.horizon === "both",
                          )
                          .sort((a, b) => b.materiality - a.materiality)[0]
                          ?.factualStatus ?? "unverified"}
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
  const pending = data?.snapshot.jobs.find(
    (r) =>
      r.task === "research-brief" &&
      r.sourceRunId === sourceRunId &&
      ["queued", "running"].includes(r.status),
  );
  const generate = () =>
    void perform(
      () => action("research", "generateResearchBrief", { sourceRunId }),
      "Research brief queued. Original analysis and earlier revisions are retained.",
    );
  if (!brief)
    return (
      <section id="research-brief" className="yi-panel">
        <h2>Investment research brief</h2>
        <p>
          Build a whole-video synthesis from accepted calls and research
          context, with separate tactical and fundamental sections and an
          independent evidence critique.
        </p>
        <button onClick={generate} disabled={busy || !completed || !!pending}>
          {pending ? "Research brief in progress…" : "Generate research brief"}
        </button>
        <p className="yi-muted">
          Model and external-search usage is recorded. Missing verification
          remains explicit.
        </p>
      </section>
    );
  const current = brief.sentences.find((s) => s.id === selected);
  const cues = source?.segments ?? [];
  const sentence = (s: AcceptedSentence) => (
    <article
      key={s.id}
      className={`yi-research-point ${selected === s.id ? "is-selected" : ""}`}
    >
      <span className="yi-eyebrow">
        {s.topic} · {s.kind.replaceAll("_", " ")}
      </span>
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
        <span>{s.fidelity}</span>
        <span>Facts: {s.factualStatus}</span>
        <span>
          Novelty: {s.novelty?.status.replaceAll("_", " ") ?? "unknown"}
        </span>
        <span>
          Thesis:{" "}
          {s.robustness === "insufficient" ? "not established" : s.robustness}
        </span>
      </div>
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
  return (
    <section id="research-brief" className="yi-panel yi-research-brief">
      <div className="yi-section-title">
        <div>
          <span className="yi-eyebrow">Sceptical investment research</span>
          <h2>{brief.mainTopics[0] || "Research brief"}</h2>
        </div>
        <button
          className="yi-text-button"
          disabled={busy || !!pending}
          onClick={generate}
        >
          {pending ? "Brief in progress…" : "Refresh as new revision"}
        </button>
      </div>
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
      <section className="yi-current-update">
        <h3>Current update · separate from the video-date thesis</h3>
        {brief.sentences.some((s) => s.timeMode === "current") ? (
          brief.sentences.filter((s) => s.timeMode === "current").map(sentence)
        ) : (
          <p>
            No eligible, dated external update was established. This does not
            mean nothing has changed.
          </p>
        )}
      </section>
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
          <p>
            <strong>Independent critique:</strong> {current.auditReason}
          </p>
          <p>
            <strong>Thesis robustness:</strong>{" "}
            {current.robustnessReason ?? "Not independently established."}
          </p>
          <p>
            <strong>Novelty:</strong>{" "}
            {current.novelty?.reason ?? "No audited comparable baseline."}
          </p>
          {!!current.financialFacts?.length && (
            <details>
              <summary>Typed financial quantities</summary>
              {current.financialFacts.map((f, i) => (
                <p key={i}>
                  <strong>{f.label}:</strong> {f.value} {f.scale}{" "}
                  {f.currency ?? "currency unstated"} ·{" "}
                  {f.unit.replaceAll("_", " ")} ·{" "}
                  {f.nature.replaceAll("_", " ")} · {f.basis} ·{" "}
                  {f.period ?? "period unstated"}
                  <br />
                  Original: “{f.quote}” ({f.evidenceId})
                </p>
              ))}
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
      <details>
        <summary>Coverage, limitations and cost audit</summary>
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
          {[
            ...brief.omissions,
            ...brief.coverageFindings,
            ...brief.retrievalNotes,
          ].map((x, i) => (
            <li key={i}>{x}</li>
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
