"use client";
import { UnreadDot } from "../UnreadDot.tsx";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { z } from "zod";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import { getAction } from "../get-action.ts";
import { useUrlState } from "../url-state.ts";
import { Empty, PageTitle, TrustBadge } from "../components.tsx";
import { SplitBar } from "../SplitBar.tsx";
import { StatTiles } from "../StatTiles.tsx";
import { InstrumentLabel } from "../InstrumentLabel.tsx";
import { TradingDay } from "../TradingDay.tsx";
import { ExportMenu } from "../ExportMenu.tsx";
import { money } from "../viewmodel.ts";
import { TrendsView } from "./Trends.tsx";
import { boardAsOf, type BoardSnapshot } from "../../leaderboard.ts";
import { costProjection } from "../../metrics/cost.ts";
import { verdictLine } from "../../report.ts";
import { TREND_RANGES } from "../../trends-series.ts";
import { channelTiles, liveStatus } from "../../channel-page.ts";
import type {
  InstrumentAggregate,
  VideoRow,
} from "../../../../server/youtube-intelligence/repos/research-query.ts";

type Aggregates = {
  calls: number;
  sentiment: Record<"bullish" | "neutral" | "bearish", { calls: number; creators: number }>;
  topInstruments: InstrumentAggregate[];
};
type Calls = { total: number; aggregates: Aggregates; facets: { trust: { value: string; count: number }[] } };
type Videos = { rows: VideoRow[]; total: number };

const ChannelState = z.object({ range: z.enum(TREND_RANGES) });

export function Channel({ id }: { id: string }) {
  return (
    <Suspense fallback={<p role="status">Loading the channel…</p>}>
      <ChannelPage id={id} />
    </Suspense>
  );
}

/**
 * One creator (F66): who they are, what they cover, which way they lean and
 * whether their settled calls beat the team benchmark, with the follow and
 * processing controls that used to live only on the Channels card.
 */
