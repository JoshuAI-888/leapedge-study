import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { seedFixture, type FixtureSpecData } from "./helpers/fixtures.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { get } from "../src/server/youtube-intelligence/store.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
import {
  rowsForRun,
  writeRunRows,
} from "../src/server/youtube-intelligence/repos/publish.ts";
import {
  loadDailyReport,
  loadReportArchive,
  synthesizeReport,
} from "../src/server/youtube-intelligence/daily-report.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";
import {
  deterministicHeadline,
  findDisagreements,
  rankInFocus,
  snapSession,
  timestamp,
  verdictLine,
  type ReportCall,
} from "../src/features/youtube-intelligence/report.ts";
import { sessionWindow } from "../src/features/youtube-intelligence/trading-day.ts";

/**
 * F64. Four creators around Friday 25 and Monday 28 September 2026:
 * - Alpha publishes Friday 10:00 ET (Friday's session) and Monday 09:00 ET;
 * - Beta publishes Friday 17:30 ET, after the close (Monday's session);
 * - Gamma publishes Saturday and Delta on Sunday (both Monday's session).
 * So Friday has one video and Monday four, with NVDA on both sides.
 */
const NOW = "2026-09-29T12:00:00.000Z"; // Tuesday morning ET
const CH = {
  alpha: "UCaaaaaaaaaaaaaaaaaaaaaa",
  beta: "UCbbbbbbbbbbbbbbbbbbbbbb",
  gamma: "UCcccccccccccccccccccccc",
  delta: "UCdddddddddddddddddddddd",
};
const channel = (key: keyof typeof CH, title: string) => ({
  key,
  id: CH[key],
  title,
  handle: `@${key}`,
  uploads: `UU${CH[key].slice(2)}`,
  createdAt: "2026-09-01T00:00:00.000Z",
});
type C = {
  key: string;
  ticker: string | null;
  instrument?: string | null;
  stance: "long" | "short" | "watch";
  thesis: string;
  quote: string;
};
const run = (
  key: string,
  ch: keyof typeof CH,
  videoId: string,
  publishedAt: string,
  claims: C[],
) => ({
  key,
  channel: ch,
  videoId,
  title: `Video ${key}`,
  publishedAt,
  createdAt: "2026-09-29T00:00:00.000Z",
  model: "fixture-model",
  promptVersion: "v1",
  segments: [
    { id: "s1", text: "Opening remarks.", start: 0, end: 11 },
    { id: "s2", text: claims.map((c) => c.quote).join(" "), start: 12, end: 40 },
  ],
  claims: claims.map((c) => ({
    key: c.key,
    ticker: c.ticker,
    instrument: c.instrument ?? c.ticker,
    stance: c.stance,
    conviction: "high" as const,
    thesis: c.thesis,
    quotes: [{ segment: "s2", quote: c.quote, translation: c.quote }],
  })),
});
const SPEC = {
  id: "daily-report",
  asOf: "2026-09-29",
  now: NOW,
  channels: [
    channel("alpha", "Alpha Markets"),
    channel("beta", "Beta Capital"),
    channel("gamma", "Gamma Macro"),
    channel("delta", "Delta Trades"),
  ],
  runs: [
    run("fri", "alpha", "fri00000001", "2026-09-25T14:00:00.000Z", [
      { key: "nvda", ticker: "NVDA", stance: "long", thesis: "Friday: add NVDA on dips.", quote: "I am adding NVDA." },
    ]),
    run("fri-late", "beta", "frilate0001", "2026-09-25T21:30:00.000Z", [
      { key: "nvda", ticker: "NVDA", stance: "long", thesis: "Capex guidance intact; add on pullbacks.", quote: "Capex is intact, buy NVDA." },
    ]),
    run("sat", "gamma", "saturday001", "2026-09-26T15:00:00.000Z", [
      { key: "nvda", ticker: "NVDA", stance: "long", thesis: "Data-centre demand keeps NVDA bid.", quote: "NVDA stays bid." },
      { key: "rates", ticker: null, instrument: "rates", stance: "short", thesis: "Rate-hike expectations weigh on small caps.", quote: "Rates will bite." },
    ]),
    run("sun", "delta", "sunday00001", "2026-09-27T18:00:00.000Z", [
      { key: "nvda", ticker: "NVDA", stance: "short", thesis: "NVDA is overextended; trim.", quote: "Trim NVDA here." },
    ]),
    run("mon", "alpha", "monday00001", "2026-09-28T13:00:00.000Z", [
      { key: "tsla", ticker: "TSLA", stance: "long", thesis: "TSLA breaks out above 382.", quote: "TSLA over 382." },
    ]),
  ],
  prices: [
    {
      symbol: "SPY",
      from: "2026-09-01",
      to: "2026-09-28",
      fetchedAt: "2026-09-29T00:00:00.000Z",
      exchange: "NYSE Arca",
      name: "SPDR S&P 500",
      closes: [
        ["2026-09-25", 600],
        ["2026-09-28", 601],
      ],
    },
  ],
} as unknown as FixtureSpecData;

