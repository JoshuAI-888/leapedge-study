"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import { getAction } from "../get-action.ts";
import { Empty, MetricHeading, PageTitle, TrustBadge } from "../components.tsx";
import { SplitBar } from "../SplitBar.tsx";
import { InstrumentLabel } from "../InstrumentLabel.tsx";
import { TradingDay, useTeamTimeZone } from "../TradingDay.tsx";
import { ResearchOverview } from "../ResearchBrief.tsx";
import { ReportSummaryCard, type ReportData } from "../ReportSummaryCard.tsx";
import { money } from "../viewmodel.ts";
import { localTime, sessionLabel } from "../../trading-day.ts";
import {
  MIN_SYNTHESIS_VIDEOS,
  analysisHref,
  sentimentOfStance,
  snapSession,
  timestamp,
  verdictLine,
  type ArchiveEntry,
  type Citation,
  type InFocusRow,
  type ReportCall,
  type ReportPoint,
} from "../../report.ts";

export { ReportSummaryCard };

const BASE = "/youtube-intelligence/report";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const GLYPH: Record<string, string> = { bullish: "▲", neutral: "●", bearish: "▼" };
const sentimentOf = sentimentOfStance;

type Archive = { rows: ArchiveEntry[]; total: number };

/**
 * The daily report (F64): one US trading session read from stored calls,
 * with the model synthesis layered on when it exists. Previous/next skip
 * non-trading days, the date field snaps to a session, and the archive of
 * past sessions sits in a right column on desktop and below on a phone.
 */
