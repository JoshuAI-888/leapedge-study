"use client";
import Link from "next/link";
import { useWorkspace } from "./workspace.tsx";
import { sentimentShift } from "../metrics/sentiment-shift.ts";
import { action } from "./api.ts";
import { Empty } from "./components.tsx";
export function SentimentPanel() {
  const { data, perform } = useWorkspace();
  if (!data) return null;
  const period = data.preferences.resolved.sentiment.periodDays;
  const canonical = new Set(data.snapshot.runs.map((r) => r.id));
  const levels = {
    "text-checked": "L1",
    "audio-agreed": "L2",
    "human-verified": "L3",
  };
  const rows = sentimentShift(
    data.snapshot.mentions.filter((m) => canonical.has(m.runId)),
    {
      asOf: data.cost.context.now,
      periodDays: period,
      minimumTrust: levels[data.preferences.resolved.sentiment.minimumTrust],
    },
  );
  return (
    <section className="yi-panel">
      <div className="yi-section-title">
        <h2>Sentiment shift</h2>
        <label className="yi-inline-label">
          Period
          <select
            value={period}
            onChange={(e) =>
              void perform(
                () =>
                  action("settings", "saveAccount", {
                    ...data.preferences.account,
                    sentiment: {
                      ...data.preferences.account.sentiment,
                      periodDays: Number(e.target.value),
                    },
                  }),
                "Sentiment period saved.",
              )
            }
          >
            {[7, 14, 30].map((n) => (
              <option value={n} key={n}>
                {n} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="yi-muted">
        Creator stances this period compared with the preceding {period} days.
        Mentions and creators are counted separately.
      </p>
      {rows.length ? (
        <ul className="yi-list">
          {rows.map((row) => (
            <li key={row.ticker}>
              <details>
                <summary>
                  <strong>{row.ticker}</strong>
                </summary>
                <div className="yi-evidence-links">
                  {row.mentionIds.map((id) => {
                    const mention = data.snapshot.mentions.find(
                      (m) => m.id === id,
                    );
                    return mention ? (
                      <Link
                        key={id}
                        href={`/youtube-intelligence/analysis/${mention.runId}`}
                      >
                        {mention.sentiment} ·{" "}
                        {mention.publishedAt || mention.stance}
                      </Link>
                    ) : null;
                  })}
                </div>
              </details>
              <span className="yi-chip">{row.direction}</span>
              <span>
                {row.current.bullish.creators} bullish ·{" "}
                {row.current.neutral.creators} neutral ·{" "}
                {row.current.bearish.creators} bearish creators
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No sentiment observations in this period">
          Eligible source-linked mentions will appear here after analysis.
        </Empty>
      )}
    </section>
  );
}
