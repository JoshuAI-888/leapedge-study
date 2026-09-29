"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { z } from "zod";
import { useWorkspace } from "../workspace.tsx";
import { action, readAction } from "../api.ts";
import {
  ConvictionChip,
  Empty,
  Filters,
  LevelChips,
  NoteEditor,
  PageTitle,
  TrustBadge,
} from "../components.tsx";
import { InstrumentLabel } from "../InstrumentLabel.tsx";
import { TradingDay } from "../TradingDay.tsx";
import { useUrlState } from "../url-state.ts";
import { dateLabel } from "../viewmodel.ts";
import { describeInstrument } from "../../instrument-kind.ts";
import { sessionFor } from "../../trading-day.ts";
import {
  SAVED_TABS,
  SAVED_TAB_LABELS,
  callDate,
  expiringSoonest,
  expiryBadgeText,
  groupBySession,
  inTab,
  sinceSavedDetail,
  sinceSavedText,
  tabCounts,
  type DateBasis,
  type SavedTab,
  type SinceSaved,
} from "../../saved-calls.ts";
import type { ClaimData } from "../../contracts.ts";
import type { ClaimRow } from "../../../../server/youtube-intelligence/repos/claims.ts";
import type { SavedSinceRow } from "../../../../server/youtube-intelligence/saved-calls.ts";