export function Report({ date }: { date: string | null }) {
  const router = useRouter();
  const { busy, perform } = useWorkspace();
  const timeZone = useTeamTimeZone();
  const [report, setReport] = useState<ReportData | null>(null),
    [archive, setArchive] = useState<Archive | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [archiveLimit, setArchiveLimit] = useState(20);
  const ticket = useRef(0);
  // The router object is not stable across renders; keep it out of load's deps.
  const routerRef = useRef(router);
  routerRef.current = router;
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        getAction<ReportData>("report", "session", date ? { session: date } : {}),
        getAction<Archive>("report", "archive", { limit: archiveLimit }),
      ]);
      if (mine !== ticket.current) return;
      setReport(r);
      setArchive(a);
      setError("");
      // A weekend or future date opens the session it snaps to.
      if (date && r.session !== date)
        routerRef.current.replace(`${BASE}/${r.session}`);
    } catch (e) {
      if (mine === ticket.current)
        setError(e instanceof Error ? e.message : "The report could not be loaded.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [date, archiveLimit]);
  useEffect(() => {
    void load();
  }, [load]);
  // While a synthesis is being written, look again every few seconds.
  const working =
    report?.synthesis.status === "queued" || report?.synthesis.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [working, load]);

  const synthesize = () =>
    report &&
    void perform(
      () => action("report", "synthesize", { session: report.session }),
      "Summary queued. It is written, then checked against the quoted sources.",
    ).then(() => load());

  if (!report)
    return (
      <>
        <PageTitle
          title="Daily report"
          description="What creators said in one US session, with the evidence behind it."
        />
        {error ? (
          <div className="yi-warning" role="alert">
            <p>The report could not be loaded: {error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <p role="status">Loading the report…</p>
        )}
      </>
    );

  const showingEarlier = !date && report.session !== report.current;
  return (
    <>
      <PageTitle
        title="Daily report"
        description="What creators said in one US session, with the evidence behind it."
      />
      <div className={`yi-report-layout${loading ? " yi-refetching" : ""}`} aria-busy={loading}>
        <div className="yi-report-main">
          <header className="yi-panel yi-report-header">
            <nav className="yi-report-nav" aria-label="Sessions">
              <Link
                className="yi-report-step"
                href={`${BASE}/${report.previous}`}
                aria-label={`Previous session, ${sessionLabel(report.previous)}`}
              >
                ‹ <span>{sessionLabel(report.previous).replace(" · US session", "")}</span>
              </Link>
              <label className="yi-report-date">
                <span className="yi-sr-only">Session date</span>
                <input
                  type="date"
                  value={report.session}
                  max={report.current}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    router.push(`${BASE}/${snapSession(e.target.value, report.current)}`);
                  }}
                />
              </label>
              {report.next ? (
                <Link
                  className="yi-report-step"
                  href={`${BASE}/${report.next}`}
                  aria-label={`Next session, ${sessionLabel(report.next)}`}
                >
                  <span>{sessionLabel(report.next).replace(" · US session", "")}</span> ›
                </Link>
              ) : (
                <span className="yi-report-step yi-muted" aria-disabled="true">
                  Latest session
                </span>
              )}
            </nav>
            <p className="yi-eyebrow">{sessionLabel(report.session, { year: true }).toUpperCase()}</p>
            <h2 className="yi-report-headline">{report.headline.text}</h2>
            {report.calls > 0 && (
              <SplitBar
                calls={report.split.calls}
                creators={report.split.creators}
                label="All calls in this session"
              />
            )}
            <p className="yi-muted yi-report-meta">
              {plural(report.calls, "call")} from {plural(report.creators, "creator")} ·{" "}
              {plural(report.videos, "video")} · {checkStatus(report)} ·{" "}
              {report.synthesis.createdAt
                ? `summary written ${localTime(report.synthesis.createdAt, timeZone)}`
                : `counted ${localTime(report.generatedAt, timeZone)}`}
            </p>
            {/* TODO(F63): Export menu. Wire ui/ExportMenu.tsx here once the
                research-ui lane's component is on this branch (scope: this session's calls). */}
            <div className="yi-export-slot" data-export-scope="report-session" hidden />
            {showingEarlier && (
              <p className="yi-muted">
                No analysed videos yet for {sessionLabel(report.current)}. Showing the
                latest session with calls.
              </p>
            )}
          </header>

          <StatePanel report={report} busy={busy} onSynthesize={synthesize} />

          {report.themes.length > 0 && <Themes points={report.themes} />}

          {report.removed.length > 0 && (
            <section className="yi-warning yi-report-removed" aria-labelledby="yi-removed">
              <h2 id="yi-removed">
                {plural(report.removed.length, "point")} removed by the source check
              </h2>
              <details>
                <summary>Show what was removed and why</summary>
                <ul>
                  {report.removed.map((p, i) => (
                    <li key={i}>
                      <p>{p.text}</p>
                      <p className="yi-muted">Why: {p.reason ?? "No reason recorded."}</p>
                      <Citations citations={p.citations} />
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          {report.state === "too-few-videos" ? (
            <CallTable calls={report.callList} title="Calls in this session" />
          ) : report.state !== "empty" ? (
            <>
              <InFocus rows={report.inFocus} calls={report.callList} />
              <Disagreements report={report} />
            </>
          ) : (
            <Empty title="No analysed videos in this session">
              Videos published between the previous close and this session&apos;s
              4 pm ET close appear here once they are analysed.
            </Empty>
          )}

          <section className="yi-report-briefs" aria-label="Video briefs">
            <ResearchOverview title="Video briefs" />
          </section>

          {report.sources.length > 0 && <Sources report={report} />}

          {report.state !== "too-few-videos" && report.callList.length > 0 && (
            <details className="yi-details yi-report-all-calls">
              <summary>All {plural(report.callList.length, "call")} in this session</summary>
              <CallTable calls={report.callList} />
            </details>
          )}
        </div>
        <ArchiveColumn
          archive={archive}
          current={report.session}
          onMore={() => setArchiveLimit((n) => Math.min(260, n + 40))}
        />
      </div>
    </>
  );
}

function checkStatus(report: ReportData) {
  if (report.state === "synthesized")
    return report.removed.length
      ? `checked against sources, ${report.removed.length} removed`
      : "checked against sources ✓";
  if (report.state === "synthesizing") return "summary being checked";
  if (report.state === "synthesis-failed") return "summary failed";
  if (report.state === "too-few-videos") return "not summarised";
  return "no summary yet";
}

function StatePanel({
  report,
  busy,
  onSynthesize,
}: {
  report: ReportData;
  busy: boolean;
  onSynthesize: () => void;
}) {
  if (report.state === "empty") return null;
  const cost = report.costEstimate
    ? `Estimated cost about ${money(report.costEstimate.usd)}, the average of ${plural(report.costEstimate.basis, "earlier summary", "earlier summaries")}.`
    : "No earlier summary to estimate the cost from; your monthly budget cap applies.";
  const canRun =
    report.videos >= MIN_SYNTHESIS_VIDEOS &&
    (report.state === "not-synthesized" ||
      report.state === "synthesis-failed" ||
      (report.state === "synthesized" && report.synthesis.newVideos > 0));
  const className =
    report.state === "synthesis-failed" || report.state === "too-few-videos"
      ? "yi-warning yi-report-state"
      : "yi-panel yi-report-state";
  return (
    <section className={className} aria-live="polite">
      <p>
        <strong>
          {report.state === "synthesized"
            ? "Summary"
            : report.state === "synthesizing"
              ? "Writing the summary"
              : report.state === "synthesis-failed"
                ? "The summary did not finish"
                : report.state === "too-few-videos"
                  ? "Not enough videos for a summary"
                  : "Summary"}
        </strong>
      </p>
      <p>{report.stateNote}</p>
      {report.state === "synthesized" && report.synthesis.newVideos > 0 && (
        <p>
          {plural(report.synthesis.newVideos, "video")} arrived after this summary was
          written and {report.synthesis.newVideos === 1 ? "is" : "are"} not in it yet.
        </p>
      )}
      {canRun && (
        <div className="yi-row">
          <button type="button" disabled={busy} onClick={onSynthesize}>
            {report.state === "synthesis-failed"
              ? "Retry the summary"
              : report.state === "synthesized"
                ? "Write the summary again"
                : "Write the summary"}
          </button>
          <span className="yi-muted">Uses model calls (a writer and a critic). {cost}</span>
        </div>
      )}
    </section>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <span className="yi-cite-list">
      {citations.map((c) => (
        <Link
          key={`${c.runId}:${c.claimId}`}
          className="yi-cite"
          href={c.href}
          title={`Open the analysis at ${c.label.replace(`${c.channel} ▶ `, "") || "the cited call"}`}
        >
          {c.label}
        </Link>
      ))}
    </span>
  );
}

function Themes({ points }: { points: ReportPoint[] }) {
  return (
    <section className="yi-panel" aria-labelledby="yi-themes">
      <h2 id="yi-themes">Themes</h2>
      <ul className="yi-report-themes">
        {points.map((p, i) => (
          <li key={i}>
            <span>{p.text}</span> <Citations citations={p.citations} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function changeText(row: InFocusRow) {
  if (row.previousCreators === null) return "New";
  const d = row.creators - row.previousCreators;
  return d === 0 ? "No change" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
}

function CallLine({ call }: { call: ReportCall }) {
  const at = timestamp(call.quote?.startSeconds);
  return (
    <li className="yi-report-call">
      <div className="yi-row">
        <span className={`yi-chip yi-stance-${call.stance}`}>
          {GLYPH[sentimentOf(call.stance)]} {call.stance}
        </span>
        {call.channelId ? (
          <Link href={`/youtube-intelligence/channels/${encodeURIComponent(call.channelId)}`}>
            {call.channelTitle ?? "Unknown channel"}
          </Link>
        ) : (
          <span>{call.channelTitle ?? "Unknown channel"}</span>
        )}
        <Link href={analysisHref(call.runId, call.claimId)}>
          Open{at ? ` ▶ ${at}` : ""}
        </Link>
      </div>
      <p>{call.thesis}</p>
      {call.quote && (
        <blockquote>
          “{call.quote.text}”
          {call.quote.translation && call.quote.translation !== call.quote.text && (
            <span className="yi-muted"> — {call.quote.translation}</span>
          )}
        </blockquote>
      )}
    </li>
  );
}

function InFocus({ rows, calls }: { rows: InFocusRow[]; calls: ReportCall[] }) {
  if (!rows.length) return null;
  const byId = new Map(calls.map((c) => [c.id, c]));
  return (
    <section className="yi-panel" aria-labelledby="yi-in-focus">
      <div className="yi-section-title">
        <h2 id="yi-in-focus">In focus</h2>
        <span className="yi-muted">Ranked by distinct creators · change vs previous session</span>
      </div>
      <ol className="yi-focus-list">
        {rows.map((row, i) => (
          <li key={row.key}>
            <details>
              <summary>
                <span className="yi-focus-rank">{i + 1}</span>
                <span className="yi-focus-instrument">
                  <InstrumentLabel claim={row.label} link={false} />
                </span>
                <span className="yi-focus-creators">
                  {plural(row.creators, "creator")}
                </span>
                <span className="yi-focus-split">
                  <SplitBar calls={row.split} creators={row.creatorSplit} label={row.key} />
                </span>
                <span className="yi-focus-change" title="Creators this session against the previous session">
                  <span className="yi-sr-only">Change against the previous session: </span>
                  {changeText(row)}
                </span>
                <span className="yi-focus-reason">{row.reason}</span>
              </summary>
              <ul className="yi-report-calls">
                {row.callIds.map((id) => {
                  const call = byId.get(id);
                  return call ? <CallLine key={id} call={call} /> : null;
                })}
              </ul>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Disagreements({ report }: { report: ReportData }) {
  return (
    <section className="yi-panel" aria-labelledby="yi-disagree">
      <h2 id="yi-disagree">Where creators disagree</h2>
      {report.disagreements.length ? (
        <div className="yi-disagree-list">
          {report.disagreements.map((d) => (
            <article key={d.key} className="yi-disagree">
              <h3>
                <InstrumentLabel claim={d.label} />{" "}
                <span className="yi-muted">
                  {d.bullish.length} ▲ vs {d.bearish.length} ▼
                </span>
              </h3>
              <div className="yi-disagree-sides">
                {(["bullish", "bearish"] as const).map((side) => (
                  <div key={side}>
                    <h4>
                      {GLYPH[side]} {side === "bullish" ? "Bullish" : "Bearish"}
                    </h4>
                    <ul className="yi-report-calls">
                      {d[side].map((c) => (
                        <CallLine key={c.id} call={c} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="yi-muted">
          No instrument has both bullish and bearish calls in this session.
        </p>
      )}
    </section>
  );
}

function Sources({ report }: { report: ReportData }) {
  return (
    <section className="yi-panel" aria-labelledby="yi-sources">
      <h2 id="yi-sources">Sources</h2>
      <ul className="yi-report-sources">
        {report.sources.map((s) => (
          <li key={s.runId}>
            <Link href={`/youtube-intelligence/analysis/${encodeURIComponent(s.runId)}`}>
              {s.title || s.videoId}
            </Link>
            <span className="yi-muted">
              {s.channelId ? (
                <Link href={`/youtube-intelligence/channels/${encodeURIComponent(s.channelId)}`}>
                  {s.channelTitle ?? "Unknown channel"}
                </Link>
              ) : (
                (s.channelTitle ?? "Unknown channel")
              )}{" "}
              · <TradingDay at={s.publishedAt} />
            </span>
            <span className="yi-verdict-line">{verdictLine(s)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CallTable({ calls, title }: { calls: ReportCall[]; title?: string }) {
  return (
    <section className={title ? "yi-panel" : undefined} aria-label={title ?? "All calls"}>
      {title && <h2>{title}</h2>}
      <div className="yi-table-wrap">
        <table>
          <thead>
            <tr>
              <MetricHeading id="today.instrument" />
              <MetricHeading id="today.stance" />
              <MetricHeading id="today.thesis" />
              <MetricHeading id="channel.title" />
              <MetricHeading id="today.trust" />
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>
                  <InstrumentLabel claim={c} />
                </td>
                <td>
                  <span className={`yi-chip yi-stance-${c.stance}`}>
                    {GLYPH[sentimentOf(c.stance)]} {c.stance}
                  </span>
                </td>
                <td className="yi-report-thesis">
                  <Link href={analysisHref(c.runId, c.claimId)}>{c.thesis}</Link>
                  <span className="yi-muted"> · conviction {c.conviction}</span>
                </td>
                <td>{c.channelTitle ?? "Unknown channel"}</td>
                <td>
                  <TrustBadge level={c.trustLevel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ArchiveColumn({
  archive,
  current,
  onMore,
}: {
  archive: Archive | null;
  current: string;
  onMore: () => void;
}) {
  return (
    <aside className="yi-panel yi-report-archive" aria-labelledby="yi-archive">
      <h2 id="yi-archive">Past sessions</h2>
      {!archive ? (
        <p className="yi-muted" role="status">
          Loading…
        </p>
      ) : archive.rows.length ? (
        <>
          <ol>
            {archive.rows.map((a) => (
              <li key={a.session}>
                <Link
                  href={`${BASE}/${a.session}`}
                  aria-current={a.session === current ? "page" : undefined}
                >
                  <strong>{sessionLabel(a.session).replace(" · US session", "")}</strong>
                  {/* The split bar carries the counts, so a counted headline shows only its lean. */}
                  <span>{a.synthesized ? a.headline : a.headline.split(":")[0]}</span>
                </Link>
                <SplitBar calls={a.split} label={sessionLabel(a.session)} />
              </li>
            ))}
          </ol>
          {archive.total > archive.rows.length && (
            <p className="yi-muted">
              Latest {archive.rows.length} of {archive.total} sessions ·{" "}
              <button type="button" className="yi-text-button" onClick={onMore}>
                Show older sessions
              </button>
            </p>
          )}
        </>
      ) : (
        <p className="yi-muted">No sessions with analysed videos yet.</p>
      )}
    </aside>
  );
}
