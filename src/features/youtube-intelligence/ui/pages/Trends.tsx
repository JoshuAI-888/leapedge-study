"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { getAction } from "../get-action.ts";
import { useUrlState } from "../url-state.ts";
import { Empty, MetricHeading, PageTitle } from "../components.tsx";
import { SplitBar } from "../SplitBar.tsx";
import { StatTiles } from "../StatTiles.tsx";
import { HiddenByFilter } from "../HiddenByFilter.tsx";
import { InstrumentLabel } from "../InstrumentLabel.tsx";
import { TradingDay } from "../TradingDay.tsx";
import { trustOptionLabel } from "../foundations.ts";
import {
  CallDotTimeline,
  PriceCallChart,
  SENTIMENT_GLYPH,
  SentimentColumns,
  type ChartCall,
} from "../charts.tsx";
import { sessionFor } from "../../trading-day.ts";
import { analysisHref } from "../../report.ts";
import {
  TREND_RANGES,
  TREND_VIEWS,
  periodInstants,
  periodLabel,
  periodUnit,
  priorRange,
  rangeSessions,
  sessionInstants,
  trendDelta,
  trendsState,
  typicalConviction,
  type TrendBucket,
  type TrendRange,
  type TrendView,
} from "../../trends-series.ts";
import type {
  CallRow,
  SeriesPoint,
} from "../../../../server/youtube-intelligence/repos/research-query.ts";

type Aggregates = {
  calls: number;
  creators: number;
  sentiment: Record<"bullish" | "neutral" | "bearish", { calls: number; creators: number }>;
  conviction: Record<string, number>;
};
type CallsResult = { rows: CallRow[]; total: number; nextOffset: number | null; aggregates: Aggregates };
type SeriesResult = {
  buckets: TrendBucket[];
  total: number;
  points: (SeriesPoint & { at: string; session: string })[];
  truncated: boolean;
};
type Index = {
  instruments: { instrument: string; kind: string; calls: number }[];
  channels: { channelId: string; title: string | null; calls: number }[];
};
type Prices = { ticker: string; prices: { date: string; close: number }[] };

const TRUST = ["L0", "L1", "L2", "L3"] as const;
export const TrendsState = z.object({
  by: z.enum(TREND_VIEWS),
  value: z.string().max(100),
  range: z.enum(TREND_RANGES),
  trust: z.enum(TRUST),
});
const DEFAULTS: z.output<typeof TrendsState> = { by: "ticker", value: "", range: "90d", trust: "L1" };
const VIEW_LABEL: Record<TrendView, string> = { ticker: "Ticker", channel: "Channel", sentiment: "Sentiment" };
const RANGE_LABEL: Record<TrendRange, string> = { "1d": "1d", "7d": "7d", "30d": "30d", "90d": "90d", "1y": "1y", all: "All" };

export function Trends() {
  return (
    <Suspense fallback={<p role="status">Loading trends…</p>}>
      <TrendsPage />
    </Suspense>
  );
}

/** The query filters for a view: one instrument, one channel, or one sentiment (or all calls). */
export function viewFilter(by: TrendView, value: string) {
  if (!value) return {};
  if (by === "ticker") return { instruments: [value] };
  if (by === "channel") return { channels: [value] };
  return { sentiments: [value] };
}

