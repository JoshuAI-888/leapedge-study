"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { Sparkline } from "./Sparkline.tsx";
import { PinButton } from "./PinButton.tsx";
import { SENTIMENTS, SENTIMENT_GLYPH } from "./foundations.ts";
import { sessionLabel } from "../trading-day.ts";
import {
  SPARK_SESSIONS,
  formatChange,
  type WatchRow,
  type Watchlist as WatchlistData,
} from "../watchlist.ts";

const day = (date: string) => sessionLabel(date).replace(" · US session", "");
const TABS = [
  { id: "pinned", label: "Pinned" },
  { id: "mentioned", label: "Mentioned today" },
] as const;

/**
 * Today's watchlist (F68), at the top of the right-hand rail. Pinned is the
 * team watchlist; Mentioned today is every instrument with a call in the
 * current US session. Price change is signed ink text and the sparkline is
 * one neutral ink, so colour keeps its one meaning (sentiment). On a phone the
 * rows become a horizontal scroller of tiles.
 */
export function Watchlist() {
  const { data } = useWorkspace();
  const [list, setList] = useState<WatchlistData | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"pinned" | "mentioned" | null>(null);
  useEffect(() => {
    let live = true;
    action<WatchlistData>("market", "watchlist")
      .then((w) => {
        if (!live) return;
        setList(w);
        setError("");
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [data]);
  const current =
    tab ?? (list && !list.pinned.length && list.mentioned.length ? "mentioned" : "pinned");
  const rows = list ? list[current] : [];
  return (
    <section className="yi-panel yi-watchlist" aria-labelledby="yi-watchlist-title">
      <div className="yi-section-title">
        <h2 id="yi-watchlist-title">Watchlist</h2>
      </div>
      <div className="yi-watchlist-tabs" role="tablist" aria-label="Watchlist view">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`yi-watchlist-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls="yi-watchlist-panel"
            tabIndex={current === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const next = t.id === "pinned" ? "mentioned" : "pinned";
              setTab(next);
              document.getElementById(`yi-watchlist-tab-${next}`)?.focus();
            }}
          >
            {t.label}
            {list && <span className="yi-watchlist-count">{list[t.id].length}</span>}
          </button>
        ))}
      </div>
      <div
        id="yi-watchlist-panel"
        role="tabpanel"
        aria-labelledby={`yi-watchlist-tab-${current}`}
      >
        {error ? (
          <p className="yi-warning" role="alert">
            The watchlist could not be loaded: {error}
          </p>
        ) : !list ? (
          <p className="yi-muted" role="status">
            Loading watchlist…
          </p>
        ) : rows.length ? (
          <ul className="yi-watchlist-rows" key={current}>
            {rows.map((r) => (
              <WatchRowItem key={r.key} row={r} closesTo={list.closesTo} />
            ))}
          </ul>
        ) : current === "pinned" ? (
          <p className="yi-muted yi-watchlist-empty">
            Nothing pinned yet. Use ☆ beside a ticker to pin it to the team
            watchlist.
          </p>
        ) : (
          <p className="yi-muted yi-watchlist-empty">
            No calls yet in the {day(list.session)} session.
          </p>
        )}
      </div>
      {list && (
        <p className="yi-watchlist-foot">
          {list.closesTo
            ? `Closes to ${day(list.closesTo)} · up to ${SPARK_SESSIONS} sessions`
            : "No stored closes for these instruments"}{" "}
          · calls in the {day(list.session)} session
        </p>
      )}
    </section>
  );
}

/**
 * One row. The footnote carries the common "Closes to <date>"; a row whose
 * newest close is older than that says so itself, so a stale price is never
 * read as today's.
 */
function WatchRowItem({ row: r, closesTo }: { row: WatchRow; closesTo: string | null }) {
  const total = r.mentions.bullish + r.mentions.neutral + r.mentions.bearish;
  const name = r.ticker ?? r.instrument ?? r.key;
  return (
    <li className="yi-watchlist-row">
      <span className="yi-watchlist-name">
        <InstrumentLabel claim={{ ticker: r.ticker, instrument: r.instrument }} />
        <PinButton ticker={r.ticker} />
      </span>
      {r.closes.length ? (
        <>
          <Sparkline
            values={r.closes}
            width={64}
            height={20}
            label={`${name} adjusted close, last ${r.closes.length} sessions to ${r.closeDate ? day(r.closeDate) : "the latest close"}`}
          />
          <span
            className="yi-watchlist-change"
            title={
              r.closeDate
                ? `1-day change in adjusted close to ${day(r.closeDate)}`
                : undefined
            }
          >
            {formatChange(r.dayChange)}
          </span>
        </>
      ) : (
        <span className="yi-watchlist-noprice" title="No stored price series for this instrument">
          No price
        </span>
      )}
      <span
        className="yi-watchlist-mentions"
        title={
          total
            ? SENTIMENTS.map((s) => `${r.mentions[s]} ${s}`).join(" · ") + " calls today"
            : "No calls today"
        }
      >
        {total ? (
          <>
            <span className="yi-sr-only">{total} calls today: </span>
            {SENTIMENTS.filter((s) => r.mentions[s] > 0).map((s) => (
              <span key={s} className={`yi-watchlist-glyph yi-watchlist-${s}`}>
                {r.mentions[s]} {SENTIMENT_GLYPH[s]}
                <span className="yi-sr-only"> {s}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="yi-muted">No calls today</span>
        )}
      </span>
      {r.closeDate && r.closeDate !== closesTo && (
        <span className="yi-watchlist-closes">Closes to {day(r.closeDate)}</span>
      )}
      {r.divergence && (
        <span className="yi-chip yi-watchlist-flag" title={r.divergence.detail}>
          Creators vs price
        </span>
      )}
    </li>
  );
}
