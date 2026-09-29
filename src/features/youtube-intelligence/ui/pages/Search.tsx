"use client";
import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  CallRow,
  VideoRow,
  queryCalls,
  queryVideos,
} from "../../../../server/youtube-intelligence/repos/research-query.ts";
import { PageTitle, TrustBadge } from "../components.tsx";
import { InstrumentLabel } from "../InstrumentLabel.tsx";
import { HiddenByFilter } from "../HiddenByFilter.tsx";
import { SplitBar } from "../SplitBar.tsx";
import { TradingDay } from "../TradingDay.tsx";
import { read } from "../api.ts";
import { trapFocus } from "../focus-trap.ts";
import { INSTRUMENT_KINDS } from "../../instrument-kind.ts";
import { SENTIMENT_GLYPH, sentimentOf, trustOptionLabel } from "../foundations.ts";
import { useQueryPages } from "../use-query-pages.ts";
import { UnreadDot } from "../UnreadDot.tsx";
import { ExportMenu } from "../ExportMenu.tsx";
import {
  CONVICTION_OPTIONS,
  EXPIRY_WINDOWS,
  SEARCH_WINDOWS,
  SENTIMENT_OPTIONS,
  STANCE_OPTIONS,
  TRUST_OPTIONS,
  WINDOW_LABELS,
  activeChips,
  calendarDate,
  callsQueryInput,
  clearAllFilters,
  facetView,
  hiddenByTrust,
  highlightParts,
  parseSearchState,
  removalText,
  serialiseSearchState,
  suggestRemoval,
  toggleInstrument,
  instrumentList,
  verdictLine,
  videosQueryInput,
  windowLabel,
  type FacetValue,
  type SearchFacets,
  type SearchState,
} from "../search-state.ts";

type CallsResult = Awaited<ReturnType<typeof queryCalls>>;
type VideosResult = Awaited<ReturnType<typeof queryVideos>>;
const BASE = "/youtube-intelligence";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Search (F62): every call and video in the archive, filtered on the server
 * (F56) with live facet counts, a summary of the filtered set, and all state in
 * the URL. Three panes on a desktop; on a phone the filters open as a sheet.
 */
export function Search() {
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}

function useSearchState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = params.toString();
  const state = useMemo(() => parseSearchState(new URLSearchParams(query)), [query]);
  const set = useCallback(
    (next: SearchState) => {
      const q = serialiseSearchState(next, query);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [query, pathname, router],
  );
  const patch = useCallback((p: Partial<SearchState>) => set({ ...state, ...p }), [set, state]);
  return { state, set, patch, query };
}