let runs: Record<string, string> = {};
before(async () => {
  await freshDatabase();
  const seeded = await seedFixture(SPEC);
  runs = seeded.runs;
  for (const id of Object.values(runs)) {
    const r = await get(id);
    await writeRunRows(rowsForRun(r!));
  }
});

const count = async (sql: string) =>
  Number(((await database.prepare(sql).get()) as { n: unknown }).n);

test("Friday-evening and weekend uploads belong to Monday's session", async () => {
  const monday = await loadDailyReport({ session: "2026-09-28", now: NOW });
  assert.deepEqual(
    monday.sources.map((s) => s.runId).sort(),
    [runs["fri-late"], runs.sat, runs.sun, runs.mon].sort(),
  );
  assert.equal(monday.videos, 4);
  assert.equal(monday.creators, 4);
  assert.equal(monday.calls, 5);
  assert.deepEqual(monday.split.calls, { bullish: 3, neutral: 0, bearish: 2 });
  const friday = await loadDailyReport({ session: "2026-09-25", now: NOW });
  assert.deepEqual(friday.sources.map((s) => s.runId), [runs.fri]);
  // Navigation skips the weekend, and the next session exists only once it has started.
  assert.equal(monday.previous, "2026-09-25");
  assert.equal(monday.next, "2026-09-29");
  assert.equal(friday.next, "2026-09-28");
  const tuesday = await loadDailyReport({ session: "2026-09-29", now: NOW });
  assert.equal(tuesday.next, null);
  assert.equal(tuesday.state, "empty");
  // The window is the previous close to this close.
  assert.deepEqual(sessionWindow("2026-09-28"), {
    from: "2026-09-25T20:00:00.000Z",
    to: "2026-09-28T20:00:00.000Z",
  });
});

test("A weekend date snaps to the session its uploads roll into; /report opens the latest session with calls", async () => {
  assert.equal(snapSession("2026-09-26", "2026-09-29"), "2026-09-28");
  assert.equal(snapSession("2026-09-27", "2026-09-28"), "2026-09-28");
  // A future date never opens a session that has not started.
  assert.equal(snapSession("2026-10-05", "2026-09-29"), "2026-09-29");
  assert.equal(snapSession("2026-10-03", "2026-09-29"), "2026-10-02");
  const snapped = await loadDailyReport({ session: "2026-09-26", now: NOW });
  assert.equal(snapped.session, "2026-09-28");
  const latest = await loadDailyReport({ now: NOW });
  assert.equal(latest.session, "2026-09-28");
  assert.equal(latest.latest, "2026-09-28");
});

test("In focus ranks instruments by distinct creators, includes macro themes, and compares with the previous session", async () => {
  const monday = await loadDailyReport({ session: "2026-09-28", now: NOW });
  const [first, ...rest] = monday.inFocus;
  assert.equal(first.key, "NVDA");
  assert.equal(first.creators, 3);
  assert.equal(first.calls, 3);
  assert.equal(first.previousCreators, 1, "Alpha's Friday call");
  assert.deepEqual(first.split, { bullish: 2, neutral: 0, bearish: 1 });
  assert.ok(first.reason.length > 0);
  const rates = rest.find((r) => r.key === "Rates");
  assert.ok(rates, "a spoken macro theme is ranked with the tickers");
  assert.equal(rates.kind, "macro");
  assert.equal(rates.previousCreators, null);
  assert.deepEqual(
    rest.map((r) => r.key),
    ["Rates", "TSLA"],
    "ties break by calls, then name",
  );
});

