"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  boardAsOf,
  diffBoards,
  type BoardSnapshot,
  type BoardOptions,
} from "../../leaderboard.ts";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import {
  BenchmarkSelector,
  Empty,
  Filters,
  PageTitle,
  MetricHeading,
  Collapsible,
} from "../components.tsx";
import { sentimentShift } from "../../metrics/sentiment-shift.ts";
import { csv, percent, sortTickerRows } from "../viewmodel.ts";
export function Leaderboard() {
  const { data, perform, busy } = useWorkspace();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"ticker" | "creator" | "changes">("ticker"),
    [record, setRecord] = useState<"forward" | "historical">("forward"),
    [horizon, setHorizon] = useState<90 | 180 | 365 | null>(null),
    [market, setMarket] = useState("all"),
    [trust, setTrust] = useState("L2"),
    [sort, setSort] = useState("medianExcess"),
    [desc, setDesc] = useState(true),
    [customDate, setCustomDate] = useState(""),
    [priceFrom, setPriceFrom] = useState(""),
    [priceTo, setPriceTo] = useState(""),
    [priceFailures, setPriceFailures] = useState<
      { ticker: string; reason: string }[]
    >([]);
  useEffect(() => {
    action<BoardSnapshot>("market", "boardSnapshot")
      .then((s) => {
        setSnapshot(s);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [data]);
  if (!data) return null;
  const changeWindow = Number(data.preferences.resolved.changeWindowDays) || 30;
  if (error)
    return (
      <>
        <PageTitle
          title="Leaderboard"
          description="Calls with enough evidence to support comparison."
        />
        <p className="yi-warning" role="alert">
          {error}
        </p>
        <button
          onClick={() => {
            setError("");
            void action<BoardSnapshot>("market", "boardSnapshot")
              .then(setSnapshot)
              .catch((e) => setError(e.message));
          }}
        >
          Retry leaderboard
        </button>
      </>
    );
  if (!snapshot) return <p role="status">Loading settled records…</p>;
  const options: BoardOptions = {
    asOf: snapshot.asOf,
    horizonDays: horizon ?? data.preferences.resolved.defaultHorizonDays,
    benchmark:
      data.preferences.resolved.benchmark === "sector-etf"
        ? "sector"
        : data.preferences.resolved.benchmark.replace(/^custom:/, ""),
    record,
    minimumTrust: trust as "L2",
    markets:
      market === "all" ? data.preferences.resolved.marketFilter : [market],
  };
  const board = boardAsOf(snapshot, options);
  const before = boardAsOf(snapshot, {
    ...options,
    asOf:
      customDate ||
      (typeof data.preferences.resolved.changeWindowDays === "string"
        ? data.preferences.resolved.changeWindowDays
        : "") ||
      new Date(Date.parse(snapshot.asOf) - changeWindow * 86400000)
        .toISOString()
        .slice(0, 10),
  });
  const changes = diffBoards(before, board);
  const shifts = sentimentShift(snapshot.mentions, {
    asOf: snapshot.asOf,
    periodDays: data.preferences.resolved.sentiment.periodDays,
    minimumTrust: trust,
  });
  const sentimentByTicker = new Map(
    shifts.map((row) => [row.ticker, row.direction]),
  );
  const tickerRows = sortTickerRows(
    board.tickers,
    sort,
    desc,
    sentimentByTicker,
  );
  const rows = [...board.creators].sort((a, b) => {
    const av =
      sort === "status"
        ? a.status
        : sort === "label"
          ? a.label
          : sort === "n"
            ? a.n
            : sort === "winRate"
              ? a.winRate
              : sort === "medianExcess"
                ? a.medianExcess
                : a.rank;
    const bv =
      sort === "status"
        ? b.status
        : sort === "label"
          ? b.label
          : sort === "n"
            ? b.n
            : sort === "winRate"
              ? b.winRate
              : sort === "medianExcess"
                ? b.medianExcess
                : b.rank;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (
      (typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv)) * (desc ? -1 : 1)
    );
  });
  const sortBy = (key: string) => {
    setSort(key);
    setDesc(sort === key ? !desc : false);
  };
  function exportRows() {
    const text =
      tab === "changes"
        ? csv(
            [
              "changes.kind",
              "changes.label",
              "changes.beforeRank",
              "changes.afterRank",
              "changes.callsAdded",
              "changes.reason",
            ],
            changes.map((r) => [
              r.kind,
              r.label,
              r.beforeRank,
              r.afterRank,
              r.callsAdded,
              r.reason,
            ]),
          )
        : tab === "ticker"
          ? csv(
              [
                "ticker.symbol",
                "sentiment.direction",
                "ticker.consensus",
                "ticker.creators",
                "board.settledCount",
                "board.medianExcess",
                "ticker.reliableCreator",
              ],
              tickerRows.map((r) => [
                r.ticker,
                sentimentByTicker.get(r.id) ?? null,
                r.consensus,
                r.creators,
                r.n,
                r.medianExcess,
                r.mostReliableCreator?.label ?? null,
              ]),
            )
          : csv(
              [
                "board.label",
                "board.rank",
                "board.settledCount",
                "board.winRate",
                "board.medianExcess",
                "board.status",
              ],
              rows.map((r) => [
                r.label,
                r.rank,
                r.n,
                r.winRate,
                r.medianExcess,
                r.status,
              ]),
            );
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `youtube-${tab}-${record}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <PageTitle
        title="Leaderboard"
        description="A track record needs time, enough calls, and a fair benchmark."
      >
        <Link href="/youtube-intelligence/methodology">Read methodology ↗</Link>
      </PageTitle>
      <div className="yi-tabs" role="tablist" aria-label="Leaderboard view">
        {(["ticker", "creator", "changes"] as const).map((v) => (
          <button
            role="tab"
            aria-selected={tab === v}
            key={v}
            onClick={() => {
              setTab(v);
              setSort(v === "ticker" ? "medianExcess" : "rank");
              setDesc(v === "ticker");
            }}
          >
            {v === "ticker"
              ? "By ticker"
              : v === "creator"
                ? "By creator"
                : "Changes"}
          </button>
        ))}
      </div>
      <Filters>
        <BenchmarkSelector />
        <label>
          Horizon
          <select
            value={options.horizonDays}
            onChange={(e) => setHorizon(Number(e.target.value) as 90)}
          >
            {[90, 180, 365].map((v) => (
              <option value={v} key={v}>
                {v} days
              </option>
            ))}
          </select>
        </label>
        <label>
          Record
          <select
            value={record}
            onChange={(e) => setRecord(e.target.value as typeof record)}
          >
            <option value="forward">Forward</option>
            <option value="historical">Historical</option>
          </select>
        </label>
        <label>
          Market
          <select value={market} onChange={(e) => setMarket(e.target.value)}>
            {["all", "us-stock", "us-etf", "hk", "cn-a", "other"].map((v) => (
              <option key={v} value={v}>
                {v === "all" ? "My markets" : v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum trust
          <select value={trust} onChange={(e) => setTrust(e.target.value)}>
            {["L0", "L1", "L2", "L3"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {tab === "changes" && (
          <label>
            Compare from date
            <input
              type="date"
              value={
                customDate ||
                (typeof data.preferences.resolved.changeWindowDays === "string"
                  ? data.preferences.resolved.changeWindowDays
                  : "")
              }
              max={snapshot.asOf.slice(0, 10)}
              onChange={(e) => {
                const date = e.target.value;
                setCustomDate(date);
                if (date)
                  void perform(
                    () =>
                      action("settings", "saveAccount", {
                        ...data.preferences.account,
                        changeWindowDays: date,
                      }),
                    "Comparison date saved.",
                  );
              }}
            />
          </label>
        )}
        {tab === "changes" && (
          <label>
            Change window
            <select
              value={changeWindow}
              onChange={(e) => {
                setCustomDate("");
                void perform(
                  () =>
                    action("settings", "saveAccount", {
                      ...data.preferences.account,
                      changeWindowDays: Number(e.target.value),
                    }),
                  "Change window saved.",
                );
              }}
            >
              {[7, 14, 30, 90, 180].map((v) => (
                <option key={v} value={v}>
                  {v} days
                </option>
              ))}
            </select>
          </label>
        )}
      </Filters>
      <Collapsible title="Refresh external price data">
        <p>
          This fetches prices for{" "}
          {new Set(snapshot.claims.map((c) => c.ticker).filter(Boolean)).size}{" "}
          stored instruments and the selected benchmark, then updates settlement
          observations. Provider quotas or charges may apply.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const response = await action<{
                result: { failures: { ticker: string; reason: string }[] };
              }>("market", "refreshBoardData", {
                benchmark: options.benchmark,
                ...(priceFrom ? { from: priceFrom } : {}),
                ...(priceTo ? { to: priceTo } : {}),
              });
              setPriceFailures(response.result.failures);
              setSnapshot(
                await action<BoardSnapshot>("market", "boardSnapshot"),
              );
            }, "Price refresh finished. Review any provider failures below.");
          }}
        >
          <div className="yi-settings-fields">
            <label>
              From (blank: earliest claim)
              <input
                type="date"
                value={priceFrom}
                onChange={(e) => setPriceFrom(e.target.value)}
                max={priceTo || snapshot.asOf.slice(0, 10)}
              />
            </label>
            <label>
              Through (blank: today)
              <input
                type="date"
                value={priceTo}
                onChange={(e) => setPriceTo(e.target.value)}
                min={priceFrom || undefined}
                max={snapshot.asOf.slice(0, 10)}
              />
            </label>
          </div>
          <button disabled={busy}>Fetch prices & update settlements</button>
        </form>
        {priceFailures.length > 0 && (
          <div className="yi-warning" role="alert">
            <strong>Some prices could not be refreshed</strong>
            <ul>
              {priceFailures.map((failure, i) => (
                <li key={`${failure.ticker}:${i}`}>
                  {failure.ticker}: {failure.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Collapsible>
      <div className="yi-section-title">
        <p className="yi-muted">
          As of {snapshot.asOf} · {record} observations
        </p>
        <button className="yi-secondary" onClick={exportRows}>
          Export CSV
        </button>
      </div>
      {tab === "changes" ? (
        changes.length ? (
          <div className="yi-card-grid">
            {changes.map((c) => (
              <article className="yi-panel" key={`${c.kind}:${c.id}`}>
                <h2>{c.label}</h2>
                <p className="yi-muted">
                  {c.kind} ·{" "}
                  {c.meaningful
                    ? "Meaningful change"
                    : "Below significance threshold"}
                </p>
                <p>{c.reason}</p>
                <p>
                  Rank {c.beforeRank ?? "unranked"} →{" "}
                  {c.afterRank ?? "unranked"} · {c.callsAdded} additional calls
                </p>
                <div className="yi-row">
                  {c.claimIds.map((id) => {
                    const claim = snapshot.claims.find((x) => x.id === id);
                    return claim ? (
                      <Link
                        key={id}
                        href={`/youtube-intelligence/analysis/${claim.runId}#${encodeURIComponent(id)}`}
                      >
                        {claim.ticker} evidence ↗
                      </Link>
                    ) : null;
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No changes in this window">
            Both dates need sufficient settled observations before movement can
            be assessed.
          </Empty>
        )
      ) : tab === "ticker" ? (
        tickerRows.length ? (
          <div className="yi-table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    ["label", "ticker.symbol"],
                    ["sentiment", "sentiment.direction"],
                    ["consensus", "ticker.consensus"],
                    ["creators", "ticker.creators"],
                    ["n", "board.settledCount"],
                    ["medianExcess", "board.medianExcess"],
                    ["reliable", "ticker.reliableCreator"],
                  ].map(([key, id]) => (
                    <MetricHeading
                      key={key}
                      id={id}
                      onSort={() => sortBy(key)}
                      direction={
                        sort === key ? (desc ? "desc" : "asc") : undefined
                      }
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickerRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <details>
                        <summary>
                          <strong>{row.ticker}</strong>
                        </summary>
                        <p>
                          95% win interval:{" "}
                          {row.wilson
                            ? `${percent(row.wilson.low)} – ${percent(row.wilson.high)}`
                            : "Not measured"}
                        </p>
                        <p>Mean excess: {percent(row.meanExcess)}</p>
                        <p>
                          Adjusted significance:{" "}
                          {row.q === null ? "Not measured" : row.q.toFixed(4)}
                        </p>
                        <div className="yi-evidence-links">
                          {row.claimIds.map((id) => {
                            const claim = snapshot.claims.find(
                              (c) => c.id === id,
                            );
                            return claim ? (
                              <Link
                                key={id}
                                href={`/youtube-intelligence/analysis/${claim.runId}#${encodeURIComponent(id)}`}
                              >
                                {claim.ticker} · source ↗
                              </Link>
                            ) : null;
                          })}
                        </div>
                      </details>
                    </td>
                    <td>
                      {sentimentByTicker.get(row.id) ?? "No observations"}
                      <small style={{ display: "block" }}>
                        {data.preferences.resolved.sentiment.periodDays} days
                      </small>
                    </td>
                    <td>{row.consensus}</td>
                    <td>{row.creators}</td>
                    <td>{row.n}</td>
                    <td>{percent(row.medianExcess)}</td>
                    <td>
                      {row.mostReliableCreator &&
                      row.mostReliableCreator.n >= 10 ? (
                        <>
                          <strong>{row.mostReliableCreator.label}</strong>
                          <small style={{ display: "block" }}>
                            n={row.mostReliableCreator.n} ·{" "}
                            {percent(row.mostReliableCreator.winRate)} win rate
                          </small>
                          <span className="yi-chip">
                            {row.mostReliableCreator.status === "not-yet"
                              ? "Not enough statistical support"
                              : row.mostReliableCreator.status}
                          </span>
                        </>
                      ) : (
                        "Insufficient sample (n < 10)"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No eligible ticker records">
            Try another market, record or trust filter.
          </Empty>
        )
      ) : rows.length ? (
        <div className="yi-table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  ["label", "board.label"],
                  ["rank", "board.rank"],
                  ["n", "board.settledCount"],
                  ["winRate", "board.winRate"],
                  ["medianExcess", "board.medianExcess"],
                  ["status", "board.status"],
                ].map(([key, id]) => (
                  <MetricHeading
                    key={key}
                    id={id}
                    onSort={() => sortBy(key)}
                    direction={
                      sort === key ? (desc ? "desc" : "asc") : undefined
                    }
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <details>
                      <summary>
                        <strong>{r.label}</strong>
                      </summary>
                      <p>
                        95% win interval:{" "}
                        {r.wilson
                          ? `${percent(r.wilson.low)} – ${percent(r.wilson.high)}`
                          : "Not measured"}
                      </p>
                      <p>Mean excess: {percent(r.meanExcess)}</p>
                      <p>
                        Adjusted significance:{" "}
                        {r.q === null ? "Not measured" : r.q.toFixed(4)}
                      </p>
                      <div className="yi-evidence-links">
                        {r.claimIds.map((id) => {
                          const claim = snapshot.claims.find(
                            (c) => c.id === id,
                          );
                          return claim ? (
                            <Link
                              key={id}
                              href={`/youtube-intelligence/analysis/${claim.runId}#${encodeURIComponent(id)}`}
                            >
                              {claim.ticker} · source ↗
                            </Link>
                          ) : null;
                        })}
                      </div>
                    </details>
                  </td>
                  <td>{r.rank ?? "—"}</td>
                  <td>{r.n}</td>
                  <td>{percent(r.winRate)}</td>
                  <td>{percent(r.medianExcess)}</td>
                  <td>
                    {r.status === "not-yet"
                      ? "Not enough support yet"
                      : r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No eligible settled calls">
          Try a different record, market or trust filter. Unsettled calls are
          not treated as losses or zero returns.
        </Empty>
      )}
      <p className="yi-muted">
        Default sort:{" "}
        {tab === "ticker"
          ? "median excess descending; unmeasured values last"
          : "supported rank ascending; unranked rows last"}
        . Returns are historical observations, not forecasts.
      </p>
    </>
  );
}
