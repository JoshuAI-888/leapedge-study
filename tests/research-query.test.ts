import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
import {
  queryCalls,
  queryVideos,
  querySeries,
  querySearchIndex,
  instrumentKind,
  instrumentOf,
  likePattern,
} from "../src/server/youtube-intelligence/repos/research-query.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";
import * as dispatchRoute from "../src/app/api/youtube-intelligence/[resource]/[action]/route.ts";

/**
 * F56. A deliberately mixed fixture: three channels (one Chinese), canonical,
 * superseded, experimental, publication-selected and failed runs, a CJK quote
 * and translation, macro/sector/crypto instruments, a watchlist, and one run
 * with 105 calls so a page of at most 100 cannot be the whole set.
 */
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const C = "UCcccccccccccccccccccccc";

type Call = {
  key: string;
  ticker: string | null;
  instrument?: string | null;
  stance: string;
  conviction: string;
  trust: string;
  thesis: string;
  quote?: string;
  translation?: string | null;
};

async function channel(id: string, title: string) {
  await database
    .prepare("INSERT INTO channels(id,title,handle) VALUES($1,$2,$3)")
    .run(id, title, `@${id.slice(2, 8)}`);
}

async function run(
  id: string,
  o: {
    videoId: string;
    title: string;
    channelId: string;
    publishedAt: string;
    createdAt: string;
    status?: string;
    input?: Record<string, unknown>;
    calls?: Call[];
  },
) {
  await database
    .prepare(
      "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)",
    )
    .run(
      id,
      o.videoId,
      `https://www.youtube.com/watch?v=${o.videoId}`,
      "model",
      "v1",
      o.title,
      o.status ?? "completed",
      o.status === "failed" ? "transcript" : "publish",
      o.createdAt,
      JSON.stringify(o.input ?? {}),
      JSON.stringify({
        metadata: { channelId: o.channelId, publishedAt: o.publishedAt },
      }),
    );
  for (const c of o.calls ?? []) {
    const claimId = `${id}:${c.key}`;
    await database
      .prepare(
        "INSERT INTO claims(id,run_id,video_id,channel_id,instrument,ticker,stance,thesis_en,creator_conviction,trust_level,published_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      )
      .run(
        claimId,
        id,
        o.videoId,
        o.channelId,
        c.instrument ?? c.ticker,
        c.ticker,
        c.stance,
        c.thesis,
        c.conviction,
        c.trust,
        o.publishedAt,
        o.createdAt,
      );
    await database
      .prepare(
        "INSERT INTO evidence_spans(claim_id,ordinal,start_id,end_id,start_seconds,end_seconds,text_original,translation_en) VALUES($1,0,'s1','s1',12,18,$2,$3)",
      )
      .run(claimId, c.quote ?? c.thesis, c.translation ?? null);
  }
}

const call = (
  key: string,
  ticker: string | null,
  stance: string,
  conviction: string,
  trust: string,
  thesis: string,
  extra: Partial<Call> = {},
): Call => ({ key, ticker, stance, conviction, trust, thesis, ...extra });

before(async () => {
  await freshDatabase();
  await channel(A, "Alpha Markets");
  await channel(B, "Beta Capital");
  await channel(C, "陈博士财经");
  await run("r1", {
    videoId: "vid00000001",
    title: "NVIDIA earnings preview: the AI trade",
    channelId: A,
    publishedAt: "2026-09-01T14:00:00.000Z",
    createdAt: "2026-09-01T15:00:00.000Z",
    calls: [
      call("c1", "NVDA", "long", "high", "L2", "Data center demand keeps accelerating"),
      call("c2", "AMD", "watch", "medium", "L1", "AMD needs a catalyst"),
      call("c3", "BTC-USD", "long", "low", "L0", "Bitcoin breakout above the range"),
    ],
  });
  // An older completed run of the same video: superseded by r1.
  await run("r1old", {
    videoId: "vid00000001",
    title: "NVIDIA earnings preview: the AI trade",
    channelId: A,
    publishedAt: "2026-09-01T14:00:00.000Z",
    createdAt: "2026-09-01T14:30:00.000Z",
    calls: [call("c1", "NVDA", "long", "high", "L2", "Superseded thesis")],
  });
  await run("r2", {
    videoId: "vid00000002",
    title: "美联储降息与黄金走势",
    channelId: C,
    publishedAt: "2026-09-03T02:00:00.000Z",
    createdAt: "2026-09-03T03:00:00.000Z",
    calls: [
      call("c4", null, "long", "medium", "L1", "Gold benefits from falling real rates", {
        instrument: "Gold",
        quote: "黄金将受益于实际利率下降",
        translation: "Gold will benefit from falling real rates",
      }),
      call("c5", null, "short", "high", "L2", "Rates will fall faster than priced", {
        instrument: "US interest rates",
        quote: "美联储会更快降息",
        translation: "The Fed will cut faster",
      }),
    ],
  });
  await run("r3", {
    videoId: "vid00000003",
    title: "Why semiconductors could crack",
    channelId: B,
    publishedAt: "2026-09-08T16:00:00.000Z",
    createdAt: "2026-09-08T17:00:00.000Z",
    calls: [
      call("c6", "NVDA", "short", "high", "L3", "Semiconductor valuations are stretched"),
      call("c7", "AMD", "avoid", "low", "L2", "Margins are compressing"),
      call("c8", null, "conditional", "medium", "L1", "Only if the rally broadens", {
        instrument: "Semiconductors sector",
      }),
    ],
  });
  await run("r8", {
    videoId: "vid00000008",
    title: "Macro weekly roundup",
    channelId: B,
    publishedAt: "2026-09-15T12:00:00.000Z",
    createdAt: "2026-09-15T13:00:00.000Z",
    calls: Array.from({ length: 105 }, (_, i) =>
      call(
        `i${String(i).padStart(3, "0")}`,
        i % 2 === 0 ? "SPY" : "QQQ",
        "hold",
        "unspecified",
        "L1",
        `Index position ${i}`,
      ),
    ),
  });
  // Experimental and never published: not canonical.
  await run("r5", {
    videoId: "vid00000005",
    title: "EV makers",
    channelId: A,
    publishedAt: "2026-09-04T12:00:00.000Z",
    createdAt: "2026-09-04T13:00:00.000Z",
    input: { experiment: true },
    calls: [call("c1", "TSLA", "long", "high", "L2", "Experimental call")],
  });
  // Two runs of one video; the publication selects the OLDER one.
  await run("r6a", {
    videoId: "vid00000006",
    title: "Software check-in",
    channelId: A,
    publishedAt: "2026-09-02T12:00:00.000Z",
    createdAt: "2026-09-02T13:00:00.000Z",
    calls: [call("c9", "MSFT", "long", "medium", "L2", "Cloud growth reaccelerates")],
  });
  await run("r6b", {
    videoId: "vid00000006",
    title: "Software check-in",
    channelId: A,
    publishedAt: "2026-09-02T12:00:00.000Z",
    createdAt: "2026-09-05T13:00:00.000Z",
    calls: [call("c9", "MSFT", "short", "medium", "L2", "Unpublished rerun")],
  });
  await put("publication", "vid00000006", {
    videoId: "vid00000006",
    runId: "r6a",
    at: "2026-09-06T00:00:00.000Z",
  });
  await run("r7", {
    videoId: "vid00000007",
    title: "Failed upload about chips",
    channelId: A,
    publishedAt: "2026-09-09T12:00:00.000Z",
    createdAt: "2026-09-09T13:00:00.000Z",
    status: "failed",
  });
  await run("task", {
    videoId: "vid00000001",
    title: "Research brief",
    channelId: A,
    publishedAt: "2026-09-01T14:00:00.000Z",
    createdAt: "2026-09-20T13:00:00.000Z",
    input: { task: "research-brief" },
  });
  await put("watchlist", "AMD", { ticker: "AMD", enabled: true });
  await put("watchlist", "NVDA", { ticker: "NVDA", enabled: false });
});

const count = (facet: { value: string; count: number }[], value: string) =>
  facet.find((f) => f.value === value)?.count ?? 0;

test("Calls count every canonical call exactly and page without a silent cap", async () => {
  const first = await queryCalls({ limit: 100 });
  assert.equal(first.total, 114);
  assert.equal(first.rows.length, 100);
  assert.equal(first.nextOffset, 100);
  const second = await queryCalls({ limit: 100, offset: 100 });
  assert.equal(second.total, 114);
  assert.equal(second.rows.length, 14);
  assert.equal(second.nextOffset, null);
  const ids = new Set([...first.rows, ...second.rows].map((r) => r.id));
  assert.equal(ids.size, 114, "pages neither overlap nor skip");
  // Superseded, experimental and unpublished runs stay out by default…
  for (const hidden of ["r1old:c1", "r5:c1", "r6b:c9"]) assert.ok(!ids.has(hidden));
  assert.ok(ids.has("r6a:c9"), "the publication's choice is canonical");
  // …and come back when asked for every run.
  assert.equal((await queryCalls({ canonicalOnly: false })).total, 117);
  const defaults = await queryCalls({});
  assert.equal(defaults.rows.length, 50);
  assert.equal(defaults.limit, 50);
});

test("A row carries what a list needs: title, channel, sentiment, kind and evidence", async () => {
  const { rows } = await queryCalls({ text: "实际利率" });
  assert.equal(rows.length, 1);
  const gold = rows[0];
  assert.equal(gold.id, "r2:c4");
  assert.equal(gold.videoTitle, "美联储降息与黄金走势");
  assert.equal(gold.channelTitle, "陈博士财经");
  assert.equal(gold.instrumentKey, "Gold");
  assert.equal(gold.kind, "macro");
  assert.equal(gold.sentiment, "bullish");
  assert.equal(gold.publishedAt, "2026-09-03T02:00:00.000Z");
  assert.deepEqual(
    gold.evidence.map((e) => [e.textOriginal, e.translationEn, e.startSeconds]),
    [["黄金将受益于实际利率下降", "Gold will benefit from falling real rates", 12]],
  );
});

test("Each facet counts the filtered set without its own filter", async () => {
  const long = await queryCalls({ stances: ["long"] });
  assert.equal(long.total, 4);
  // The stance facet ignores the stance filter…
  assert.equal(count(long.facets.stance, "long"), 4);
  assert.equal(count(long.facets.stance, "short"), 2);
  assert.equal(count(long.facets.stance, "hold"), 105);
  assert.equal(count(long.facets.stance, "neutral"), 0);
  assert.ok(
    long.facets.stance.some((f) => f.value === "neutral"),
    "a zero-count stance stays listed",
  );
  // …while every other facet is narrowed by it.
  assert.equal(count(long.facets.channel, A), 3);
  assert.equal(count(long.facets.channel, C), 1);
  assert.equal(count(long.facets.channel, B), 0);
  assert.equal(
    long.facets.channel.find((f) => f.value === A)?.label,
    "Alpha Markets",
  );
  assert.equal(count(long.facets.sentiment, "bullish"), 4);
  assert.equal(count(long.facets.sentiment, "bearish"), 0);

  const bearish = await queryCalls({ sentiments: ["bearish"] });
  assert.equal(bearish.total, 3);
  assert.equal(count(bearish.facets.sentiment, "bullish"), 4);
  assert.equal(count(bearish.facets.sentiment, "neutral"), 107);
  assert.equal(count(bearish.facets.sentiment, "bearish"), 3);
  assert.equal(count(bearish.facets.instrument, "NVDA"), 1);
  assert.equal(count(bearish.facets.instrument, "AMD"), 1);
  assert.equal(count(bearish.facets.kind, "macro"), 1);

  const nvda = await queryCalls({ instruments: ["nvda"] });
  assert.equal(nvda.total, 2);
  assert.equal(count(nvda.facets.instrument, "NVDA"), 2);
  assert.equal(count(nvda.facets.instrument, "SPY"), 53, "own filter excluded");
  assert.equal(count(nvda.facets.conviction, "high"), 2);
  assert.equal(count(nvda.facets.trust, "L3"), 1);
});

test("Text matches Chinese and mid-title English substrings, case-insensitively, with wildcards escaped", async () => {
  assert.deepEqual(
    (await queryCalls({ text: "实际利率" })).rows.map((r) => r.id),
    ["r2:c4"],
  );
  // A CJK substring of the title matches both calls of that video.
  assert.equal((await queryCalls({ text: "降息" })).total, 2);
  const title = await queryCalls({ text: "EARNINGS" });
  assert.deepEqual(title.rows.map((r) => r.id).sort(), ["r1:c1", "r1:c2", "r1:c3"]);
  assert.deepEqual(
    (await queryCalls({ text: "cut faster" })).rows.map((r) => r.id),
    ["r2:c5"],
    "translation text is searched",
  );
  assert.equal((await queryCalls({ text: "  " })).total, 114, "blank text is no filter");
  assert.equal((await queryCalls({ text: "%" })).total, 0);
  assert.equal((await queryCalls({ text: "_" })).total, 0);
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});

test("Minimum trust keeps that level and above", async () => {
  const strong = await queryCalls({ minTrust: "L2" });
  assert.equal(strong.total, 5);
  assert.ok(strong.rows.every((r) => r.trustLevel >= "L2"));
  assert.equal(count(strong.facets.trust, "L0"), 1);
  assert.equal(count(strong.facets.trust, "L1"), 108);
  assert.equal(count(strong.facets.trust, "L2"), 4);
  assert.equal(count(strong.facets.trust, "L3"), 1);
  assert.equal((await queryCalls({ minTrust: "L3" })).rows[0].id, "r3:c6");
});

test("The published window is inclusive of whole dates and exact for instants", async () => {
  const day = await queryCalls({ from: "2026-09-03", to: "2026-09-03" });
  assert.deepEqual(day.rows.map((r) => r.id).sort(), ["r2:c4", "r2:c5"]);
  assert.equal((await queryCalls({ from: "2026-09-01", to: "2026-09-02" })).total, 4);
  assert.equal((await queryCalls({ from: "2026-09-15" })).total, 105);
  assert.equal((await queryCalls({ to: "2026-08-31" })).total, 0);
  assert.equal(
    (
      await queryCalls({
        from: "2026-09-01T14:00:00.000Z",
        to: "2026-09-03T02:00:00.000Z",
      })
    ).total,
    4,
    "an instant upper bound is exclusive",
  );
});

test("Kind, channel, conviction, pinned and sort filters narrow and order the set", async () => {
  assert.deepEqual((await queryCalls({ kinds: ["crypto"] })).rows.map((r) => r.id), ["r1:c3"]);
  assert.deepEqual(
    (await queryCalls({ kinds: ["macro"] })).rows.map((r) => r.id).sort(),
    ["r2:c4", "r2:c5"],
  );
  assert.deepEqual((await queryCalls({ kinds: ["sector"] })).rows.map((r) => r.id), ["r3:c8"]);
  const all = await queryCalls({});
  assert.equal(count(all.facets.kind, "stock"), 110);
  assert.equal(count(all.facets.kind, "unresolved"), 0);
  assert.equal((await queryCalls({ channels: [C] })).total, 2);
  assert.equal((await queryCalls({ convictions: ["high", "low"] })).total, 5);
  const pinned = await queryCalls({ pinnedOnly: true });
  assert.deepEqual(pinned.rows.map((r) => r.id).sort(), ["r1:c2", "r3:c7"]);
  assert.equal((await queryCalls({ sort: "conviction" })).rows[0].id, "r3:c6");
  assert.equal((await queryCalls({ sort: "trust" })).rows[0].id, "r3:c6");
  const newest = (await queryCalls({ sort: "newest" })).rows[0];
  assert.equal(newest.runId, "r8");
});

test("Aggregates describe the filtered set: sentiment split, conviction, top instruments and channels", async () => {
  const { aggregates } = await queryCalls({});
  assert.equal(aggregates.calls, 114);
  assert.equal(aggregates.videos, 5);
  assert.equal(aggregates.creators, 3);
  assert.deepEqual(aggregates.sentiment.bullish, { calls: 4, creators: 2 });
  assert.deepEqual(aggregates.sentiment.neutral, { calls: 107, creators: 2 });
  assert.deepEqual(aggregates.sentiment.bearish, { calls: 3, creators: 2 });
  assert.deepEqual(aggregates.conviction, { high: 3, medium: 4, low: 2, unspecified: 105 });
  assert.equal(aggregates.topInstruments[0].instrument, "SPY");
  assert.equal(aggregates.topInstruments[0].calls, 53);
  const nvda = aggregates.topInstruments.find((i) => i.instrument === "NVDA");
  assert.deepEqual(
    nvda && [nvda.calls, nvda.creators, nvda.bullish, nvda.neutral, nvda.bearish, nvda.kind],
    [2, 2, 1, 0, 1, "stock"],
  );
  assert.equal(aggregates.topChannels[0].channelId, B);
  assert.equal(aggregates.topChannels[0].title, "Beta Capital");
  assert.equal(aggregates.topChannels[0].calls, 108);
  const none = await queryCalls({ text: "nothing matches this" });
  assert.equal(none.total, 0);
  assert.deepEqual(none.rows, []);
  assert.equal(none.aggregates.videos, 0);
  assert.deepEqual(none.aggregates.topInstruments, []);
});

test("Videos carry a verdict summary and match through their calls or their title", async () => {
  const all = await queryVideos({});
  assert.equal(all.total, 5);
  assert.deepEqual(
    all.rows.map((v) => v.runId),
    ["r8", "r3", "r2", "r6a", "r1"],
  );
  const r1 = all.rows.find((v) => v.runId === "r1")!;
  assert.equal(r1.ideas, 3);
  assert.deepEqual(r1.sentiment, { bullish: 2, neutral: 1, bearish: 0 });
  assert.deepEqual(r1.instruments, ["AMD", "BTC-USD", "NVDA"]);
  assert.equal(r1.channelTitle, "Alpha Markets");
  assert.equal(r1.publishedAt, "2026-09-01T14:00:00.000Z");
  assert.equal(r1.status, "completed");
  const short = await queryVideos({ stances: ["short"] });
  assert.deepEqual(short.rows.map((v) => v.runId), ["r3", "r2"]);
  assert.equal(short.rows[0].matchingCalls, 1);
  assert.equal(short.rows[0].ideas, 3, "the verdict describes the whole video");
  assert.deepEqual(short.rows[0].sentiment, { bullish: 0, neutral: 1, bearish: 2 });
  assert.deepEqual((await queryVideos({ text: "weekly" })).rows.map((v) => v.runId), ["r8"]);
  assert.deepEqual((await queryVideos({ text: "黄金" })).rows.map((v) => v.runId), ["r2"]);
  assert.equal((await queryVideos({ text: "Failed upload" })).total, 0);
  const everything = await queryVideos({ canonicalOnly: false, text: "Failed upload" });
  assert.deepEqual(everything.rows.map((v) => [v.runId, v.status, v.ideas]), [["r7", "failed", 0]]);
  assert.equal((await queryVideos({ canonicalOnly: false })).total, 9);
  assert.equal((await queryVideos({ channels: [A], from: "2026-09-02" })).total, 1);
  const page = await queryVideos({ limit: 2, offset: 4 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.nextOffset, null);
});

test("The series buckets calls by ISO week or day, with capped points reported as truncated", async () => {
  const weekly = await querySeries({ bucket: "week" });
  assert.deepEqual(
    weekly.buckets.map((b) => [b.start, b.label, b.bullish, b.neutral, b.bearish, b.calls]),
    [
      ["2026-08-31", "2026-W36", 4, 1, 1, 6],
      ["2026-09-07", "2026-W37", 0, 1, 2, 3],
      ["2026-09-14", "2026-W38", 0, 105, 0, 105],
    ],
  );
  assert.equal(weekly.total, 114);
  assert.equal(weekly.points.length, 114);
  assert.equal(weekly.truncated, false);
  const daily = await querySeries({ bucket: "day", from: "2026-09-01", to: "2026-09-04" });
  assert.deepEqual(
    daily.buckets.map((b) => [b.start, b.bullish, b.neutral, b.bearish]),
    [
      ["2026-09-01", 2, 1, 0],
      ["2026-09-02", 1, 0, 0],
      ["2026-09-03", 1, 0, 1],
      ["2026-09-04", 0, 0, 0],
    ],
  );
  const capped = await querySeries({ bucket: "week", pointCap: 10 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.points.length, 10);
  assert.equal(capped.total, 114);
  assert.ok(capped.points.every((p) => p.runId === "r8"), "the newest points are kept");
  const point = (await querySeries({ instruments: ["Gold"] })).points[0];
  assert.deepEqual(
    [point.id, point.runId, point.date, point.instrument, point.stance, point.sentiment, point.conviction, point.channelId],
    ["r2:c4", "r2", "2026-09-03", "Gold", "long", "bullish", "medium", C],
  );
  assert.equal(point.thesis, "Gold benefits from falling real rates");
});

test("The quick-search index lists instruments, channels and recent videos", async () => {
  const index = await querySearchIndex({ videos: 3 });
  assert.equal(index.instruments.length, 9);
  assert.deepEqual(index.instruments[0], { instrument: "SPY", label: "SPY", kind: "stock", calls: 53 });
  assert.ok(index.instruments.some((i) => i.instrument === "Gold" && i.kind === "macro"));
  assert.deepEqual(
    index.channels.map((c) => [c.channelId, c.title, c.calls]),
    [
      [B, "Beta Capital", 108],
      [A, "Alpha Markets", 4],
      [C, "陈博士财经", 2],
    ],
  );
  assert.deepEqual(index.videos.map((v) => [v.runId, v.title]), [
    ["r8", "Macro weekly roundup"],
    ["r3", "Why semiconductors could crack"],
    ["r2", "美联储降息与黄金走势"],
  ]);
  assert.equal(index.totals.videos, 5);
  assert.equal(index.totals.instruments, 9);
});

test("Every input is validated", async () => {
  const bad: unknown[] = [
    { limit: 101 },
    { limit: 0 },
    { offset: -1 },
    { minTrust: "L4" },
    { from: "2026-09-10", to: "2026-09-01" },
    { from: "yesterday" },
    { sort: "random" },
    { stances: ["bullish"] },
    { kinds: ["bond"] },
    { unknownField: true },
    { text: "x".repeat(201) },
    { instruments: Array.from({ length: 51 }, (_, i) => `T${i}`) },
  ];
  for (const input of bad)
    await assert.rejects(() => queryCalls(input), `${JSON.stringify(input)} is refused`);
  await assert.rejects(() => querySeries({ bucket: "month" }));
  await assert.rejects(() => querySeries({ pointCap: 5001 }));
  await assert.rejects(() => querySearchIndex({ videos: 1001 }));
  await assert.rejects(() => queryVideos({ sort: "trust" }));
});

test("The query resource is read-only and answers GET with its input in the URL", async () => {
  const url = (action: string, input?: unknown) =>
    `http://127.0.0.1:3000/api/youtube-intelligence/query/${action}${
      input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`
    }`;
  const params = (action: string) => ({
    params: Promise.resolve({ resource: "query", action }),
  });
  for (const action of ["calls", "videos", "series", "searchIndex"]) {
    const r = await dispatchRoute.GET(new Request(url(action)), params(action));
    assert.equal(r.status, 200, action);
  }
  const r = await dispatchRoute.GET(
    new Request(url("calls", { instruments: ["AMD"], limit: 1 })),
    params("calls"),
  );
  const body = (await r.json()) as { total: number; rows: unknown[] };
  assert.equal(body.total, 2);
  assert.equal(body.rows.length, 1);
  const refused = await dispatchRoute.GET(
    new Request(url("calls", { limit: 500 })),
    params("calls"),
  );
  assert.equal(refused.status, 400);
  const garbled = await dispatchRoute.GET(
    new Request(`${url("calls")}?input=%7Bnot-json`),
    params("calls"),
  );
  assert.equal(garbled.status, 400);
  const prior = process.env.YTI_PREVIEW_READ_ONLY;
  process.env.YTI_PREVIEW_READ_ONLY = "true";
  try {
    assert.equal(((await dispatch("query", "calls", { limit: 1 })) as { total: number }).total, 114);
  } finally {
    if (prior === undefined) delete process.env.YTI_PREVIEW_READ_ONLY;
    else process.env.YTI_PREVIEW_READ_ONLY = prior;
  }
});

test("Instruments group by the F59 vocabulary, so a label's link finds its calls", async () => {
  // InstrumentLabel links a macro theme as ?kind=macro&instrument=Rates.
  const rates = await queryCalls({ kinds: ["macro"], instruments: ["Rates"] });
  assert.deepEqual(rates.rows.map((r) => r.id), ["r2:c5"]);
  assert.equal(rates.rows[0].instrumentKey, "Rates");
  assert.equal(rates.rows[0].instrumentLabel, "MACRO · RATES");
  // The spoken name still works, and matching ignores case.
  assert.equal((await queryCalls({ instruments: ["us interest rates"] })).total, 1);
  const semis = await queryCalls({ instruments: ["Information Technology / Semiconductors"] });
  assert.deepEqual(semis.rows.map((r) => r.id), ["r3:c8"]);
  const all = await queryCalls({});
  const facet = all.facets.instrument.find((f) => f.value === "Rates");
  assert.deepEqual(facet && [facet.count, facet.label], [1, "MACRO · RATES"]);
  assert.equal(count(all.facets.instrument, "US interest rates"), 0, "grouped under Rates");
  const top = all.aggregates.topInstruments.find((i) => i.instrument === "Rates");
  assert.deepEqual(top && [top.kind, top.label, top.calls, top.bearish], ["macro", "MACRO · RATES", 1, 1]);
  const videos = await queryVideos({ text: "黄金" });
  assert.deepEqual(videos.rows[0].instruments, ["Gold", "Rates"]);
  assert.deepEqual(videos.rows[0].instrumentLabels, ["MACRO · GOLD", "MACRO · RATES"]);
  const index = await querySearchIndex({});
  assert.ok(index.instruments.some((i) => i.instrument === "Rates" && i.label === "MACRO · RATES"));
  assert.equal(index.totals.instruments, 9);
});

test("Calls carry the F60 fields and filter by stated levels and expiry window", async () => {
  await database
    .prepare(
      `UPDATE claims SET levels=$1::jsonb, action_en='Buy on dips', catalysts_en=ARRAY['Earnings','Capex guide'],
        expiry_date='2026-09-20', expiry_original='by the 20th' WHERE id='r1:c1'`,
    )
    .run(JSON.stringify([{ kind: "target", valueOriginal: "$150", parsed: null }]));
  await database
    .prepare("UPDATE claims SET expiry_date='2026-11-30', expiry_original='end of November' WHERE id='r3:c6'")
    .run();
  const today = "2026-09-15";
  const withLevels = await queryCalls({ hasLevels: true, today });
  assert.deepEqual(withLevels.rows.map((r) => r.id), ["r1:c1"]);
  const nvda = withLevels.rows[0];
  assert.equal(nvda.action, "Buy on dips");
  assert.deepEqual(nvda.catalysts, ["Earnings", "Capex guide"]);
  assert.equal(nvda.expiryDate, "2026-09-20");
  assert.equal(nvda.expiryOriginal, "by the 20th");
  assert.deepEqual(
    nvda.levels.map((l) => [l.kind, l.valueOriginal, l.parsed?.low]),
    [["target", "$150", 150]],
    "the parse comes from the original wording",
  );
  assert.deepEqual((await queryCalls({ expiresWithin: 7, today })).rows.map((r) => r.id), ["r1:c1"]);
  assert.deepEqual(
    (await queryCalls({ expiresWithin: 90, today })).rows.map((r) => r.id).sort(),
    ["r1:c1", "r3:c6"],
  );
  assert.equal((await queryCalls({ expiresWithin: 7, today: "2026-09-21" })).total, 0, "an expired call is not expiring");
  const all = await queryCalls({ today });
  assert.deepEqual(all.facets.levels, [{ value: "with", count: 1 }]);
  assert.deepEqual(
    all.facets.expiry.map((e) => [e.value, e.count]),
    [["7", 1], ["30", 1], ["90", 2]],
  );
  // Each facet ignores its own filter.
  assert.equal(count((await queryCalls({ hasLevels: true, today })).facets.levels, "with"), 1);
  assert.equal(count((await queryCalls({ expiresWithin: 7, today })).facets.expiry, "90"), 2);
  const plain = (await queryCalls({ text: "实际利率" })).rows[0];
  assert.deepEqual([plain.action, plain.levels, plain.catalysts, plain.expiryDate], [null, [], [], null]);
  await assert.rejects(() => queryCalls({ expiresWithin: 14 }));
  // A model-chosen macro theme (prompt v9) decides the grouping.
  assert.equal(instrumentOf(null, "chip names", "Information Technology / Semiconductors").key, "Information Technology / Semiconductors");
});

test("Instrument kind is derived from the ticker and the spoken name", () => {
  assert.equal(instrumentKind("NVDA", "NVIDIA"), "stock");
  assert.equal(instrumentKind("SMH", null), "stock");
  assert.equal(instrumentKind("BTC-USD", null), "crypto");
  assert.equal(instrumentKind(null, "Ethereum"), "crypto");
  assert.equal(instrumentKind(null, "US 10-year Treasury yield"), "macro");
  assert.equal(instrumentKind("GC=F", "Gold futures"), "macro");
  assert.equal(instrumentKind(null, "US dollar"), "macro");
  assert.equal(instrumentKind(null, "Healthcare sector"), "sector");
  assert.equal(instrumentKind(null, "Semiconductors"), "sector");
  assert.equal(instrumentKind(null, "Some private startup"), "unresolved");
  assert.equal(instrumentKind(null, null), "unresolved");
});

test("A claim-id filter selects exactly the named calls, so a saved list can be exported", async () => {
  const named = await queryCalls({ claimIds: ["r6a:c9", "r1old:c1"], canonicalOnly: false });
  assert.deepEqual(named.rows.map((r) => r.id).sort(), ["r1old:c1", "r6a:c9"]);
  assert.equal(named.total, 2);
  // Canonical-only still applies when asked, so the superseded call drops out.
  assert.deepEqual((await queryCalls({ claimIds: ["r6a:c9", "r1old:c1"] })).rows.map((r) => r.id), ["r6a:c9"]);
  assert.equal((await queryCalls({ claimIds: [], canonicalOnly: false })).total, 0, "an empty list matches nothing");
  await assert.rejects(() => queryCalls({ claimIds: [""] }));
});
