import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  splitSegments,
  splitCountText,
  splitTitle,
  sentimentOf,
  sentimentCounts,
  hiddenByFilter,
  hiddenByFilterText,
  statDelta,
  sparklinePoints,
  trustOptionLabel,
  dailyCounts,
} from "../src/features/youtube-intelligence/ui/foundations.ts";
import {
  parseUrlState,
  serialiseUrlState,
} from "../src/features/youtube-intelligence/ui/url-state-core.ts";
import {
  NAV_GROUPS,
  PHONE_TABS,
  QUICK_SEARCH_HREF,
  resolveRoute,
  routeFromHref,
  isCurrentRoute,
} from "../src/features/youtube-intelligence/ui/navigation.ts";
import { STANCE_SENTIMENT } from "../src/features/youtube-intelligence/sentiment.ts";

// --- Sentiment split bar ----------------------------------------------------

test("split bar segments keep bullish, neutral, bearish order and sum to exactly 100%", () => {
  const segments = splitSegments({ bullish: 1, neutral: 1, bearish: 1 });
  assert.deepEqual(
    segments.map((s) => s.sentiment),
    ["bullish", "neutral", "bearish"],
  );
  assert.equal(
    segments.reduce((sum, s) => sum + s.percent, 0),
    100,
  );
  // Largest remainder: thirds round to whole numbers that still total 100.
  for (const s of segments) assert.ok([33, 34].includes(s.percent));
  const uneven = splitSegments({ bullish: 12, neutral: 3, bearish: 1 });
  assert.deepEqual(
    uneven.map((s) => s.percent),
    [75, 19, 6],
  );
  assert.equal(
    uneven.reduce((sum, s) => sum + s.percent, 0),
    100,
  );
});

test("split bar drops empty segments but a zero total yields no segments", () => {
  assert.deepEqual(
    splitSegments({ bullish: 4, neutral: 0, bearish: 0 }).map((s) => [
      s.sentiment,
      s.percent,
    ]),
    [["bullish", 100]],
  );
  assert.deepEqual(splitSegments({ bullish: 0, neutral: 0, bearish: 0 }), []);
  assert.deepEqual(splitSegments({ bullish: -2, neutral: NaN, bearish: 0 }), []);
});

test("split bar text pairs every colour with a glyph, and the title names calls and creators", () => {
  assert.equal(
    splitCountText({ bullish: 12, neutral: 3, bearish: 1 }),
    "12 ▲ · 3 ● · 1 ▼",
  );
  assert.equal(
    splitTitle(
      { bullish: 12, neutral: 3, bearish: 1 },
      { bullish: 5, neutral: 2, bearish: 1 },
    ),
    "12 bullish calls from 5 creators · 3 neutral calls from 2 creators · 1 bearish call from 1 creator",
  );
  assert.equal(
    splitTitle({ bullish: 2, neutral: 0, bearish: 1 }),
    "2 bullish calls · 0 neutral calls · 1 bearish call",
  );
  assert.equal(
    splitTitle({ bullish: 0, neutral: 0, bearish: 0 }),
    "No calls in this view",
  );
  assert.equal(
    splitTitle(
      { bullish: 1, neutral: 0, bearish: 2 },
      { bullish: 1, neutral: 0, bearish: 2 },
      "mention",
    ),
    "1 bullish mention from 1 creator · 0 neutral mentions from 0 creators · 2 bearish mentions from 2 creators",
  );
});

test("sentimentOf reuses the stance table rather than redefining it", () => {
  for (const [stance, sentiment] of Object.entries(STANCE_SENTIMENT))
    assert.equal(
      sentimentOf(stance),
      sentiment ?? "neutral",
      `stance ${stance}`,
    );
  assert.equal(sentimentOf("not-a-stance"), "neutral");
  assert.deepEqual(
    sentimentCounts([
      { stance: "long" },
      { stance: "long" },
      { stance: "avoid" },
      { stance: "watch" },
      { stance: "conditional" },
    ]),
    { bullish: 2, neutral: 2, bearish: 1 },
  );
});

// --- Hidden by filter -------------------------------------------------------