function TrendsPage() {
  const [state, setState] = useUrlState(TrendsState, DEFAULTS);
  const [index, setIndex] = useState<Index | null>(null);
  useEffect(() => {
    getAction<Index>("query", "searchIndex", { instruments: 300, videos: 1 })
      .then(setIndex)
      .catch(() => setIndex({ instruments: [], channels: [] }));
  }, []);
  const value =
    state.value ||
    (state.by === "ticker"
      ? (index?.instruments[0]?.instrument ?? "")
      : state.by === "channel"
        ? (index?.channels.find((c) => c.calls > 0)?.channelId ?? "")
        : "");
  const valueLabel =
    state.by === "channel"
      ? (index?.channels.find((c) => c.channelId === value)?.title ?? value)
      : state.by === "sentiment"
        ? value
          ? `${SENTIMENT_GLYPH[value as "bullish"]} ${value}`
          : "All calls"
        : value;
  return (
    <>
      <PageTitle
        title="Trends"
        description="How creator sentiment on an instrument, a channel or the whole market moves over time."
      />
      <div className="yi-filters yi-trends-filters" role="group" aria-label="Trends view">
        <label>
          View by
          <select
            value={state.by}
            onChange={(e) => setState({ by: e.target.value as TrendView, value: "" })}
          >
            {TREND_VIEWS.map((v) => (
              <option key={v} value={v}>
                {VIEW_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {state.by === "ticker" ? "Instrument" : state.by === "channel" ? "Channel" : "Sentiment"}
          <select value={value} onChange={(e) => setState({ value: e.target.value })}>
            {state.by === "ticker" &&
              (index?.instruments ?? []).map((i) => (
                <option key={i.instrument} value={i.instrument}>
                  {i.instrument} ({i.calls})
                </option>
              ))}
            {state.by === "channel" &&
              (index?.channels ?? [])
                .filter((c) => c.calls > 0)
                .map((c) => (
                  <option key={c.channelId} value={c.channelId}>
                    {c.title ?? c.channelId} ({c.calls})
                  </option>
                ))}
            {state.by === "sentiment" && (
              <>
                <option value="">All calls</option>
                <option value="bullish">▲ Bullish</option>
                <option value="neutral">● Neutral</option>
                <option value="bearish">▼ Bearish</option>
              </>
            )}
            {!index && <option value={value}>{value || "Loading…"}</option>}
          </select>
        </label>
        <fieldset className="yi-range-chips">
          <legend>Range</legend>
          {TREND_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={state.range === r}
              onClick={() => setState({ range: r })}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </fieldset>
        <label>
          Trust at least
          <select value={state.trust} onChange={(e) => setState({ trust: e.target.value as "L1" })}>
            {TRUST.map((t) => (
              <option key={t} value={t}>
                {trustOptionLabel(t)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {index && !value && state.by !== "sentiment" ? (
        <Empty title="Nothing to chart yet">
          Trends appear once analysed videos have calls.
        </Empty>
      ) : index ? (
        <TrendsView
          by={state.by}
          value={value}
          valueLabel={valueLabel}
          range={state.range}
          trust={state.trust}
          onReveal={() => setState({ trust: "L0" })}
        />
      ) : (
        <p role="status">Loading…</p>
      )}
    </>
  );
}

/**
 * Everything below the filter row, for one view. The channel page (F66)
 * reuses it with the channel preset.
 */
export function TrendsView({
  by,
  value,
  valueLabel,
  range,
  trust,
  onReveal,
  embedded = false,
}: {
  by: TrendView;
  value: string;
  valueLabel: string;
  range: TrendRange;
  trust: (typeof TRUST)[number];
  onReveal?: () => void;
  /** On the channel page: the chart only, without tiles or the call list. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [series, setSeries] = useState<SeriesResult | null>(null),
    [totals, setTotals] = useState<{ now: Aggregates; prior: Aggregates | null; all: number } | null>(null),
    [prices, setPrices] = useState<Prices | null>(null),
    [list, setList] = useState<CallsResult | null>(null),
    [period, setPeriod] = useState<TrendBucket | null>(null),
    [view, setView] = useState<"chart" | "table">("chart"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false);
  const current = useMemo(() => sessionFor(new Date()).session, []);
  const unit = periodUnit(range);
  const span = rangeSessions(range, current);
  const prior = priorRange(range, current);
  const filter = useMemo(() => viewFilter(by, value), [by, value]);
  const key = JSON.stringify([by, value, range, trust]);
  const ticket = useRef(0);
  useEffect(() => {
    const mine = ++ticket.current;
    setLoading(true);
    setPeriod(null);
    const base = { ...filter, minTrust: trust };
    const instants = sessionInstants(span.from, span.to);
    Promise.all([
      getAction<SeriesResult>("query", "series", {
        ...base,
        ...instants,
        bucket: unit === "week" ? "week" : "day",
        sessions: true,
        pointCap: 1000,
      }),
      getAction<CallsResult>("query", "calls", { ...base, ...instants, limit: 1 }),
      prior
        ? getAction<CallsResult>("query", "calls", { ...base, ...sessionInstants(prior.from, prior.to), limit: 1 })
        : Promise.resolve(null),
      trust === "L0"
        ? Promise.resolve(null)
        : getAction<CallsResult>("query", "calls", { ...filter, ...instants, limit: 1 }),
      by === "ticker"
        ? getAction<Prices>("market", "priceSeries", {
            ticker: value,
            ...(span.from ? { from: span.from } : {}),
            to: span.to,
          }).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([s, now, before, all, p]) => {
        if (mine !== ticket.current) return;
        setSeries(s);
        setTotals({
          now: now.aggregates,
          prior: before?.aggregates ?? null,
          all: all?.aggregates.calls ?? now.aggregates.calls,
        });
        setPrices(p);
        setError("");
      })
      .catch((e: Error) => mine === ticket.current && setError(e.message))
      .finally(() => mine === ticket.current && setLoading(false));
    // key captures every input; span/prior derive from range and current.
  }, [key]);
  // The drill list: the whole view, or the period a column click selected.
  useEffect(() => {
    const instants = period
      ? periodInstants(period)
      : sessionInstants(span.from, span.to);
    getAction<CallsResult>("query", "calls", { ...filter, minTrust: trust, ...instants, limit: 50 })
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [key, period?.start]);

  if (error)
    return (
      <p className="yi-warning" role="alert">
        Trends could not be loaded: {error}
      </p>
    );
  if (!series || !totals) return <p role="status">Loading…</p>;
  const now = totals.now;
  const state = trendsState(now.calls);
  const typical = typicalConviction(now.conviction);
  const hidden = Math.max(0, totals.all - now.calls);
  const domainFrom = series.buckets[0]?.start ?? span.from ?? current;
  const domainTo = series.buckets.at(-1)?.end ?? current;
  const chartCalls: ChartCall[] = series.points.map((p) => ({
    id: p.id,
    session: p.session,
    sentiment: p.sentiment,
    conviction: p.conviction,
    stance: p.stance,
    thesis: p.thesis,
    channel: p.channelTitle,
    href: analysisHref(p.runId, p.id.slice(p.runId.length + 1)),
  }));
  const open = (c: ChartCall) => router.push(c.href);
  const split = {
    bullish: now.sentiment.bullish.calls,
    neutral: now.sentiment.neutral.calls,
    bearish: now.sentiment.bearish.calls,
  };
  const creators = {
    bullish: now.sentiment.bullish.creators,
    neutral: now.sentiment.neutral.creators,
    bearish: now.sentiment.bearish.creators,
  };
  return (
    <div className={`yi-trends${loading ? " yi-refetching" : ""}`} aria-busy={loading}>
      {onReveal && !embedded && (
        <HiddenByFilter
          count={hidden}
          filter={`the ${trustOptionLabel(trust)} trust filter`}
          onReveal={onReveal}
        />
      )}
      {!embedded && <StatTiles
        label={`${valueLabel}, ${RANGE_LABEL[range]}`}
        tiles={[
          {
            label: "Calls",
            value: now.calls.toLocaleString("en-US"),
            note: trendDelta(now.calls, totals.prior?.calls ?? null, range) ?? "No prior period",
          },
          {
            label: "Sentiment",
            value: <SplitBar calls={split} creators={creators} label={valueLabel} />,
          },
          {
            label: "Typical conviction",
            value: typical ? typical.level[0].toUpperCase() + typical.level.slice(1) : "Not stated",
            note: typical ? `${Math.round(typical.share * 100)}% of rated calls` : "No rated calls",
          },
          {
            label: "Creators",
            value: now.creators.toLocaleString("en-US"),
            note: trendDelta(now.creators, totals.prior?.creators ?? null, range) ?? "No prior period",
          },
        ]}
      />}
      {state === "chart" ? (
        <section className="yi-panel yi-trends-chart" aria-labelledby="yi-trends-chart">
          <div className="yi-section-title">
            <h2 id="yi-trends-chart">
              Calls per {unit === "week" ? "week" : "session"} by sentiment
            </h2>
            <div className="yi-view-switch" role="group" aria-label="Chart or table">
              <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                Chart
              </button>
              <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
                Table
              </button>
            </div>
          </div>
          {view === "chart" ? (
            <>
              <p className="yi-chart-legend" aria-hidden="true">
                <span><i className="yi-key yi-key-bullish" /> ▲ Bullish above the line</span>
                <span><i className="yi-key yi-key-bearish" /> ▼ Bearish below</span>
                <span className="yi-muted">Neutral counts in the tooltip and table</span>
              </p>
              <SentimentColumns
                buckets={series.buckets}
                unit={unit}
                from={domainFrom}
                to={domainTo}
                selected={period?.start ?? null}
                onSelect={setPeriod}
                label={`${valueLabel}: calls per ${unit === "week" ? "week" : "session"}, bullish above and bearish below the zero line`}
              />
              {by === "ticker" ? (
                prices?.prices.length ? (
                  <div className="yi-trends-price">
                    <h3>{value} adjusted close · each call placed on the line</h3>
                    <PriceCallChart
                      prices={prices.prices}
                      calls={chartCalls}
                      from={domainFrom}
                      to={domainTo}
                      symbol={value}
                      onOpen={open}
                    />
                    <p className="yi-muted yi-chart-note">
                      Dot size is creator conviction · colour and ▲ ● ▼ are sentiment · select a dot to open the call.
                    </p>
                  </div>
                ) : (
                  <p className="yi-muted yi-chart-note">No price series for {valueLabel}.</p>
                )
              ) : (
                <div className="yi-trends-price">
                  <h3>Each call on the same dates · lanes ▲ bullish, ● neutral, ▼ bearish</h3>
                  <CallDotTimeline
                    calls={chartCalls}
                    from={domainFrom}
                    to={domainTo}
                    onOpen={open}
                    label={`${valueLabel}: each call by sentiment lane`}
                  />
                </div>
              )}
              {series.truncated && (
                <p className="yi-muted yi-chart-note">
                  Dots show the newest {series.points.length} of {series.total} calls; the columns count all of them.
                </p>
              )}
            </>
          ) : (
            <PeriodTable buckets={series.buckets} unit={unit} onSelect={setPeriod} />
          )}
        </section>
      ) : state === "thin" ? (
        <p className="yi-notice">
          Only {now.calls} call{now.calls === 1 ? "" : "s"} in this range, too few to chart. They are listed below.
        </p>
      ) : (
        <Empty title="No calls in this range">
          Try a longer range{trust !== "L0" ? " or a lower trust level" : ""}.
        </Empty>
      )}
      {!embedded && list && (list.total > 0 || period) && (
        <section className="yi-panel" aria-labelledby="yi-trends-list">
          <div className="yi-section-title">
            <h2 id="yi-trends-list">
              {period
                ? `${list.total} call${list.total === 1 ? "" : "s"} ${unit === "week" ? "in" : "on"} ${periodLabel(period.start, unit).replace("Week of", "the week of")}`
                : `${list.total} call${list.total === 1 ? "" : "s"} behind this view`}
            </h2>
            {period && (
              <button type="button" className="yi-secondary" onClick={() => setPeriod(null)}>
                Show the whole range
              </button>
            )}
            {/* TODO(F63): Export menu here once ui/ExportMenu.tsx is on this branch (scope: these calls). */}
          </div>
          <ul className="yi-trends-calls">
            {list.rows.map((c) => (
              <CallItem key={c.id} call={c} showChannel={by !== "channel"} />
            ))}
          </ul>
          {list.nextOffset !== null && (
            <button
              type="button"
              className="yi-secondary"
              disabled={more}
              onClick={() => {
                setMore(true);
                const instants = period
                  ? periodInstants(period)
                  : sessionInstants(span.from, span.to);
                getAction<CallsResult>("query", "calls", {
                  ...filter,
                  minTrust: trust,
                  ...instants,
                  limit: 50,
                  offset: list.nextOffset,
                })
                  .then((next) => setList({ ...next, rows: [...list.rows, ...next.rows] }))
                  .finally(() => setMore(false));
              }}
            >
              Load 50 more · showing {list.rows.length} of {list.total}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function PeriodTable({
  buckets,
  unit,
  onSelect,
}: {
  buckets: TrendBucket[];
  unit: "session" | "week";
  onSelect: (b: TrendBucket) => void;
}) {
  return (
    <div className="yi-table-wrap">
      <table>
        <caption className="yi-sr-only">Calls per {unit === "week" ? "week" : "session"} by sentiment</caption>
        <thead>
          <tr>
            <MetricHeading id="trends.period" />
            <MetricHeading id="trends.bullish" />
            <MetricHeading id="trends.neutral" />
            <MetricHeading id="trends.bearish" />
            <MetricHeading id="trends.calls" />
          </tr>
        </thead>
        <tbody>
          {[...buckets].reverse().map((b) => (
            <tr key={b.start}>
              <td>
                <button type="button" className="yi-text-button" onClick={() => onSelect(b)}>
                  {periodLabel(b.start, unit)}
                </button>
              </td>
              <td>{b.bullish}</td>
              <td>{b.neutral}</td>
              <td>{b.bearish}</td>
              <td>{b.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CallItem({
  call,
  showChannel = true,
}: {
  call: CallRow;
  showChannel?: boolean;
}) {
  const claimId = call.id.slice(call.runId.length + 1);
  return (
    <li className="yi-trends-call">
      <div className="yi-row">
        <InstrumentLabel claim={call} />
        <span className={`yi-chip yi-stance-${call.stance}`}>
          {SENTIMENT_GLYPH[call.sentiment]} {call.stance}
        </span>
        <span className="yi-muted">
          {showChannel && call.channelId && (
            <>
              <Link href={`/youtube-intelligence/channels/${encodeURIComponent(call.channelId)}`}>
                {call.channelTitle ?? "Unknown channel"}
              </Link>{" "}
              ·{" "}
            </>
          )}
          <TradingDay at={call.publishedAt ?? call.createdAt} /> · conviction {call.conviction}
        </span>
      </div>
      <Link href={analysisHref(call.runId, claimId)}>{call.thesis}</Link>
    </li>
  );
}
