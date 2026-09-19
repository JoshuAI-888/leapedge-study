"use client";
import Link from "next/link";
import { SentimentPanel } from "../SentimentPanel.tsx";
import { useState } from "react";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import {
  visibleClaims,
  recoveredRuns,
  processingState,
  dateLabel,
  creatorStances,
} from "../viewmodel.ts";
import {
  ClaimCard,
  Empty,
  Filters,
  PageTitle,
  TrustBadge,
  SaveCallButton,
  MetricHeading,
} from "../components.tsx";
export function Today() {
  const { data, perform, busy } = useWorkspace();
  const [url, setUrl] = useState(""),
    [search, setSearch] = useState(""),
    [minimum, setMinimum] = useState(""),
    [status, setStatus] = useState("all"),
    [stance, setStance] = useState("all"),
    [view, setView] = useState("table"),
    [sort, setSort] = useState("default"),
    [descending, setDescending] = useState(false),
    [limit, setLimit] = useState(5);
  if (!data) return null;
  const defaultTrust =
    (
      {
        "text-checked": "L1",
        "audio-agreed": "L2",
        "human-verified": "L3",
      } as Record<string, string>
    )[data.preferences.resolved.todayTrustFilter] ?? "L2";
  const canonical = new Set(data.snapshot.runs.map((r) => r.id));
  const eligible = visibleClaims(
    data.snapshot.claims.filter((c) => canonical.has(c.runId)),
    search,
    minimum || defaultTrust,
  );
  const allCreators = creatorStances(eligible);
  const creatorCounts = new Map(allCreators.map((r) => [r.ticker, r.creators]));
  const claims = eligible.filter(
    (c) => stance === "all" || c.stance === stance,
  );
  if (sort !== "default")
    claims.sort((a, b) => {
      const value = (c: typeof a) =>
        sort === "creators"
          ? String(creatorCounts.get(c.ticker ?? "") ?? 0).padStart(10, "0")
          : sort === "instrument"
            ? (c.ticker ?? c.instrument ?? "")
            : sort === "stance"
              ? c.stance
              : sort === "thesis"
                ? c.thesisEn
                : c.trustLevel;
      return (
        (descending ? -1 : 1) * value(a).localeCompare(value(b)) ||
        a.id.localeCompare(b.id)
      );
    });
  const across = allCreators.slice(0, 6);
  const shown = claims.slice(0, limit);
  const recovered = recoveredRuns(data.runs);
  const activityState = (r: (typeof data.runs)[number]) =>
    recovered.has(r.id) ? "Recovered" : processingState(r.status);
  const needsReview = data.runs.filter(
    (r) => activityState(r) === "Needs review",
  );
  function sortBy(key: string) {
    setSort(key);
    setDescending(sort === key ? !descending : false);
  }
  const runs = data.runs.filter(
    (r) => status === "all" || activityState(r) === status,
  );
  return (
    <>
      <PageTitle
        title="Today"
        description="Creator calls, the evidence behind them, and what changed."
      >
        <form
          className="yi-quick-analyse"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await action("runs", "analyse", { url });
              setUrl("");
            }, "Video queued. Its progress appears below.");
          }}
        >
          <label htmlFor="video-url">Analyse a YouTube video</label>
          <div className="yi-row">
            <input
              id="video-url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a YouTube video link"
            />
            <button disabled={busy || !url.trim()}>
              {busy ? "Adding…" : "Analyse video →"}
            </button>
          </div>
        </form>
      </PageTitle>
      <div className="yi-today-layout">
        <div className="yi-today-primary">
          <section className="yi-panel yi-calls-panel">
            <div className="yi-section-title">
              <h2>Calls to explore</h2>
              <span className="yi-muted">
                {claims.length} matching ·{" "}
                {sort === "default"
                  ? "trust, then conviction"
                  : `${sort}, ${descending ? "descending" : "ascending"}`}
              </span>
            </div>
            <div className="yi-view-switch" aria-label="Call layout">
              {["table", "cards"].map((v) => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "table" ? "Table" : "Cards"}
                </button>
              ))}
            </div>
            <Filters>
              <label>
                Find a call
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ticker or thesis"
                />
              </label>
              <label>
                Minimum trust
                <select
                  value={minimum || defaultTrust}
                  onChange={(e) => setMinimum(e.target.value)}
                >
                  <option value="L0">All extracted</option>
                  <option value="L1">Text-checked</option>
                  <option value="L2">Audio-agreed</option>
                  <option value="L3">Human-verified</option>
                </select>
              </label>
              <label>
                Stance
                <select
                  value={stance}
                  onChange={(e) => setStance(e.target.value)}
                >
                  <option value="all">All stances</option>
                  {[...new Set(eligible.map((c) => c.stance))]
                    .sort()
                    .map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                </select>
              </label>
              <button
                className="yi-text-button"
                onClick={() => {
                  setSort("default");
                  setDescending(false);
                }}
              >
                Reset sort
              </button>
            </Filters>
            {data.snapshot.counts.claims.truncated && (
              <p className="yi-warning">
                Showing {data.snapshot.counts.claims.returned} of{" "}
                {data.snapshot.counts.claims.total} stored claims.
              </p>
            )}
            {claims.length ? (
              <>
                {view === "table" && (
                  <div className="yi-call-table">
                    <table>
                      <caption className="yi-sr-only">
                        Creator calls with stance, thesis and evidence trust
                      </caption>
                      <thead>
                        <tr>
                          {[
                            "instrument",
                            "stance",
                            "thesis",
                            "trust",
                            "creators",
                          ].map((key) => (
                            <MetricHeading
                              key={key}
                              id={`today.${key}`}
                              onSort={() => sortBy(key)}
                              direction={
                                sort === key
                                  ? descending
                                    ? "desc"
                                    : "asc"
                                  : undefined
                              }
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong className="yi-ticker">
                                {c.ticker ?? c.instrument ?? "Unresolved"}
                              </strong>
                              {c.ticker && c.instrument !== c.ticker && (
                                <small>{c.instrument}</small>
                              )}
                            </td>
                            <td>
                              <span className={`yi-chip yi-stance-${c.stance}`}>
                                {c.stance}
                              </span>
                            </td>
                            <td>
                              <strong className="yi-call-thesis">
                                {c.thesisEn}
                              </strong>
                              <p className="yi-muted">
                                {c.horizonEn || "Horizon not specified"}
                              </p>
                              {c.conditionsEn.length > 0 && (
                                <p className="yi-muted">
                                  Conditions: {c.conditionsEn.join(" · ")}
                                </p>
                              )}
                              <span className="yi-muted">
                                Creator conviction: {c.creatorConviction}
                              </span>
                              <div className="yi-call-actions">
                                <Link
                                  href={`/youtube-intelligence/analysis/${encodeURIComponent(c.runId)}#${encodeURIComponent(c.id)}`}
                                >
                                  Inspect evidence ↗
                                </Link>
                                <SaveCallButton claim={c} />
                              </div>
                            </td>
                            <td>
                              <TrustBadge
                                level={c.trustLevel}
                                basis={c.trustBasis}
                              />
                            </td>
                            <td>
                              <strong>
                                {creatorCounts.get(c.ticker ?? "") ?? 0}
                              </strong>
                              <small>Dated creators</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div
                  className={`yi-card-grid ${view === "table" ? "yi-mobile-calls" : ""}`}
                >
                  {shown.map((c) => (
                    <ClaimCard key={c.id} claim={c} />
                  ))}
                </div>
                <p className="yi-calls-footnote">
                  Showing {shown.length} of {claims.length}. Trust describes the
                  evidence, not investment quality.
                </p>
                {shown.length < claims.length && (
                  <button
                    className="yi-text-button yi-show-more"
                    onClick={() => setLimit(limit + 10)}
                  >
                    Show more calls ({claims.length - shown.length} remaining)
                  </button>
                )}
              </>
            ) : (
              <Empty title="No calls match this view">
                Analyse a video, follow a channel, or change the minimum trust
                filter. Calls without enough evidence remain available in their
                analysis.
              </Empty>
            )}
          </section>
          <section className="yi-panel">
            <div className="yi-section-title">
              <h2>Video activity</h2>
              <label className="yi-inline-label">
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "all",
                    "Queued",
                    "Analysing",
                    "Ready",
                    "Needs review",
                    "Recovered",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s === "all" ? "All activity" : s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {runs.length ? (
              <ul className="yi-list">
                {runs.map((r) => (
                  <li key={r.id}>
                    <div>
                      <Link href={`/youtube-intelligence/analysis/${r.id}`}>
                        {r.title || `YouTube · ${r.videoId}`}
                      </Link>
                      <small>{dateLabel(r.createdAt)}</small>
                    </div>
                    <span
                      className="yi-chip"
                      title={
                        recovered.has(r.id)
                          ? "Earlier attempt; a linked recovery completed. Original details remain available."
                          : undefined
                      }
                    >
                      {activityState(r)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No video activity">
                Submitted videos will appear here as they progress.
              </Empty>
            )}
          </section>
        </div>
        <aside className="yi-today-rail" aria-label="Research context">
          <SentimentPanel />
          <section className="yi-panel">
            <h2>Across creators</h2>
            {across.length ? (
              <ul className="yi-list">
                {across.map((row) => (
                  <li key={row.ticker}>
                    <strong>{row.ticker}</strong>
                    <div className="yi-row">
                      {Object.entries(row.stances).map(([direction, count]) => (
                        <span
                          key={direction}
                          className={`yi-chip yi-stance-${direction}`}
                        >
                          {count} {direction}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="yi-muted">
                No dated creator calls match this view.
              </p>
            )}
            <p className="yi-muted">
              Latest dated stance per known creator among calls matching search
              and trust. Agreement is not proof a thesis is correct.
            </p>
          </section>
          <section className="yi-panel">
            <h2>
              Needs your review{" "}
              <span className="yi-muted">{needsReview.length}</span>
            </h2>
            {needsReview.length ? (
              <ul className="yi-list">
                {needsReview.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link href={`/youtube-intelligence/analysis/${r.id}`}>
                      {r.title || r.videoId} ↗
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="yi-muted">
                No video activity currently needs review.
              </p>
            )}
            <Link href="/youtube-intelligence/lab">
              Open diagnostics in Lab →
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
