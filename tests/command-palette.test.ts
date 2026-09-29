import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_CAPS,
  instrumentLinks,
  loadRecent,
  matchScore,
  paletteResults,
  rememberSearch,
  saveRecent,
  youtubeUrl,
  RECENT_KEY,
  type PaletteIndex,
} from "../src/features/youtube-intelligence/ui/command-palette.ts";
import { NAV_GROUPS } from "../src/features/youtube-intelligence/ui/navigation.ts";

/**
 * F76. Quick search ranks and groups the server-built index on the client:
 * exact ticker first, then prefix, then substring; capped groups; pasted
 * YouTube links become "Analyse this video"; CJK matches anywhere.
 */
const pages = NAV_GROUPS.flatMap((g) => g.items);
const index: PaletteIndex = {
  instruments: [
    { instrument: "TSM", label: "TSM", kind: "stock", calls: 40 },
    { instrument: "TSLA", label: "TSLA", kind: "stock", calls: 23 },
    { instrument: "TS", label: "TS", kind: "stock", calls: 1 },
    { instrument: "ETSY", label: "ETSY", kind: "stock", calls: 90 },
    { instrument: "Rates", label: "MACRO · RATES", kind: "macro", calls: 12 },
    { instrument: "BTC", label: "BTC", kind: "crypto", calls: 5 },
    ...Array.from({ length: 20 }, (_, i) => ({ instrument: `A${i}`, label: `A${i}`, kind: "stock", calls: i })),
  ],
  channels: [
    { channelId: "UCa", title: "Alpha Markets", handle: "@alpha", calls: 10, videos: 3 },
    { channelId: "UCc", title: "美股Alpha姐", handle: "@alphajie", calls: 30, videos: 9 },
    { channelId: "UCt", title: "Tesla Daily", handle: "@tesladaily", calls: 4, videos: 2 },
  ],
  videos: [
    { runId: "r1", videoId: "vid00000001", title: "特斯拉还能涨吗？", channelId: "UCc", publishedAt: null },
    { runId: "r2", videoId: "vid00000002", title: "Tesla robotaxi day recap", channelId: "UCt", publishedAt: null },
    { runId: "r3", videoId: "vid00000003", title: "美联储降息与黄金走势", channelId: "UCc", publishedAt: null },
  ],
};
const group = (results: ReturnType<typeof paletteResults>, name: string) =>
  results.find((g) => g.group === name)?.items ?? [];

test("Match tiers: exact, then prefix (of the text or a word), then substring", () => {
  assert.equal(matchScore("TSLA", "tsla"), 3);
  assert.equal(matchScore("TSLA", "ts"), 2);
  assert.equal(matchScore("MACRO · RATES", "rat"), 2, "a word prefix counts");
  assert.equal(matchScore("ETSY", "ts"), 1);
  assert.equal(matchScore("ETSY", "xyz"), 0);
  assert.equal(matchScore(null, "a"), 0);
  assert.equal(matchScore("TSLA", "  "), 0);
});

test("Instruments rank exact ticker first, prefix before substring, then by calls", () => {
  const items = group(paletteResults(index, pages, "ts"), "Instruments");
  // TS is exact; TSM and TSLA are prefixes (more calls first); ETSY only contains "ts".
  assert.deepEqual(items.map((i) => i.label), ["TS", "TSM", "TSLA", "ETSY"]);
  assert.equal(items[0].href, "/youtube-intelligence/search?ticker=TS");
  assert.equal(items[0].altHref, "/youtube-intelligence/trends?by=ticker&value=TS");
  assert.equal(items[2].detail, "23 calls");
  const rates = group(paletteResults(index, pages, "rates"), "Instruments")[0];
  assert.equal(rates.label, "MACRO · RATES");
  assert.equal(rates.href, "/youtube-intelligence/search?kind=macro&instrument=Rates");
  assert.deepEqual(instrumentLinks("BTC", "crypto").href, "/youtube-intelligence/search?ticker=BTC");
});

