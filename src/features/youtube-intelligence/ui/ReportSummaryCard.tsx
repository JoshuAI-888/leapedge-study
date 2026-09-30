"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DailyReport } from "../report.ts";
import { sessionLabel } from "../trading-day.ts";
import { getAction } from "./get-action.ts";
import { SplitBar } from "./SplitBar.tsx";
import { InstrumentLabel } from "./InstrumentLabel.tsx";

export type ReportData = DailyReport & {
  requested: string | null;
  latest: string | null;
};

/**
 * The daily report's summary for Today (decision D3, F64): headline, split
 * bar, the top three instruments in focus and a link to the full report.
 * Reads `report/session` for the latest session with calls; never writes.
 */
export function ReportSummaryCard() {
  const [report, setReport] = useState<ReportData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    getAction<ReportData>("report", "session", {}, controller.signal)
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="yi-panel yi-report-summary" aria-labelledby="yi-report-summary-title">
      <div className="yi-section-title">
        <div>
          <span className="yi-eyebrow">DAILY REPORT</span>
          <h2 id="yi-report-summary-title">
            {report ? sessionLabel(report.session) : "Latest US session"}
          </h2>
        </div>
        {report && (
          <Link href={`/youtube-intelligence/report/${report.session}`}>
            Open the report →
          </Link>
        )}
      </div>
      {error ? (
        <p className="yi-warning" role="alert">
          The report could not be loaded: {error}
        </p>
      ) : !report ? (
        <p className="yi-muted" role="status">
          Loading the latest session…
        </p>
      ) : report.state === "empty" ? (
        <p className="yi-muted">No analysed videos yet in a US session.</p>
      ) : (
        <>
          <p className="yi-report-summary-headline">{report.headline.text}</p>
          <SplitBar
            calls={report.split.calls}
            creators={report.split.creators}
            label={`${report.creators} creators`}
          />
          <p className="yi-muted yi-report-meta">
            {report.videos} video{report.videos === 1 ? "" : "s"} ·{" "}
            {report.creators} creator{report.creators === 1 ? "" : "s"}
            {report.headline.synthesized ? " · checked against sources" : ""}
          </p>
          {report.inFocus.length > 0 && (
            <ol className="yi-report-summary-focus" aria-label="Top three in focus">
              {report.inFocus.slice(0, 3).map((row) => (
                <li key={row.key}>
                  <InstrumentLabel claim={row.label} />
                  <span className="yi-muted">
                    {row.creators} creator{row.creators === 1 ? "" : "s"}
                  </span>
                  <SplitBar
                    calls={row.split}
                    creators={row.creatorSplit}
                    label={row.key}
                    showCounts={false}
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
