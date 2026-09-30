/**
 * Synthetic phase-5 gate data (F77). Never points at a production database.
 *
 * Seeds an isolated local Postgres (`yti_phase5_gate`) with enough rows to
 * exercise every LeapEdge-gap surface: four channels (one Chinese-language,
 * one not followed), completed video analyses across the recent US sessions
 * (including a Friday-evening-ET and a weekend upload that roll into Monday),
 * a history for Trends, macro and sector calls, parsed and unparsed levels,
 * catalysts, actions and expiries, trust levels L0/L1/L2, a failed, a running
 * and a queued run, pinned tickers, price history and saved ideas in every
 * state. Rows are written through the real fixture writer, publish path and
 * repositories; no provider is called.
 *
 * The recent runs are dated around the gate date, 29 September 2026. The
 * running and queued runs are stamped with the clock, so their elapsed time is
 * realistic when the browser matrix runs straight after seeding.
 *
 *   YTI_ISOLATED_DB=true YTI_FIXTURE_MODE=true \
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/yti_phase5_gate \
 *   node --experimental-strip-types scripts/seed-phase5.ts
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PHASE5_DATABASE = "yti_phase5_gate";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

/**
 * The guard, as a pure function of the environment: the reason to refuse, or
 * null when the target is the isolated local phase-5 database.
 */