test("Disagreements list instruments with calls on both sides, with each side's quotes", async () => {
  const monday = await loadDailyReport({ session: "2026-09-28", now: NOW });
  assert.equal(monday.disagreements.length, 1);
  const [nvda] = monday.disagreements;
  assert.equal(nvda.key, "NVDA");
  assert.equal(nvda.bullish.length, 2);
  assert.equal(nvda.bearish.length, 1);
  assert.equal(nvda.bearish[0].quote?.text, "Trim NVDA here.");
  assert.equal(nvda.bearish[0].channelTitle, "Delta Trades");
  // A one-sided instrument is never a disagreement.
  const call = (id: string, stance: string): ReportCall => ({
    id: `r:${id}`, runId: "r", claimId: id, videoId: "v", videoTitle: null,
    channelId: id, channelTitle: null, instrument: "AAPL", ticker: "AAPL",
    stance, conviction: "high", trustLevel: "L1", thesis: "t", publishedAt: null, quote: null,
  });
  assert.equal(findDisagreements([call("a", "long"), call("b", "watch")]).length, 0);
  assert.equal(findDisagreements([call("a", "long"), call("b", "avoid")]).length, 1);
  assert.equal(rankInFocus([call("a", "long"), call("b", "long")])[0].creators, 2);
});

test("Fewer than three videos: no synthesis, the calls are listed and the reason is given", async () => {
  const friday = await loadDailyReport({ session: "2026-09-25", now: NOW });
  assert.equal(friday.state, "too-few-videos");
  assert.match(friday.stateNote, /at least 3/);
  assert.equal(friday.headline.synthesized, false);
  assert.equal(friday.themes.length, 0);
  assert.equal(friday.callList.length, 1);
  await assert.rejects(
    () => synthesizeReport({ session: "2026-09-25" }),
    /at least 3/,
  );
});

test("Reading a report is deterministic and writes nothing; synthesis is a separate, queued action", async () => {
  const before = await count("SELECT count(*) AS n FROM yi_runs");
  const docs = await count("SELECT count(*) AS n FROM yi_documents");
  const monday = await dispatch("report", "session", { session: "2026-09-28", now: NOW });
  assert.equal((monday as { state: string }).state, "not-synthesized");
  assert.match((monday as { stateNote: string }).stateNote, /Synthesis not generated yet/);
  assert.equal(
    (monday as { headline: { text: string } }).headline.text,
    "Creators lean bullish: 3 ▲ · 0 ● · 2 ▼ across 4 creators",
  );
  await dispatch("report", "archive", undefined);
  assert.equal(await count("SELECT count(*) AS n FROM yi_runs"), before);
  assert.equal(await count("SELECT count(*) AS n FROM yi_documents"), docs);
  assert.equal(await count("SELECT count(*) AS n FROM yi_calls"), 0);
});

test("Points the critic removed stay visible with their reason; a failed retry shows its error", async () => {
  const briefingId = "briefing-mon";
  const ref = (key: string) => ({ runId: runs[key], claimId: "c1" });
  await put("briefing", briefingId, {
    id: briefingId,
    createdAt: "2026-09-29T09:00:00.000Z",
    session: "2026-09-28",
    runIds: [runs["fri-late"], runs.sat, runs.sun, runs.mon],
    summaryPoints: [
      { text_en: "Creators lean bullish on NVDA after capex guidance.", refs: [ref("fri-late"), ref("sat")], passed: true, reason: "Supported." },
      { text_en: "Everyone expects a rate cut.", refs: [ref("sat")], passed: false, reason: "The quote says rates will bite, not that a cut is expected." },
    ],
  });
  const insert = (id: string, status: string, at: string, output: unknown, error: string | null) =>
    database
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,error,input,output,cost) VALUES($1,'briefing','https://www.youtube.com/watch?v=briefing','m','v1','Daily synthesis',$2,'complete',$3,$3,$4,$5,$6,0.02)",
      )
      .run(id, status, at, error, JSON.stringify({ task: "briefing", snapshot: { session: "2026-09-28" } }), JSON.stringify(output));
  await insert("synth-1", "completed", "2026-09-29T09:00:00.000Z", { briefingId }, null);
  let monday = await loadDailyReport({ session: "2026-09-28", now: NOW });
  assert.equal(monday.state, "synthesized");
  assert.equal(monday.headline.synthesized, true);
  assert.equal(monday.headline.text, "Creators lean bullish on NVDA after capex guidance.");
  assert.equal(monday.themes.length, 1);
  assert.deepEqual(
    monday.themes[0].citations.map((c) => c.label),
    ["Beta Capital ▶ 0:12", "Gamma Macro ▶ 0:12"],
  );
  assert.equal(
    monday.themes[0].citations[0].href,
    `/youtube-intelligence/analysis/${runs["fri-late"]}#c1`,
  );
  assert.equal(monday.removed.length, 1, "the removed point is listed, never dropped");
  assert.equal(monday.removed[0].text, "Everyone expects a rate cut.");
  assert.match(monday.removed[0].reason ?? "", /rates will bite/);
  assert.deepEqual(monday.costEstimate, { usd: 0.02, basis: 1 });

  await insert("synth-2", "failed", "2026-09-29T10:00:00.000Z", {}, "The model did not answer.");
  monday = await loadDailyReport({ session: "2026-09-28", now: NOW });
  assert.equal(monday.state, "synthesis-failed");
  assert.equal(monday.synthesis.error, "The model did not answer.");
  assert.equal(monday.removed.length, 1, "the last good synthesis is still shown");

  const archive = await loadReportArchive({});
  assert.equal(archive.rows[0].headline, "Creators lean bullish on NVDA after capex guidance.");
  assert.equal(archive.rows[0].synthesized, true);
});