test("hidden-by-filter counts only rows the filter removed and names the filter", () => {
  assert.equal(hiddenByFilter(12, 7), 5);
  assert.equal(hiddenByFilter(3, 3), 0);
  assert.equal(hiddenByFilter(2, 5), 0, "never negative");
  assert.equal(
    hiddenByFilterText(5, "the Audio-agreed trust filter"),
    "5 calls hidden by the Audio-agreed trust filter",
  );
  assert.equal(
    hiddenByFilterText(1, "the Audio-agreed trust filter"),
    "1 call hidden by the Audio-agreed trust filter",
  );
  assert.equal(hiddenByFilterText(0, "anything"), "");
  assert.equal(
    hiddenByFilterText(2, "the market filter", "settled calls"),
    "2 settled calls hidden by the market filter",
  );
});

test("trust select labels use names, never L0–L3", () => {
  assert.equal(trustOptionLabel("L0"), "Extracted");
  assert.equal(trustOptionLabel("L1"), "Text-checked");
  assert.equal(trustOptionLabel("L2"), "Audio-agreed");
  assert.equal(trustOptionLabel("L3"), "Human-verified");
  for (const level of ["L0", "L1", "L2", "L3", "L9"])
    assert.doesNotMatch(trustOptionLabel(level), /^L\d$/);
});

// --- Headline tiles and sparkline -------------------------------------------

test("stat delta reports the change against the prior period, including new and flat", () => {
  assert.deepEqual(statDelta(12, 9), {
    direction: "up",
    text: "+3 vs prior period",
  });
  assert.deepEqual(statDelta(4, 9), {
    direction: "down",
    text: "−5 vs prior period",
  });
  assert.deepEqual(statDelta(4, 4), {
    direction: "flat",
    text: "No change vs prior period",
  });
  assert.deepEqual(statDelta(4, null), {
    direction: "flat",
    text: "No prior period",
  });
});

test("sparkline geometry tolerates zero, one and flat series", () => {
  assert.deepEqual(sparklinePoints([], 100, 20), []);
  const one = sparklinePoints([5], 100, 20);
  assert.equal(one.length, 1);
  assert.equal(one[0].x, 100);
  assert.ok(one[0].y >= 0 && one[0].y <= 20);
  const flat = sparklinePoints([3, 3, 3], 100, 20);
  assert.deepEqual(
    flat.map((p) => p.y),
    [flat[0].y, flat[0].y, flat[0].y],
  );
  const rising = sparklinePoints([0, 5, 10], 100, 20, 2);
  assert.equal(rising[0].x, 0);
  assert.equal(rising[2].x, 100);
  assert.ok(rising[0].y > rising[2].y, "higher values draw higher");
  assert.equal(rising[2].y, 2);
  assert.equal(rising[0].y, 18);
  assert.deepEqual(sparklinePoints([1, NaN, 2], 100, 20).length, 2);
});

test("daily counts bucket dates into the window ending at the as-of date", () => {
  assert.deepEqual(
    dailyCounts(
      [
        "2026-09-28T10:00:00Z",
        "2026-09-28T01:00:00Z",
        "2026-09-26T12:00:00Z",
        "2026-09-20T12:00:00Z", // outside a 3-day window
        "2026-09-29T12:00:00Z", // after the as-of date
        "not a date",
      ],
      "2026-09-28",
      3,
    ),
    [1, 0, 2],
  );
  assert.deepEqual(dailyCounts([], "2026-09-28", 2), [0, 0]);
  assert.deepEqual(dailyCounts(["2026-09-28T00:00:00Z"], "bad", 2), [0, 0]);
});

// --- URL view state ---------------------------------------------------------

const Schema = z.object({
  sentiment: z.enum(["7d", "14d", "30d"]),
  page: z.coerce.number().int().min(1),
  q: z.string().max(40),
});
const defaults = { sentiment: "7d", page: 1, q: "" } as const;

