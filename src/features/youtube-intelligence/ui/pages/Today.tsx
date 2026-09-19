"use client";
import Link from "next/link";
import { SentimentPanel } from "../SentimentPanel.tsx";
import { useState } from "react";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import { visibleClaims, processingState, dateLabel } from "../viewmodel.ts";
import { ClaimCard, Empty, Filters, PageTitle } from "../components.tsx";
export function Today() {
  const { data, perform, busy } = useWorkspace();
  const [url, setUrl] = useState(""),
    [search, setSearch] = useState(""),
    [minimum, setMinimum] = useState(""),
    [status, setStatus] = useState("all");
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
  const claims = visibleClaims(
    data.snapshot.claims.filter((c) => canonical.has(c.runId)),
    search,
    minimum || defaultTrust,
  );
  const runs = data.runs.filter(
    (r) => status === "all" || processingState(r.status) === status,
  );
  return (
    <>
      <PageTitle
        title="Today"
        description="Ideas from the creators you follow, with evidence you can inspect."
      />
      <form
        className="yi-submit yi-panel"
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
        <p className="yi-muted">
          Your configured processing and spending limits apply.
        </p>
      </form>
      <section>
        <div className="yi-section-title">
          <h2>Your research</h2>
          <span className="yi-muted">
            {claims.length} shown · sorted by trust, then conviction
          </span>
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
        </Filters>
        {data.snapshot.counts.claims.truncated && (
          <p className="yi-warning">
            Showing {data.snapshot.counts.claims.returned} of{" "}
            {data.snapshot.counts.claims.total} stored claims.
          </p>
        )}
        {claims.length ? (
          <div className="yi-card-grid">
            {claims.map((c) => (
              <ClaimCard key={c.id} claim={c} />
            ))}
          </div>
        ) : (
          <Empty title="No calls match this view">
            Analyse a video, follow a channel, or change the minimum trust
            filter. Calls without enough evidence remain available in their
            analysis.
          </Empty>
        )}
      </section>
      <SentimentPanel />
      <section className="yi-panel">
        <div className="yi-section-title">
          <h2>Video activity</h2>
          <label className="yi-inline-label">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["all", "Queued", "Analysing", "Ready", "Needs review"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "All activity" : s}
                  </option>
                ),
              )}
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
                <span className="yi-chip">{processingState(r.status)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No video activity">
            Submitted videos will appear here as they progress.
          </Empty>
        )}
      </section>
    </>
  );
}