test("The archive lists sessions newest first with each headline and split", async () => {
  const archive = await loadReportArchive({ limit: 10 });
  assert.equal(archive.total, 2);
  assert.deepEqual(archive.rows.map((r) => r.session), ["2026-09-28", "2026-09-25"]);
  const friday = archive.rows[1];
  assert.equal(friday.videos, 1);
  assert.deepEqual(friday.split, { bullish: 1, neutral: 0, bearish: 0 });
  assert.equal(friday.headline, "Creators lean bullish: 1 ▲ · 0 ● · 0 ▼ across 1 creator");
  const page = await loadReportArchive({ limit: 1, offset: 1 });
  assert.deepEqual(page.rows.map((r) => r.session), ["2026-09-25"]);
  assert.equal(page.total, 2);
});

test("Synthesis queues the existing briefing pipeline for the session's calls", async () => {
  const result = await synthesizeReport({ session: "2026-09-28" });
  const queued = await get(result.runId);
  assert.equal(queued?.status, "queued");
  assert.equal(queued?.input.task, "briefing");
  const snapshot = queued?.input.snapshot as { session: string; runIds: string[] };
  assert.equal(snapshot.session, "2026-09-28");
  assert.deepEqual(snapshot.runIds.sort(), [runs["fri-late"], runs.sat, runs.sun, runs.mon].sort());
  const monday = await loadDailyReport({ session: "2026-09-28", now: NOW });
  assert.equal(monday.state, "synthesizing");
});

test("Headline, verdict line and timestamp wording", () => {
  assert.equal(
    deterministicHeadline({ bullish: 41, neutral: 11, bearish: 7 }, 14),
    "Creators lean bullish: 41 ▲ · 11 ● · 7 ▼ across 14 creators",
  );
  assert.match(deterministicHeadline({ bullish: 2, neutral: 0, bearish: 2 }, 3), /^Creators are split/);
  assert.match(deterministicHeadline({ bullish: 0, neutral: 3, bearish: 1 }, 2), /^Creators are mostly neutral/);
  assert.equal(deterministicHeadline({ bullish: 0, neutral: 0, bearish: 0 }, 0), "No creator calls in this session");
  assert.equal(
    verdictLine({ ideas: 4, sentiment: { bullish: 3, neutral: 1, bearish: 0 }, instruments: ["NVDA", "AVGO", "TSM", "AMD"] }),
    "4 ideas · 3 ▲ 1 ● · NVDA AVGO TSM",
  );
  assert.equal(verdictLine({ ideas: 0, sentiment: { bullish: 0, neutral: 0, bearish: 0 }, instruments: [] }), "No investable ideas");
  // F77: macro and sector keys read as their instrument labels, as everywhere else.
  assert.equal(
    verdictLine({
      ideas: 3,
      sentiment: { bullish: 2, neutral: 1, bearish: 0 },
      instruments: ["NVDA", "Rates", "Information Technology / Semiconductors"],
    }),
    "3 ideas · 2 ▲ 1 ● · NVDA MACRO · RATES SECTOR · SEMIS",
  );
  assert.equal(timestamp(252), "4:12");
  assert.equal(timestamp(3725), "1:02:05");
  assert.equal(timestamp(null), null);
});