function ChannelPage({ id }: { id: string }) {
  const { data, busy, perform } = useWorkspace();
  const [view, setView] = useUrlState(ChannelState, { range: "1y" });
  const [calls, setCalls] = useState<Calls | null>(null),
    [videos, setVideos] = useState<Videos | null>(null),
    [recent, setRecent] = useState<number | null>(null),
    [board, setBoard] = useState<BoardSnapshot | null>(null),
    [error, setError] = useState(""),
    [recordError, setRecordError] = useState("");
  useEffect(() => {
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    Promise.all([
      getAction<Calls>("query", "calls", { channels: [id], limit: 1 }),
      getAction<Videos>("query", "videos", { channels: [id], limit: 10 }),
      getAction<Videos>("query", "videos", { channels: [id], from: week, limit: 1 }),
    ])
      .then(([c, v, r]) => {
        setCalls(c);
        setVideos(v);
        setRecent(r.total);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
    action<BoardSnapshot>("market", "boardSnapshot")
      .then(setBoard)
      .catch((e: Error) => setRecordError(e.message));
  }, [id, data]);
  if (!data) return null;
  const channel = data.snapshot.channels.find((c) => c.id === id);
  const name = channel?.title || channel?.handle || id;
  const benchmark =
    data.preferences.resolved.benchmark === "sector-etf"
      ? "sector"
      : data.preferences.resolved.benchmark.replace(/^custom:/, "");
  const record = board
    ? boardAsOf(board, {
        horizonDays: data.preferences.resolved.defaultHorizonDays,
        benchmark,
        record: "forward",
        markets: data.preferences.resolved.marketFilter,
      })
    : null;
  const row = record?.creators.find((r) => r.id === id) ?? null;
  const minimum = board ? Math.max(20, board.settings.leaderboard.minSettledForRank) : 20;
  const selected = data.cost.context.selectedChannelIds;
  const processing = selected.includes(id);
  const projection = costProjection(data.cost.context);
  const cost = projection.channels.find((c) => c.channelId === id);
  const videoIds = new Set(
    data.snapshot.discoveries.filter((d) => d.channel_id === id).map((d) => String(d.video_id)),
  );
  for (const v of videos?.rows ?? []) videoIds.add(v.videoId);
  const live = liveStatus(data.runs, videoIds);
  const split = calls
    ? {
        bullish: calls.aggregates.sentiment.bullish.calls,
        neutral: calls.aggregates.sentiment.neutral.calls,
        bearish: calls.aggregates.sentiment.bearish.calls,
      }
    : { bullish: 0, neutral: 0, bearish: 0 };
  const tiles =
    calls && videos && recent !== null
      ? channelTiles({
          videos: videos.total,
          videosLast7: recent,
          calls: calls.total,
          split,
          record: row
            ? { n: row.n, medianExcess: row.medianExcess, q: row.q, status: row.status }
            : null,
          minimumSettled: minimum,
          benchmark: data.preferences.resolved.benchmark.replace(/^custom:/, "").replace("sector-etf", "sector ETF"),
          horizonDays: data.preferences.resolved.defaultHorizonDays,
        })
      : null;
  if (!channel && calls && calls.total === 0 && videos?.total === 0)
    return (
      <>
        <PageTitle title="Channel" description="One creator's calls, lean and record against your benchmark." />
        <Empty title="This channel is not in your workspace">
          <Link href="/youtube-intelligence/channels">Back to Channels</Link>
        </Empty>
      </>
    );
  return (
    <>
      <PageTitle
        title={String(name || "Channel")}
        description="One creator's calls, lean and record against your benchmark."
      />
      <section className="yi-panel yi-channel-header" aria-label="Channel">
        <div className="yi-channel-identity">
          <p className="yi-muted">
            {channel?.handle || id}
            {channel?.followedAt || channel?.createdAt ? (
              <>
                {" "}
                · following since <TradingDay at={channel.followedAt ?? channel.createdAt} year />
              </>
            ) : null}
          </p>
          <p className={live ? "yi-live-status yi-live-on" : "yi-live-status"} role="status">
            {live ?? "Nothing analysing now"}
          </p>
        </div>
        {channel && (
          <div className="yi-switches">
            <label>
              <input
                type="checkbox"
                checked={channel.active}
                disabled={busy}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  void perform(
                    () =>
                      enabled && !channel.uploads
                        ? action("channels", "follow", channel.id)
                        : action("channels", "channel", { id: channel.id, active: enabled }),
                    enabled ? "Following: new uploads are discovered." : "Unfollowed: new uploads are no longer discovered.",
                  );
                }}
              />{" "}
              Follow (discover new uploads)
            </label>
            <label>
              <input
                type="checkbox"
                checked={processing}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  void perform(
                    () =>
                      action("channels", "saveSelection", {
                        channelIds: on ? [...new Set([...selected, id])] : selected.filter((c) => c !== id),
                      }),
                    on
                      ? `New uploads will be analysed automatically${cost?.projectedMonthlyUsd != null ? ` (about ${money(cost.projectedMonthlyUsd)} a month)` : ""}.`
                      : "New uploads will no longer be analysed automatically.",
                  );
                }}
              />{" "}
              Process new uploads
            </label>
          </div>
        )}
        <nav className="yi-row yi-channel-links" aria-label="Channel links">
          <Link href={`/youtube-intelligence/search?${new URLSearchParams({ channel: id })}`}>Search this channel</Link>
          <a href={`https://www.youtube.com/channel/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
            Open on YouTube ↗
          </a>
          <ExportMenu input={{ channels: [id] }} total={calls?.total ?? 0} />
        </nav>
      </section>
      {error && (
        <p className="yi-warning" role="alert">
          Some of this channel could not be loaded: {error}
        </p>
      )}
      {tiles ? (
        <StatTiles
          label="Channel summary"
          tiles={tiles.map((t) =>
            t.label === "Lean"
              ? { label: t.label, value: t.value, note: t.note, children: <SplitBar calls={split} label="Lean" /> }
              : {
                  label: t.label,
                  value: t.value,
                  note: t.label.startsWith("Record") && recordError ? `Record unavailable: ${recordError}` : t.note,
                },
          )}
        />
      ) : (
        <p role="status">Loading…</p>
      )}
      <section className="yi-panel" aria-labelledby="yi-channel-trend">
        <div className="yi-section-title">
          <h2 id="yi-channel-trend">Calls over time</h2>
          <fieldset className="yi-range-chips">
            <legend className="yi-sr-only">Range</legend>
            {TREND_RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={view.range === r} onClick={() => setView({ range: r })}>
                {r === "all" ? "All" : r}
              </button>
            ))}
          </fieldset>
        </div>
        <TrendsView
          by="channel"
          value={id}
          valueLabel={String(name || id)}
          range={view.range}
          trust="L0"
          embedded
        />
      </section>
      <div className="yi-two-col yi-channel-cols">
        <section className="yi-panel" aria-labelledby="yi-channel-instruments">
          <h2 id="yi-channel-instruments">Most discussed</h2>
          {calls?.aggregates.topInstruments.length ? (
            <ol className="yi-channel-instruments">
              {calls.aggregates.topInstruments.map((i) => (
                <li key={i.instrument}>
                  <InstrumentLabel claim={{ ticker: i.kind === "stock" || i.kind === "crypto" ? i.instrument : null, instrument: i.instrument }} />
                  <span className="yi-muted">{i.calls} call{i.calls === 1 ? "" : "s"}</span>
                  <SplitBar calls={{ bullish: i.bullish, neutral: i.neutral, bearish: i.bearish }} label={i.instrument} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="yi-muted">No calls yet.</p>
          )}
        </section>
        <section className="yi-panel" aria-labelledby="yi-channel-recent">
          <h2 id="yi-channel-recent">Recent analyses</h2>
          {videos?.rows.length ? (
            <ul className="yi-report-sources">
              {videos.rows.map((v) => (
                <li key={v.runId}>
                  <UnreadDot run={{ id: v.runId, status: v.status, at: v.createdAt }} />
                  <Link href={`/youtube-intelligence/analysis/${encodeURIComponent(v.runId)}`}>{v.title || v.videoId}</Link>
                  <span className="yi-muted">
                    <TradingDay at={v.publishedAt} />
                  </span>
                  <span className="yi-verdict-line">
                    {verdictLine({ ideas: v.ideas, sentiment: v.sentiment, instruments: v.instrumentLabels })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="yi-muted">No analysed videos yet.</p>
          )}
          {videos && videos.total > videos.rows.length && (
            <p className="yi-muted">
              Showing the latest {videos.rows.length} of {videos.total}.{" "}
              <Link href={`/youtube-intelligence/search?${new URLSearchParams({ channel: id })}`}>See all in Search</Link>
            </p>
          )}
        </section>
      </div>
      <details className="yi-details yi-channel-processing">
        <summary>Processing</summary>
        <div>
          <dl className="yi-channel-facts">
            <div>
              <dt>Discovery</dt>
              <dd>{channel ? (channel.active ? channel.discovery || "Scheduled checks" : "Off") : "Not followed"}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{processing ? "New uploads analysed automatically" : "On request only"}</dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>{channel?.tier || "Unranked"}</dd>
            </div>
            <div>
              <dt>Last check for uploads</dt>
              <dd>{channel?.lastPull ? <TradingDay at={channel.lastPull} /> : "Never"}</dd>
            </div>
            <div>
              <dt>Projected monthly cost</dt>
              <dd>
                {processing
                  ? `${money(cost?.projectedMonthlyUsd)} / month`
                  : "Not processed automatically"}
              </dd>
            </div>
            <div>
              <dt>Trust of this channel&apos;s calls</dt>
              <dd className="yi-row">
                {(calls?.facets.trust ?? []).map((t) => (
                  <span key={t.value}>
                    <TrustBadge level={t.value} /> {t.count}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
          {channel?.error && (
            <p className="yi-warning" role="alert">
              The last upload check failed: {channel.error}
            </p>
          )}
        </div>
      </details>
    </>
  );
}