export function phase5SeedRefusal(env: Record<string, string | undefined>): string | null {
  if (env.YTI_ISOLATED_DB !== "true") return "YTI_ISOLATED_DB=true is required.";
  if (env.YTI_FIXTURE_MODE !== "true") return "YTI_FIXTURE_MODE=true is required.";
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const value = env[name];
    if (!value) {
      if (name === "DATABASE_URL") return "DATABASE_URL is required.";
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return `${name} is not a URL.`;
    }
    if (!/^postgres(ql)?:$/.test(url.protocol)) return `${name} is not a Postgres URL.`;
    if (!LOCAL_HOSTS.includes(url.hostname))
      return `${name} points at ${url.hostname}; only a local database may be seeded.`;
    if (url.pathname !== `/${PHASE5_DATABASE}`)
      return `${name} names ${url.pathname.slice(1) || "no database"}; only ${PHASE5_DATABASE} may be seeded.`;
    if (env.YTI_PRODUCTION_DB_HOST && url.hostname === env.YTI_PRODUCTION_DB_HOST)
      return `${name} is the production host.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The data, as plain values.

type Level = { kind: "entry" | "target" | "stop" | "support" | "resistance" | "strike"; value: string };
type Call = {
  key: string;
  ticker: string | null;
  instrument: string;
  stance: "long" | "short" | "neutral" | "avoid" | "watch" | "hold" | "conditional";
  conviction: "high" | "medium" | "low" | "unspecified";
  thesis: string;
  segment: string;
  translation?: string;
  horizon?: string;
  levels?: Level[];
  /** Structured-idea fields (prompt v9+): dated catalysts and the action enum. */
  catalysts?: { text_en: string; date_original: string | null }[];
  action?: "bought" | "sold" | "holding" | "plan_buy" | "plan_sell" | "watch" | "research" | "avoid" | "view";
  expiry?: { date: string | null; original: string };
  macro?: string;
  risks?: string[];
  conditions?: string[];
  /** L0: legacy quote without a pointer span; L2: independent audio agreement. */
  trust?: "L0" | "L1" | "L2";
  rejected?: string;
};
type RunSpec = {
  key: string;
  channel: string;
  videoId: string;
  title: string;
  publishedAt: string;
  createdAt: string;
  language?: string;
  segments: [string, string, number, number][];
  calls: Call[];
  /** Current pipeline identity (reusable) versus the older fixture pipeline. */
  current?: boolean;
  summary?: string;
  keyPoints?: { text: string; segment: string }[];
};

const CHANNELS = [
  { key: "macro-mike", id: "UCmacroMike0000000000001", title: "Macro Mike", handle: "@macromike", followed: true, favorite: true, createdAt: "2026-05-20T09:00:00.000Z" },
  { key: "laowang", id: "UClaowangStocks000000002", title: "老王聊股", handle: "@laowangstocks", followed: true, favorite: false, createdAt: "2026-05-22T09:00:00.000Z" },
  { key: "chart-school", id: "UCchartSchool00000000003", title: "Chart School", handle: "@chartschool", followed: true, favorite: false, createdAt: "2026-06-03T09:00:00.000Z" },
  { key: "value-hunter", id: "UCvalueHunter00000000004", title: "Value Hunter", handle: "@valuehunter", followed: false, favorite: false, createdAt: "2026-09-29T14:00:00.000Z" },
];

/** Hand-written recent runs, around the gate date (Tue 29 Sep 2026). */
const RECENT: RunSpec[] = [
  // Wed 30 Sep session: uploaded after Tuesday's close.
  {
    key: "mike-fed-nvda",
    channel: "macro-mike",
    videoId: "p5MikeFed01",
    title: "Fed pause and NVDA into earnings: adding here",
    publishedAt: "2026-09-29T21:05:00.000Z",
    createdAt: "2026-09-29T21:20:00.000Z",
    current: true,
    summary:
      "Macro Mike adds to Nvidia ahead of earnings and expects Treasury yields to keep falling after the Fed's pause.",
    segments: [
      ["s1", "The Fed paused today and I think yields keep drifting lower into year end, so I am short rates here.", 30, 41],
      ["s2", "I am adding to NVDA on any dip toward $172, my target is $210 and I get out on a close below $160.", 95, 108],
      ["s3", "The catalysts are the Q3 earnings on 18 November and the next Fed decision; I want this to work by Friday.", 108, 119],
      ["s4", "Remember that none of this is advice, it is how I manage my own book.", 300, 306],
    ],
    calls: [
      {
        key: "rates-short",
        ticker: null,
        instrument: "Treasury yields",
        macro: "rates",
        stance: "short",
        conviction: "medium",
        thesis: "Yields keep drifting lower into year end after the Fed pause.",
        segment: "s1",
        horizon: "into year end",
        action: "holding",
        trust: "L1",
      },
      {
        key: "nvda-long",
        ticker: "NVDA",
        instrument: "Nvidia",
        stance: "long",
        conviction: "high",
        thesis: "Add to NVDA on dips toward $172 ahead of earnings, target $210, stop on a close below $160.",
        segment: "s2",
        horizon: "into Q3 earnings",
        levels: [
          { kind: "entry", value: "$172" },
          { kind: "target", value: "$210" },
          { kind: "stop", value: "close below $160" },
        ],
        catalysts: [
          { text_en: "Q3 earnings", date_original: "18 November" },
          { text_en: "Next Fed decision", date_original: null },
        ],
        action: "plan_buy",
        expiry: { date: "2026-10-02", original: "by Friday" },
        risks: ["An earnings miss would break the setup."],
        conditions: ["Only while the stock holds $160 on a closing basis."],
        trust: "L2",
      },
    ],
    keyPoints: [{ text: "The Fed paused and the creator expects yields to drift lower.", segment: "s1" }],
  },
  {
    key: "laowang-semis",
    channel: "laowang",
    videoId: "p5LaoSemi01",
    language: "zh",
    title: "英伟达财报前瞻：半导体板块还能追吗？",
    publishedAt: "2026-09-29T20:15:00.000Z",
    createdAt: "2026-09-29T20:40:00.000Z",
    current: true,
    segments: [
      ["s1", "英伟达 NVDA 财报前我先观望，不追高。", 12, 18],
      ["s2", "半导体板块整体还是强势，我继续看多半导体。", 40, 47],
    ],
    calls: [
      {
        key: "nvda-watch",
        ticker: "NVDA",
        instrument: "英伟达",
        stance: "watch",
        conviction: "medium",
        thesis: "Wait on Nvidia before earnings rather than chase it.",
        translation: "Before Nvidia (NVDA) reports I will wait and watch rather than chase it.",
        segment: "s1",
        trust: "L1",
      },
      {
        key: "semis-long",
        ticker: null,
        instrument: "半导体板块",
        macro: "semiconductors",
        stance: "long",
        conviction: "medium",
        thesis: "The semiconductor sector remains strong; stays bullish on semis.",
        translation: "The semiconductor sector as a whole is still strong; I remain bullish on semis.",
        segment: "s2",
        trust: "L1",
      },
    ],
  },
  {
    key: "chart-tsla-range",
    channel: "chart-school",
    videoId: "p5ChartTsl1",
    title: "TSLA range break or fake-out? Levels to watch",
    publishedAt: "2026-09-29T21:50:00.000Z",
    createdAt: "2026-09-29T22:05:00.000Z",
    current: true,
    segments: [
      ["s1", "TSLA is boxed between 364 and 382; a break above 382 opens a run back to the old highs.", 60, 72],
      ["s2", "I would not buy AAPL here, the iPhone cycle looks soft.", 150, 156],
      ["s3", "Someone asked about PLTR, I have no opinion on it today.", 200, 205],
    ],
    calls: [
      {
        key: "tsla-conditional",
        ticker: "TSLA",
        instrument: "Tesla",
        stance: "conditional",
        conviction: "medium",
        thesis: "Tesla is range-bound between 364 and 382; a break above 382 targets the old highs.",
        segment: "s1",
        levels: [
          { kind: "support", value: "364" },
          { kind: "resistance", value: "382" },
          { kind: "target", value: "the old highs" },
        ],
        conditions: ["A daily close above 382."],
        expiry: { date: "2026-09-25", original: "into last Friday's close" },
        action: "plan_buy",
        trust: "L1",
      },
      {
        key: "aapl-avoid",
        ticker: "AAPL",
        instrument: "Apple",
        stance: "avoid",
        conviction: "low",
        thesis: "Avoid Apple for now because the iPhone cycle looks soft.",
        segment: "s2",
        trust: "L0",
      },
      {
        key: "pltr-none",
        ticker: "PLTR",
        instrument: "Palantir",
        stance: "neutral",
        conviction: "unspecified",
        thesis: "No opinion on Palantir today.",
        segment: "s3",
        rejected: "The creator states no view, so this is not a call.",
      },
    ],
  },
  // Tue 29 Sep session.
  {
    key: "hunter-avgo",
    channel: "value-hunter",
    videoId: "p5HuntAvgo1",
    title: "Broadcom after earnings: a boring compounder",
    publishedAt: "2026-09-29T14:30:00.000Z",
    createdAt: "2026-09-29T14:50:00.000Z",
    current: true,
    segments: [
      ["s1", "AVGO is a boring compounder and I keep buying it every month for the next three years.", 20, 30],
    ],
    calls: [
      {
        key: "avgo-long",
        ticker: "AVGO",
        instrument: "Broadcom",
        stance: "long",
        conviction: "high",
        thesis: "Broadcom is a boring compounder worth buying every month.",
        segment: "s1",
        horizon: "three years",
        action: "plan_buy",
        trust: "L1",
      },
    ],
  },
  {
    key: "mike-wrap-no-ideas",
    channel: "macro-mike",
    videoId: "p5MikeWrap1",
    title: "Market wrap: what moved today and why",
    publishedAt: "2026-09-29T16:00:00.000Z",
    createdAt: "2026-09-29T16:30:00.000Z",
    current: true,
    segments: [["s1", "Today we walk through how index rebalancing works and why it moves prices at the close.", 5, 15]],
    calls: [],
  },
  {
    key: "chart-semis-breadth",
    channel: "chart-school",
    videoId: "p5ChartTsm1",
    title: "Semis breadth check: TSM, AMD and the SMH",
    publishedAt: "2026-09-29T12:00:00.000Z",
    createdAt: "2026-09-29T12:25:00.000Z",
    current: true,
    segments: [
      ["s1", "TSM keeps making higher lows, I like it above 290 with a 330 target.", 40, 48],
      ["s2", "AMD I am just watching, it needs to reclaim 170 first.", 90, 96],
    ],
    calls: [
      {
        key: "tsm-long",
        ticker: "TSM",
        instrument: "TSMC",
        stance: "long",
        conviction: "medium",
        thesis: "TSMC keeps making higher lows; constructive above 290 with a 330 target.",
        segment: "s1",
        levels: [
          { kind: "support", value: "above 290" },
          { kind: "target", value: "330" },
        ],
        trust: "L2",
      },
      {
        key: "amd-watch",
        ticker: "AMD",
        instrument: "AMD",
        stance: "watch",
        conviction: "low",
        thesis: "Watching AMD until it reclaims 170.",
        segment: "s2",
        levels: [{ kind: "resistance", value: "170" }],
        trust: "L1",
      },
    ],
  },
  // Mon 28 Sep session: a Friday-evening-ET and a weekend upload roll into it.
  {
    key: "mike-friday-night",
    channel: "macro-mike",
    videoId: "p5MikeFri01",
    title: "Friday night take: oil, gold and the dollar",
    publishedAt: "2026-09-25T22:30:00.000Z",
    createdAt: "2026-09-25T23:00:00.000Z",
    current: true,
    segments: [
      ["s1", "Oil looks like it has bottomed, I am long crude into winter.", 30, 37],
      ["s2", "Gold is my hedge and I will keep a small long.", 60, 66],
      ["s3", "The dollar should weaken from here, I am short the dollar.", 90, 96],
    ],
    calls: [
      { key: "oil-long", ticker: null, instrument: "crude oil", macro: "oil", stance: "long", conviction: "medium", thesis: "Oil has bottomed; long crude into winter.", segment: "s1", horizon: "into winter", trust: "L1" },
      { key: "gold-long", ticker: null, instrument: "gold", macro: "gold", stance: "long", conviction: "low", thesis: "Keep a small gold long as a hedge.", segment: "s2", trust: "L1" },
      { key: "usd-short", ticker: null, instrument: "the dollar", macro: "usd", stance: "short", conviction: "medium", thesis: "The dollar weakens from here.", segment: "s3", trust: "L1" },
    ],
  },
  {
    key: "laowang-weekend",
    channel: "laowang",
    videoId: "p5LaoWknd01",
    language: "zh",
    title: "周末复盘：特斯拉和英伟达怎么看",
    publishedAt: "2026-09-26T15:00:00.000Z",
    createdAt: "2026-09-26T15:30:00.000Z",
    current: true,
    segments: [
      ["s1", "特斯拉 TSLA 我继续持有，三个月内看到 420。", 20, 27],
      ["s2", "英伟达 NVDA 估值太高了，我在减仓。", 60, 66],
    ],
    calls: [
      {
        key: "tsla-long",
        ticker: "TSLA",
        instrument: "特斯拉",
        stance: "long",
        conviction: "medium",
        thesis: "Keeps holding Tesla with a three-month target of 420.",
        translation: "I keep holding Tesla (TSLA) and expect 420 within three months.",
        segment: "s1",
        horizon: "three months",
        levels: [{ kind: "target", value: "420" }],
        trust: "L1",
      },
      {
        key: "nvda-short",
        ticker: "NVDA",
        instrument: "英伟达",
        stance: "short",
        conviction: "medium",
        thesis: "Nvidia's valuation is too high; reducing the position.",
        translation: "Nvidia's (NVDA) valuation is too high, I am trimming.",
        segment: "s2",
        action: "plan_sell",
        trust: "L1",
      },
    ],
  },
  {
    key: "chart-nvda-avgo",
    channel: "chart-school",
    videoId: "p5ChartNvA1",
    title: "NVDA and AVGO: the two charts that matter this week",
    publishedAt: "2026-09-28T13:00:00.000Z",
    createdAt: "2026-09-28T13:20:00.000Z",
    current: true,
    segments: [
      ["s1", "NVDA held its 50 day average, I am long with a stop at 158.", 30, 38],
      ["s2", "AVGO broke its trend line, I am short into the gap fill.", 70, 77],
    ],
    calls: [
      { key: "nvda-long", ticker: "NVDA", instrument: "Nvidia", stance: "long", conviction: "medium", thesis: "Nvidia held its 50-day average; long with a stop at 158.", segment: "s1", levels: [{ kind: "stop", value: "158" }], trust: "L2" },
      { key: "avgo-short", ticker: "AVGO", instrument: "Broadcom", stance: "short", conviction: "medium", thesis: "Broadcom broke its trend line; short into the gap fill.", segment: "s2", trust: "L1" },
    ],
  },
  // Fri 25 Sep session.
  {
    key: "mike-pce",
    channel: "macro-mike",
    videoId: "p5MikePce01",
    title: "PCE day: rates, small caps and the IWM",
    publishedAt: "2026-09-25T14:00:00.000Z",
    createdAt: "2026-09-25T14:30:00.000Z",
    current: true,
    segments: [
      ["s1", "Inflation is cooling, and that is bullish for IWM once yields roll over.", 20, 28],
      ["s2", "Growth is slowing more than people think.", 50, 55],
    ],
    calls: [
      { key: "iwm-long", ticker: "IWM", instrument: "small caps", stance: "long", conviction: "medium", thesis: "Cooling inflation is bullish for small caps once yields roll over.", segment: "s1", trust: "L1" },
      { key: "growth-short", ticker: null, instrument: "economic growth", macro: "growth", stance: "short", conviction: "low", thesis: "Growth is slowing more than expected.", segment: "s2", trust: "L1" },
    ],
  },
  // Thu 24 Sep session.
  {
    key: "laowang-msft",
    channel: "laowang",
    videoId: "p5LaoMsft01",
    language: "zh",
    title: "降息之后，微软还是我的第一大持仓",
    publishedAt: "2026-09-24T15:00:00.000Z",
    createdAt: "2026-09-24T15:20:00.000Z",
    current: true,
    segments: [["s1", "微软 MSFT 还是我的第一大持仓，长期看多。", 10, 16]],
    calls: [
      { key: "msft-long", ticker: "MSFT", instrument: "微软", stance: "long", conviction: "high", thesis: "Microsoft stays the largest holding; long-term bullish.", translation: "Microsoft (MSFT) is still my largest position; long-term bullish.", segment: "s1", trust: "L1" },
    ],
  },
  // Wed 23 Sep session.
  {
    key: "chart-amd-nvda",
    channel: "chart-school",
    videoId: "p5ChartAmd1",
    title: "AMD vs NVDA: which chip stock for Q4?",
    publishedAt: "2026-09-23T15:00:00.000Z",
    createdAt: "2026-09-23T15:25:00.000Z",
    current: true,
    segments: [["s1", "For Q4 I prefer AMD over NVDA, AMD can reach 200 by the end of the year.", 40, 48]],
    calls: [
      { key: "amd-long", ticker: "AMD", instrument: "AMD", stance: "long", conviction: "medium", thesis: "Prefers AMD for Q4 with a year-end target of 200.", segment: "s1", levels: [{ kind: "target", value: "200" }], expiry: { date: "2026-12-31", original: "by the end of the year" }, trust: "L1" },
    ],
  },
];

const HISTORY_TICKERS: { ticker: string; name: string; bull: number }[] = [
  { ticker: "NVDA", name: "Nvidia", bull: 0.7 },
  { ticker: "TSLA", name: "Tesla", bull: 0.5 },
  { ticker: "AAPL", name: "Apple", bull: 0.55 },
  { ticker: "AVGO", name: "Broadcom", bull: 0.65 },
  { ticker: "TSM", name: "TSMC", bull: 0.6 },
  { ticker: "AMD", name: "AMD", bull: 0.5 },
  { ticker: "MSFT", name: "Microsoft", bull: 0.6 },
];
const PRICE_START: Record<string, number> = {
  NVDA: 150, TSLA: 330, AAPL: 220, AVGO: 300, TSM: 260, AMD: 150, MSFT: 480, IWM: 215, SPY: 610,
};

/** Deterministic pseudo-random numbers, so every seed writes the same rows. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const refusal = phase5SeedRefusal(process.env);
  if (refusal) throw Error(`Refusing to seed: ${refusal}`);
  const { seedFixture } = await import("../tests/helpers/fixtures.ts");
  const { database } = await import("../src/server/youtube-intelligence/database.ts");
  const { list } = await import("../src/server/youtube-intelligence/store.ts");
  const { rowsForRun, writeRunRows } = await import("../src/server/youtube-intelligence/repos/publish.ts");
  const { savePrices } = await import("../src/server/youtube-intelligence/repos/prices.ts");
  const { upsertChannel } = await import("../src/server/youtube-intelligence/repos/channels.ts");
  const { deriveEvidence } = await import("../src/features/youtube-intelligence/contracts.ts");
  const { isTradingDay, sessionsBetween } = await import("../src/features/youtube-intelligence/trading-day.ts");
  const { sentimentFromStance } = await import("../src/features/youtube-intelligence/stance-sentiment.ts");
  const research = await import("../src/server/youtube-intelligence/research-store.ts");
  type SourceData = import("../src/features/youtube-intelligence/contracts.ts").SourceData;
  type CheckedClaim = import("../src/features/youtube-intelligence/contracts.ts").CheckedClaim;
  type FixtureSpecData = import("../tests/helpers/fixtures.ts").FixtureSpecData;

  try {
    if ((await list()).length)
      throw Error("The phase-5 database is already seeded; drop and recreate it to reseed.");

    // History for Trends and the leaderboard: one or two older-pipeline
    // analyses per trading day from July to 22 September.
    const random = prng(20260929);
    const pick = <T,>(values: T[]) => values[Math.floor(random() * values.length)];
    const history: RunSpec[] = [];
    const historyDays = sessionsBetween("2026-07-01", "2026-09-22").filter(isTradingDay);
    historyDays.forEach((day, i) => {
      const perDay = random() < 0.4 ? 2 : 1;
      for (let v = 0; v < perDay; v++) {
        const channel = CHANNELS[(i + v) % 3];
        const a = pick(HISTORY_TICKERS);
        let b = pick(HISTORY_TICKERS);
        if (b.ticker === a.ticker) b = HISTORY_TICKERS[(HISTORY_TICKERS.indexOf(a) + 1) % HISTORY_TICKERS.length];
        const picks = random() < 0.5 ? [a] : [a, b];
        const n = history.length + 1;
        const hour = 12 + Math.floor(random() * 7);
        const at = `${day}T${String(hour).padStart(2, "0")}:15:00.000Z`;
        const calls: Call[] = picks.map((t, j) => {
          const r = random();
          const stance: Call["stance"] = r < t.bull ? "long" : r < t.bull + 0.15 ? "watch" : random() < 0.5 ? "short" : "avoid";
          const verb = stance === "long" ? "I am buying" : stance === "watch" ? "I am watching" : "I am selling";
          return {
            key: `${t.ticker.toLowerCase()}-${j}`,
            ticker: t.ticker,
            instrument: t.name,
            stance,
            conviction: pick(["high", "medium", "medium", "low"] as const),
            thesis: `${verb} ${t.name} (${t.ticker}) on the ${day} setup.`,
            segment: `s${j + 1}`,
            trust: random() < 0.2 ? "L2" : "L1",
          };
        });
        // One older call on a ticker with no stored prices ("No price" states).
        if (n === 5)
          calls.push({ key: "pltr-watch", ticker: "PLTR", instrument: "Palantir", stance: "watch", conviction: "low", thesis: "Watching Palantir (PLTR) for a pullback.", segment: `s${calls.length + 1}`, trust: "L1" });
        // A macro call every so often, so Trends and In focus see macro rows.
        if (n % 7 === 0)
          calls.push({ key: "rates-watch", ticker: null, instrument: "interest rates", macro: "rates", stance: random() < 0.5 ? "long" : "short", conviction: "medium", thesis: "Rates are the swing factor for the next month.", segment: `s${calls.length + 1}`, trust: "L1" });
        history.push({
          key: `history-${String(n).padStart(3, "0")}`,
          channel: channel.key,
          videoId: `p5Hist${String(n).padStart(5, "0")}`,
          title: `${pick(["Market wrap", "Morning note", "Live Q&A", "Weekly outlook", "Chart review"])}: ${calls.map((c) => c.ticker ?? c.instrument).join(", ")}`,
          publishedAt: at,
          createdAt: at.replace(":15:00", ":40:00"),
          language: "en",
          segments: calls.map((c, j) => [`s${j + 1}`, `${c.thesis.replace(/\.$/, "")} and that is my view.`, 30 + j * 60, 40 + j * 60]),
          calls,
        });
      }
    });
    const runs = [...history, ...RECENT];

    // Prices: every trading day from June to the gate date, a seeded walk.
    const priceDays = sessionsBetween("2026-06-01", "2026-09-29").filter(isTradingDay);
    const prices = Object.entries(PRICE_START).map(([symbol, start]) => {
      const walk = prng(symbol.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
      let close = start;
      return {
        symbol,
        from: priceDays[0],
        to: priceDays.at(-1)!,
        fetchedAt: "2026-09-29T22:00:00.000Z",
        exchange: symbol === "TSM" ? "NYSE" : "NASDAQ",
        name: HISTORY_TICKERS.find((t) => t.ticker === symbol)?.name ?? symbol,
        closes: priceDays.map((date) => {
          close = Math.max(1, close * (1 + (walk() - 0.47) * 0.035));
          return [date, Math.round(close * 100) / 100] as [string, number];
        }),
      };
    });

    const byKey = new Map(runs.map((r) => [r.key, r]));
    const spec: FixtureSpecData = {
      id: "phase5",
      asOf: "2026-09-29",
      now: "2026-09-29T22:30:00.000Z",
      horizonDays: 90,
      documents: [],
      prices,
      channels: CHANNELS.map((c) => ({
        key: c.key,
        id: c.id,
        title: c.title,
        handle: c.handle,
        uploads: `UU${c.id.slice(2)}`,
        favorite: c.favorite,
        // Fixture channels cannot trigger paid background work.
        autoAnalyze: false,
        createdAt: c.createdAt,
      })),
      runs: runs.map((r) => ({
        key: r.key,
        channel: r.channel,
        videoId: r.videoId,
        title: r.title,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
        model: "gemini-3.8-flash",
        promptVersion: r.current ? "evidence-first.web.v9" : "evidence-first.web.v8",
        language: r.language ?? "en",
        cost: r.calls.length ? 0.04 : 0.02,
        segments: r.segments.map(([id, text, start, end]) => ({ id, text, start, end })),
        claims: r.calls.map((c) => {
          const text = r.segments.find((s) => s[0] === c.segment)![1];
          return {
            key: c.key,
            ticker: c.ticker,
            tickerExplicit: true,
            instrument: c.instrument,
            stance: c.stance,
            conviction: c.conviction,
            thesis: c.thesis,
            horizon: c.horizon ?? null,
            conditions: c.conditions ?? [],
            risks: c.risks ?? [],
            levels: (c.levels ?? []).map((l) => ({ kind: l.kind, value: l.value })),
            quotes: [{ segment: c.segment, quote: text, translation: c.translation ?? "" }],
            passed: !c.rejected,
            reasons: c.rejected ? [c.rejected] : [],
          };
        }),
      })),
    };
    await seedFixture(spec);

    for (const c of CHANNELS)
      await upsertChannel({
        id: c.id,
        title: c.title,
        handle: c.handle,
        uploads: `UU${c.id.slice(2)}`,
        // Following is the discovery switch; Value Hunter stays unfollowed (F71).
        active: c.followed,
        favorite: c.favorite,
        autoAnalyze: false,
        createdAt: c.createdAt,
        tier: "1",
        discovery: "manual",
        processing: "on-request",
        followedAt: c.followed ? c.createdAt : null,
      });

    // The current pipeline identity, so a re-submission of a recent video is
    // answered by its analysis (F74). History keeps the older fixture pipeline.
    const plan = await research.queuePlan();
    for (const run of await list()) {
      const spec = [...byKey.values()].find((r) => r.videoId === run.videoId);
      if (!spec) continue;
      const source = run.output.source as SourceData;
      const claims = run.output.claims as CheckedClaim[];
      const agreement: Record<string, unknown> = {};
      const mentionChecks: Record<string, boolean> = {};
      const mentions: unknown[] = [];
      claims.forEach((checked, i) => {
        const call = spec.calls[i];
        if (call.trust !== "L0")
          checked.claim.evidence = checked.claim.evidence.map((e) => {
            const span = { start_id: e.segment_id, end_id: e.end_segment_id ?? e.segment_id };
            const derived = deriveEvidence(source, span);
            return {
              ...e,
              quote_original: derived.quote_original,
              source_span: {
                ...span,
                start_seconds: derived.start_seconds,
                end_seconds: derived.end_seconds,
                text_hash: derived.text_hash,
              },
            };
          });
        Object.assign(checked.claim, {
          catalysts: call.catalysts ?? [],
          action: call.action,
          expiry: call.expiry ?? null,
          macro_theme: call.macro ?? null,
        });
        if (call.trust === "L2")
          agreement[checked.id] = checked.claim.evidence.map((e) => ({
            agreementScore: 0.96,
            anchorErrorSeconds: 0.8,
            agreed: true,
            independent: true,
            referenceText: e.quote_original,
            referenceStartSeconds: e.source_span?.start_seconds ?? null,
            referenceEndSeconds: e.source_span?.end_seconds ?? null,
            tieBreakSource: null,
          }));
        if (!checked.passed) return;
        const segment = source.segments.find((s) => s.id === call.segment)!;
        const span = {
          start_id: segment.id,
          end_id: segment.id,
          start_seconds: segment.start_seconds,
          end_seconds: segment.end_seconds,
          text_hash: createHash("sha256").update(segment.text).digest("hex"),
        };
        mentions.push({
          ticker: call.ticker,
          instrument_as_spoken: call.instrument,
          market: call.ticker ? "us-stock" : "other",
          stance: call.stance,
          sentiment: sentimentFromStance(call.stance) ?? "neutral",
          rationale_en: call.thesis,
          source_span: span,
          is_call: true,
          claim_id: checked.id,
        });
        mentionChecks[`${call.ticker ?? call.instrument}:${segment.id}:${segment.id}`] = call.trust !== "L0";
      });
      run.output.spanAgreement = agreement;
      run.output.mentions = mentions;
      run.output.mentionChecks = mentionChecks;
      (run.output.metadata as Record<string, unknown>).durationSeconds = 600 + (spec.segments.length * 137) % 900;
      if (spec.summary) run.output.summary = spec.summary;
      if (spec.keyPoints)
        run.output.keyPoints = spec.keyPoints.map((p, i) => {
          const segment = source.segments.find((s) => s.id === p.segment)!;
          return {
            id: `k${i + 1}`,
            passed: true,
            reasons: [],
            // A full claim, as the pipeline stores a checked key point.
            claim: {
              thesis_en: p.text,
              instrument_as_spoken: null,
              ticker: null,
              ticker_explicit: false,
              stance: "neutral",
              horizon_en: null,
              conditions_en: [],
              creator_conviction: "unspecified",
              risks_en: [],
              levels: [],
              evidence: [
                {
                  segment_id: segment.id,
                  quote_original: segment.text,
                  quote_translation_en: "",
                  source_span: {
                    start_id: segment.id,
                    end_id: segment.id,
                    start_seconds: segment.start_seconds,
                    end_seconds: segment.end_seconds,
                    text_hash: createHash("sha256").update(segment.text).digest("hex"),
                  },
                },
              ],
            },
          };
        });
      let model = run.model,
        promptVersion = run.promptVersion;
      if (spec.current) {
        model = plan.model;
        promptVersion = plan.promptVersion;
        run.input = { ...plan.input, record: "forward", fixture: "phase5" };
      } else run.input.record = "forward";
      run.model = model;
      run.promptVersion = promptVersion;
      await database
        .prepare("UPDATE yi_runs SET model=$1,prompt_version=$2,input=$3,output=$4 WHERE id=$5")
        .run(model, promptVersion, JSON.stringify(run.input), JSON.stringify(run.output), run.id);
      await writeRunRows(rowsForRun(run));
    }

    await savePrices(
      prices.flatMap((p) =>
        p.closes.map(([date, adjustedClose]) => ({
          ticker: p.symbol,
          date,
          adjustedClose,
          source: "SYNTHETIC phase-5 gate fixture",
          fetchedAt: p.fetchedAt,
        })),
      ),
    );

    // Failed, running and queued analyses. They are inserted as rows only (no
    // queue job), so no worker can pick them up and nothing is spent.
    const now = Date.now();
    const stamp = (ms: number) => new Date(ms).toISOString();
    const open = [
      {
        id: "phase5-run-failed",
        videoId: "p5FailCap01",
        title: "Live: options flow Q&A",
        status: "failed",
        stage: "source",
        error: "Captions are not available for this video, so no transcript could be read.",
        createdAt: "2026-09-29T17:10:00.000Z",
        updatedAt: "2026-09-29T17:11:30.000Z",
        channel: CHANNELS[2],
        leaseUntil: 0,
      },
      {
        id: "phase5-run-running",
        videoId: "p5RunNow001",
        title: "Rate cut odds and the bank stocks",
        status: "running",
        stage: "critique",
        error: null,
        createdAt: stamp(now - 95_000),
        updatedAt: stamp(now - 10_000),
        channel: CHANNELS[0],
        leaseUntil: now + 7 * 86_400_000,
      },
      {
        id: "phase5-run-queued",
        videoId: "p5Queued001",
        title: "p5Queued001",
        status: "queued",
        stage: "metadata",
        error: null,
        createdAt: stamp(now - 20_000),
        updatedAt: stamp(now - 20_000),
        channel: CHANNELS[1],
        leaseUntil: now + 7 * 86_400_000,
      },
    ];
    for (const r of open)
      await database
        .prepare(
          "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,error,input,output,cost,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        )
        .run(
          r.id,
          r.videoId,
          `https://www.youtube.com/watch?v=${r.videoId}`,
          plan.model,
          plan.promptVersion,
          r.title,
          r.status,
          r.stage,
          r.createdAt,
          r.updatedAt,
          r.error,
          JSON.stringify({ ...plan.input, record: "forward", fixture: "phase5" }),
          JSON.stringify(
            r.status === "queued"
              ? {}
              : {
                  metadata: {
                    title: r.title,
                    channel: r.channel.title,
                    channelId: r.channel.id,
                    publishedAt: r.createdAt,
                    language: "en",
                    durationSeconds: 1260,
                  },
                },
          ),
          r.status === "failed" ? 0.001 : 0.01,
          r.leaseUntil,
        );

    // Pinned watchlist tickers (PLTR has no stored prices: the "No price" row).
    for (const ticker of ["NVDA", "TSLA", "AVGO", "PLTR"])
      await research.watch({ ticker, enabled: true });

    // Saved ideas in every state.
    const idOf = async (key: string) => (await list()).find((r) => r.videoId === byKey.get(key)!.videoId)!.id;
    const ideas: [string, string, "open" | "done" | "dismissed", string][] = [
      ["mike-fed-nvda", "c2", "open", "Size up only after the stop is confirmed."],
      ["laowang-weekend", "c1", "open", ""],
      ["chart-tsla-range", "c1", "done", "Range held; closed the idea."],
      ["chart-nvda-avgo", "c2", "dismissed", "Disagree with the trend-line read."],
      ["laowang-msft", "c1", "dismissed", ""],
    ];
    for (const [key, claimId, status, note] of ideas) {
      const saved = (await research.saveIdea(await idOf(key), claimId)) as { id: string };
      await research.changeIdea({ id: saved.id, status, note });
    }

    const completed = (await list()).filter((r) => r.status === "completed").length;
    console.log(
      `Seeded synthetic phase-5 fixtures: ${CHANNELS.length} channels, ${completed} completed analyses (${RECENT.length} recent, ${history.length} history), 1 failed, 1 running, 1 queued, ${prices.length} price series, 4 pins, ${ideas.length} saved ideas. No provider calls.`,
    );
  } finally {
    await database.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
