"use client";
import { useEffect, useState, useRef } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  Layers3,
  Link2,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import {
  MODELS,
  type Run,
  type CheckedClaim,
  type SourceData,
} from "./contracts";
type Health = {
  workerOnline: boolean;
  hasYouTubeKey: boolean;
  hasModelKey: boolean;
  budgetUsd: number;
  spentOrReservedUsd: number;
};
import { displayEntity, type EntityData } from "./entities";
import { SourcePlayer } from "./SourcePlayer";
import { researchOutcome, canDropFailedAudit } from "./research-quality";
const label = (s: string) => s.replaceAll("_", " ");
const modelName = (s: string) =>
  s.replace("google/", "").replace("gemini-", "Gemini ").replaceAll("-", " ");
const time = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
async function request(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
export function IntelligenceApp() {
  const [runs, setRuns] = useState<Run[]>([]),
    [health, setHealth] = useState<Health | null>(null),
    [error, setError] = useState(""),
    [url, setUrl] = useState(""),
    [model, setModel] = useState<string>(MODELS[0]),
    [source, setSource] = useState<unknown>(),
    [fileName, setFileName] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("library"),
    [query, setQuery] = useState(""),
    [selected, rawSetSelected] = useState<string | null>(null),
    [run, setRun] = useState<Run | null>(null),
    [compare, setCompare] = useState<string[]>([]),
    [version, setVersion] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  function setSelected(id: string | null) {
    rawSetSelected(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("run", id);
    else u.searchParams.delete("run");
    window.history.replaceState(null, "", u);
  }
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("run");
    if (id) rawSetSelected(id);
    const abort = new AbortController();
    request("/api/intelligence/research?view=preferences", {
      signal: abort.signal,
    })
      .then((d) => {
        setModel(d.preferences.model);
        const theme = d.preferences.theme;
        document.documentElement.dataset.theme =
          theme === "dark" ||
          (theme === "system" &&
            matchMedia("(prefers-color-scheme: dark)").matches)
            ? "dark"
            : "light";
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
      if (e.key === "Tab") {
        const els = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input,select,summary,iframe",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [selected]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [a, b] = await Promise.all([
          request("/api/intelligence/runs", { signal: abort.signal }),
          request("/api/intelligence/status", { signal: abort.signal }),
        ]);
        if (!abort.signal.aborted) {
          setRuns(a.runs);
          setHealth(b);
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load library.");
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 4000);
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [version]);
  useEffect(() => {
    setRun(null);
    if (!selected) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await request(`/api/intelligence/runs/${selected}`, {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) setRun(data.run);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not open report.");
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 4000);
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [selected]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request("/api/intelligence/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, model, source }),
      });
      setSelected(data.run.id);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue analysis.");
    } finally {
      setBusy(false);
    }
  }
  const filtered = runs.filter((r) =>
    (r.title + " " + r.videoId + " " + r.model)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const completed = runs.filter(
    (r) => r.status === "completed" && Number(r.output.acceptedCount || 0) > 0,
  ).length;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Radio size={22} />
          </span>
          finradar<span className="lab-label">LAB</span>
        </a>
        <nav aria-label="Main navigation">
          <details className="nav-menu">
            <summary className="nav-active">
              Intelligence <ChevronDown size={13} />
            </summary>
            <a href="/">YouTube Intelligence</a>
          </details>
          <a className="nav-caption" href="/research">
            Research workspace →
          </a>
        </nav>
        <div className="local-status">
          <span className="dot" />
          Personal workspace
        </div>
      </header>
      <main>
        <div className="breadcrumb">
          INTELLIGENCE <span>/</span> YOUTUBE
        </div>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> FROM COMMENTARY TO CLARITY
            </div>
            <h1>
              YouTube <span>Intelligence.</span>
            </h1>
            <p>
              The thesis. The context. The exact words behind it.
              <br />
              Research in any language, brought together in English.
            </p>
          </div>
          <div className="intro-note">
            <ShieldCheck size={25} />
            <div>
              <strong>Evidence comes first</strong>
              <span>
                Original quotes. Visible source coverage.
                <br />
                Every analysis open to scrutiny.
              </span>
            </div>
          </div>
        </section>
        <section className="composer panel">
          <form onSubmit={submit}>
            <label htmlFor="video-url">Start with a video</label>
            <div className="url-row">
              <Link2 size={20} />
              <input
                id="video-url"
                type="url"
                required
                placeholder="Paste a YouTube video URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                className="primary"
                disabled={
                  busy || !health?.hasYouTubeKey || !health?.hasModelKey
                }
              >
                {busy ? "Queuing…" : "Analyze video"}
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="composer-bottom">
              <span>
                <AudioLines size={15} /> Multilingual input{" "}
                <span className="separator">·</span> English synthesis
              </span>
              <div className="model-control">
                <label htmlFor="model">Synthesis</label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {MODELS.map((m) => (
                    <option value={m} key={m}>
                      {modelName(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <details className="source-options">
              <summary>
                <Upload size={14} /> Supply a timed transcript
              </summary>
              <p>
                Optional JSON source with original text and start/end seconds.
                Without one, the worker tries model transcription and checks
                timestamp coverage.
              </p>
              <input
                aria-label="Timed transcript JSON"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) {
                    setSource(undefined);
                    setFileName("");
                    return;
                  }
                  try {
                    if (f.size > 2000000)
                      throw Error("Choose a transcript smaller than 2 MB.");
                    setSource(JSON.parse(await f.text()));
                    setFileName(f.name);
                    setError("");
                  } catch (err) {
                    setSource(undefined);
                    setFileName("");
                    setError(
                      err instanceof Error ? err.message : "Invalid JSON",
                    );
                  }
                }}
              />
              {fileName ? (
                <span className="file-chip">
                  {fileName}
                  <button
                    type="button"
                    aria-label="Remove transcript"
                    onClick={() => {
                      setSource(undefined);
                      setFileName("");
                    }}
                  >
                    <X size={13} />
                  </button>
                </span>
              ) : null}
            </details>
          </form>
        </section>
        {error ? (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        ) : null}
        {health && !health.workerOnline ? (
          <div className="notice">
            <Clock3 size={17} />
            <span>
              Worker is offline. Submissions will stay queued until the local
              worker starts.
            </span>
          </div>
        ) : null}
        <section className="overview">
          <Stat
            label="RESEARCH LIBRARY"
            value={String(runs.length)}
            detail="saved analysis runs"
            icon={<Layers3 size={18} />}
          />
          <Stat
            label="COMPLETED"
            value={String(completed)}
            detail="ready to review"
            icon={<Check size={18} />}
          />
          <Stat
            label="IN PROGRESS"
            value={String(
              runs.filter((r) => ["queued", "running"].includes(r.status))
                .length,
            )}
            detail="persisted across sessions"
            icon={<Clock3 size={18} />}
          />
          <Stat
            label="EXPERIMENT SPEND"
            value={`$${(health?.spentOrReservedUsd || 0).toFixed(2)}`}
            detail={`USD · $${health?.budgetUsd || 2} local cap, includes reservations`}
            icon={<FlaskConical size={18} />}
          />
        </section>
        <section className="library">
          <div className="section-toolbar">
            <div className="tabs" role="tablist" aria-label="Research views">
              <button
                role="tab"
                aria-selected={tab === "library"}
                className={tab === "library" ? "active" : ""}
                onClick={() => setTab("library")}
              >
                <FileText size={16} />
                Library <span>{runs.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "compare"}
                className={tab === "compare" ? "active" : ""}
                onClick={() => setTab("compare")}
              >
                <FlaskConical size={16} />
                Compare runs
                {compare.length > 0 ? <span>{compare.length}</span> : null}
              </button>
            </div>
            {tab === "library" ? (
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search research"
                  placeholder="Search videos or models"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            ) : null}
          </div>
          {tab === "library" ? (
            <div className="panel library-body">
              {filtered.length ? (
                filtered.map((r) => (
                  <article className="run-row" key={r.id}>
                    <input
                      type="checkbox"
                      aria-label={`Compare ${r.title}`}
                      checked={compare.includes(r.id)}
                      onChange={(e) =>
                        setCompare((prev) =>
                          e.target.checked
                            ? [...prev.slice(-1), r.id]
                            : prev.filter((id) => id !== r.id),
                        )
                      }
                    />
                    <div className="video-icon">
                      <Play size={18} />
                    </div>
                    <button
                      className="run-link"
                      onClick={() => setSelected(r.id)}
                    >
                      <strong>{r.title}</strong>
                      <span>
                        {modelName(r.model)} <b>·</b>{" "}
                        {new Date(r.createdAt).toLocaleDateString("en-NZ", {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        <b>·</b> {r.promptVersion}
                      </span>
                    </button>
                    <span className={`badge ${r.status}`}>
                      {researchOutcome(r)}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Open ${r.title}`}
                      onClick={() => setSelected(r.id)}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty">
                  <div className="empty-symbol">
                    <Play size={26} />
                  </div>
                  <h2>
                    {query
                      ? "No matching research"
                      : "Your next insight starts here"}
                  </h2>
                  <p>
                    {query
                      ? "Try another video title or model."
                      : "Add a video above to build your research library. Every report keeps the source, the synthesis and its checks together."}
                  </p>
                  <div className="empty-steps">
                    <span>
                      <b>01</b> Add a video
                    </span>
                    <ArrowRight size={14} />
                    <span>
                      <b>02</b> Check the evidence
                    </span>
                    <ArrowRight size={14} />
                    <span>
                      <b>03</b> Compare the results
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Compare
              runs={runs.filter((r) => compare.includes(r.id))}
              open={setSelected}
            />
          )}
        </section>
        <footer>
          <span>
            <ShieldCheck size={14} /> Source-backed research, with limitations
            made visible.
          </span>
          <span>
            YouTube Intelligence <b>·</b> Experimental workspace
          </span>
        </footer>
      </main>
      {selected ? (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <section
            ref={dialogRef}
            className="report-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Analysis report"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="drawer-close"
              autoFocus
              onClick={() => setSelected(null)}
              aria-label="Close report"
            >
              <X size={22} />
            </button>
            {run ? (
              <Report key={run.id} run={run} />
            ) : (
              <p>Loading saved report…</p>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
function Compare({ runs, open }: { runs: Run[]; open: (id: string) => void }) {
  if (runs.length < 2)
    return (
      <div className="panel empty">
        <FlaskConical size={30} />
        <h2>Compare the process, not just the answer.</h2>
        <p>
          Select two runs in the library to compare models, prompt versions,
          cost and accepted claims. For a controlled test, use the same video
          and transcript.
        </p>
      </div>
    );
  const same =
    runs[0].videoId === runs[1].videoId &&
    runs[0].output.sourceHash === runs[1].output.sourceHash;
  return (
    <div className="panel compare-panel">
      <div className="notice">
        {same
          ? "Same video and source hash. Check model and prompt settings before drawing conclusions."
          : "Different videos or source versions: this is not a controlled A/B comparison."}
      </div>
      <div className="compare-grid">
        {runs.map((r) => (
          <div key={r.id}>
            <span className="eyebrow">{modelName(r.model)}</span>
            <h2>{r.title}</h2>
            <dl>
              <dt>Prompt</dt>
              <dd>{r.promptVersion}</dd>
              <dt>Status</dt>
              <dd>{label(r.status)}</dd>
              <dt>Accepted claims</dt>
              <dd>{String(r.output.acceptedCount ?? "Pending")}</dd>
              <dt>Rejected claims</dt>
              <dd>{String(r.output.rejectedCount ?? "Pending")}</dd>
              <dt>Cost / reservation</dt>
              <dd>US${r.cost.toFixed(4)}</dd>
            </dl>
            <button className="secondary" onClick={() => open(r.id)}>
              Inspect evidence <ArrowUpRight size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
function Report({ run }: { run: Run }) {
  const [showRejected, setShowRejected] = useState(false);
  const claims = (run.output.claims || []) as CheckedClaim[];
  const source = run.output.source as SourceData | undefined;
  const metadata = run.output.metadata as
    { channel?: string; duration?: number } | undefined;
  const c = run.output.coverage as
    { ratio: number; status: string } | undefined;
  const accepted = claims.filter((c) => c.passed);
  const [seek, setSeek] = useState<number | null>(null);
  return (
    <>
      <div className="eyebrow">
        VIDEO RESEARCH{" "}
        <span className={`badge ${run.status}`}>{researchOutcome(run)}</span>
      </div>
      <h2 className="report-title">{run.title}</h2>
      <p className="muted">
        {metadata?.channel || run.videoId} ·{" "}
        {metadata?.duration ? time(metadata.duration) : "Duration pending"} ·{" "}
        {source?.language || "Language pending"}
      </p>
      <div className="report-actions">
        <a
          href={run.url}
          target="_blank"
          rel="noreferrer"
          className="secondary"
        >
          Watch source <ArrowUpRight size={15} />
        </a>
        <button
          className="secondary"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(run, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `youtube-intelligence-${run.id}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={15} />
          Export JSON
        </button>
      </div>
      <SourcePlayer videoId={run.videoId} seconds={seek || 0} />
      <p role="status">
        <strong>{researchOutcome(run)}</strong>
      </p>
      <div className="progress-strip">
        {["metadata", "source", "synthesis", "critique", "complete"].map(
          (s, i) => (
            <span key={s} className={run.stage === s ? "current" : ""}>
              <b>{i + 1}</b>
              {s === "source"
                ? "Transcript"
                : s === "complete"
                  ? "Report"
                  : label(s)}
            </span>
          ),
        )}
      </div>
      {run.error ? <div className="notice error">{run.error}</div> : null}
      {c ? (
        <div className="coverage-box">
          <ShieldCheck size={19} />
          <div>
            <strong>{Math.round(c.ratio * 100)}% timestamp coverage</strong>
            <p>
              This measures declared segment timing, not transcription
              completeness or accuracy. Original audio has not been
              independently verified.
            </p>
          </div>
        </div>
      ) : null}
      {canDropFailedAudit(run) ? (
        <button
          className="secondary"
          onClick={async () => {
            try {
              await request("/api/intelligence/research", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "recoverAudit", data: run.id }),
              });
              window.location.reload();
            } catch (e) {
              window.alert(e instanceof Error ? e.message : "Recovery failed");
            }
          }}
        >
          Drop unverified point and continue audit
        </button>
      ) : null}
      {run.status === "completed" ? (
        <>
          {Array.isArray(run.output.keyPoints) &&
          run.output.keyPoints.length > 0 ? (
            <section>
              <h3>Key points</h3>
              <details>
                <summary>Key-point audit results</summary>
                {(run.output.keyPoints as CheckedClaim[]).map((k) => (
                  <p key={k.id}>
                    {k.id}:{" "}
                    {k.passed
                      ? "Accepted"
                      : `Rejected — ${k.reasons.join("; ")}`}
                  </p>
                ))}
              </details>
              {(run.output.keyPoints as CheckedClaim[])
                .filter((k) => k.passed)
                .map((k) => (
                  <article className="claim-card" key={k.id}>
                    <h3>{k.claim.thesis_en}</h3>
                    {k.claim.evidence.map((e, i) => {
                      const segment = source?.segments.find(
                        (s) => s.id === e.segment_id,
                      );
                      return (
                        <div className="evidence" key={i}>
                          <blockquote>{e.quote_original}</blockquote>
                          {e.quote_translation_en &&
                          e.quote_translation_en !== e.quote_original ? (
                            <p>{e.quote_translation_en}</p>
                          ) : null}
                          {segment?.start_seconds != null ? (
                            <button
                              className="text-button"
                              onClick={() => setSeek(segment.start_seconds)}
                            >
                              Verify at {time(segment.start_seconds)}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </article>
                ))}
            </section>
          ) : null}
          <div className="section-toolbar">
            <h3>{accepted.length} accepted research claims</h3>
            {claims.length > accepted.length ? (
              <button
                className="text-button"
                onClick={() => setShowRejected(!showRejected)}
              >
                {showRejected ? "Hide" : "Show"}{" "}
                {claims.length - accepted.length} rejected
              </button>
            ) : null}
          </div>
          {!accepted.length ? (
            <div className="notice">
              No claims passed every check. This does not necessarily mean the
              video contains no useful research.
            </div>
          ) : null}
          {claims
            .filter((c) => c.passed || showRejected)
            .map((item) => (
              <article
                className={`claim-card ${!item.passed ? "rejected" : ""}`}
                key={item.id}
              >
                <div className="claim-meta">
                  <span className="ticker">
                    {
                      displayEntity(
                        item.claim,
                        (run.output.entityRegistry || []) as EntityData[],
                      ).name
                    }
                  </span>
                  <span className="badge">{item.claim.stance}</span>
                  <span className="muted">
                    Creator conviction: {item.claim.creator_conviction}
                  </span>
                </div>
                <h3>{item.claim.thesis_en}</h3>
                {item.claim.conditions_en.length ? (
                  <p>
                    <strong>Conditions:</strong>{" "}
                    {item.claim.conditions_en.join(" ")}
                  </p>
                ) : null}
                {item.claim.risks_en.length ? (
                  <p>
                    <strong>Risks:</strong> {item.claim.risks_en.join(" ")}
                  </p>
                ) : null}
                {item.claim.levels.length ? (
                  <p>
                    <strong>Levels:</strong>{" "}
                    {item.claim.levels
                      .map(
                        (l) =>
                          `${l.kind}: ${/\p{Script=Han}/u.test(l.value_original) ? "See translated source evidence" : l.value_original}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null}
                {item.claim.evidence.map((e, i) => {
                  const segment = source?.segments.find(
                    (s) => s.id === e.segment_id,
                  );
                  return (
                    <div className="evidence" key={i}>
                      <div className="evidence-label">
                        ORIGINAL SOURCE
                        {segment?.start_seconds != null ? (
                          <button
                            onClick={() => setSeek(segment.start_seconds)}
                          >
                            <Play size={12} />
                            {time(segment.start_seconds)}
                          </button>
                        ) : (
                          <span>Timestamp unavailable</span>
                        )}
                      </div>
                      <blockquote>{e.quote_original}</blockquote>
                      {e.quote_translation_en !== e.quote_original ? (
                        <p className="translation">
                          <strong>English translation</strong>
                          <br />
                          {e.quote_translation_en}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {!item.passed ? (
                  <div className="notice error">
                    Rejected: {item.reasons.join(" ")}
                  </div>
                ) : (
                  <div className="audit-note">
                    <Check size={14} /> Exact text checks and model critique
                    passed
                  </div>
                )}
              </article>
            ))}
        </>
      ) : (
        <div className="empty compact">
          <Clock3 size={25} />
          <h3>
            {run.status === "needs_review"
              ? "Source needs review"
              : run.status === "failed"
                ? "Analysis paused after a failure"
                : "Research is in progress"}
          </h3>
          <p>
            Progress is saved after each stage. You can close this report and
            return from the library.
          </p>
        </div>
      )}
      <details className="diagnostics">
        <summary>Pipeline metadata</summary>
        <pre>
          {JSON.stringify(
            {
              model: run.model,
              prompt: run.promptVersion,
              sourceHash: run.output.sourceHash,
              pipelineRevision:
                run.output.pipelineRevision ||
                run.input.pipelineVersion ||
                "legacy",
              validationVersion: run.output.validationVersion || "legacy",
              costOrReservationUsd: run.cost,
              metrics: run.output.metrics,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </>
  );
}
