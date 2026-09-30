import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEARCH_DEFAULTS,
  activeChips,
  callsQueryInput,
  clearAllFilters,
  facetView,
  hiddenByTrust,
  highlightParts,
  instrumentList,
  parseSearchState,
  removalText,
  serialiseSearchState,
  suggestRemoval,
  toggleInstrument,
  verdictLine,
  videosQueryInput,
  windowBounds,
  type SearchFacets,
  type SearchState,
} from "../src/features/youtube-intelligence/ui/search-state.ts";
import { sessionBounds } from "../src/features/youtube-intelligence/trading-day.ts";

/**
 * F62. The Search page keeps every filter in the URL, turns it into a query
 * API input, derives its chips and its "remove this filter" suggestion, and
 * maps a date window of trading sessions to instants. All of that is pure and
 * tested here; the page only renders it.
 */
const params = (query: string) => new URLSearchParams(query);
const state = (patch: Partial<SearchState>): SearchState => ({ ...SEARCH_DEFAULTS, ...patch });

test("An empty URL is the default view: text-checked trust, all dates, the Calls tab", () => {
  const s = parseSearchState(params(""));
  assert.deepEqual(s, SEARCH_DEFAULTS);
  assert.equal(s.trust, "L1");
  assert.equal(s.window, "all");
  assert.equal(s.tab, "calls");
  assert.equal(s.sort, "newest");
  assert.equal(serialiseSearchState(s), "", "defaults leave the URL clean");
});

test("Filters round-trip through the URL, with repeated keys for lists", () => {
  const s = parseSearchState(
    params(
      "q=capex&ticker=NVDA&ticker=AVGO&kind=equity&sentiment=bullish&stance=long&conviction=high&trust=L2&channel=UCa&channel=UCb&window=30d&pinned=1&levels=1&expires=30d&tab=videos&sort=ideas",
    ),
  );
  assert.deepEqual(s, {
    q: "capex",
    tickers: ["NVDA", "AVGO"],
    instruments: [],
    kind: "equity",
    sentiment: "bullish",
    stance: "long",
    conviction: "high",
    trust: "L2",
    channels: ["UCa", "UCb"],
    window: "30d",
    pinned: true,
    levels: true,
    expires: "30d",
    tab: "videos",
    sort: "ideas",
  });
  assert.deepEqual(parseSearchState(params(serialiseSearchState(s))), s);
  // Keys another component owns survive a change.
  assert.match(serialiseSearchState(state({ q: "x" }), "focus=1"), /focus=1/);
  assert.doesNotMatch(serialiseSearchState(state({ q: "" }), "q=old"), /q=/);
});

test("Invalid or duplicate values fall back instead of failing the page", () => {
  const s = parseSearchState(
    params("trust=L9&window=2y&kind=bonds&sentiment=up&tab=x&sort=random&pinned=maybe&ticker=NVDA&ticker=nvda&ticker=%20"),
  );
  assert.equal(s.trust, "L1");
  assert.equal(s.window, "all");
  assert.equal(s.kind, "");
  assert.equal(s.sentiment, "");
  assert.equal(s.tab, "calls");
  assert.equal(s.sort, "newest");
  assert.equal(s.pinned, false);
  assert.deepEqual(s.tickers, ["NVDA"], "blank and case-duplicate tickers are dropped");
});

test("The F59 label link ?kind=macro&instrument=Rates is honoured", () => {
  const s = parseSearchState(params("kind=macro&instrument=Rates"));
  assert.equal(s.kind, "macro");
  assert.deepEqual(s.instruments, ["Rates"]);
  const input = callsQueryInput(s, "2026-09-29T15:00:00Z", { limit: 50, offset: 0 });
  assert.deepEqual(input.kinds, ["macro"]);
  assert.deepEqual(input.instruments, ["Rates"]);
  // Stocks & ETFs is F59's "equity", which the query API calls "stock".
  assert.deepEqual(
    callsQueryInput(state({ kind: "equity" }), "2026-09-29T15:00:00Z", { limit: 50, offset: 0 }).kinds,
    ["stock"],
  );
});

