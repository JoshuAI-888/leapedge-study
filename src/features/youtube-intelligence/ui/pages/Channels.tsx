"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useWorkspace, type WorkspaceData } from "../workspace.tsx";
import { action } from "../api.ts";
import { boardAsOf, type BoardSnapshot } from "../../leaderboard.ts";
import { costProjection } from "../../metrics/cost.ts";
import { money } from "../viewmodel.ts";
import { useUrlState } from "../url-state.ts";
import { SplitBar } from "../SplitBar.tsx";
import { InstrumentLabel } from "../InstrumentLabel.tsx";
import {
  BenchmarkSelector,
  Empty,
  Filters,
  MetricHeading,
  PageTitle,
  TrustBadge,
} from "../components.tsx";
import {
  CHANNEL_COLUMNS,
  CHANNEL_SORTS,
  SORT_PRESETS,
  channelStatusLabel,
  filterChannels,
  naturalDirection,
  recordLabel,
  relativeAge,
  sortChannels,
  type ChannelRecord,
  type ChannelSort,
  type ChannelStat,
} from "../../channel-list.ts";

/** Sort, direction and filter are view state in the URL (decision D4). */
const ViewState = z.object({
  sort: z.enum(CHANNEL_SORTS),
  dir: z.enum(["", "asc", "desc"]),
  q: z.string().max(100),
});
type Snapshot = WorkspaceData["snapshot"];
type ChannelRow = Snapshot["channels"][number];
const channelHref = (id: string) =>
  `/youtube-intelligence/channels/${encodeURIComponent(id)}`;
/** The seed list tier, labelled; this was the bare "· 1" after the handle. */
const tierLabel = (tier: string | null) =>
  tier ? `Catalogue tier ${tier}` : null;

