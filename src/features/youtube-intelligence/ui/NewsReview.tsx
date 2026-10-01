"use client";
import { useCallback, useEffect, useState } from "react";
import type { NewsReviewData, CheckedStatement } from "../news-review.ts";
import { action } from "./api.ts";

const VERDICT_LABEL: Record<string, string> = {
  consistent: "Consistent with the news",
  contradicted: "Contradicted by the news",
  mixed: "Mixed",
  superseded: "Superseded by later events",
  not_covered: "Not covered by retrieved articles",
};
const day = (value: string | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : "undated";

/**
 * Analyst-requested news review of a brief's claims. Every statement shows
 * numbered citations to dated articles with the verbatim excerpt relied on;
 * statements that failed citation or independent checks are listed, not hidden.
 */
export function NewsReview({
  briefId,
  claims,
}: {
  briefId: string;
  claims: { id: string; text: string }[];
}) {
  const [reviews, setReviews] = useState<NewsReviewData[] | null>(null);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const all = await action<NewsReviewData[]>("research", "newsReviews");
      setReviews(all.filter((r) => r.briefId === briefId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load news reviews.");
    }
  }, [briefId]);
  useEffect(() => {
    void load();
  }, [load]);
  const latest = [...(reviews ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  useEffect(() => {
    if (!requested || latest) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [requested, latest, load]);
  const request = async () => {
    setError("");
    try {
      await action("research", "requestNewsReview", { briefId });
      setRequested(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request a news review.");
    }
  };
  const number = new Map(latest?.sources.map((s, i) => [s.id, i + 1]) ?? []);
  const cite = (statement: CheckedStatement) => (
    <li key={statement.id}>
      {statement.text}{" "}
      {statement.citations.map((c) => (
        <a key={c.sourceId + c.excerpt} href={`#news-source-${briefId}-${number.get(c.sourceId)}`} title={`“${c.excerpt}”`}>
          [{number.get(c.sourceId)}]
        </a>
      ))}
      <ul className="yi-muted">
        {statement.citations.map((c) => (
          <li key={c.sourceId + c.excerpt}>
            [{number.get(c.sourceId)}] “{c.excerpt}”
          </li>
        ))}
      </ul>
    </li>
  );
  return (
    <section className="yi-current-update" aria-label="News review">
      <h3>News review · analyst-requested, separate from the transcript brief</h3>
      <p className="yi-muted">
        Searches dated news for the brief&apos;s claims and writes a cited review.
        Articles published before the video are kept apart from developments
        since. Every statement quotes the article it relies on and is checked
        by an independent model; it reports what the articles say, not whether
        to trade.
      </p>
      {!latest && (
        <button onClick={() => void request()} disabled={requested}>
          {requested ? "News review running…" : "Request news review"}
        </button>
      )}
      {error && <p className="yi-warning">{error}</p>}
      {latest && (
        <div>
          <p className="yi-muted">
            Reviewed {day(latest.createdAt)} · video date {day(latest.cutoff)} ·{" "}
            {latest.sources.length} article(s) from {latest.queries.length} search(es) ·{" "}
            {latest.independentlyChecked ? "independently checked" : "no statements to check"}
          </p>
          {latest.summary.length > 0 && (
            <>
              <h4>Summary</h4>
              <ul>{latest.summary.map(cite)}</ul>
            </>
          )}
          {latest.claims.map((claim) => (
            <div key={claim.claimId}>
              <h4>
                {claims.find((c) => c.id === claim.claimId)?.text ?? claim.claimId}
              </h4>
              <p>
                <strong>{VERDICT_LABEL[claim.verdict] ?? claim.verdict}</strong>
                {claim.downgraded && " (no statement survived the checks)"}
              </p>
              {claim.asOfVideo.length > 0 && (
                <>
                  <p className="yi-eyebrow">Known by the video date</p>
                  <ul>{claim.asOfVideo.map(cite)}</ul>
                </>
              )}
              {claim.sinceVideo.length > 0 && (
                <>
                  <p className="yi-eyebrow">Since the video</p>
                  <ul>{claim.sinceVideo.map(cite)}</ul>
                </>
              )}
            </div>
          ))}
          {latest.gaps.length > 0 && (
            <>
              <h4>Not tested by the articles</h4>
              <ul>{latest.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </>
          )}
          <h4>Sources</h4>
          <ol>
            {latest.sources.map((s, i) => (
              <li key={s.id} id={`news-source-${briefId}-${i + 1}`}>
                <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>{" "}
                · {new URL(s.url).hostname} · {day(s.publishedAt)}
                {s.publishedAt && !s.publicationConfirmed && " (provider-estimated date)"}
                {" · "}
                {s.window === "asOfVideo" ? "before the video" : s.window === "sinceVideo" ? "after the video" : "undated, not citable"}
                {s.sourceClass === "primary" && " · primary source"}
              </li>
            ))}
          </ol>
          {latest.rejected.length > 0 && (
            <details>
              <summary>{latest.rejected.length} statement(s) removed by citation or independent checks</summary>
              <ul>
                {latest.rejected.map((r) => (
                  <li key={r.id}>
                    {r.text} — <span className="yi-muted">{r.reasons.join(" ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="yi-muted">Search cost US${latest.searchCostUsd.toFixed(3)}; model calls are costed in the run ledger.</p>
        </div>
      )}
    </section>
  );
}