test("Toggling an instrument writes tickers as ticker= and themes as instrument=", () => {
  const withNvda = toggleInstrument(SEARCH_DEFAULTS, "NVDA", "stock");
  assert.deepEqual([withNvda.tickers, withNvda.instruments], [["NVDA"], []]);
  const withRates = toggleInstrument(withNvda, "Rates", "macro");
  assert.deepEqual([withRates.tickers, withRates.instruments], [["NVDA"], ["Rates"]]);
  const without = toggleInstrument(withRates, "nvda", "stock");
  assert.deepEqual(without.tickers, [], "removal ignores case");
});

test("The state maps onto the query API input", () => {
  const input = callsQueryInput(
    state({
      q: "  capex ",
      tickers: ["NVDA"],
      sentiment: "bearish",
      stance: "short",
      conviction: "high",
      trust: "L0",
      channels: ["UCa"],
      pinned: true,
      sort: "conviction",
    }),
    "2026-09-29T15:00:00Z",
    { limit: 50, offset: 100 },
  );
  assert.deepEqual(input, {
    text: "capex",
    instruments: ["NVDA"],
    sentiments: ["bearish"],
    stances: ["short"],
    convictions: ["high"],
    channels: ["UCa"],
    pinnedOnly: true,
    sort: "conviction",
    limit: 50,
    offset: 100,
  });
  assert.equal(callsQueryInput(SEARCH_DEFAULTS, "2026-09-29T15:00:00Z", { limit: 50, offset: 0 }).minTrust, "L1");
  // The Videos tab sorts by newest or ideas; a calls-only sort falls back.
  assert.equal(videosQueryInput(state({ sort: "trust" }), "2026-09-29T15:00:00Z", { limit: 50, offset: 0 }).sort, "newest");
  assert.equal(videosQueryInput(state({ sort: "ideas" }), "2026-09-29T15:00:00Z", { limit: 50, offset: 0 }).sort, "ideas");
  assert.equal(callsQueryInput(state({ sort: "ideas" }), "2026-09-29T15:00:00Z", { limit: 50, offset: 0 }).sort, "newest");
});

test("A window of trading sessions maps to the instant after the prior session's close", () => {
  // Tue 29 Sep 11:00 ET: the current session is Tue 29 Sep.
  const now = "2026-09-29T15:00:00Z";
  assert.deepEqual(sessionBounds("2026-09-29"), {
    from: "2026-09-28T20:00:00.000Z",
    to: "2026-09-29T20:00:00.000Z",
  });
  assert.deepEqual(windowBounds("1d", now), { from: "2026-09-28T20:00:00.000Z" });
  // Seven sessions: 29, 28, 25, 24, 23, 22, 21 Sep; the window opens at Fri 18 Sep's close.
  assert.deepEqual(windowBounds("7d", now), { from: "2026-09-18T20:00:00.000Z" });
  // 30 sessions back skips weekends and Labor Day (7 Sep).
  assert.deepEqual(windowBounds("30d", now), { from: "2026-08-17T20:00:00.000Z" });
  assert.deepEqual(windowBounds("all", now), {});
  // On a Saturday the current session is Monday, so "1d" covers Friday's close onwards.
  assert.deepEqual(windowBounds("1d", "2026-09-26T15:00:00Z"), { from: "2026-09-25T20:00:00.000Z" });
  // Thanksgiving rolls to Friday; Friday's session opens after Wednesday's close (EST).
  assert.deepEqual(windowBounds("1d", "2026-11-26T15:00:00Z"), { from: "2026-11-25T21:00:00.000Z" });
  const input = callsQueryInput(state({ window: "7d" }), now, { limit: 50, offset: 0 });
  assert.equal(input.from, "2026-09-18T20:00:00.000Z");
  assert.equal(input.to, undefined);
});