export function Channels() {
  const { data, busy, perform } = useWorkspace();
  const router = useRouter();
  const [view, setView] = useUrlState(ViewState, {
    sort: "active",
    dir: "",
    q: "",
  });
  const [query, setQuery] = useState(""),
    [draft, setDraft] = useState<string[] | null>(null),
    [discoverQuery, setDiscoverQuery] = useState(""),
    [catalogSearch, setCatalogSearch] = useState(""),
    [boardSnapshot, setBoardSnapshot] = useState<BoardSnapshot | null>(null),
    [recordError, setRecordError] = useState(""),
    [stats, setStats] = useState<ChannelStat[] | null>(null),
    [statsError, setStatsError] = useState(""),
    [expanded, setExpanded] = useState<string | null>(null),
    [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    action<BoardSnapshot>("market", "boardSnapshot")
      .then((s) => {
        setBoardSnapshot(s);
        setRecordError("");
      })
      .catch((e) => setRecordError(e.message));
    action<ChannelStat[]>("channels", "channelStats")
      .then((s) => {
        setStats(s);
        setStatsError("");
      })
      .catch((e) => setStatsError(e.message));
  }, [data]);
  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    if (drawerOpen && !dialog.open) dialog.showModal();
    if (!drawerOpen && dialog.open) dialog.close();
  }, [drawerOpen]);
  if (!data) return null;
  const now = new Date().toISOString();
  const board = boardSnapshot
    ? boardAsOf(boardSnapshot, {
        horizonDays: data.preferences.resolved.defaultHorizonDays,
        benchmark:
          data.preferences.resolved.benchmark === "sector-etf"
            ? "sector"
            : data.preferences.resolved.benchmark.replace(/^custom:/, ""),
        record: "forward",
        markets: data.preferences.resolved.marketFilter,
      })
    : null;
  const minimum = Math.max(
    20,
    boardSnapshot?.settings.leaderboard.minSettledForRank ?? 20,
  );
  const records = new Map<string, ChannelRecord>(
    (board?.creators ?? []).map((row) => [
      row.id,
      { n: row.n, medianExcess: row.medianExcess, status: row.status },
    ]),
  );
  const record = (id: string) =>
    board
      ? recordLabel(records.get(id), minimum)
      : recordError
        ? "Record unavailable"
        : "Loading…";
  const seedSources = data.snapshot.seedSources ?? [];
  const selected = draft ?? data.cost.context.selectedChannelIds;
  const projection = costProjection({
    ...data.cost.context,
    selectedChannelIds: selected,
  });
  const byId = new Map(data.snapshot.channels.map((c) => [c.id, c]));
  const followed = stats ?? [];
  const direction = view.dir || naturalDirection(view.sort);
  const rows = sortChannels(
    filterChannels(followed, view.q),
    view.sort,
    records,
    direction,
  );
  const catalogue = data.snapshot.channels
    .filter((c) => !c.active)
    .filter((c) =>
      `${c.title} ${c.handle}`
        .toLowerCase()
        .includes(catalogSearch.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.title.localeCompare(b.title),
    );
  function sortBy(sort: ChannelSort) {
    if (view.sort === sort)
      setView({ dir: direction === "asc" ? "desc" : "asc" });
    else setView({ sort, dir: "" });
  }
  const toggle = (id: string) => setExpanded(expanded === id ? null : id);
  const details = (s: ChannelStat) => {
    const c = byId.get(s.channelId);
    return c ? (
      <ChannelDetails
        channel={c}
        snapshot={data.snapshot}
        runs={data.runs}
        selected={selected}
        onSelect={setDraft}
        projected={
          projection.channels.find((x) => x.channelId === c.id)
            ?.projectedMonthlyUsd
        }
      />
    ) : (
      <p className="yi-muted">This channel is still loading.</p>
    );
  };
  const status = (s: ChannelStat) => {
    const label = channelStatusLabel(s);
    return (
      <span
        className={`yi-chip yi-channel-status yi-channel-status-${label.tone}`}
        title={label.title}
      >
        {label.tone === "live" && <i aria-hidden="true" />}
        {label.label}
      </span>
    );
  };
  const lean = (s: ChannelStat) =>
    s.calls30d ? (
      <SplitBar
        calls={s.lean}
        label={`${s.title} lean, last 30 days`}
      />
    ) : (
      <span className="yi-muted">No calls in 30 days</span>
    );
  const top = (s: ChannelStat) =>
    s.topInstrument ? (
      <span className="yi-channel-top">
        <InstrumentLabel claim={s.topInstrument} />
        <small>{s.topInstrument.calls} calls</small>
      </span>
    ) : (
      <span className="yi-muted">—</span>
    );
  return (
    <>
      <PageTitle
        title="Channels"
        description="The creators you follow: what they are posting, what they talk about, and their record."
      >
        <button
          type="button"
          className="yi-channel-add"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
        >
          + Add channels
        </button>
      </PageTitle>
      {draft !== null && (
        <div className="yi-warning yi-channel-draft" role="status">
          <span>
            Processing selection changed: {selected.length} channels ·{" "}
            {money(projection.projectedMonthlyUsd)} / month projected. Not
            saved yet.
          </span>
          <span className="yi-row">
            <button
              disabled={busy}
              onClick={() =>
                void perform(
                  () =>
                    action("channels", "saveSelection", {
                      channelIds: selected,
                    }),
                  "Processing selection saved.",
                ).then((ok) => {
                  if (ok) setDraft(null);
                })
              }
            >
              Save selection
            </button>
            <button className="yi-secondary" onClick={() => setDraft(null)}>
              Discard changes
            </button>
          </span>
        </div>
      )}
      <section className="yi-panel yi-channel-panel">
        <div className="yi-section-title">
          <h2>
            Followed channels{" "}
            {stats && <span className="yi-muted">{stats.length}</span>}
          </h2>
        </div>
        <div className="yi-channel-toolbar">
          <div
            className="yi-segmented"
            role="group"
            aria-label="Sort channels"
          >
            {SORT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={view.sort === p.id}
                onClick={() => setView({ sort: p.id, dir: "" })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Filters>
            <label>
              Filter channels
              <input
                type="search"
                value={view.q}
                onChange={(e) => setView({ q: e.target.value.slice(0, 100) })}
                placeholder="Name, handle or ticker"
              />
            </label>
            <BenchmarkSelector />
          </Filters>
        </div>
        {statsError && (
          <p className="yi-warning" role="alert">
            Channel activity could not be loaded: {statsError}
          </p>
        )}
        {!stats && !statsError ? (
          <p className="yi-muted yi-channel-loading" role="status">
            Loading channel activity…
          </p>
        ) : stats && !stats.length ? (
          <Empty title="You are not following any channels yet">
            <button
              type="button"
              className="yi-text-button"
              onClick={() => setDrawerOpen(true)}
            >
              + Add channels
            </button>{" "}
            to follow a creator, discover new ones or add the catalogue.
          </Empty>
        ) : stats && !rows.length ? (
          <Empty title={`No followed channels match "${view.q}"`}>
            <button
              type="button"
              className="yi-text-button"
              onClick={() => setView({ q: "" })}
            >
              Clear the filter
            </button>
          </Empty>
        ) : (
          <>
            <div className="yi-channel-table">
              <table>
                <caption className="yi-sr-only">
                  Followed channels with status, activity, top instrument,
                  lean and record. Select a row to open the channel page.
                </caption>
                <thead>
                  <tr>
                    {CHANNEL_COLUMNS.map((c) => (
                      <MetricHeading
                        key={c.key}
                        id={`channels.${c.key}`}
                        onSort={() => sortBy(c.sort)}
                        direction={view.sort === c.sort ? direction : undefined}
                      />
                    ))}
                    <th scope="col">
                      <span className="yi-sr-only">Settings</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const c = byId.get(s.channelId);
                    const open = expanded === s.channelId;
                    return (
                      <Fragment key={s.channelId}>
                        <tr
                          className="yi-channel-row"
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a,button,input,label"))
                              return;
                            router.push(channelHref(s.channelId));
                          }}
                        >
                          <td>
                            <Link
                              className="yi-channel-name"
                              href={channelHref(s.channelId)}
                            >
                              {s.title || s.handle || s.channelId}
                            </Link>
                            <small>
                              {[s.handle, tierLabel(c?.tier ?? null)]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </td>
                          <td>{status(s)}</td>
                          <td title={s.lastAnalysedAt ? new Date(s.lastAnalysedAt).toLocaleString() : undefined}>
                            {relativeAge(s.lastAnalysedAt, now)}
                          </td>
                          <td className="yi-channel-num">{s.videos7d}</td>
                          <td>{top(s)}</td>
                          <td>{lean(s)}</td>
                          <td>{record(s.channelId)}</td>
                          <td>
                            <button
                              type="button"
                              className="yi-text-button"
                              aria-expanded={open}
                              aria-controls={`yi-channel-details-${s.channelId}`}
                              onClick={() => toggle(s.channelId)}
                            >
                              {open ? "Hide" : "Settings"}
                              <span className="yi-sr-only"> for {s.title}</span>
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr
                            className="yi-channel-details-row"
                            id={`yi-channel-details-${s.channelId}`}
                          >
                            <td colSpan={CHANNEL_COLUMNS.length + 1}>
                              {details(s)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="yi-channel-cards" aria-label="Followed channels">
              {rows.map((s) => {
                const c = byId.get(s.channelId);
                const open = expanded === s.channelId;
                return (
                  <li key={s.channelId} className="yi-channel-card">
                    <div className="yi-channel-card-head">
                      <Link
                        className="yi-channel-name"
                        href={channelHref(s.channelId)}
                      >
                        {s.title || s.handle || s.channelId}
                      </Link>
                      {status(s)}
                    </div>
                    <small className="yi-muted">
                      {[s.handle, tierLabel(c?.tier ?? null)]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <dl className="yi-channel-card-facts">
                      <div>
                        <dt>Last video</dt>
                        <dd>{relativeAge(s.lastAnalysedAt, now)}</dd>
                      </div>
                      <div>
                        <dt>7 days</dt>
                        <dd>{s.videos7d}</dd>
                      </div>
                      <div>
                        <dt>Top</dt>
                        <dd>{top(s)}</dd>
                      </div>
                      <div>
                        <dt>Record</dt>
                        <dd>{record(s.channelId)}</dd>
                      </div>
                    </dl>
                    <div className="yi-channel-card-lean">{lean(s)}</div>
                    <button
                      type="button"
                      className="yi-text-button"
                      aria-expanded={open}
                      onClick={() => toggle(s.channelId)}
                    >
                      {open ? "Hide settings" : "Settings and uploads"}
                    </button>
                    {open && details(s)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <dialog
        ref={drawer}
        className="yi-drawer"
        aria-labelledby="yi-drawer-title"
        onClose={() => setDrawerOpen(false)}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself.
          if (e.target === e.currentTarget) setDrawerOpen(false);
        }}
      >
        <div className="yi-drawer-body">
          <div className="yi-drawer-head">
            <h2 id="yi-drawer-title">Add channels</h2>
            <button
              type="button"
              className="yi-secondary"
              onClick={() => setDrawerOpen(false)}
            >
              Close
            </button>
          </div>
          <form
            className="yi-drawer-block"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                () => action("channels", "follow", query),
                "Channel followed. Automatic processing remains off until selected.",
              ).then((ok) => {
                if (ok) setQuery("");
              });
            }}
          >
            <label>
              Follow a creator
              <input
                required
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="@handle or YouTube channel URL"
              />
            </label>
            <button disabled={busy || !query.trim()}>Follow channel</button>
          </form>
          <form
            className="yi-drawer-block"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                () =>
                  action("channels", "discoverChannels", {
                    query: discoverQuery,
                    language: "en",
                  }),
                "Channel search updated.",
              );
            }}
          >
            <label>
              Discover creators
              <input
                minLength={3}
                required
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                placeholder="Investment topic or creator name"
              />
            </label>
            <button disabled={busy}>Search YouTube</button>
            {data.snapshot.channelCandidates.length > 0 && (
              <>
                <h3>Discovery results</h3>
                <ul className="yi-list">
                  {data.snapshot.channelCandidates.map((c) => (
                    <li key={String(c.id)}>
                      <span>{String(c.sourceTitle ?? c.id)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            () => action("channels", "follow", String(c.id)),
                            "Channel followed.",
                          )
                        }
                      >
                        Follow
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </form>
          <section className="yi-drawer-block">
            <div className="yi-section-title">
              <h3>Source-backed channel catalogue</h3>
              <button
                type="button"
                className="yi-secondary"
                disabled={
                  busy ||
                  !seedSources.some(
                    (source) =>
                      !source.placeholder &&
                      source.installedCount < source.count,
                  )
                }
                onClick={() =>
                  void perform(async () => {
                    const response = await action<{
                      result: { recommendedChannelIds: string[] };
                    }>("channels", "seedCatalog", null);
                    setDraft([
                      ...new Set([
                        ...data.cost.context.selectedChannelIds,
                        ...response.result.recommendedChannelIds,
                      ]),
                    ]);
                  }, "Catalogue added. Recommended processing is previewed below; save selection to enable it.")
                }
              >
                Add available channels
              </button>
            </div>
            <p className="yi-muted">
              Catalogue setup adds channel metadata only. Turn on discovery and
              preview processing costs before choosing automatic analysis.
            </p>
            {seedSources.map((source) => (
              <div className="yi-row" key={source.source}>
                <strong>
                  {source.source === "truealpha" ? "TrueAlphaData" : "LeapEdge"}
                </strong>
                <span className="yi-chip">
                  {source.placeholder
                    ? "Source unavailable"
                    : `${source.count} confirmed channels · ${source.installedCount} added`}
                </span>
              </div>
            ))}
            {seedSources.some((source) => source.note) && (
              <details className="yi-provenance">
                <summary>Where this list comes from</summary>
                {seedSources.map((source) => (
                  <p className="yi-muted" key={source.source}>
                    <strong>
                      {source.source === "truealpha"
                        ? "TrueAlphaData"
                        : "LeapEdge"}
                      :
                    </strong>{" "}
                    {source.note}
                  </p>
                ))}
              </details>
            )}
            {data.snapshot.channels.some((c) => !c.active) && (
              <>
                <label className="yi-drawer-search">
                  Catalogue channels not followed
                  <input
                    type="search"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Name or handle"
                  />
                </label>
                <ul className="yi-drawer-catalogue">
                  {catalogue.slice(0, 50).map((c) => (
                    <li key={c.id}>
                      <details>
                        <summary>
                          <strong>{c.title || c.handle || c.id}</strong>{" "}
                          <small className="yi-muted">
                            {[c.handle, tierLabel(c.tier)]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </summary>
                        <ChannelDetails
                          channel={c}
                          snapshot={data.snapshot}
                          runs={data.runs}
                          selected={selected}
                          onSelect={setDraft}
                          projected={
                            projection.channels.find(
                              (x) => x.channelId === c.id,
                            )?.projectedMonthlyUsd
                          }
                        />
                      </details>
                    </li>
                  ))}
                </ul>
                {catalogue.length > 50 && (
                  <p className="yi-muted">
                    Showing 50 of {catalogue.length}. Filter to find others.
                  </p>
                )}
              </>
            )}
          </section>
          <section className="yi-drawer-block yi-projection">
            <div>
              <p className="yi-eyebrow">SELECTION PREVIEW</p>
              <h3>
                {money(projection.projectedMonthlyUsd)} <small>/ month</small>
              </h3>
              <p>
                {selected.length} channels selected · budget{" "}
                {money(data.cost.budget.monthlyUsd)}
              </p>
              {projection.exceedsBudget && (
                <p className="yi-warning">
                  This selection projects above your budget. You can save it;
                  the spending cap still applies.
                </p>
              )}
              {projection.projectedMonthlyUsd === null && (
                <p className="yi-muted">
                  Some channels need fresh, complete upload history or measured
                  analysis costs before a total can be estimated.
                </p>
              )}
              <p className="yi-muted">
                {projection.sampleCount} measured videos · cost coverage{" "}
                {projection.sampleCoverage === null
                  ? "unknown"
                  : `${Math.round(projection.sampleCoverage * 100)}%`}
              </p>
            </div>
            <div className="yi-row">
              <button
                type="button"
                disabled={busy || draft === null}
                onClick={() =>
                  void perform(
                    () =>
                      action("channels", "saveSelection", {
                        channelIds: selected,
                      }),
                    "Processing selection saved.",
                  ).then((ok) => {
                    if (ok) setDraft(null);
                  })
                }
              >
                Save selection
              </button>
              <button
                type="button"
                className="yi-secondary"
                disabled={draft === null}
                onClick={() => setDraft(null)}
              >
                Discard changes
              </button>
            </div>
          </section>
        </div>
      </dialog>
    </>
  );
}

const RUN_STATUS: Record<string, string> = {
  queued: "Queued",
  running: "Analysing",
  completed: "Analysed",
  failed: "Failed",
};

/**
 * The per-channel switches, trust counts, projection, refresh and recent
 * uploads that used to fill each card. Same actions as before; reachable from
 * a row's Settings button (followed) or the drawer's catalogue (not followed).
 */
function ChannelDetails({
  channel: c,
  snapshot,
  runs,
  selected,
  onSelect,
  projected,
}: {
  channel: ChannelRow;
  snapshot: Snapshot;
  runs: WorkspaceData["runs"];
  selected: string[];
  onSelect: (ids: string[]) => void;
  projected: number | null | undefined;
}) {
  const { busy, perform } = useWorkspace();
  const claims = snapshot.claims.filter((x) => x.channelId === c.id);
  const processing = selected.includes(c.id);
  return (
    <div className="yi-channel-details">
      <div className="yi-row">
        <button
          type="button"
          className="yi-text-button"
          aria-pressed={c.favorite}
          aria-label={`${c.favorite ? "Unfavourite" : "Favourite"} ${c.title}`}
          onClick={() =>
            void perform(
              () =>
                action("channels", "channel", {
                  id: c.id,
                  favorite: !c.favorite,
                }),
              "Favourite updated.",
            )
          }
          disabled={busy}
        >
          {c.favorite ? "★ Favourite" : "☆ Favourite"}
        </button>
        <span className="yi-muted">Calls by trust:</span>
        {["L0", "L1", "L2", "L3"].map((level) => (
          <span key={level}>
            <TrustBadge level={level} />{" "}
            {claims.filter((x) => x.trustLevel === level).length}
          </span>
        ))}
      </div>
      <div className="yi-switches">
        <label>
          <input
            type="checkbox"
            checked={c.active}
            disabled={busy}
            onChange={(e) => {
              const enabled = e.target.checked;
              void perform(
                () =>
                  enabled && !c.uploads
                    ? action("channels", "follow", c.id)
                    : action("channels", "channel", {
                        id: c.id,
                        active: enabled,
                      }),
                "Discovery updated.",
              );
            }}
          />{" "}
          Discover uploads (follow)
        </label>
        <label>
          <input
            type="checkbox"
            checked={processing}
            onChange={(e) =>
              onSelect(
                e.target.checked
                  ? [...selected, c.id]
                  : selected.filter((id) => id !== c.id),
              )
            }
          />{" "}
          Process new uploads
        </label>
      </div>
      <p>
        {processing
          ? `Projected: ${money(projected)} / month`
          : "Not processed automatically"}
      </p>
      {c.error && (
        <p role="alert" className="yi-warning">
          Discovery failed: {c.error}
        </p>
      )}
      <div className="yi-row">
        <button
          type="button"
          className="yi-secondary"
          disabled={busy || !c.active || !c.uploads}
          onClick={() =>
            void perform(
              () => action("channels", "pull", c.id),
              "Latest uploads discovered.",
            )
          }
        >
          Refresh uploads
        </button>
        {c.active && c.nextPageToken && (
          <button
            type="button"
            className="yi-text-button"
            disabled={busy}
            onClick={() =>
              void perform(
                () =>
                  action("channels", "backfillChannel", {
                    id: c.id,
                    pages: 3,
                  }),
                "Older upload metadata loaded. No analyses were queued.",
              )
            }
          >
            Load older metadata for cost projection
          </button>
        )}
      </div>
      <ul className="yi-upload-list" aria-label={`Recent uploads from ${c.title}`}>
        {snapshot.discoveries
          .filter((v) => v.channel_id === c.id)
          .slice(0, 3)
          .map((v) => {
            const runId = v.run_id ? String(v.run_id) : null;
            const run = runId ? runs.find((r) => r.id === runId) : undefined;
            return (
              <li key={String(v.video_id)}>
                <span>{v.payload.title || String(v.video_id)}</span>
                {runId ? (
                  <Link
                    className={`yi-chip yi-upload-status yi-upload-${run?.status ?? "sent"}`}
                    href={`/youtube-intelligence/analysis/${encodeURIComponent(runId)}`}
                  >
                    {run ? (RUN_STATUS[run.status] ?? "Needs review") : "Sent for analysis"}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          action("channels", "analyzeUpload", String(v.video_id)),
                        "Video queued and future uploads selected for processing.",
                      )
                    }
                  >
                    Analyse & process future uploads
                  </button>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