test("Groups are capped and ordered, and Trends is offered for the best instrument", () => {
  const results = paletteResults(index, pages, "a");
  assert.equal(group(results, "Instruments").length, GROUP_CAPS.Instruments);
  for (const g of results) assert.ok(g.items.length <= GROUP_CAPS[g.group], g.group);
  assert.deepEqual(
    results.map((g) => g.group),
    ["Actions", "Instruments", "Channels", "Videos", "Pages"].filter((n) => results.some((g) => g.group === n)),
  );
  const tsla = paletteResults(index, pages, "tsla");
  assert.equal(group(tsla, "Actions")[0].label, "See trends for TSLA");
  assert.equal(group(tsla, "Actions")[0].href, "/youtube-intelligence/trends?by=ticker&value=TSLA");
  assert.deepEqual(group(paletteResults(index, pages, "search"), "Pages").map((p) => p.href), ["/youtube-intelligence/search"]);
  assert.deepEqual(paletteResults(index, pages, "zzzz-nothing"), []);
});

test("Channels open their page and match by name or handle", () => {
  const items = group(paletteResults(index, pages, "tesla"), "Channels");
  assert.deepEqual(items.map((c) => c.href), ["/youtube-intelligence/channels/UCt"]);
  assert.equal(group(paletteResults(index, pages, "@alphaj"), "Channels")[0].label, "美股Alpha姐");
});

test("CJK text matches anywhere in a title or a name", () => {
  const videos = group(paletteResults(index, pages, "还能"), "Videos");
  assert.deepEqual(videos.map((v) => [v.label, v.href, v.detail]), [
    ["特斯拉还能涨吗？", "/youtube-intelligence/analysis/r1", "美股Alpha姐"],
  ]);
  assert.equal(group(paletteResults(index, pages, "黄金"), "Videos")[0].label, "美联储降息与黄金走势");
  assert.equal(group(paletteResults(index, pages, "alpha姐"), "Channels")[0].label, "美股Alpha姐");
});

test("A pasted YouTube link offers only “Analyse this video”", () => {
  const cases: [string, string | null][] = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ?si=abc", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=short", null],
    ["https://example.com/watch?v=dQw4w9WgXcQ", null],
    ["https://www.youtube.com/@alpha", null],
    ["tesla robotaxi", null],
    ["", null],
  ];
  for (const [text, expected] of cases) assert.equal(youtubeUrl(text), expected, text);
  const results = paletteResults(index, pages, " https://youtu.be/dQw4w9WgXcQ ");
  assert.deepEqual(results.map((g) => g.group), ["Actions"]);
  assert.deepEqual(results[0].items[0], {
    id: "analyse",
    group: "Actions",
    label: "Analyse this video",
    detail: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    analyse: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
});

test("An empty box lists recent searches and the pages; the index may still be loading", () => {
  const results = paletteResults(null, pages, "", ["nvda", "rates"]);
  assert.deepEqual(group(results, "Recent").map((r) => r.query), ["nvda", "rates"]);
  assert.equal(group(results, "Pages").length, GROUP_CAPS.Pages);
  assert.deepEqual(group(paletteResults(null, pages, "trends"), "Pages").map((p) => p.label), ["Trends"]);
});

test("Recent searches keep the last five, newest first, without duplicates", () => {
  let recent: string[] = [];
  for (const q of ["a", "b", "A", "c", "d", "e", "f", "  "]) recent = rememberSearch(recent, q);
  assert.deepEqual(recent, ["f", "e", "d", "c", "A"]);
  const memory = new Map<string, string>();
  const store = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
  saveRecent(store, recent);
  assert.deepEqual(loadRecent(store), recent);
  memory.set(RECENT_KEY, "{not json");
  assert.deepEqual(loadRecent(store), []);
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.deepEqual(loadRecent(blocked), []);
  assert.doesNotThrow(() => saveRecent(blocked, ["x"]));
  assert.deepEqual(loadRecent(null), []);
});
