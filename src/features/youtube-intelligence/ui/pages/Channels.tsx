"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import { boardAsOf, type BoardSnapshot } from "../../leaderboard.ts";
import { costProjection } from "../../metrics/cost.ts";
import { money, percent } from "../viewmodel.ts";
import {
  BenchmarkSelector,
  Empty,
  Filters,
  PageTitle,
  TrustBadge,
} from "../components.tsx";
export function Channels() {
  const { data, busy, perform } = useWorkspace();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState<string[] | null>(null),
    [discoverQuery, setDiscoverQuery] = useState(""),
    [boardSnapshot, setBoardSnapshot] = useState<BoardSnapshot | null>(null),
    [recordError, setRecordError] = useState("");
  useEffect(() => {
    action<BoardSnapshot>("market", "boardSnapshot")
      .then((s) => {
        setBoardSnapshot(s);
        setRecordError("");
      })
      .catch((e) => setRecordError(e.message));
  }, [data]);
  if (!data) return null;
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
  const seedSources = data.snapshot.seedSources ?? [];
  const selected = draft ?? data.cost.context.selectedChannelIds;
  const projection = costProjection({
    ...data.cost.context,
    selectedChannelIds: selected,
  });
  const channels = data.snapshot.channels
    .filter((c) =>
      `${c.title} ${c.handle}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.title.localeCompare(b.title),
    );
  return (
    <>
      <PageTitle
        title="Channels"
        description="Choose whose ideas you follow and which new uploads to process."
      />
      <section className="yi-panel">
        <div className="yi-section-title">
          <h2>Source-backed channel catalog</h2>
          <button
            className="yi-secondary"
            disabled={
              busy ||
              !seedSources.some(
                (source) =>
                  !source.placeholder && source.installedCount < source.count,
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
              }, "Catalog added. Recommended processing is previewed below; save selection to enable it.")
            }
          >
            Add available channels
          </button>
        </div>
        <p className="yi-muted">
          Catalog setup adds channel metadata only. Enable discovery and preview
          processing costs before choosing automatic analysis.
        </p>
        {seedSources.map((source) => (
          <div key={source.source}>
            <div className="yi-row">
              <strong>
                {source.source === "truealpha" ? "TrueAlphaData" : "LeapEdge"}
              </strong>
              <span className="yi-chip">
                {source.placeholder
                  ? "Source unavailable"
                  : `${source.count} confirmed channel IDs · ${source.installedCount} added`}
              </span>
            </div>
            <p className="yi-muted">{source.note}</p>
          </div>
        ))}
      </section>
      <div className="yi-two-col">
        <form
          className="yi-panel"
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
          className="yi-panel"
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
        </form>
      </div>
      <section className="yi-panel yi-projection">
        <div>
          <p className="yi-eyebrow">SELECTION PREVIEW</p>
          <h2>
            {money(projection.projectedMonthlyUsd)} <small>/ month</small>
          </h2>
          <p>
            {selected.length} channels selected · budget{" "}
            {money(data.cost.budget.monthlyUsd)}
          </p>
          {projection.exceedsBudget && (
            <p className="yi-warning">
              This selection projects above your budget. You can save it; the
              spending cap still applies.
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
            disabled={busy || draft === null}
            onClick={() =>
              void perform(
                () =>
                  action("channels", "saveSelection", { channelIds: selected }),
                "Processing selection saved.",
              ).then((ok) => {
                if (ok) setDraft(null);
              })
            }
          >
            Save selection
          </button>
          <button
            className="yi-secondary"
            disabled={draft === null}
            onClick={() => setDraft(null)}
          >
            Discard changes
          </button>
        </div>
      </section>
      <Filters>
        <label>
          Filter channels
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or handle"
          />
        </label>
        <BenchmarkSelector />
      </Filters>
      {channels.length ? (
        <div className="yi-card-grid">
          {channels.map((c) => {
            const claims = data.snapshot.claims.filter(
              (x) => x.channelId === c.id,
            );
            const cost = projection.channels.find((x) => x.channelId === c.id);
            const record = board?.creators.find((row) => row.id === c.id);
            return (
              <article className="yi-panel" key={c.id}>
                <div className="yi-section-title">
                  <h2>{c.title || c.handle || c.id}</h2>
                  <button
                    className="yi-text-button"
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
                    {c.favorite ? "★" : "☆"}
                  </button>
                </div>
                <p className="yi-muted">
                  {c.handle || c.id} · {c.tier || "Unranked tier"}
                </p>
                <div className="yi-row">
                  {["L0", "L1", "L2", "L3"].map((level) => (
                    <span key={level}>
                      <TrustBadge level={level} />{" "}
                      {claims.filter((x) => x.trustLevel === level).length}
                    </span>
                  ))}
                </div>
                <p className="yi-muted">
                  Forward record vs {data.preferences.resolved.benchmark}:{" "}
                  {record
                    ? `${record.n} settled calls · ${percent(record.medianExcess)} median excess · ${record.status === "not-yet" ? "not enough statistical support" : record.status}`
                    : recordError
                      ? "Record unavailable: " + recordError
                      : "No eligible settled calls"}
                  .
                </p>
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
                    Discover uploads
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={(e) =>
                        setDraft(
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
                  Projected:{" "}
                  {selected.includes(c.id)
                    ? money(cost?.projectedMonthlyUsd)
                    : "Not selected"}{" "}
                  / month
                </p>
                {c.error && (
                  <p role="alert" className="yi-warning">
                    Discovery failed: {c.error}
                  </p>
                )}
                <button
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
                <div className="yi-upload-list">
                  {data.snapshot.discoveries
                    .filter((v) => v.channel_id === c.id)
                    .slice(0, 3)
                    .map((v) => (
                      <div key={String(v.video_id)}>
                        <span>{v.payload.title || String(v.video_id)}</span>
                        <button
                          disabled={busy || Boolean(v.run_id)}
                          onClick={() =>
                            void perform(
                              () =>
                                action(
                                  "channels",
                                  "analyzeUpload",
                                  String(v.video_id),
                                ),
                              "Video queued and future uploads selected for processing.",
                            )
                          }
                        >
                          {v.run_id
                            ? "Queued / analysed"
                            : "Analyse & process future uploads"}
                        </button>
                      </div>
                    ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="No matching channels">
          Follow a creator or try a different search.
        </Empty>
      )}
      {data.snapshot.channelCandidates.length > 0 && (
        <section className="yi-panel">
          <h2>Discovery results</h2>
          <ul className="yi-list">
            {data.snapshot.channelCandidates.map((c) => (
              <li key={String(c.id)}>
                <span>{String(c.sourceTitle ?? c.id)}</span>
                <button
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
        </section>
      )}
    </>
  );
}
