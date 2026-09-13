"use client";
import { useEffect, useState, useRef } from "react";
import {
  Radio,
  ArrowUpRight,
  Star,
  RefreshCw,
  FlaskConical,
  Settings2,
  Bookmark,
  Search,
  Users,
  ChartNoAxesCombined,
  Sun,
} from "lucide-react";
import type { researchSnapshot } from "../../server/youtube-intelligence/research-store";
import type { performance } from "../../server/youtube-intelligence/market";
import type { Channel } from "../../server/youtube-intelligence/channels";
import type { Briefing } from "../../server/youtube-intelligence/briefings";
import { MODELS, type CheckedClaim, type Run } from "./contracts";
import { TrendsPanel } from "./TrendsPanel";
import { localDate } from "./research-utils";
type Snapshot = Awaited<ReturnType<typeof researchSnapshot>> & {
  performances: Awaited<ReturnType<typeof performance>>[];
};
const tabs = [
  ["today", "Today", Sun],
  ["channels", "Channels", Users],
  ["ideas", "Saved ideas", Bookmark],
  ["search", "Search & trends", Search],
  ["performance", "Performance", ChartNoAxesCombined],
  ["lab", "Evaluation lab", FlaskConical],
  ["settings", "Settings", Settings2],
] as const;
function Json({ value }: { value: unknown }) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}
function fields(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form));
}
export function ResearchApp() {
  const [data, setData] = useState<Snapshot | null>(null),
    [tab, setTab] = useState("today"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [direction, setDirection] = useState(""),
    [conviction, setConviction] = useState(""),
    [channel, setChannel] = useState(""),
    [visibleUploads, setVisibleUploads] = useState<Record<string, number>>({}),
    [channelDetail, setChannelDetail] = useState(""),
    [range, setRange] = useState("all"),
    [ideaStatus, setIdeaStatus] = useState("open"),
    [left, setLeft] = useState(""),
    [right, setRight] = useState("");
  async function refresh() {
    const r = await fetch("/api/intelligence/research", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
    return d;
  }
  const channelDetailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (channelDetail) {
      channelDetailRef.current?.focus();
      channelDetailRef.current?.scrollIntoView({ block: "start" });
    }
  }, [channelDetail]);
  useEffect(() => {
    let alive = true;
    fetch("/api/intelligence/research", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          if (d.error) setError(d.error);
          else setData(d);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const t = new URLSearchParams(location.search).get("tab");
    if (t) setTab(t);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const theme = data.preferences.theme;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "dark" || (theme === "system" && media.matches)
          ? "dark"
          : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data?.preferences.theme]);
  async function act(action: string, payload: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/intelligence/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, data: payload }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      await refresh();
      setMessage(
        d.result?.path
          ? `Share link: ${location.origin}${d.result.path}`
          : "Saved.",
      );
      return d.result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setTab("search");
        setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>(
                'input[aria-label="Search research"]',
              )
              ?.focus(),
          0,
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function select(t: string) {
    setTab(t);
    history.replaceState(null, "", `/research?tab=${t}`);
    setMessage("");
  }
  if (!data)
    return (
      <main>
        <h1>YouTube Intelligence</h1>
        <p role="status">{error || "Loading your research workspace…"}</p>
        <a href="/">Return to analysis</a>
      </main>
    );
  const p = data.preferences,
    runs = data.runs as Run[],
    channels = data.channels as unknown as Channel[],
    briefings = data.briefings as unknown as Briefing[];
  const calls = runs.flatMap((r) =>
    ((r.output.claims || []) as CheckedClaim[])
      .filter((c) => c.passed)
      .map((c) => ({ run: r, item: c })),
  );
  const filtered = calls.filter(
    ({ run: r, item: c }) =>
      (!query ||
        `${r.title} ${c.claim.ticker || ""} ${c.claim.thesis_en}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!direction || c.claim.stance === direction) &&
      (!conviction || c.claim.creator_conviction === conviction) &&
      (!channel ||
        (r.output.metadata as { channel?: string })?.channel === channel) &&
      (range === "all" ||
        Date.now() - Date.parse(r.createdAt) <= Number(range) * 86400000),
  );
  const byTicker = Object.groupBy(
    filtered,
    (x) =>
      x.item.claim.ticker ||
      x.item.claim.instrument_as_spoken ||
      "Macro context",
  );
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Radio size={22} />
          </span>
          finradar<span className="lab-label">LAB</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/">Analyze a video</a>
        </nav>
        <span className="local-status">YouTube Intelligence</span>
      </header>
      <main className="research-main">
        <div className="breadcrumb">INTELLIGENCE / YOUTUBE</div>
        <section className="research-heading">
          <div>
            <h1>Your research, connected.</h1>
            <p>Follow the evidence across videos, creators and time.</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </section>
        <nav className="research-tabs" aria-label="Research sections">
          {tabs.map(([id, title, Icon]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => select(id)}
            >
              <Icon size={17} />
              {title}
            </button>
          ))}
        </nav>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {tab === "today" && (
          <>
            <div className="research-grid">
              <section className="panel research-panel">
                <div className="section-heading">
                  <h2>Today’s research</h2>
                  <span>
                    {localDate(new Date().toISOString(), p.timezone)} ·{" "}
                    {p.timezone}
                  </span>
                </div>
                <p>
                  By analysis date. Collection statistics use one latest
                  completed run per video, excluding duplicate A/B variants.
                </p>
                {runs
                  .filter(
                    (r) =>
                      localDate(r.createdAt, p.timezone) ===
                      localDate(new Date().toISOString(), p.timezone),
                  )
                  .map((r) => (
                    <a
                      className="research-row"
                      key={r.id}
                      href={`/?run=${r.id}`}
                    >
                      <strong>{r.title}</strong>
                      <span>
                        {String(
                          (r.output.metadata as { channel?: string })
                            ?.channel || "",
                        )}{" "}
                        · Open analysis <ArrowUpRight size={14} />
                      </span>
                    </a>
                  ))}
                {!runs.length && (
                  <p>
                    No completed research yet.{" "}
                    <a href="/">Analyze your first video.</a>
                  </p>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act("briefing", null)}
                >
                  Build evidence digest
                </button>
              </section>
              <section className="panel research-panel">
                <h2>Watchlist</h2>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = fields(e.currentTarget);
                    act("watch", { ticker: f.ticker, enabled: true });
                  }}
                >
                  <input
                    name="ticker"
                    aria-label="Watchlist ticker"
                    placeholder="Ticker, e.g. SPY"
                    required
                    maxLength={20}
                  />
                  <button className="secondary" disabled={busy}>
                    Add
                  </button>
                </form>
                {data.watchlist
                  .filter((w) => w.enabled)
                  .map((w) => (
                    <div className="research-row" key={String(w.ticker)}>
                      <button
                        onClick={() => {
                          setQuery(String(w.ticker));
                          select("search");
                        }}
                      >
                        {String(w.ticker)}
                      </button>
                      <button
                        onClick={() =>
                          act("watch", { ticker: w.ticker, enabled: false })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                <p>
                  Mentions in your collection only. No network-wide totals are
                  implied.
                </p>
              </section>
            </div>
            <section className="panel research-panel">
              <h2>Digest history</h2>
              {data.jobs.map((j) => (
                <p key={j.id}>
                  {j.title} · {j.status} · {j.stage}
                  {j.error ? ` · ${j.error}` : ""}
                </p>
              ))}
              {!briefings.length && (
                <p>
                  Build a digest to group today’s evidence. Empty days remain
                  explicit.
                </p>
              )}
              {briefings.map((b) => (
                <details key={b.id}>
                  <summary>
                    {b.date} · {b.runIds.length} videos · {b.groups.length}{" "}
                    topics
                  </summary>
                  <p>{b.kind}</p>
                  {b.summaryPoints
                    ?.filter((x) => x.passed)
                    .map((x, i) => (
                      <article key={i}>
                        <p>{x.text_en}</p>
                        {x.refs.map((ref) => (
                          <a
                            key={ref.runId + ref.claimId}
                            href={`/?run=${ref.runId}`}
                          >
                            Evidence {ref.claimId} ↗{" "}
                          </a>
                        ))}
                      </article>
                    ))}
                  <button
                    className="secondary"
                    disabled={busy || !b.groups.length}
                    onClick={() => act("synthesizeBriefing", b.id)}
                  >
                    Synthesize and audit cross-video research
                  </button>
                  {b.groups.map((g) => (
                    <article key={g.ticker}>
                      <h3>
                        {g.ticker} · {g.agreement}
                      </h3>
                      {g.calls.map((c) => (
                        <p key={c.runId + c.claimId}>
                          <a href={`/?run=${c.runId}`}>{c.channel} ↗</a> ·{" "}
                          {c.claim.thesis_en}
                        </p>
                      ))}
                    </article>
                  ))}
                  {b.limitations.map((x) => (
                    <p key={x}>{x}</p>
                  ))}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => act("share", b.id)}
                  >
                    Create 7-day share link
                  </button>
                </details>
              ))}
            </section>
          </>
        )}
        {tab === "channels" && (
          <>
            <section className="panel research-panel">
              <h2>Follow a channel</h2>
              <p>
                Discover uploads first. Auto-analysis is a separate choice and
                respects the model spend limit.
              </p>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  act("follow", fields(e.currentTarget).channel);
                }}
              >
                <input
                  name="channel"
                  aria-label="YouTube channel"
                  placeholder="YouTube channel URL, @handle or UC… ID"
                  required
                />
                <button className="primary" disabled={busy}>
                  Follow channel
                </button>
              </form>
            </section>
            {channelDetail && (
              <section
                ref={channelDetailRef}
                tabIndex={-1}
                className="panel research-panel"
              >
                <button onClick={() => setChannelDetail("")}>
                  Close channel detail
                </button>
                <h2>{channels.find((c) => c.id === channelDetail)?.title}</h2>
                <p>
                  Personal collection. Historical performance includes only
                  recommendations we have captured.
                </p>
                <TrendsPanel
                  calls={calls.filter(
                    (c) =>
                      (c.run.output.metadata as { channelId?: string })
                        ?.channelId === channelDetail,
                  )}
                />
                {runs
                  .filter(
                    (r) =>
                      (r.output.metadata as { channelId?: string })
                        ?.channelId === channelDetail,
                  )
                  .map((r) => (
                    <article key={r.id}>
                      <a href={`/?run=${r.id}`}>{r.title}</a>
                      <p>
                        Published{" "}
                        {String(
                          (r.output.metadata as { publishedAt?: string })
                            ?.publishedAt || "Unknown",
                        ).slice(0, 10)}{" "}
                        · Analyzed {r.createdAt.slice(0, 10)}
                      </p>
                    </article>
                  ))}
              </section>
            )}
            <div className="research-grid">
              {channels
                .filter((c) => c.active)
                .sort(
                  (a, b) =>
                    Number(b.favorite) - Number(a.favorite) ||
                    a.title.localeCompare(b.title),
                )
                .map((c) => (
                  <section className="panel research-panel" key={c.id}>
                    <div className="section-heading">
                      <h2>{c.title}</h2>
                      <button
                        aria-label={`Favourite ${c.title}`}
                        aria-pressed={c.favorite}
                        onClick={() =>
                          act("channel", { id: c.id, favorite: !c.favorite })
                        }
                      >
                        <Star
                          size={18}
                          fill={c.favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                    <p>{c.handle}</p>
                    <p>
                      {
                        runs.filter(
                          (r) =>
                            (r.output.metadata as { channel?: string })
                              ?.channel === c.title,
                        ).length
                      }{" "}
                      collection videos ·{" "}
                      {
                        calls.filter(
                          (x) =>
                            (x.run.output.metadata as { channel?: string })
                              ?.channel === c.title,
                        ).length
                      }{" "}
                      accepted research claims
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setChannelDetail(c.id);
                      }}
                    >
                      View channel research & trends
                    </button>
                    <p>
                      Last successful pull:{" "}
                      {c.lastPull
                        ? new Date(c.lastPull).toLocaleString()
                        : "Not yet pulled"}
                    </p>
                    <p>
                      Next scheduled pull:{" "}
                      {p.autoPullEnabled
                        ? c.nextPullAt
                          ? new Date(c.nextPullAt).toLocaleString()
                          : "Due on next scheduler sweep"
                        : "Paused in Settings"}
                    </p>
                    {c.error && (
                      <p role="alert">Last attempt failed: {c.error}</p>
                    )}
                    <div className="inline-form">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => act("pull", c.id)}
                      >
                        Discover latest uploads
                      </button>
                      {c.nextPageToken && (
                        <button
                          disabled={busy}
                          onClick={() => act("pullOlder", c.id)}
                        >
                          Discover older uploads
                        </button>
                      )}
                      <button
                        onClick={() =>
                          act("channel", { id: c.id, active: false })
                        }
                      >
                        Unfollow
                      </button>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={c.autoAnalyze}
                        onChange={(e) =>
                          act("channel", {
                            id: c.id,
                            autoAnalyze: e.target.checked,
                          })
                        }
                      />{" "}
                      Automatically analyze new uploads after follow date
                    </label>
                    <p>
                      Global scheduled pulls:{" "}
                      {p.autoPullEnabled ? "enabled" : "disabled in Settings"}
                    </p>
                    <details>
                      <summary>
                        Discovered uploads (
                        {
                          data.discoveries.filter((v) => v.channel_id === c.id)
                            .length
                        }
                        )
                      </summary>
                      {data.discoveries
                        .filter((v) => v.channel_id === c.id)
                        .slice(0, visibleUploads[c.id] || 20)
                        .map((v) => (
                          <div
                            className="research-row"
                            key={String(v.video_id)}
                          >
                            <span>
                              {v.payload.title}
                              <small>
                                Published {v.payload.publishedAt?.slice(0, 50)}
                              </small>
                            </span>
                            {v.run_id ? (
                              <a href={`/?run=${v.run_id}`}>View run</a>
                            ) : (
                              <button
                                disabled={busy}
                                onClick={() => act("analyzeUpload", v.video_id)}
                              >
                                Analyze
                              </button>
                            )}
                          </div>
                        ))}
                      {data.discoveries.filter((v) => v.channel_id === c.id)
                        .length > (visibleUploads[c.id] || 20) && (
                        <button
                          onClick={() =>
                            setVisibleUploads((old) => ({
                              ...old,
                              [c.id]: (old[c.id] || 20) + 50,
                            }))
                          }
                        >
                          Show 50 more discovered uploads
                        </button>
                      )}
                    </details>
                  </section>
                ))}
            </div>
            {!channels.some((c) => c.active) && (
              <p>No followed channels. Add one above to discover uploads.</p>
            )}
          </>
        )}
        {tab === "ideas" && (
          <section className="panel research-panel">
            <div className="section-heading">
              <h2>Saved ideas</h2>
              <select
                aria-label="Saved idea status"
                value={ideaStatus}
                onChange={(e) => setIdeaStatus(e.target.value)}
              >
                {["open", "done", "dismissed", "all"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {data.ideas
              .filter((i) => ideaStatus === "all" || i.status === ideaStatus)
              .map((i) => (
                <article key={String(i.id)}>
                  <h3>
                    {String(
                      (i.claim as { ticker: string }).ticker || "Research idea",
                    )}{" "}
                    · {String(i.channel)}
                  </h3>
                  <p>{String((i.claim as { thesis_en: string }).thesis_en)}</p>
                  <a href={`/?run=${i.runId}`}>View original evidence ↗</a>
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      act("idea", { id: i.id, ...fields(e.currentTarget) });
                    }}
                  >
                    <select
                      name="status"
                      aria-label="Idea status"
                      defaultValue={String(i.status)}
                    >
                      {["open", "done", "dismissed"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      name="note"
                      aria-label="Idea note"
                      defaultValue={String(i.note || "")}
                      placeholder="Your research note"
                    />
                    <button className="secondary" disabled={busy}>
                      Save
                    </button>
                  </form>
                </article>
              ))}
            {!data.ideas.filter(
              (i) => ideaStatus === "all" || i.status === ideaStatus,
            ).length && (
              <p>
                No ideas in this view.{" "}
                <button onClick={() => select("search")}>
                  Browse accepted claims
                </button>{" "}
                and save one for follow-up.
              </p>
            )}
          </section>
        )}
        {tab === "search" && (
          <>
            <section className="panel research-panel">
              <h2>Search your evidence</h2>
              <button
                disabled={busy || !filtered.length}
                onClick={() =>
                  act("shareSelection", {
                    query,
                    direction,
                    conviction,
                    channel,
                    range,
                  })
                }
              >
                Share this filtered snapshot for 7 days
              </button>
              <div className="filter-grid">
                <input
                  aria-label="Search research"
                  placeholder="Title, ticker or thesis"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Direction"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="">All directions</option>
                  {[
                    "long",
                    "short",
                    "neutral",
                    "avoid",
                    "watch",
                    "hold",
                    "conditional",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  aria-label="Conviction"
                  value={conviction}
                  onChange={(e) => setConviction(e.target.value)}
                >
                  <option value="">All conviction</option>
                  {["high", "medium", "low", "unspecified"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  aria-label="Channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="">All channels</option>
                  {[
                    ...new Set(
                      calls.map((x) =>
                        String(
                          (x.run.output.metadata as { channel?: string })
                            ?.channel || "",
                        ),
                      ),
                    ),
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  aria-label="Analysis date range"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  {["all", "1", "7", "30", "90", "365"].map((x) => (
                    <option key={x} value={x}>
                      {x === "all" ? "All dates" : `Last ${x} days`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setQuery("");
                    setDirection("");
                    setConviction("");
                    setChannel("");
                    setRange("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
              <p>
                {filtered.length} accepted claims across{" "}
                {new Set(filtered.map((x) => x.run.id)).size} videos · analysis
                dates
              </p>
              <TrendsPanel calls={filtered} />
              {filtered.map(({ run: r, item: c }) => (
                <article key={r.id + c.id}>
                  <div className="section-heading">
                    <h3>
                      {c.claim.ticker ||
                        c.claim.instrument_as_spoken ||
                        "Macro context"}{" "}
                      · {c.claim.stance}
                    </h3>
                    <span>{c.claim.creator_conviction} creator conviction</span>
                  </div>
                  <p>{c.claim.thesis_en}</p>
                  {c.claim.conditions_en.length > 0 && (
                    <p>
                      <strong>Conditions:</strong>{" "}
                      {c.claim.conditions_en.join("; ")}
                    </p>
                  )}
                  {c.claim.evidence.map((e, i) => (
                    <blockquote key={i}>
                      {e.quote_original}
                      <p>{e.quote_translation_en}</p>
                    </blockquote>
                  ))}
                  <div className="inline-form">
                    <a href={`/?run=${r.id}`}>Verify source ↗</a>
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        data.ideas.some((i) => i.id === r.id + ":" + c.id)
                      }
                      onClick={() =>
                        act("saveIdea", { runId: r.id, claimId: c.id })
                      }
                    >
                      {data.ideas.some((i) => i.id === r.id + ":" + c.id)
                        ? "Saved"
                        : "Save idea"}
                    </button>
                  </div>
                </article>
              ))}
              {!filtered.length && (
                <p>
                  No matching claims. Clear filters or analyze another video.
                </p>
              )}
            </section>
            <section className="panel research-panel">
              <h2>Direction history</h2>
              <p>
                Evidence from the filtered collection. Different horizons and
                conditional calls are retained.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Analysis date</th>
                      <th>Channel</th>
                      <th>Direction</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(byTicker).flatMap(([ticker, items]) =>
                      items!.map(({ run: r, item: c }) => (
                        <tr key={r.id + c.id}>
                          <td>{ticker}</td>
                          <td>{r.createdAt.slice(0, 50)}</td>
                          <td>
                            {String(
                              (r.output.metadata as { channel?: string })
                                ?.channel || "",
                            )}
                          </td>
                          <td>{c.claim.stance}</td>
                          <td>
                            <a href={`/?run=${r.id}`}>Open</a>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {tab === "performance" && (
          <section className="panel research-panel">
            <h2>Creator performance versus SPY</h2>
            <p>
              Adjusted FMP prices. Medium/high conviction long and short calls
              only. Each call uses matching stock and SPY dates. Sunday analyses
              may remain unpriced until a common trading session exists.
            </p>
            <div className="inline-form">
              <button
                className="primary"
                disabled={busy}
                onClick={() => act("performance", "leapedge")}
              >
                Calculate comparison methodology
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => act("performance", "forward")}
              >
                Calculate forward methodology
              </button>
              <button
                disabled={busy}
                onClick={() => act("performance", "historical")}
              >
                Replay from video publication dates
              </button>
            </div>
            <p>
              Historical analyses are retrospective. A channel average is not a
              portfolio return. Provider and holiday-rule differences are
              recorded with each calculation.
            </p>
            {data.performances.map((r) => (
              <details key={String(r.id)}>
                <summary>
                  {String(r.asOf)} · {String(r.mode)} · saved calculation
                </summary>
                <p>
                  {r.summary.priced} priced / {r.summary.total} calls ·{" "}
                  {r.summary.completed} completed · {r.summary.ongoing} ongoing
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>Priced calls</th>
                        <th>Mean return</th>
                        <th>SPY</th>
                        <th>Excess</th>
                        <th>Win rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.channels?.map((c) => (
                        <tr key={c.channel}>
                          <td>{c.channel}</td>
                          <td>{c.priced}</td>
                          {[
                            c.meanReturn,
                            c.meanSpy,
                            c.meanExcess,
                            c.winRate,
                          ].map((v, i) => (
                            <td key={i}>
                              {v === null ? "—" : `${(v * 100).toFixed(2)}%`}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.rows
                  .filter((x) => x.reason)
                  .map((x) => (
                    <p key={x.id}>
                      {x.id.split(":").at(-1)}: {x.status} — {x.reason}
                    </p>
                  ))}
                <details>
                  <summary>Call-level prices, dates and methodology</summary>
                  <Json value={r} />
                </details>
              </details>
            ))}
          </section>
        )}
        {tab === "lab" && (
          <>
            <section className="panel research-panel">
              <h2>LeapEdge reference expectations</h2>
              <p>
                Observed signed-in reports. These are comparison references, not
                ground truth or access to LeapEdge’s internal prompts.
              </p>
              {data.references.map((r) => (
                <details key={r.videoId}>
                  <summary>
                    {r.videoId} · {r.tradeIdeas} trade ideas · {r.keyPoints} key
                    points
                  </summary>
                  <p>{r.finding}</p>
                  <ul>
                    {r.topics.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <p>
                    Displayed cost: US${r.displayedCostUsd.toFixed(3)} · tokens:{" "}
                    {r.displayedTokens}. {r.limitations}
                  </p>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    Open reference report
                  </a>
                </details>
              ))}
              <h2>Independent audio evidence review</h2>
              <p>
                A separate multimodal pass compares accepted quotes and numeric
                roles with the source video. This is model review, not human
                verification.
              </p>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  act("audioReview", fields(e.currentTarget).runId);
                }}
              >
                <select
                  name="runId"
                  aria-label="Analysis for audio review"
                  required
                >
                  <option value="">Choose analysis</option>
                  {data.evaluationRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {r.model}
                    </option>
                  ))}
                </select>
                <button disabled={busy}>Queue paid audio review</button>
              </form>
              {data.audioReviews.map((a) => (
                <details key={String(a.id)}>
                  <summary>
                    {String(a.videoId)} ·{" "}
                    {a.video_accessible
                      ? "Audio examined"
                      : "Audio inaccessible"}{" "}
                    · {String(a.at)}
                  </summary>
                  <Json value={a} />
                </details>
              ))}
              <h2>Run a fresh A/B experiment</h2>
              <p>
                Both variants use the same retained transcript. New generations
                use the shared API budget and are kept separate from published
                research.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = fields(e.currentTarget);
                  act("experiment", {
                    baselineId: f.baselineId,
                    hypothesis: f.hypothesis,
                    variants: [
                      {
                        model: f.modelA,
                        criticModel: f.modelA,
                        promptVersion: f.promptA,
                      },
                      {
                        model: f.modelB,
                        criticModel: f.modelB,
                        promptVersion: f.promptB,
                      },
                    ],
                  });
                }}
              >
                <label>
                  Source video
                  <select name="baselineId" required>
                    <option value="">Choose retained source</option>
                    {data.evaluationRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} · {r.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="filter-grid">
                  {["A", "B"].map((side, i) => (
                    <fieldset key={side}>
                      <legend>Variant {side}</legend>
                      <label>
                        Model
                        <select name={`model${side}`} defaultValue={MODELS[i]}>
                          {MODELS.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Prompt
                        <select
                          name={`prompt${side}`}
                          defaultValue={p.promptVersion}
                        >
                          {data.prompts.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                  ))}
                </div>
                <label>
                  Hypothesis
                  <input
                    name="hypothesis"
                    required
                    minLength={10}
                    placeholder="Which measurable quality improvement are we testing?"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Queue paid A/B experiment
                </button>
              </form>
              {data.experiments.map((e) => (
                <details key={String(e.id)}>
                  <summary>
                    {String(e.status)} · {String(e.videoId)} ·{" "}
                    {String(e.createdAt)}
                  </summary>
                  <Json value={e} />
                </details>
              ))}
              <h2>Automated regression evaluations</h2>
              <p>
                Promptfoo checks frozen model outputs against retained evidence
                and explicit coverage expectations. Replay runs incur no new
                model charges; a passing result does not establish audio
                accuracy.
              </p>
              {data.evaluations.length === 0 && (
                <p>No automated evaluations have been recorded yet.</p>
              )}
              {data.evaluations.map((e) => (
                <details key={String(e.id)}>
                  <summary>
                    {String(e.at)} · {String(e.checkVersion)} · {String(e.mode)}{" "}
                    · {e.rows.filter((r) => r.pass).length}/{e.rows.length}{" "}
                    passed
                  </summary>
                  <p>{e.limitation}</p>
                  <p>New model cost: ${e.newModelCostUsd.toFixed(2)}</p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Video / model</th>
                          <th>Prompt</th>
                          <th>Result</th>
                          <th>Findings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.rows.map((r) => (
                          <tr key={r.runId}>
                            <td>
                              <a href={`/?run=${encodeURIComponent(r.runId)}`}>
                                {r.videoId}
                              </a>
                              <br />
                              {r.model.replace("google/", "")}
                            </td>
                            <td>{r.promptVersion}</td>
                            <td>{r.pass ? "Passed" : "Needs improvement"}</td>
                            <td>{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details>
                    <summary>Technical record</summary>
                    <Json value={e} />
                  </details>
                </details>
              ))}
              <h2>Reproducible A/B comparisons</h2>
              <p>
                Capture two completed runs and an explicit hypothesis. Snapshots
                preserve source hashes, prompts, model metrics and
                accepted/rejected claims. Human assessment remains separate from
                model critique.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act("comparison", {
                    leftId: left,
                    rightId: right,
                    hypothesis: fields(e.currentTarget).hypothesis,
                  });
                }}
              >
                <div className="filter-grid">
                  <select
                    aria-label="Baseline run"
                    value={left}
                    required
                    onChange={(e) => setLeft(e.target.value)}
                  >
                    <option value="">Baseline run</option>
                    {data.evaluationRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} · {r.model} · {r.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Candidate run"
                    value={right}
                    required
                    onChange={(e) => setRight(e.target.value)}
                  >
                    <option value="">Candidate run</option>
                    {data.evaluationRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} · {r.model} · {r.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </div>
                <label>
                  Hypothesis
                  <input
                    name="hypothesis"
                    required
                    minLength={5}
                    placeholder="What should this change improve?"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Save comparison snapshots
                </button>
              </form>
              {data.comparisons.map((c) => (
                <details key={String(c.id)}>
                  <summary>
                    {String(c.hypothesis)} ·{" "}
                    {c.sameSource ? "Same source" : "Sources differ"} ·{" "}
                    {data.reviews.some((r) => r.comparisonId === c.id)
                      ? "Reviewed"
                      : "Awaiting review"}
                  </summary>
                  <div className="research-grid">
                    {["left", "right"].map((side) => {
                      const r = c[side] as Run;
                      return (
                        <section key={side}>
                          <h3>
                            {side === "left" ? "Baseline" : "Candidate"} ·{" "}
                            {r.model}
                          </h3>
                          <p>
                            {r.promptVersion} · ${r.cost.toFixed(4)} USD
                          </p>
                          <a href={`/?run=${r.id}`}>Open complete analysis ↗</a>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => act("publishRun", r.id)}
                          >
                            Use this version in collection
                          </button>
                          {((r.output.claims || []) as CheckedClaim[]).map(
                            (x) => (
                              <article key={x.id}>
                                <strong>
                                  {x.passed ? "Accepted" : "Rejected"}
                                </strong>
                                <p>{x.claim.thesis_en}</p>
                                <p>{x.reasons.join("; ")}</p>
                              </article>
                            ),
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = fields(e.currentTarget);
                      act("review", {
                        comparisonId: c.id,
                        ...f,
                        accuracy: Number(f.accuracy),
                        completeness: Number(f.completeness),
                        evidence: Number(f.evidence),
                      });
                    }}
                  >
                    <div className="filter-grid">
                      <label>
                        Winner
                        <select name="winner">
                          {["inconclusive", "left", "right", "tie"].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </label>
                      {["accuracy", "completeness", "evidence"].map((x) => (
                        <label key={x}>
                          {x} (0–5)
                          <input
                            name={x}
                            type="number"
                            min="0"
                            max="5"
                            step="0.5"
                            required
                            defaultValue="0"
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      Reviewer
                      <input
                        name="reviewer"
                        required
                        placeholder="Name or reviewer identity"
                      />
                    </label>
                    <label>
                      Evidence and rationale
                      <textarea name="notes" required minLength={20} />
                    </label>
                    <button className="secondary" disabled={busy}>
                      Append review
                    </button>
                  </form>
                  {data.reviews
                    .filter((r) => r.comparisonId === c.id)
                    .map((r) => (
                      <Json key={String(r.id)} value={r} />
                    ))}
                </details>
              ))}
            </section>
            <section className="panel research-panel">
              <h2>Improvement journal</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = fields(e.currentTarget);
                  act("improvement", {
                    ...f,
                    ...(!f.comparisonId ? { comparisonId: undefined } : {}),
                  });
                }}
              >
                <label>
                  Title
                  <input name="title" minLength={5} required />
                </label>
                <label>
                  Observed problem
                  <textarea name="problem" minLength={10} required />
                </label>
                <label>
                  Proposed change
                  <textarea name="proposal" minLength={10} required />
                </label>
                <label>
                  Outcome
                  <textarea name="outcome" defaultValue="Not yet tested" />
                </label>
                <div className="filter-grid">
                  <select aria-label="Improvement status" name="status">
                    {["proposed", "testing", "accepted", "rejected"].map(
                      (x) => (
                        <option key={x}>{x}</option>
                      ),
                    )}
                  </select>
                  <select
                    aria-label="Supporting comparison"
                    name="comparisonId"
                  >
                    <option value="">No supporting comparison yet</option>
                    {data.comparisons.map((c) => (
                      <option key={String(c.id)} value={String(c.id)}>
                        {String(c.hypothesis)}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="secondary" disabled={busy}>
                  Append improvement record
                </button>
              </form>
              {data.improvements.map((i) => (
                <details key={String(i.id)}>
                  <summary>
                    {String(i.title)} · {String(i.status)}
                  </summary>
                  <Json value={i} />
                </details>
              ))}
            </section>
          </>
        )}
        {tab === "settings" && (
          <>
            <section className="panel research-panel">
              <h2>Research preferences</h2>
              <details>
                <summary>Free caption retrieval history</summary>
                <Json value={data.captionAttempts} />
              </details>
              <p>
                Connections: YouTube{" "}
                {data.integrations.youtube ? "ready" : "missing"} · OpenRouter{" "}
                {data.integrations.openrouter ? "ready" : "missing"} · FMP{" "}
                {data.integrations.fmp ? "ready" : "missing"} · Native captions:
                YouTube.js{" "}
                {data.integrations.youtubeJs ? "enabled" : "disabled"} · Paid
                caption backup{" "}
                {data.integrations.nativeCaptions
                  ? "configured"
                  : "not configured"}{" "}
                · Email{" "}
                {data.integrations.emailConfigured
                  ? "configured"
                  : "awaiting setup"}
              </p>
              <form
                key={JSON.stringify(p)}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = fields(e.currentTarget);
                  act("preferences", {
                    ...f,
                    digestHour: Number(f.digestHour),
                    digestEnabled: f.digestEnabled === "on",
                    autoPullEnabled: f.autoPullEnabled === "on",
                    windowedTranscription:f.windowedTranscription === "on",
                  });
                }}
              >
                <div className="filter-grid">
                  <label>
                    Timezone
                    <input name="timezone" defaultValue={p.timezone} required />
                  </label>
                  <label>
                    Appearance
                    <select name="theme" defaultValue={p.theme}>
                      {["light", "dark", "system"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Synthesis model
                    <select name="model" defaultValue={p.model}>
                      {MODELS.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Critique model
                    <select name="criticModel" defaultValue={p.criticModel}>
                      {MODELS.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Video transcription fallback
                    <select
                      name="transcriptionModel"
                      defaultValue={p.transcriptionModel}
                    >
                      {["google/gemini-3.1-flash-lite", ...MODELS].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <small>
                      Used only when captions are unavailable; video input costs
                      more than retained-text synthesis.
                    </small>
                  </label>
                  <label>
                    Active prompt
                    <select name="promptVersion" defaultValue={p.promptVersion}>
                      {data.prompts.map((x) => (
                        <option key={x.id}>{x.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Digest local hour
                    <input
                      name="digestHour"
                      type="number"
                      min="0"
                      max="23"
                      defaultValue={p.digestHour}
                    />
                  </label>
                </div>
                <label><input name="windowedTranscription" type="checkbox" defaultChecked={p.windowedTranscription}/>{" "}Experimental long-video transcription windows</label><p>Off by default: our long-video test produced inconsistent timing. Use a verified timed transcript when source quality is critical.</p>
                <label>
                  <input
                    name="autoPullEnabled"
                    type="checkbox"
                    defaultChecked={p.autoPullEnabled}
                  />{" "}
                  Enable scheduled channel discovery
                </label>
                <label>
                  <input
                    name="digestEnabled"
                    type="checkbox"
                    defaultChecked={p.digestEnabled}
                  />{" "}
                  Prepare daily digest at the selected local hour
                </label>
                <p>
                  Delivery currently prepares a preview; email sending requires
                  a configured provider and recipient.
                </p>
                <button className="primary" disabled={busy}>
                  Save preferences
                </button>
              </form>
            </section>
            <section className="panel research-panel">
              <h2>Versioned prompts</h2>
              <p>
                Every saved version is immutable. Select an earlier version
                above to restore its behaviour for future runs.
              </p>
              {data.prompts.map((v) => (
                <details key={v.id}>
                  <summary>
                    {v.id} · {v.rationale}
                  </summary>
                  <Json value={v} />
                  <button
                    className="secondary"
                    onClick={() => {
                      const text = JSON.stringify(
                        {
                          ...v,
                          id: v.id + ".next",
                          rationale:
                            "Describe the intended measurable improvement.",
                        },
                        null,
                        2,
                      );
                      const el = document.getElementById(
                        "prompt-json",
                      ) as HTMLTextAreaElement;
                      if (el) {
                        el.value = text;
                        el.focus();
                      }
                    }}
                  >
                    Use as new version
                  </button>
                </details>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    act(
                      "prompt",
                      JSON.parse(String(fields(e.currentTarget).prompt)),
                    );
                  } catch {
                    setError("Enter valid prompt JSON.");
                  }
                }}
              >
                <label>
                  New prompt version JSON
                  <textarea
                    id="prompt-json"
                    name="prompt"
                    rows={10}
                    required
                    placeholder='{"id":"evidence.v2","rationale":"...","transcribe":"...","extraction":"...","synthesis":"...","critique":"..."}'
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Save immutable version
                </button>
              </form>
            </section>
            <section className="panel research-panel">
              <h2>Tokens, cost and processing history</h2>
              <p>
                USD provider costs are separate from the NZ$500 monthly
                operating budget. Reserved calls remain charged against the cap
                until resolved.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Stage</th>
                      <th>Status</th>
                      <th>USD</th>
                      <th>Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((c) => (
                      <tr key={String(c.id)}>
                        <td>
                          <a href={`/?run=${c.run_id}`}>
                            {String(c.run_id).slice(0, 8)}
                          </a>
                        </td>
                        <td>{String(c.stage)}</td>
                        <td>{String(c.status)}</td>
                        <td>{Number(c.amount).toFixed(5)}</td>
                        <td>
                          <details>
                            <summary>Tokens & latency</summary>
                            <Json value={c.metrics} />
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel research-panel">
              <h2>Shared snapshots</h2>
              {data.shares.map((s) => (
                <div className="research-row" key={String(s.id)}>
                  <span>
                    {String(s.id).slice(0, 8)} · expires{" "}
                    {String(s.expires_at).slice(0, 50)} ·{" "}
                    {s.revoked_at ? "revoked" : "active"}
                  </span>
                  <button
                    disabled={busy || !!s.revoked_at}
                    onClick={() => act("revoke", s.id)}
                  >
                    Revoke
                  </button>
                </div>
              ))}
              <details>
                <summary>Configuration and improvement audit history</summary>
                <Json value={data.events} />
              </details>
              <details>
                <summary>Scheduled digest previews</summary>
                <Json value={data.deliveries} />
              </details>
            </section>
          </>
        )}
      </main>
    </>
  );
}