test("Active chips name each filter and know how to remove it", () => {
  const s = state({
    q: "capex",
    tickers: ["NVDA"],
    instruments: ["Rates"],
    kind: "macro",
    sentiment: "bullish",
    trust: "L1",
    channels: ["UCa"],
    window: "30d",
    pinned: true,
  });
  const chips = activeChips(s, {
    channels: new Map([["UCa", "Alpha Markets"]]),
    instruments: new Map([["Rates", "MACRO · RATES"]]),
  });
  assert.deepEqual(
    chips.map((c) => [c.id, c.label]),
    [
      ["q", "“capex”"],
      ["ticker:NVDA", "NVDA"],
      ["instrument:Rates", "MACRO · RATES"],
      ["kind", "Type: Macro"],
      ["sentiment", "▲ Bullish"],
      ["channel:UCa", "Alpha Markets"],
      ["window", "Last 30 sessions"],
      ["trust", "Trust ≥ Text-checked"],
      ["pinned", "Pinned only"],
    ],
  );
  const ticker = chips.find((c) => c.id === "ticker:NVDA")!;
  assert.deepEqual({ ...s, ...ticker.remove }.tickers, []);
  const trust = chips.find((c) => c.id === "trust")!;
  assert.equal({ ...s, ...trust.remove }.trust, "L0");
  assert.deepEqual(activeChips(state({ trust: "L0" })), [], "all trust levels is no filter");
  // Unknown channel names fall back to the id rather than vanishing.
  assert.equal(activeChips(state({ channels: ["UCz"] })).find((c) => c.id === "channel:UCz")?.label, "UCz");
  const cleared = clearAllFilters(s);
  assert.deepEqual(activeChips(cleared), []);
  assert.equal(cleared.tab, s.tab, "clearing filters keeps the tab");
});

const facets = (patch: Partial<SearchFacets> = {}): SearchFacets => ({
  instrument: [],
  kind: [
    { value: "stock", count: 0 },
    { value: "crypto", count: 0 },
    { value: "macro", count: 0 },
    { value: "sector", count: 0 },
    { value: "unresolved", count: 0 },
  ],
  channel: [],
  stance: [],
  sentiment: [
    { value: "bullish", count: 0 },
    { value: "neutral", count: 0 },
    { value: "bearish", count: 0 },
  ],
  conviction: [],
  trust: [],
  levels: [{ value: "with", count: 0 }],
  expiry: [],
  ...patch,
});

test("No results suggests the single filter removal that returns the most rows", () => {
  const s = state({ sentiment: "bearish", kind: "crypto", window: "7d", q: "capex" });
  const chips = activeChips(s);
  const f = facets({
    // Without the sentiment filter, 4 calls match; without the kind filter, 12.
    sentiment: [
      { value: "bullish", count: 3 },
      { value: "neutral", count: 1 },
      { value: "bearish", count: 0 },
    ],
    kind: [
      { value: "stock", count: 9 },
      { value: "crypto", count: 0 },
      { value: "macro", count: 3 },
      { value: "sector", count: 0 },
      { value: "unresolved", count: 0 },
    ],
  });
  // Chips a facet cannot answer need a count query; until it arrives they are "pending".
  const pending = suggestRemoval(chips, f, {});
  assert.deepEqual(pending.needs.sort(), ["q", "window"]);
  assert.deepEqual(pending.best && [pending.best.chip.id, pending.best.count], ["kind", 12]);
  const done = suggestRemoval(chips, f, { q: 2, window: 30 });
  assert.deepEqual(done.needs, []);
  assert.deepEqual(done.best && [done.best.chip.id, done.best.count], ["window", 30]);
  // Trust counts are per level; removing it counts every level.
  const trust = suggestRemoval(
    activeChips(state({ trust: "L3" })),
    facets({ trust: [{ value: "L0", count: 2 }, { value: "L1", count: 5 }, { value: "L2", count: 0 }, { value: "L3", count: 0 }] }),
    {},
  );
  assert.deepEqual(trust.best && [trust.best.chip.id, trust.best.count], ["trust", 7]);
  assert.equal(removalText(done.best!), "Remove “Last 7 sessions” to see 30 calls");
  assert.equal(
    removalText({ chip: chips.find((c) => c.id === "q")!, count: 1 }),
    "Remove “capex” to see 1 call",
    "a text chip is not quoted twice",
  );
  // Nothing helps: no suggestion rather than "remove X to see 0 calls".
  assert.equal(suggestRemoval(chips, facets(), { q: 0, window: 0 }).best, null);
  assert.equal(suggestRemoval([], facets(), {}).best, null);
});