function SearchPage() {
  const { state, set, patch, query } = useSearchState();
  // The date window is anchored when the filters change, not on every render.
  const now = useMemo(() => Date.now(), [query]);
  const base = useMemo(() => {
    const { limit: _l, offset: _o, ...input } = callsQueryInput(state, now, { limit: 1, offset: 0 });
    return input;
  }, [state, now]);
  const videoBase = useMemo(() => {
    const { limit: _l, offset: _o, ...input } = videosQueryInput(state, now, { limit: 1, offset: 0 });
    return input;
  }, [state, now]);
  const calls = useQueryPages<CallRow, CallsResult>("calls", base);
  const videos = useQueryPages<VideoRow, VideosResult>("videos", videoBase);
  const facets = calls.data?.facets as SearchFacets | undefined;
  const labels = useMemo(
    () => ({
      channels: new Map((facets?.channel ?? []).map((c) => [c.value, c.label ?? null])),
      instruments: new Map((facets?.instrument ?? []).map((c) => [c.value, c.label ?? null])),
    }),
    [facets],
  );
  const chips = activeChips(state, {
    channels: new Map([...labels.channels].filter(([, v]) => v) as [string, string][]),
    instruments: new Map([...labels.instruments].filter(([, v]) => v) as [string, string][]),
  });
  const [draft, setDraft] = useState(state.q);
  useEffect(() => setDraft(state.q), [state.q]);
  useEffect(() => {
    if (draft === state.q) return;
    const timer = setTimeout(() => patch({ q: draft }), 300);
    return () => clearTimeout(timer);
  }, [draft, state.q, patch]);
  const [preview, setPreview] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const total = calls.data?.total ?? 0;
  const filterCount = chips.length;
  const empty = !!calls.data && !calls.stale && total === 0;
  const suggestion = useRemovalSuggestion(empty, state, chips, facets, now, query);
  const shown = calls.rows.find((r) => r.id === preview) ?? null;
  const tab = state.tab;
  const active = tab === "calls" ? calls : videos;
  return (
    <div className="yi-search-page">
      <PageTitle
        title="Search"
        description="Every call and video in the archive, by instrument, channel, stance, trust or text."
      />
      <form
        className="yi-search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          patch({ q: draft });
        }}
      >
        <label htmlFor="yi-search-text" className="yi-sr-only">
          Search text
        </label>
        <input
          id="yi-search-text"
          type="search"
          value={draft}
          maxLength={200}
          placeholder="Search titles, theses, quotes and translations"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      <div className="yi-search-chips" aria-label="Active filters">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="yi-search-chip"
            onClick={() => patch(chip.remove)}
            aria-label={`Remove filter ${chip.label}`}
          >
            {chip.label} <span aria-hidden="true">×</span>
          </button>
        ))}
        {chips.length > 0 && (
          <button type="button" className="yi-text-button" onClick={() => set(clearAllFilters(state))}>
            Clear all
          </button>
        )}
        <button
          type="button"
          className="yi-secondary yi-search-filters-button"
          onClick={() => setSheet(true)}
          aria-haspopup="dialog"
        >
          Filters ({filterCount})
        </button>
      </div>
      {calls.data && (
        <p className="yi-search-oneline" aria-hidden="true">
          {plural(total, "call")} · {SENTIMENT_OPTIONS.map((s) => `${calls.data!.aggregates.sentiment[s].calls} ${SENTIMENT_GLYPH[s]}`).join(" ")}
        </p>
      )}
      <div className="yi-search">
        <aside className="yi-search-filters" aria-label="Filters">
          {facets ? (
            <SearchFilters state={state} facets={facets} set={set} />
          ) : (
            <p className="yi-muted">Loading filters…</p>
          )}
        </aside>
        <section className="yi-search-results" aria-labelledby="yi-search-results-title">
          <h2 id="yi-search-results-title" className="yi-sr-only">
            Results
          </h2>
          <div className="yi-search-results-head">
            <div className="yi-search-tabs" role="tablist" aria-label="Result type">
              {(["calls", "videos"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? "yi-search-tab yi-active" : "yi-search-tab"}
                  onClick={() => patch({ tab: t })}
                >
                  {t === "calls" ? "Calls" : "Videos"}{" "}
                  <span className="yi-search-tab-count">
                    {(t === "calls" ? calls.data?.total : videos.data?.total)?.toLocaleString("en-US") ?? "…"}
                  </span>
                </button>
              ))}
            </div>
            <div className="yi-search-tools">
              <ExportMenu input={base} total={calls.stale ? 0 : total} />
              <label>
                <span className="yi-sr-only">Sort</span>
                <select
                  value={tab === "calls" ? (state.sort === "ideas" ? "newest" : state.sort) : state.sort === "ideas" ? "ideas" : "newest"}
                  onChange={(e) => patch({ sort: e.target.value as SearchState["sort"] })}
                >
                  <option value="newest">Newest</option>
                  {tab === "calls" ? (
                    <>
                      <option value="conviction">Conviction</option>
                      <option value="trust">Trust</option>
                    </>
                  ) : (
                    <option value="ideas">Most ideas</option>
                  )}
                </select>
              </label>
            </div>
          </div>
          {facets && (
            <HiddenByFilter
              count={hiddenByTrust(facets.trust, state.trust)}
              filter={`the ${trustOptionLabel(state.trust)} trust filter`}
              onReveal={() => patch({ trust: "L0" })}
            />
          )}
          {active.error && (
            <p className="yi-warning" role="alert">
              Search failed: {active.error}{" "}
              <button type="button" className="yi-text-button" onClick={active.retry}>
                Retry
              </button>
            </p>
          )}
          <div
            className={`yi-search-list${active.stale ? " yi-stale" : ""}`}
            aria-busy={active.stale}
            aria-live="polite"
          >
            {!active.data && !active.error ? (
              <p className="yi-muted">Searching…</p>
            ) : tab === "calls" ? (
              empty ? (
                <NoResults suggestion={suggestion} onApply={(p) => patch(p)} clear={() => set(clearAllFilters(state))} />
              ) : (
                <ol className="yi-search-rows">
                  {calls.rows.map((row) => (
                    <CallResult
                      key={row.id}
                      row={row}
                      q={state.q}
                      onPreview={() => setPreview(row.id)}
                      onChannel={(id) => patch({ channels: state.channels.includes(id) ? state.channels : [...state.channels, id] })}
                    />
                  ))}
                </ol>
              )
            ) : videos.data && videos.data.total === 0 ? (
              <NoResults suggestion={empty ? suggestion : null} onApply={(p) => patch(p)} clear={() => set(clearAllFilters(state))} noun="videos" />
            ) : (
              <ol className="yi-search-rows">
                {videos.rows.map((row) => (
                  <VideoResult key={row.runId} row={row} q={state.q} />
                ))}
              </ol>
            )}
          </div>
          {active.data && active.rows.length > 0 && (
            <div className="yi-search-more">
              <span className="yi-muted">
                Showing 1–{active.rows.length.toLocaleString("en-US")} of {active.data.total.toLocaleString("en-US")}
              </span>
              {active.data.nextOffset !== null && (
                <button type="button" className="yi-secondary" disabled={active.loadingMore} onClick={() => void active.loadMore()}>
                  {active.loadingMore ? "Loading…" : "Load 50 more"}
                </button>
              )}
            </div>
          )}
        </section>
        <aside className="yi-search-summary" aria-label="Summary of the filtered set">
          {calls.data ? (
            <Summary
              result={calls.data}
              preview={shown}
              state={state}
              onInstrument={(key, kind) => set(toggleInstrument(state, key, kind))}
              onChannel={(id) => patch({ channels: state.channels.includes(id) ? state.channels : [...state.channels, id] })}
            />
          ) : (
            <p className="yi-muted">Summarising…</p>
          )}
        </aside>
      </div>
      <FilterSheet open={sheet} onClose={() => setSheet(false)} total={total} stale={calls.stale}>
        {facets && <SearchFilters state={state} facets={facets} set={set} idPrefix="sheet" />}
      </FilterSheet>
    </div>
  );
}

