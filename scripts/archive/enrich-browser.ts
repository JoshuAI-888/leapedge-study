/** Synthetic acceptance fixtures only. Adds records; never changes saved notes or signs human reviews. */
import { database } from "../src/server/youtube-intelligence/database.ts";
import {
  Source,
  Claim,
  deriveEvidence,
  type Run,
} from "../src/features/youtube-intelligence/contracts.ts";
import { compareSpan } from "../src/features/youtube-intelligence/agreement.ts";
import {
  rowsForRun,
  writeRunRows,
} from "../src/server/youtube-intelligence/repos/publish.ts";
import { savePrices } from "../src/server/youtube-intelligence/repos/prices.ts";
import { upsertInstrument } from "../src/server/youtube-intelligence/repos/instruments.ts";
import { listChannels } from "../src/server/youtube-intelligence/repos/channels.ts";
import { upsertChannel } from "../src/server/youtube-intelligence/repos/channels.ts";
import { fixtureSpec } from "../tests/helpers/fixtures.ts";
import { listSettlements } from "../src/server/youtube-intelligence/repos/settlements.ts";
import {
  settlementSweep,
  loadBoardSnapshot,
} from "../src/server/youtube-intelligence/leaderboard.ts";
import { boardAsOf } from "../src/features/youtube-intelligence/leaderboard.ts";
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid");
if (
  process.env.YTI_ISOLATED_DB !== "true" ||
  process.env.YTI_FIXTURE_MODE !== "true" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/yti_browser"
)
  throw Error(
    "Synthetic enrichment requires isolated local yti_browser and explicit fixture mode.",
  );
try {
  for (const channel of fixtureSpec("baseline").channels)
    await upsertChannel({
      ...channel,
      autoAnalyze: false,
      active: true,
      tier: "1",
      discovery: "manual",
      processing: "on-request",
      followedAt: channel.createdAt,
    });
  const channel = (await listChannels())[0];
  if (!channel) throw Error("Run the baseline browser seed first.");
  for (let i = 0; i < 24; i++) {
    const id = `synthetic-browser-trust-${i}`,
      videoId = `fixture${String(i).padStart(4, "0")}`;
    const createdAt = new Date(Date.UTC(2026, 0, i + 1, 12)).toISOString();
    const source = Source.parse({
      video_id: videoId,
      language: "en",
      source_kind: "synthetic_caption_fixture",
      segment_separator: " ",
      segments: [
        {
          id: "s1",
          text: "Buy NVDA under 120 with a target of 150.",
          start_seconds: 10,
          end_seconds: 15,
        },
      ],
    });
    const span = { start_id: "s1", end_id: "s1" },
      copied = deriveEvidence(source, span);
    const claim = Claim.parse({
      thesis_en: "SYNTHETIC FIXTURE: buy NVDA below 120.",
      instrument_as_spoken: "NVDA",
      ticker: "NVDA",
      ticker_explicit: true,
      stance: "long",
      horizon_en: "90 days",
      conditions_en: ["Below 120"],
      risks_en: [],
      creator_conviction: "high",
      levels: [{ kind: "target", value_original: "150" }],
      evidence: [
        {
          segment_id: "s1",
          quote_original: copied.quote_original,
          quote_translation_en: copied.quote_original,
          source_span: { ...span, ...copied },
        },
      ],
    });
    const measured = compareSpan(
      { text: copied.quote_original, startSeconds: 10, endSeconds: 15 },
      source.segments,
    );
    const run: Run = {
      id,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      model: "synthetic-fixture-no-provider",
      promptVersion: "synthetic-fixture",
      title: `SYNTHETIC acceptance fixture ${i + 1}: explicit NVDA call`,
      status: "completed",
      stage: "complete",
      createdAt,
      updatedAt: createdAt,
      error: null,
      cost: 0,
      input: { record: "forward", syntheticFixture: true },
      output: {
        metadata: {
          channel: channel.title,
          channelId: channel.id,
          publishedAt: createdAt,
          duration: 30,
        },
        source,
        claims: [
          {
            id: "c1",
            claim,
            passed: true,
            reasons: [],
            audit: {
              verdict: "accept",
              reason_en: "Synthetic deterministic fixture",
            },
          },
        ],
        mentions: [],
        spanAgreement: { c1: [measured] },
        audioTrustProcessed: true,
        limitations: [
          "SYNTHETIC acceptance fixture: text and audio transcripts are authored fixtures; no live audio or human verification is claimed.",
        ],
      },
    };
    const inserted = await database
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) ON CONFLICT(id) DO NOTHING",
      )
      .run(
        id,
        videoId,
        run.url,
        run.model,
        run.promptVersion,
        run.title,
        run.status,
        run.stage,
        createdAt,
        createdAt,
        JSON.stringify(run.input),
        JSON.stringify(run.output),
      );
    if (inserted.changes) await writeRunRows(rowsForRun(run));
  }
  for (const symbol of ["NVDA", "SPY", "QQQ", "XLK"]) {
    await upsertInstrument({
      symbol,
      name: `SYNTHETIC ${symbol}`,
      currency: "USD",
      exchange: "NASDAQ",
      market: symbol === "NVDA" ? "us-stock" : "us-etf",
      verifiedAt: "2026-01-01T00:00:00Z",
    });
    const bars = [];
    for (let day = 0; day <= 210; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day));
      if ([0, 6].includes(date.getUTCDay())) continue;
      bars.push({
        ticker: symbol,
        date: date.toISOString().slice(0, 10),
        adjustedClose:
          100 + day * (symbol === "NVDA" ? 0.3 : symbol === "QQQ" ? 0.2 : 0.05),
        source: "SYNTHETIC browser acceptance prices",
        fetchedAt: "2026-08-01T00:00:00Z",
      });
    }
    await savePrices(bars);
  }
  await settlementSweep();
  // Historical synthetic fixture rows exercise Changes. This is an INSERT into
  // the isolated fixture DB; production settlement timestamps remain database-owned.
  const firstTwenty = [
    ...new Map(
      (await listSettlements({ record: "forward", horizonDays: 90 }))
        .filter(
          (s) =>
            /^synthetic-browser-trust-(?:[0-9]|1[0-9]):c1$/.test(s.claimId) &&
            s.status === "settled",
        )
        .map((s) => [s.claimId, s]),
    ).values(),
  ];
  for (const row of firstTwenty) {
    await database
      .prepare(
        "INSERT INTO settlements(id,claim_id,horizon_days,entry_date,entry_price,exit_date,exit_price,return_pct,status,reason,record,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING",
      )
      .run(
        `synthetic-earlier-v2:${row.claimId}`,
        row.claimId,
        row.horizonDays,
        row.entryDate,
        row.entryPrice,
        row.exitDate,
        row.exitPrice,
        row.return,
        row.status,
        row.reason,
        row.record,
        "2026-08-02T12:00:00Z",
      );
  }
  const board = boardAsOf(await loadBoardSnapshot(), {
    benchmark: "SPY",
    record: "forward",
  });
  const earlier = boardAsOf(await loadBoardSnapshot(), {
    benchmark: "SPY",
    record: "forward",
    asOf: "2026-08-20",
  });
  console.log(
    JSON.stringify({
      synthetic: true,
      providersCalled: 0,
      humanReviewsCreated: 0,
      creators: board.creators.map((c) => ({
        label: c.label,
        n: c.n,
        status: c.status,
      })),
      earlierCounts: earlier.creators.map((c) => c.n),
      tickers: board.tickers.length,
    }),
  );
} finally {
  await database.close();
}