test("url state falls back to defaults for missing or invalid values", () => {
  assert.deepEqual(
    parseUrlState(Schema, defaults, new URLSearchParams("")),
    defaults,
  );
  assert.deepEqual(
    parseUrlState(
      Schema,
      defaults,
      new URLSearchParams("sentiment=90d&page=-3&q=nvda"),
    ),
    { sentiment: "7d", page: 1, q: "nvda" },
  );
  assert.deepEqual(
    parseUrlState(Schema, defaults, new URLSearchParams("sentiment=30d&page=4")),
    { sentiment: "30d", page: 4, q: "" },
  );
});

test("url state serialises only non-default values and keeps other keys", () => {
  const current = new URLSearchParams("other=keep&sentiment=14d");
  assert.equal(
    serialiseUrlState({ sentiment: "30d", page: 2, q: "腾讯" }, defaults, current),
    `other=keep&sentiment=30d&page=2&q=${encodeURIComponent("腾讯")}`,
  );
  assert.equal(
    serialiseUrlState({ sentiment: "7d", page: 1, q: "" }, defaults, current),
    "other=keep",
    "a value equal to its default leaves the URL",
  );
  assert.equal(
    current.toString(),
    "other=keep&sentiment=14d",
    "the caller's params are not mutated",
  );
});

test("url state round-trips through serialise and parse", () => {
  const state = { sentiment: "14d", page: 3, q: "semis & rates" } as const;
  const query = serialiseUrlState(state, defaults, new URLSearchParams());
  assert.deepEqual(
    parseUrlState(Schema, defaults, new URLSearchParams(query)),
    state,
  );
});

// --- Grouped navigation (decision D2) ---------------------------------------

test("sidebar groups follow decision D2 in order", () => {
  assert.deepEqual(
    NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)]),
    [
      ["Read", ["Today", "Daily report"]],
      ["Research", ["Search", "Trends", "Leaderboard"]],
      ["Sources", ["Channels"]],
      ["Your work", ["Saved calls"]],
      ["Operate", ["Lab", "Settings", "Methodology"]],
    ],
  );
  assert.deepEqual(
    PHONE_TABS.map((t) => t.label),
    ["Today", "Report", "Search"],
  );
});

test("every navigation link resolves in the router map", () => {
  const hrefs = [
    ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    ...PHONE_TABS.map((t) => t.href),
    QUICK_SEARCH_HREF,
  ];
  for (const href of hrefs) {
    const route = routeFromHref(href);
    assert.ok(route, `${href} has no route`);
  }
  assert.equal(new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))).size, 10);
});

test("router map covers new phase-5 pages and rejects malformed paths", () => {
  assert.deepEqual(resolveRoute(["report"]), { page: "report", date: null });
  assert.deepEqual(resolveRoute(["report", "2026-09-28"]), {
    page: "report",
    date: "2026-09-28",
  });
  assert.equal(resolveRoute(["report", "yesterday"]), null);
  assert.equal(resolveRoute(["report", "2026-13-40"]), null);
  assert.deepEqual(resolveRoute(["search"]), { page: "search" });
  assert.deepEqual(resolveRoute(["trends"]), { page: "trends" });
  assert.deepEqual(resolveRoute(["channels"]), { page: "channels" });
  assert.deepEqual(resolveRoute(["channels", "UC123"]), {
    page: "channel",
    id: "UC123",
  });
  assert.deepEqual(resolveRoute(["analysis", "run-1"]), {
    page: "analysis",
    id: "run-1",
  });
  assert.deepEqual(resolveRoute(["processing-profiles"]), {
    page: "processing-profiles",
  });
  assert.equal(resolveRoute(["channels", "a", "b"]), null);
  assert.equal(resolveRoute(["nope"]), null);
  assert.equal(resolveRoute(["search", "extra"]), null);
  assert.equal(resolveRoute([]), null);
});

test("current-page marking matches whole path segments", () => {
  assert.ok(isCurrentRoute("/youtube-intelligence/channels/UC1", "/youtube-intelligence/channels"));
  assert.ok(isCurrentRoute("/youtube-intelligence/report/2026-09-28", "/youtube-intelligence/report"));
  assert.ok(!isCurrentRoute("/youtube-intelligence/today", "/youtube-intelligence/trends"));
  assert.ok(!isCurrentRoute("/youtube-intelligence/saved-x", "/youtube-intelligence/saved"));
});