test("Has levels and Expires within map to the query and to chips (F60 filters)", () => {
  const s = state({ levels: true, expires: "7d" });
  const input = callsQueryInput(s, "2026-09-29T23:30:00Z", { limit: 50, offset: 0 });
  assert.equal(input.hasLevels, true);
  assert.equal(input.expiresWithin, 7);
  assert.equal(input.today, "2026-09-29", "expiry counts from the UTC date");
  assert.equal(callsQueryInput(SEARCH_DEFAULTS, "2026-09-29T15:00:00Z", { limit: 50, offset: 0 }).hasLevels, undefined);
  const chips = activeChips(s);
  assert.deepEqual(
    chips.filter((c) => c.id === "levels" || c.id === "expires").map((c) => c.label),
    ["Has levels", "Expires within 7 days"],
  );
  // Neither facet counts every call, so removing either needs a count query.
  assert.deepEqual(
    suggestRemoval(chips, facets({ trust: [{ value: "L1", count: 1 }] }), {}).needs.sort(),
    ["expires", "levels"],
  );
  assert.equal(parseSearchState(params("expires=14d&levels=maybe")).expires, "");
});

test("The trust line counts calls below the minimum, from the trust facet", () => {
  const trust = [
    { value: "L0", count: 3 },
    { value: "L1", count: 10 },
    { value: "L2", count: 4 },
    { value: "L3", count: 0 },
  ];
  assert.equal(hiddenByTrust(trust, "L1"), 3);
  assert.equal(hiddenByTrust(trust, "L2"), 13);
  assert.equal(hiddenByTrust(trust, "L0"), 0);
  assert.equal(hiddenByTrust([], "L1"), 0);
});

test("Facet lists keep zero counts, show the top 8 and filter the rest by text", () => {
  const values = Array.from({ length: 12 }, (_, i) => ({ value: `T${i}`, count: 12 - i }));
  values.push({ value: "黄金", count: 0 });
  const top = facetView(values, [], { limit: 8 });
  assert.equal(top.shown.length, 8);
  assert.equal(top.more, 5);
  // A selected value is always shown, even past the top 8.
  assert.ok(facetView(values, ["T11"], { limit: 8 }).shown.some((v) => v.value === "T11"));
  const found = facetView(values, [], { limit: 8, expanded: true, filter: "t1" });
  assert.deepEqual(found.shown.map((v) => v.value), ["T1", "T10", "T11"]);
  assert.equal(found.more, 0);
  assert.deepEqual(facetView(values, [], { limit: 8, expanded: true, filter: "黄" }).shown.map((v) => v.value), ["黄金"]);
  // Labels are searched too ("MACRO · RATES" for the key "Rates").
  assert.deepEqual(
    facetView([{ value: "Rates", count: 1, label: "MACRO · RATES" }], [], { limit: 8, filter: "macro" }).shown.length,
    1,
  );
});

test("Matched text is highlighted case-insensitively, including CJK", () => {
  assert.deepEqual(highlightParts("Capex holds up; CAPEX grows", "capex"), [
    { text: "Capex", match: true },
    { text: " holds up; ", match: false },
    { text: "CAPEX", match: true },
    { text: " grows", match: false },
  ]);
  assert.deepEqual(highlightParts("黄金将受益于实际利率下降", "实际利率"), [
    { text: "黄金将受益于", match: false },
    { text: "实际利率", match: true },
    { text: "下降", match: false },
  ]);
  assert.deepEqual(highlightParts("a.b", "."), [
    { text: "a", match: false },
    { text: ".", match: true },
    { text: "b", match: false },
  ]);
  assert.deepEqual(highlightParts("text", "  "), [{ text: "text", match: false }]);
});

test("A video's verdict line counts ideas and sentiment with glyphs", () => {
  assert.equal(verdictLine({ ideas: 4, sentiment: { bullish: 3, neutral: 1, bearish: 0 } }), "4 ideas · 3 ▲ 1 ●");
  assert.equal(verdictLine({ ideas: 1, sentiment: { bullish: 0, neutral: 0, bearish: 1 } }), "1 idea · 1 ▼");
  assert.equal(verdictLine({ ideas: 0, sentiment: { bullish: 0, neutral: 0, bearish: 0 } }), "No ideas");
});

test("a video row separates its instruments, so macro labels do not run together (F77)", () => {
  assert.equal(instrumentList([]), "");
  assert.equal(instrumentList(["NVDA", "Macro · Rates"]), "NVDA, Macro · Rates");
  assert.equal(
    instrumentList(["Macro · Gold", "Macro · Oil", "Macro · USD"]),
    "Macro · Gold, Macro · Oil, Macro · USD",
  );
  assert.equal(instrumentList(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D, E +2");
});
