import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
import { channelStats } from "../src/server/youtube-intelligence/channel-stats.ts";
import {
  RESOURCES,
  dispatch,
} from "../src/server/youtube-intelligence/actions/index.ts";
import {
  channelStatusLabel,
  filterChannels,
  relativeAge,
  recordLabel,
  sortChannels,
  type ChannelStat,
} from "../src/features/youtube-intelligence/channel-list.ts";
import { registry } from "../src/features/youtube-intelligence/metrics/registry.ts";
import { uiColumns } from "../src/features/youtube-intelligence/metrics/ui-columns.ts";

/**
 * F67. Four followed channels and one catalogue row nobody followed:
 *  - A: busy, with a queued upload (analysing), superseded and old runs;
 *  - B: last upload 21 days ago (silent);
 *  - C: a recent upload and nothing queued (idle);
 *  - D: followed, never pulled, never analysed (idle, no data);
 *  - Z: seeded but not followed (not listed).
 */
const NOW = "2026-09-29T15:00:00.000Z";
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const C = "UCcccccccccccccccccccccc";
const D = "UCdddddddddddddddddddddd";
const Z = "UCzzzzzzzzzzzzzzzzzzzzzz";
const daysAgo = (n: number, hours = 0) =>
  new Date(Date.parse(NOW) - n * 86400000 - hours * 3600000).toISOString();