/** The empty-state suggestion, fetching one count per chip the facets cannot answer. */
function useRemovalSuggestion(
  empty: boolean,
  state: SearchState,
  chips: ReturnType<typeof activeChips>,
  facets: SearchFacets | undefined,
  now: number,
  query: string,
) {
  const [extra, setExtra] = useState<{ query: string; counts: Record<string, number> }>({ query: "", counts: {} });
  const counts = extra.query === query ? extra.counts : {};
  const result = facets && empty ? suggestRemoval(chips, facets, counts) : null;
  const needs = result?.needs.join("|") ?? "";
  useEffect(() => {
    if (!needs) return;
    const controller = new AbortController();
    const ids = needs.split("|").slice(0, 6);
    void Promise.all(
      ids.map(async (id) => {
        const chip = chips.find((c) => c.id === id);
        if (!chip) return [id, 0] as const;
        const input = callsQueryInput({ ...state, ...chip.remove }, now, { limit: 1, offset: 0 });
        try {
          const r = await read<{ total: number }>("query", "calls", input, controller.signal);
          return [id, r.total] as const;
        } catch {
          return [id, 0] as const;
        }
      }),
    ).then((pairs) => {
      if (controller.signal.aborted) return;
      setExtra((prev) => ({
        query,
        counts: { ...(prev.query === query ? prev.counts : {}), ...Object.fromEntries(pairs) },
      }));
    });
    return () => controller.abort();
    // chips and state are derived from query.
  }, [needs, query]);
  if (!result) return null;
  return { best: result.best, pending: result.needs.length > 0 };
}