type Idea = Record<string, unknown> & { id: string; status?: unknown };
type Level = { kind: string; valueOriginal?: string; value_original?: string };
/** The card's content: the published claim row where loaded, else the saved copy. */
type CallView = {
  idea: Idea;
  at: string | null;
  basis: DateBasis;
  session: string | null;
  ticker: string | null;
  instrument: string | null;
  macroTheme: string | null;
  stance: string;
  thesis: string;
  conviction: string | null;
  horizon: string | null;
  action: string | null;
  levels: Level[];
  catalysts: string[];
  expiryDate: string | null;
  expiryOriginal: string | null;
  trust: ClaimRow | undefined;
  /** The priced symbol, or null for themes and unresolved names. */
  priceTicker: string | null;
};
function callView(idea: Idea, row: ClaimRow | undefined): CallView {
  const c = (idea.claim ?? {}) as Partial<ClaimData>;
  const { at, basis } = callDate(idea, row?.publishedAt);
  let session: string | null = null;
  try {
    session = at ? sessionFor(at).session : null;
  } catch {
    session = null;
  }
  const ticker = row?.ticker ?? c.ticker ?? null;
  const instrument = row?.instrument ?? c.instrument_as_spoken ?? null;
  const macroTheme = row?.macroTheme ?? c.macro_theme ?? null;
  const described = describeInstrument({ ticker, instrument, macroTheme });
  return {
    idea,
    at,
    basis,
    session,
    ticker,
    instrument,
    macroTheme,
    stance: row?.stance ?? c.stance ?? "neutral",
    thesis: row?.thesisEn ?? c.thesis_en ?? "",
    conviction: row?.creatorConviction ?? c.creator_conviction ?? null,
    horizon: row?.horizonEn ?? c.horizon_en ?? null,
    action: row?.actionEn ?? c.action_en ?? null,
    // A row written before F60 has empty call fields; the saved copy may not.
    levels: row?.levels?.length ? row.levels : (c.levels ?? []),
    catalysts: row?.catalystsEn?.length
      ? row.catalystsEn
      : (c.catalysts_en ?? []),
    expiryDate: row?.expiryDate ?? c.expiry?.date ?? null,
    expiryOriginal: row?.expiryOriginal ?? c.expiry?.original ?? null,
    trust: row,
    priceTicker:
      described.kind === "equity" || described.kind === "crypto"
        ? described.canonical
        : null,
  };
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const ViewState = z.object({
  tab: z.enum(SAVED_TABS),
  sort: z.enum(["session", "expiry"]),
});
const DEFAULTS = { tab: "open", sort: "session" } as const;
type Prices = Record<string, SinceSaved | "error">;
/** "since saved" for every priced call, read from stored prices in chunks. */
function useSinceSaved(calls: CallView[]): Prices | null {
  const wanted = useMemo(() => {
    const keys = new Map<string, { ticker: string; session: string }>();
    for (const c of calls)
      if (c.priceTicker && c.session)
        keys.set(`${c.priceTicker}|${c.session}`, {
          ticker: c.priceTicker,
          session: c.session,
        });
    return [...keys.values()];
  }, [calls]);
  const key = JSON.stringify(wanted);
  const [prices, setPrices] = useState<Prices | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const list = JSON.parse(key) as { ticker: string; session: string }[];
    const chunks: (typeof list)[] = [];
    for (let i = 0; i < list.length; i += 150) chunks.push(list.slice(i, i + 150));
    Promise.all(
      chunks.map((calls) =>
        readAction<SavedSinceRow[]>(
          "research",
          "savedSince",
          { calls },
          controller.signal,
        ),
      ),
    )
      .then((rows) => {
        const next: Prices = {};
        for (const r of rows.flat()) next[`${r.ticker}|${r.session}`] = r.since;
        setPrices(next);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        const next: Prices = {};
        for (const c of list) next[`${c.ticker}|${c.session}`] = "error";
        setPrices(next);
      });
    return () => controller.abort();
  }, [key]);
  return prices;
}
function SinceSavedLine({
  call,
  prices,
}: {
  call: CallView;
  prices: Prices | null;
}) {
  const since =
    call.priceTicker && call.session
      ? prices?.[`${call.priceTicker}|${call.session}`]
      : { state: "no-price" as const };
  const text =
    since === undefined
      ? "Checking prices…"
      : since === "error"
        ? "Price unavailable right now"
        : sinceSavedText(since);
  const title =
    since && since !== "error" && call.priceTicker
      ? sinceSavedDetail(since, call.priceTicker)
      : call.priceTicker
        ? "Stored prices could not be read."
        : "Themes and unresolved names have no price series.";
  return (
    <p className="yi-saved-since" title={title}>
      <span>Since saved</span> {text}
    </p>
  );
}
function ExpiryText({ call, today }: { call: CallView; today: string }) {
  const badge = expiryBadgeText(call.expiryDate, today);
  if (!badge)
    return call.expiryOriginal ? (
      <span className="yi-saved-expiry" title="Expiry as the creator said it">
        Expires: {call.expiryOriginal}
      </span>
    ) : null;
  return (
    <span
      className={`yi-saved-expiry yi-saved-expiry-${badge.state}`}
      title={call.expiryOriginal ? `Said as "${call.expiryOriginal}"` : undefined}
    >
      {badge.text}
    </span>
  );
}
function SavedCard({
  call,
  today,
  prices,
  showSession,
  inRemoved,
}: {
  call: CallView;
  today: string;
  prices: Prices | null;
  showSession: boolean;
  /** Delete permanently is offered only in the Removed tab. */
  inRemoved: boolean;
}) {
  const { perform, busy } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);
  const i = call.idea;
  const status = String(i.status);
  const note = String(i.note ?? "");
  const label = describeInstrument(call).text;
  const setStatus = (next: string, message: string) =>
    void perform(
      () => action("research", "idea", { id: i.id, status: next, note }),
      message,
    );
  return (
    <article className="yi-panel yi-saved-card">
      <div className="yi-row yi-card2-line1">
        <InstrumentLabel claim={call} />
        <span className={`yi-chip yi-stance-${call.stance}`}>{call.stance}</span>
        {call.conviction && <ConvictionChip value={call.conviction} />}
        {call.trust && (
          <TrustBadge level={call.trust.trustLevel} basis={call.trust.trustBasis} />
        )}
        {(call.horizon || call.expiryDate || call.expiryOriginal) && (
          <span className="yi-card2-when">
            {call.horizon && <span>{call.horizon}</span>}
            <ExpiryText call={call} today={today} />
          </span>
        )}
      </div>
      <h3>{call.thesis}</h3>
      {call.action && (
        <p className="yi-card2-action">
          <span>Action</span> {call.action}
        </p>
      )}
      <LevelChips levels={call.levels} />
      {call.catalysts.length > 0 && (
        <div className="yi-card2-catalysts">
          <span>Catalysts</span>
          {call.catalysts.map((c, n) => (
            <span key={n} className="yi-chip">
              {c}
            </span>
          ))}
        </div>
      )}
      <SinceSavedLine call={call} prices={prices} />
      <p className="yi-muted yi-saved-meta">
        {showSession && call.at && (
          <>
            <TradingDay at={call.at} /> ·{" "}
          </>
        )}
        Saved {dateLabel(String(i.savedAt ?? ""))}
        {i.channel || i.title ? ` · ${String(i.channel || i.title)}` : ""}
      </p>
      <NoteEditor
        initial={note}
        save={(next) =>
          perform(
            () => action("research", "idea", { id: i.id, status, note: next }),
            "Note saved.",
          )
        }
      />
      {confirming ? (
        <div
          className="yi-saved-confirm"
          role="group"
          aria-label="Confirm permanent delete"
        >
          <p>
            Delete {label} call and its note? This can&apos;t be undone.
          </p>
          <button
            className="yi-saved-danger"
            disabled={busy}
            onClick={() =>
              void perform(
                () => action("research", "deleteIdea", { id: i.id }),
                `${label} call deleted.`,
              )
            }
          >
            Delete
          </button>
          <button
            ref={cancel}
            className="yi-secondary"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <footer className="yi-row">
          <Link href={`/youtube-intelligence/analysis/${String(i.runId)}`}>
            View evidence ↗
          </Link>
          <button
            className="yi-secondary"
            disabled={busy}
            onClick={() =>
              setStatus(
                status === "open" ? "done" : "open",
                status === "open"
                  ? "Marked reviewed."
                  : "Restored to open.",
              )
            }
          >
            {status === "open" ? "Mark reviewed" : "Restore to open"}
          </button>
          {status !== "dismissed" ? (
            <button
              className="yi-text-button"
              disabled={busy}
              onClick={() => setStatus("dismissed", "Moved to Removed.")}
            >
              Remove
            </button>
          ) : inRemoved ? (
            <button
              className="yi-text-button yi-saved-delete"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Delete permanently
            </button>
          ) : (
            <span className="yi-muted yi-saved-removed">In Removed</span>
          )}
        </footer>
      )}
    </article>
  );
}
function Tabs({
  tab,
  counts,
  onChange,
}: {
  tab: SavedTab;
  counts: Record<SavedTab, number>;
  onChange: (tab: SavedTab) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, index: number) => {
    const last = SAVED_TABS.length - 1;
    const next =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(SAVED_TABS[next]);
  };
  return (
    <div className="yi-tabs yi-saved-tabs" role="tablist" aria-label="Saved call status">
      {SAVED_TABS.map((t, index) => (
        <button
          key={t}
          ref={(el) => {
            refs.current[index] = el;
          }}
          role="tab"
          id={`yi-saved-tab-${t}`}
          aria-selected={tab === t}
          aria-controls="yi-saved-panel"
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onChange(t)}
          onKeyDown={(e) => move(e, index)}
        >
          {SAVED_TAB_LABELS[t]}{" "}
          <span className={`yi-saved-count${counts[t] ? "" : " yi-saved-zero"}`}>
            {counts[t]}
          </span>
        </button>
      ))}
    </div>
  );
}
export function Saved() {
  const { data } = useWorkspace();
  const [search, setSearch] = useState("");
  const [view, setView] = useUrlState(ViewState, DEFAULTS);
  const ideas = useMemo(
    () => (data?.snapshot.ideas ?? []) as Idea[],
    [data?.snapshot.ideas],
  );
  const claims = data?.snapshot.claims;
  const calls = useMemo(() => {
    const rows = new Map((claims ?? []).map((c) => [c.id, c]));
    return ideas.map((i) => callView(i, rows.get(i.id)));
  }, [ideas, claims]);
  const counts = useMemo(() => tabCounts(ideas), [ideas]);
  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      calls.filter(
        (c) =>
          inTab(c.idea, view.tab) &&
          (!needle ||
            `${JSON.stringify(c.idea.claim)} ${String(c.idea.note ?? "")} ${c.ticker ?? ""}`
              .toLowerCase()
              .includes(needle)),
      ),
    [calls, view.tab, needle],
  );
  const prices = useSinceSaved(shown);
  if (!data) return null;
  const today = todayLocal();
  const hiddenBySearch = calls.filter((c) => inTab(c.idea, view.tab)).length - shown.length;
  const groups =
    view.sort === "session"
      ? groupBySession(shown)
      : [
          {
            session: "expiry",
            heading: "",
            basis: "",
            items: expiringSoonest(shown, today),
          },
        ];
  return (
    <>
      <PageTitle
        title="Saved calls"
        description="Your research notebook: the calls worth revisiting, and why."
      />
      <Tabs
        tab={view.tab}
        counts={counts}
        onChange={(tab) => setView({ tab })}
      />
      <Filters>
        <label>
          Find saved research
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticker, thesis or note"
          />
        </label>
        <label>
          Sort
          <select
            value={view.sort}
            onChange={(e) =>
              setView({ sort: e.target.value as "session" | "expiry" })
            }
          >
            <option value="session">By session, newest first</option>
            <option value="expiry">Expiring soonest</option>
          </select>
        </label>
        {/*
          EXPORT SLOT (F63): ui/ExportMenu.tsx is not on this branch yet. When
          it lands, render it here over `shown` — the current tab after the
          search — with the scope line "N saved calls in <tab>".
        */}
      </Filters>
      {hiddenBySearch > 0 && (
        <p className="yi-muted">
          {hiddenBySearch} {hiddenBySearch === 1 ? "call" : "calls"} hidden by
          the search.{" "}
          <button className="yi-text-button" onClick={() => setSearch("")}>
            Clear search
          </button>
        </p>
      )}
      <div
        id="yi-saved-panel"
        role="tabpanel"
        aria-labelledby={`yi-saved-tab-${view.tab}`}
      >
        {shown.length ? (
          groups.map((g) => (
            <section className="yi-saved-group" key={String(g.session)}>
              {g.heading && (
                <h2 className="yi-saved-heading" title={g.basis}>
                  {g.heading}
                </h2>
              )}
              <div className="yi-card-grid">
                {g.items.map((c) => (
                  <SavedCard
                    key={c.idea.id}
                    call={c}
                    today={today}
                    prices={prices}
                    showSession={view.sort === "expiry"}
                    inRemoved={view.tab === "dismissed"}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <Empty
            title={
              view.tab === "dismissed"
                ? "Nothing in Removed"
                : view.tab === "done"
                  ? "No reviewed calls yet"
                  : "No saved calls in this view"
            }
          >
            {view.tab === "dismissed"
              ? "Calls you remove wait here until you restore or delete them."
              : "Save a call from Today or an analysis. Its source evidence stays attached."}
          </Empty>
        )}
      </div>
    </>
  );
}
