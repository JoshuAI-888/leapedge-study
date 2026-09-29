"use client";
import Link from "next/link";
import { z } from "zod";
import { useWorkspace } from "./workspace.tsx";
import { sentimentShift } from "../metrics/sentiment-shift.ts";
import { Empty } from "./components.tsx";
import { useUrlState } from "./url-state.ts";
import { SplitBar } from "./SplitBar.tsx";
import { StatTiles } from "./StatTiles.tsx";
import { Sparkline } from "./Sparkline.tsx";
import { dailyCounts, SENTIMENTS } from "./foundations.ts";
/** The period is view state in the URL (decision D4), seeded from the saved setting. */
const PERIODS = ["7d", "14d", "30d"] as const;
const PeriodState = z.object({ sentiment: z.enum(PERIODS) });
export function SentimentPanel() {
  const { data } = useWorkspace();
  const saved = `${data?.preferences.resolved.sentiment.periodDays ?? 7}d`;
  const [view, setView] = useUrlState(PeriodState, {
    sentiment: (PERIODS as readonly string[]).includes(saved)
      ? (saved as (typeof PERIODS)[number])
      : "7d",
  });
  if (!data) return null;
  const period = Number.parseInt(view.sentiment, 10);
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
  const sum = (row: (typeof rows)[number], side: "current" | "previous") =>
    SENTIMENTS.reduce((n, s) => n + row[side][s].mentions, 0);
  const total = (side: "current" | "previous") =>
    rows.reduce((n, row) => n + sum(row, side), 0);
  const tickers = (side: "current" | "previous") =>
    rows.filter((row) => sum(row, side) > 0).length;
  const counted = new Set(rows.flatMap((row) => row.mentionIds));
  const daily = dailyCounts(
    data.snapshot.mentions
      .filter((m) => counted.has(m.id) && m.publishedAt)
      .map((m) => m.publishedAt!),
    data.cost.context.now,
    period,
  );
  return (
    <section className="yi-panel">
      <div className="yi-section-title">
        <h2>Sentiment shift</h2>
        <label className="yi-inline-label">
          Period
          <select
            value={view.sentiment}
            onChange={(e) =>
              setView({ sentiment: PeriodState.shape.sentiment.parse(e.target.value) })
            }
          >
            {PERIODS.map((value) => (
              <option value={value} key={value}>
                {Number.parseInt(value, 10)} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="yi-muted">
        Creator stances this period compared with the preceding {period} days.
        Mentions and creators are counted separately.
      </p>
      <StatTiles
        label={`Sentiment shift headline, last ${period} days`}
        tiles={[
          {
            label: "Mentions",
            value: total("current").toLocaleString("en-US"),
            current: total("current"),
            prior: total("previous"),
            children: (
              <Sparkline
                values={daily}
                label={`Mentions per day over the last ${period} days`}
              />
            ),
          },
          {
            label: "Tickers",
            value: tickers("current").toLocaleString("en-US"),
            current: tickers("current"),
            prior: tickers("previous"),
          },
        ]}
      />
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
              <SplitBar
                label={row.ticker}
                noun="mention"
                calls={{
                  bullish: row.current.bullish.mentions,
                  neutral: row.current.neutral.mentions,
                  bearish: row.current.bearish.mentions,
                }}
                creators={{
                  bullish: row.current.bullish.creators,
                  neutral: row.current.neutral.creators,
                  bearish: row.current.bearish.creators,
                }}
              />
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