function NoResults({
  suggestion,
  onApply,
  clear,
  noun = "calls",
}: {
  suggestion: ReturnType<typeof useRemovalSuggestion>;
  onApply: (p: Partial<SearchState>) => void;
  clear: () => void;
  noun?: string;
}) {
  return (
    <div className="yi-search-empty">
      <h3>No {noun} match these filters</h3>
      {suggestion?.best ? (
        <p>
          <button type="button" className="yi-secondary" onClick={() => onApply(suggestion.best!.chip.remove)}>
            {removalText(suggestion.best)}
          </button>
        </p>
      ) : suggestion?.pending ? (
        <p className="yi-muted">Checking which filter to remove…</p>
      ) : (
        <p className="yi-muted">
          No single filter removal returns any calls.{" "}
          <button type="button" className="yi-text-button" onClick={clear}>
            Clear all filters
          </button>
        </p>
      )}
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function CallResult({
  row,
  q,
  onPreview,
  onChannel,
}: {
  row: CallRow;
  q: string;
  onPreview: () => void;
  onChannel: (id: string) => void;
}) {
  const needle = q.trim().toLowerCase();
  // When the text matched a quote or translation rather than the thesis, show that line.
  const quote =
    needle && !row.thesis.toLowerCase().includes(needle)
      ? row.evidence.find(
          (e) =>
            e.textOriginal.toLowerCase().includes(needle) ||
            (e.translationEn ?? "").toLowerCase().includes(needle),
        )
      : undefined;
  const quoteText = quote
    ? quote.textOriginal.toLowerCase().includes(needle)
      ? quote.textOriginal
      : (quote.translationEn ?? "")
    : "";
  const sentiment = sentimentOf(row.stance);
  return (
    <li className="yi-search-call" onMouseEnter={onPreview} onFocusCapture={onPreview}>
      <div className="yi-search-call-head">
        <InstrumentLabel claim={{ ticker: row.ticker, instrument: row.instrument, macroTheme: row.macroTheme }} />
        <span className={`yi-chip yi-stance-${row.stance}`}>
          <span className="yi-search-glyph" aria-hidden="true">
            {SENTIMENT_GLYPH[sentiment]}
          </span>
          {row.stance}
        </span>
        <TrustBadge level={row.trustLevel} />
      </div>
      <p className="yi-search-thesis">
        <Highlight text={row.thesis} q={q} />
      </p>
      {quote && (
        <p className="yi-search-quote">
          “<Highlight text={quoteText} q={q} />”
        </p>
      )}
      <p className="yi-search-meta">
        {row.channelId ? (
          <button type="button" className="yi-text-button" onClick={() => onChannel(row.channelId!)} title="Filter to this channel">
            {row.channelTitle ?? row.channelId}
          </button>
        ) : (
          <span>Unknown channel</span>
        )}
        <span aria-hidden="true"> · </span>
        <TradingDay at={row.publishedAt ?? row.createdAt} />
        <span aria-hidden="true"> · </span>
        <Link href={`${BASE}/analysis/${encodeURIComponent(row.runId)}#${encodeURIComponent(row.id)}`}>
          Open at this call →
        </Link>
      </p>
    </li>
  );
}

function VideoResult({ row, q }: { row: VideoRow; q: string }) {
  return (
    <li className="yi-search-video">
      <UnreadDot run={{ id: row.runId, status: row.status, at: row.createdAt }} />
      <Link className="yi-search-video-title" href={`${BASE}/analysis/${encodeURIComponent(row.runId)}`}>
        <Highlight text={row.title ?? row.videoId} q={q} />
      </Link>
      <p className="yi-search-meta">
        {row.channelId ? (
          <Link href={`${BASE}/channels/${encodeURIComponent(row.channelId)}`}>{row.channelTitle ?? row.channelId}</Link>
        ) : (
          <span>Unknown channel</span>
        )}
        <span aria-hidden="true"> · </span>
        <TradingDay at={row.publishedAt ?? row.createdAt} />
      </p>
      <p className="yi-search-verdict">
        <span>{verdictLine(row)}</span>
        {row.instrumentLabels.length > 0 && (
          <span className="yi-search-verdict-instruments">
            {" · "}
            {instrumentList(row.instrumentLabels)}
          </span>
        )}
        {row.matchingCalls !== row.ideas && row.matchingCalls > 0 && (
          <span className="yi-muted"> · {plural(row.matchingCalls, "matching call")}</span>
        )}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function FacetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="yi-facet">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}
function Option({
  label,
  count,
  pressed,
  onClick,
}: {
  label: ReactNode;
  count: number | null;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`yi-facet-option${count === 0 && !pressed ? " yi-facet-zero" : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className="yi-facet-label">{label}</span>
      {count !== null && <span className="yi-facet-count">{count.toLocaleString("en-US")}</span>}
    </button>
  );
}
function MultiFacet({
  title,
  values,
  selected,
  onToggle,
  idPrefix,
  render,
}: {
  title: string;
  values: FacetValue[];
  selected: string[];
  onToggle: (v: FacetValue) => void;
  idPrefix: string;
  render: (v: FacetValue) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const view = facetView(values, selected, { limit: 8, expanded, filter });
  const picked = new Set(selected.map((s) => s.toUpperCase()));
  const id = `${idPrefix}-${title.toLowerCase()}`;
  return (
    <FacetGroup title={title}>
      {expanded && (
        <label className="yi-facet-search">
          <span className="yi-sr-only">Find a {title.toLowerCase()}</span>
          <input
            id={`${id}-find`}
            type="search"
            value={filter}
            placeholder={`Find ${title.toLowerCase()}`}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      )}
      {view.shown.length === 0 && <p className="yi-muted yi-facet-none">None</p>}
      {view.shown.map((v) => (
        <Option
          key={v.value}
          label={render(v)}
          count={v.count}
          pressed={picked.has(v.value.toUpperCase())}
          onClick={() => onToggle(v)}
        />
      ))}
      {view.more > 0 && (
        <button type="button" className="yi-text-button yi-facet-more" onClick={() => setExpanded(true)}>
          + {view.more} more
        </button>
      )}
      {expanded && (
        <button
          type="button"
          className="yi-text-button yi-facet-more"
          onClick={() => {
            setExpanded(false);
            setFilter("");
          }}
        >
          Show fewer
        </button>
      )}
    </FacetGroup>
  );
}
function count(values: FacetValue[], value: string) {
  return values.find((v) => v.value === value)?.count ?? 0;
}
function SearchFilters({
  state,
  facets,
  set,
  idPrefix = "pane",
}: {
  state: SearchState;
  facets: SearchFacets;
  set: (s: SearchState) => void;
  idPrefix?: string;
}) {
  const single = <K extends keyof SearchState>(key: K, value: SearchState[K]) =>
    set({ ...state, [key]: state[key] === value ? "" : value });
  const trustAtLeast = (level: string) =>
    facets.trust.filter((t) => t.value >= level).reduce((n, t) => n + t.count, 0);
  return (
    <div className="yi-search-facets">
      <MultiFacet
        title="Instrument"
        idPrefix={idPrefix}
        values={facets.instrument}
        selected={[...state.tickers, ...state.instruments]}
        render={(v) => v.label ?? v.value}
        onToggle={(v) => set(toggleInstrument(state, v.value, v.kind ?? "unresolved"))}
      />
      <FacetGroup title="Type">
        {INSTRUMENT_KINDS.map((k) => (
          <Option
            key={k.id}
            label={k.label}
            count={count(facets.kind, k.id === "equity" ? "stock" : k.id)}
            pressed={state.kind === k.id}
            onClick={() => single("kind", k.id)}
          />
        ))}
      </FacetGroup>
      <FacetGroup title="Sentiment">
        {SENTIMENT_OPTIONS.map((s) => (
          <Option
            key={s}
            label={
              <>
                <span className={`yi-glyph-${s}`} aria-hidden="true">
                  {SENTIMENT_GLYPH[s]}
                </span>{" "}
                {cap(s)}
              </>
            }
            count={count(facets.sentiment, s)}
            pressed={state.sentiment === s}
            onClick={() => single("sentiment", s)}
          />
        ))}
      </FacetGroup>
      <FacetGroup title="Stance">
        {STANCE_OPTIONS.map((s) => (
          <Option key={s} label={cap(s)} count={count(facets.stance, s)} pressed={state.stance === s} onClick={() => single("stance", s)} />
        ))}
      </FacetGroup>
      <FacetGroup title="Conviction">
        {CONVICTION_OPTIONS.map((c) => (
          <Option
            key={c}
            label={cap(c)}
            count={count(facets.conviction, c)}
            pressed={state.conviction === c}
            onClick={() => single("conviction", c)}
          />
        ))}
      </FacetGroup>
      <FacetGroup title="Trust (at least)">
        {TRUST_OPTIONS.map((t) => (
          <Option
            key={t}
            label={t === "L0" ? "All extracted" : trustOptionLabel(t)}
            count={trustAtLeast(t)}
            pressed={state.trust === t}
            onClick={() => set({ ...state, trust: t })}
          />
        ))}
      </FacetGroup>
      <MultiFacet
        title="Channel"
        idPrefix={idPrefix}
        values={facets.channel}
        selected={state.channels}
        render={(v) => v.label ?? v.value}
        onToggle={(v) =>
          set({
            ...state,
            channels: state.channels.includes(v.value)
              ? state.channels.filter((c) => c !== v.value)
              : [...state.channels, v.value],
          })
        }
      />
      <FacetGroup title="Date (US sessions)">
        <div className="yi-search-window" role="group" aria-label="Date window">
          {SEARCH_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={state.window === w}
              title={windowLabel(w)}
              onClick={() => set({ ...state, window: w })}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </FacetGroup>
      <FacetGroup title="Levels">
        <Option
          label="Has price levels"
          count={count(facets.levels, "with")}
          pressed={state.levels}
          onClick={() => set({ ...state, levels: !state.levels })}
        />
      </FacetGroup>
      <FacetGroup title="Expires within">
        {EXPIRY_WINDOWS.map((w) => (
          <Option
            key={w}
            label={`${parseInt(w, 10)} days`}
            count={count(facets.expiry, String(parseInt(w, 10)))}
            pressed={state.expires === w}
            onClick={() => single("expires", w)}
          />
        ))}
      </FacetGroup>
      <FacetGroup title="Watchlist">
        <label className="yi-facet-check">
          <input type="checkbox" checked={state.pinned} onChange={(e) => set({ ...state, pinned: e.target.checked })} />
          Pinned only
        </label>
      </FacetGroup>
    </div>
  );
}

/** The phone filter sheet: a modal dialog with a focus trap, Esc, and a sticky result button. */
function FilterSheet({
  open,
  onClose,
  total,
  stale,
  children,
}: {
  open: boolean;
  onClose: () => void;
  total: number;
  stale: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="yi-search-sheet"
      aria-labelledby="yi-search-sheet-title"
      onClose={() => {
        onClose();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
      onKeyDown={(e) => trapFocus(e, ref.current)}
    >
      <div className="yi-search-sheet-head">
        <h2 id="yi-search-sheet-title">Filters</h2>
        <button type="button" className="yi-text-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="yi-search-sheet-body">{children}</div>
      <div className="yi-search-sheet-foot">
        <button type="button" onClick={onClose} aria-busy={stale}>
          Show {plural(total, "call")}
        </button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
function Summary({
  result,
  preview,
  state,
  onInstrument,
  onChannel,
}: {
  result: CallsResult;
  preview: CallRow | null;
  state: SearchState;
  onInstrument: (key: string, kind: string) => void;
  onChannel: (id: string) => void;
}) {
  const a = result.aggregates;
  const split = (k: "calls" | "creators") => ({
    bullish: a.sentiment.bullish[k],
    neutral: a.sentiment.neutral[k],
    bearish: a.sentiment.bearish[k],
  });
  return (
    <div className="yi-search-summary-body">
      <h2>This set</h2>
      <p className="yi-muted">
        {plural(a.calls, "call")} · {plural(a.videos, "video")} · {plural(a.creators, "creator")}
      </p>
      <SplitBar calls={split("calls")} creators={split("creators")} label="Sentiment of this set" />
      <h3>Conviction</h3>
      <ConvictionBars counts={a.conviction} />
      {a.topInstruments.length > 0 && (
        <>
          <h3>Top instruments</h3>
          <ul className="yi-search-top">
            {a.topInstruments.slice(0, 5).map((i) => (
              <li key={i.instrument}>
                <button type="button" className="yi-text-button" onClick={() => onInstrument(i.instrument, i.kind)}>
                  {i.label ?? i.instrument}
                </button>
                <SplitBar
                  calls={{ bullish: i.bullish, neutral: i.neutral, bearish: i.bearish }}
                  label={i.label ?? i.instrument}
                  showCounts={false}
                />
                <span className="yi-muted">{i.calls}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {a.topChannels.length > 0 && (
        <>
          <h3>Top channels</h3>
          <ul className="yi-search-top">
            {a.topChannels.slice(0, 5).map((c) => (
              <li key={c.channelId}>
                <button type="button" className="yi-text-button" onClick={() => onChannel(c.channelId)}>
                  {c.title ?? c.channelId}
                </button>
                <SplitBar calls={{ bullish: c.bullish, neutral: c.neutral, bearish: c.bearish }} label={c.title ?? c.channelId} showCounts={false} />
                <span className="yi-muted">{c.calls}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Preview</h3>
      {preview ? <Preview row={preview} q={state.q} /> : <p className="yi-muted">Hover or focus a call to preview its thesis, levels and quote.</p>}
    </div>
  );
}

/** Horizontal bars in --yi-primary tints, labelled with the count as text. */
function ConvictionBars({ counts }: { counts: Record<string, number> }) {
  const order = ["high", "medium", "low", "unspecified"] as const;
  const max = Math.max(1, ...order.map((c) => counts[c] ?? 0));
  const tint = { high: 1, medium: 0.7, low: 0.45, unspecified: 0.25 };
  const row = 18;
  return (
    <svg
      className="yi-search-conviction"
      viewBox={`0 0 240 ${order.length * row}`}
      width="100%"
      role="img"
      aria-label={order.map((c) => `${cap(c)} ${counts[c] ?? 0}`).join(", ")}
    >
      {order.map((c, i) => {
        const n = counts[c] ?? 0;
        const width = (n / max) * 130;
        return (
          <g key={c} transform={`translate(0 ${i * row})`}>
            <text x="0" y="12" className="yi-svg-label">
              {cap(c)}
            </text>
            <rect x="78" y="3" width={Math.max(n ? 2 : 0, width)} height="11" rx="2" fill="var(--yi-primary)" opacity={tint[c]} />
            <text x={82 + width} y="12" className="yi-svg-value">
              {n.toLocaleString("en-US")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Preview({ row, q }: { row: CallRow; q: string }) {
  const levels = row.levels ?? [];
  const quote = row.evidence[0];
  return (
    <div className="yi-search-preview">
      <p className="yi-search-preview-head">
        <InstrumentLabel claim={{ ticker: row.ticker, instrument: row.instrument, macroTheme: row.macroTheme }} link={false} />{" "}
        <span className="yi-muted">{row.stance} · conviction {row.conviction}</span>
      </p>
      <p>
        <Highlight text={row.thesis} q={q} />
      </p>
      {row.action && <p className="yi-search-action">{row.action}</p>}
      {row.horizon && <p className="yi-muted">Horizon: {row.horizon}</p>}
      {levels.length > 0 ? (
        <p className="yi-search-levels">
          {levels.map((l, i) => (
            <span key={i} className="yi-chip" title={l.parsed ? undefined : "Kept as said; not read as a number"}>
              {l.kind} {l.valueOriginal}
            </span>
          ))}
        </p>
      ) : (
        <p className="yi-muted">No price levels stated.</p>
      )}
      {row.expiryOriginal && (
        <p className="yi-muted">
          Expires: {row.expiryDate ? `${calendarDate(row.expiryDate)} (“${row.expiryOriginal}”)` : `“${row.expiryOriginal}”`}
        </p>
      )}
      {row.catalysts.length > 0 && <p className="yi-muted">Catalysts: {row.catalysts.join("; ")}</p>}
      {row.conditions.length > 0 && <p className="yi-muted">If: {row.conditions.join("; ")}</p>}
      {quote && (
        <blockquote>
          <p>
            <Highlight text={quote.textOriginal} q={q} />
          </p>
          {quote.translationEn && quote.translationEn !== quote.textOriginal && (
            <p className="yi-muted">
              <Highlight text={quote.translationEn} q={q} />
            </p>
          )}
        </blockquote>
      )}
    </div>
  );
}
