"use client";
import Link from "next/link";
import { z } from "zod";
import { useWorkspace } from "./workspace.tsx";
import {
  SENTIMENT_PERIODS,
  emptyTitle,
  periodFromDays,
  sentimentForPeriod,
} from "../metrics/sentiment-window.ts";
import { Empty } from "./components.tsx";
import { useUrlState } from "./url-state.ts";
import { SplitBar } from "./SplitBar.tsx";
import { StatTiles } from "./StatTiles.tsx";
import { Sparkline } from "./Sparkline.tsx";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { dailyCounts, SENTIMENTS } from "./foundations.ts";
import { dateLabel } from "./viewmodel.ts";
/**
 * The period is view state in the URL (decision D4), seeded from the saved
 * setting. 24h (F69) is the US session window: since the previous close.
 */
const PeriodState = z.object({ sentiment: z.enum(SENTIMENT_PERIODS) });
export function SentimentPanel() {
  const { data } = useWorkspace();
  const [view, setView] = useUrlState(PeriodState, {
    sentiment: periodFromDays(data?.preferences.resolved.sentiment.periodDays),
  });
  if (!data) return null;
  const canonical = new Set(data.snapshot.runs.map((r) => r.id));
  const levels = {
    "text-checked": "L1",
    "audio-agreed": "L2",
    "human-verified": "L3",
  };
  const { windows, rows } = sentimentForPeriod(
    data.snapshot.mentions.filter((m) => canonical.has(m.runId)),
    {
      period: view.sentiment,
      asOf: data.cost.context.now,
      minimumTrust: levels[data.preferences.resolved.sentiment.minimumTrust],
    },
  );
  const days = view.sentiment === "24h" ? 0 : Number.parseInt(view.sentiment, 10);
  const sum = (row: (typeof rows)[number], side: "current" | "previous") =>
    SENTIMENTS.reduce((n, s) => n + row[side][s].mentions, 0);
  const total = (side: "current" | "previous") =>
    rows.reduce((n, row) => n + sum(row, side), 0);
  const tickers = (side: "current" | "previous") =>
    rows.filter((row) => sum(row, side) > 0).length;
  const counted = new Set(rows.flatMap((row) => row.mentionIds));
  const daily = days
    ? dailyCounts(
        data.snapshot.mentions
          .filter((m) => counted.has(m.id) && m.publishedAt)
          .map((m) => m.publishedAt!),
        data.cost.context.now,
        days,
      )
    : null;
  return (
    <section className="yi-panel yi-sentiment-panel">
      <div className="yi-section-title">
        <h2>Sentiment shift</h2>
        <div className="yi-segmented" role="group" aria-label="Sentiment period">
          {SENTIMENT_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view.sentiment === value}
              title={
                value === "24h"
                  ? "Since the previous US session close"
                  : `Last ${Number.parseInt(value, 10)} days`
              }
              onClick={() => setView({ sentiment: value })}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <p className="yi-muted">
        Creator stances {windows.label}, compared with {windows.priorLabel}.
        Mentions and creators are counted separately.
      </p>
      <StatTiles
        label={`Sentiment shift headline, ${windows.label}`}
        tiles={[
          {
            label: "Mentions",
            value: total("current").toLocaleString("en-US"),
            current: total("current"),
            prior: total("previous"),
            children: daily ? (
              <Sparkline
                values={daily}
                label={`Mentions per day over the last ${days} days`}
              />
            ) : undefined,
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
        <ul className="yi-sentiment-rows">
          {rows.map((row) => (
            <li key={row.ticker}>
              <div className="yi-sentiment-row">
                <InstrumentLabel claim={{ ticker: row.ticker, instrument: row.ticker }} />
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
                <span className="yi-sentiment-creators">
                  {row.creators} creator{row.creators === 1 ? "" : "s"}
                </span>
                <span
                  className="yi-sentiment-change"
                  title={`Distinct creators ${windows.label} against ${windows.priorLabel}. Net lean: ${row.direction}.`}
                >
                  {row.change}
                </span>
              </div>
              <details className="yi-sentiment-evidence">
                <summary>Evidence ({row.mentionIds.length})</summary>
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
                        {mention.publishedAt
                          ? dateLabel(mention.publishedAt)
                          : mention.stance}
                      </Link>
                    ) : null;
                  })}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={emptyTitle(windows)}>
          Eligible source-linked mentions will appear here after analysis.
        </Empty>
      )}
    </section>
  );
}