async function channel(
  id: string,
  title: string,
  o: { active?: boolean; followedAt?: string | null } = {},
) {
  await database
    .prepare(
      "INSERT INTO channels(id,title,handle,active,followed_at,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    )
    .run(
      id,
      title,
      `@${title.toLowerCase().replace(/\W/g, "")}`,
      o.active ?? true,
      o.followedAt === undefined ? daysAgo(60) : o.followedAt,
      daysAgo(90),
    );
}
async function discovery(videoId: string, channelId: string, publishedAt: string, runId: string | null = null) {
  await database
    .prepare(
      "INSERT INTO yi_discoveries(video_id,channel_id,payload,discovered_at,run_id) VALUES($1,$2,$3,$4,$5)",
    )
    .run(videoId, channelId, JSON.stringify({ title: videoId, publishedAt }), publishedAt, runId);
}
async function run(
  id: string,
  o: {
    videoId: string;
    channelId: string;
    createdAt: string;
    status?: string;
    input?: Record<string, unknown>;
    calls?: [string | null, string, string?][];
  },
) {
  await database
    .prepare(
      "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,'m','v1',$4,$5,'publish',$6,$6,$7,$8)",
    )
    .run(
      id,
      o.videoId,
      `https://www.youtube.com/watch?v=${o.videoId}`,
      `Video ${o.videoId}`,
      o.status ?? "completed",
      o.createdAt,
      JSON.stringify(o.input ?? {}),
      JSON.stringify(
        o.status && o.status !== "completed"
          ? {}
          : { metadata: { channelId: o.channelId, publishedAt: o.createdAt } },
      ),
    );
  let i = 0;
  for (const [ticker, stance, instrument] of o.calls ?? [])
    await database
      .prepare(
        "INSERT INTO claims(id,run_id,video_id,channel_id,instrument,ticker,stance,thesis_en,trust_level,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,'t','L1',$8)",
      )
      .run(`${id}:c${++i}`, id, o.videoId, o.channelId, instrument ?? ticker, ticker, stance, o.createdAt);
}

before(async () => {
  await freshDatabase();
  await channel(A, "Alpha", { followedAt: daysAgo(10) });
  await channel(B, "Beta", { followedAt: daysAgo(40) });
  await channel(C, "Gamma", { followedAt: daysAgo(20) });
  await channel(D, "Delta", { followedAt: daysAgo(1) });
  await channel(Z, "Zeta", { active: false, followedAt: null });

  // A: three videos in the last 7 days, one of them analysed twice (the
  // superseded run must not count twice), one older than 30 days.
  await discovery("a1", A, daysAgo(1));
  await discovery("a2", A, daysAgo(3));
  await discovery("a3", A, daysAgo(5));
  await discovery("a-old", A, daysAgo(40));
  await discovery("a-new", A, daysAgo(0, 2), "ra-queued");
  await run("ra1-old", { videoId: "a1", channelId: A, createdAt: daysAgo(1, 3), calls: [["NVDA", "short"]] });
  await run("ra1", { videoId: "a1", channelId: A, createdAt: daysAgo(1), calls: [["NVDA", "long"], ["AAPL", "avoid"]] });
  await run("ra2", { videoId: "a2", channelId: A, createdAt: daysAgo(3), calls: [["NVDA", "long"], [null, "long", "rates"]] });
  await run("ra3", { videoId: "a3", channelId: A, createdAt: daysAgo(5), calls: [["TSLA", "hold"]] });
  await run("ra-old", { videoId: "a-old", channelId: A, createdAt: daysAgo(40), calls: [["AAPL", "long"], ["AAPL", "long"], ["AAPL", "long"]] });
  await run("ra-failed", { videoId: "a-fail", channelId: A, createdAt: daysAgo(2), status: "failed" });
  await run("ra-queued", { videoId: "a-new", channelId: A, createdAt: daysAgo(0, 1), status: "queued" });
  // A brief job is not a video analysis, even if it names the channel's video.
  await run("ra-task", { videoId: "a1", channelId: A, createdAt: daysAgo(0, 1), status: "running", input: { task: "researchBrief" } });

  // B: silent for 21 days; its last analysis is that upload.
  await discovery("b1", B, daysAgo(21));
  await run("rb1", { videoId: "b1", channelId: B, createdAt: daysAgo(21), calls: [["MSFT", "short"]] });

  // C: an upload two days ago, analysed; nothing queued.
  await discovery("c1", C, daysAgo(2));
  await run("rc1", { videoId: "c1", channelId: C, createdAt: daysAgo(2), calls: [["AMD", "long"], ["AMD", "neutral"]] });

  // Z would count if unfollowed channels leaked in.
  await discovery("z1", Z, daysAgo(1));
  await run("rz1", { videoId: "z1", channelId: Z, createdAt: daysAgo(1), calls: [["GME", "long"]] });

  await put("publication", "a1", { runId: "ra1" });
});

const byId = (rows: ChannelStat[]) => new Map(rows.map((r) => [r.channelId, r]));

test("only followed channels are listed, each with its identity", async () => {
  const rows = await channelStats({ now: NOW });
  assert.deepEqual(rows.map((r) => r.channelId).sort(), [A, B, C, D].sort());
  const a = byId(rows).get(A)!;
  assert.equal(a.title, "Alpha");
  assert.equal(a.handle, "@alpha");
  assert.equal(a.followedAt, daysAgo(10));
});

test("last analysed video and videos analysed in the last 7 days count each video once", async () => {
  const s = byId(await channelStats({ now: NOW }));
  const a = s.get(A)!;
  assert.equal(a.lastAnalysedAt, daysAgo(1));
  assert.equal(a.lastRunId, "ra1");
  assert.equal(a.videos7d, 3, "a1 (twice), a2, a3; failed, queued and task runs do not count");
  assert.equal(s.get(B)!.videos7d, 0);
  assert.equal(s.get(B)!.lastAnalysedAt, daysAgo(21));
  assert.equal(s.get(C)!.videos7d, 1);
  assert.equal(s.get(D)!.lastAnalysedAt, null);
  assert.equal(s.get(D)!.videos7d, 0);
});

test("top instrument and lean cover canonical calls from the last 30 days", async () => {
  const s = byId(await channelStats({ now: NOW }));
  const a = s.get(A)!;
  // ra1-old (superseded) and ra-old (40 days) are excluded: NVDA 2, AAPL 1, rates 1, TSLA 1.
  assert.deepEqual(a.topInstrument, { ticker: "NVDA", instrument: "NVDA", calls: 2 });
  assert.equal(a.calls30d, 5);
  assert.deepEqual(a.lean, { bullish: 3, neutral: 1, bearish: 1 });
  assert.deepEqual(s.get(B)!.lean, { bullish: 0, neutral: 0, bearish: 1 });
  assert.deepEqual(s.get(C)!.topInstrument, { ticker: "AMD", instrument: "AMD", calls: 2 });
  assert.equal(s.get(D)!.topInstrument, null);
  assert.deepEqual(s.get(D)!.lean, { bullish: 0, neutral: 0, bearish: 0 });
});

test("status: analysing beats silent, silent after 14 days without uploads, otherwise idle", async () => {
  const s = byId(await channelStats({ now: NOW }));
  assert.equal(s.get(A)!.status, "analysing");
  assert.equal(s.get(A)!.activeRuns, 1);
  assert.equal(s.get(B)!.status, "silent");
  assert.equal(s.get(B)!.silentDays, 21);
  assert.equal(s.get(B)!.lastUploadAt, daysAgo(21));
  assert.equal(s.get(C)!.status, "idle");
  assert.equal(s.get(C)!.silentDays, 2);
  // No upload data at all is not evidence of silence.
  assert.equal(s.get(D)!.status, "idle");
  assert.equal(s.get(D)!.lastUploadAt, null);
  assert.equal(s.get(D)!.silentDays, null);
  // Exactly 14 days is silent; 13 days is not.
  const at14 = byId(await channelStats({ now: new Date(Date.parse(daysAgo(2)) + 14 * 86400000).toISOString() }));
  assert.equal(at14.get(C)!.status, "silent");
  const at13 = byId(await channelStats({ now: new Date(Date.parse(daysAgo(2)) + 13 * 86400000).toISOString() }));
  assert.equal(at13.get(C)!.status, "idle");
});

test("channels/channelStats is a read action that answers on an empty database", async () => {
  const entry = RESOURCES.channels.channelStats;
  assert.equal(entry.mutating, false);
  const rows = (await dispatch("channels", "channelStats", undefined)) as ChannelStat[];
  assert.equal(rows.length, 4);
  await freshDatabase();
  assert.deepEqual(await dispatch("channels", "channelStats", undefined), []);
});

// --- Pure list helpers -------------------------------------------------------

const stat = (o: Partial<ChannelStat> & { channelId: string }): ChannelStat => ({
  title: o.channelId,
  handle: "",
  followedAt: null,
  favorite: false,
  status: "idle",
  activeRuns: 0,
  lastUploadAt: null,
  silentDays: null,
  lastAnalysedAt: null,
  lastRunId: null,
  videos7d: 0,
  calls30d: 0,
  topInstrument: null,
  lean: { bullish: 0, neutral: 0, bearish: 0 },
  ...o,
});

test("sort presets: most active, recently added, best record", () => {
  const rows = [
    stat({ channelId: "x", title: "Xylo", videos7d: 1, lastAnalysedAt: daysAgo(1), followedAt: daysAgo(30) }),
    stat({ channelId: "y", title: "Yak", videos7d: 5, lastAnalysedAt: daysAgo(3), followedAt: daysAgo(2) }),
    stat({ channelId: "z", title: "Zed", videos7d: 1, lastAnalysedAt: daysAgo(0), followedAt: null }),
  ];
  const records = new Map([
    ["x", { n: 12, medianExcess: 0.021, status: "supported" }],
    ["y", { n: 8, medianExcess: -0.01, status: "not-yet" }],
  ]);
  assert.deepEqual(sortChannels(rows, "active", records).map((r) => r.channelId), ["y", "z", "x"]);
  assert.deepEqual(sortChannels(rows, "added", records).map((r) => r.channelId), ["y", "x", "z"]);
  assert.deepEqual(sortChannels(rows, "record", records).map((r) => r.channelId), ["x", "y", "z"]);
  assert.deepEqual(sortChannels(rows, "channel", records).map((r) => r.channelId), ["x", "y", "z"]);
  assert.deepEqual(sortChannels(rows, "channel", records, "desc").map((r) => r.channelId), ["z", "y", "x"]);
  // Sorting never mutates its input.
  assert.deepEqual(rows.map((r) => r.channelId), ["x", "y", "z"]);
});

test("the filter matches name, handle or top instrument, case-insensitively", () => {
  const rows = [
    stat({ channelId: "a", title: "Macro Mike", handle: "@macromike" }),
    stat({ channelId: "b", title: "老王聊股", handle: "@laowang", topInstrument: { ticker: "NVDA", instrument: "英伟达", calls: 2 } }),
  ];
  assert.deepEqual(filterChannels(rows, "MIKE").map((r) => r.channelId), ["a"]);
  assert.deepEqual(filterChannels(rows, "老王").map((r) => r.channelId), ["b"]);
  assert.deepEqual(filterChannels(rows, "nvda").map((r) => r.channelId), ["b"]);
  assert.deepEqual(filterChannels(rows, "  ").map((r) => r.channelId), ["a", "b"]);
  assert.deepEqual(filterChannels(rows, "zzz"), []);
});

test("status, age and record labels read as plain text", () => {
  assert.equal(channelStatusLabel(stat({ channelId: "a", status: "analysing", activeRuns: 2 })).label, "Analysing 2");
  assert.equal(channelStatusLabel(stat({ channelId: "a", status: "analysing", activeRuns: 1 })).label, "Analysing");
  const silent = channelStatusLabel(stat({ channelId: "a", status: "silent", silentDays: 21 }));
  assert.equal(silent.label, "No uploads 21 d");
  assert.equal(silent.tone, "warn");
  assert.equal(channelStatusLabel(stat({ channelId: "a" })).label, "Idle");
  assert.equal(relativeAge(daysAgo(0, 4), NOW), "4 h ago");
  assert.equal(relativeAge(daysAgo(2), NOW), "2 d ago");
  assert.equal(relativeAge(new Date(Date.parse(NOW) - 20 * 60000).toISOString(), NOW), "Under 1 h ago");
  assert.equal(relativeAge(null, NOW), "—");
  assert.equal(recordLabel({ n: 31, medianExcess: 0.021, status: "supported" }), "+2.1% · n=31");
  assert.equal(recordLabel({ n: 31, medianExcess: -0.004, status: "not-yet" }), "−0.4% · n=31 · not significant");
  assert.equal(recordLabel({ n: 3, medianExcess: 0.1, status: "not-yet" }), "Too few settled calls (3 of 20)");
  assert.equal(recordLabel({ n: 3, medianExcess: 0.1, status: "not-yet" }, 5), "Too few settled calls (3 of 5)");
  assert.equal(recordLabel(undefined), "No settled calls");
});

test("every Channels table heading is a registered metric", () => {
  const ids = new Set(registry.map((m) => m.id));
  const columns = uiColumns.filter((c) => c.surface === "channels.followed");
  assert.deepEqual(
    columns.map((c) => c.column),
    ["Channel", "Status", "Last video", "7 days", "Top", "Lean", "Record"],
  );
  for (const c of columns) {
    assert.ok(ids.has(c.metricId), c.metricId);
    assert.equal(registry.find((m) => m.id === c.metricId)!.label, c.column);
  }
});
