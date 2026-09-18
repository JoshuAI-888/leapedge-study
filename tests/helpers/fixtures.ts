import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../../src/server/youtube-intelligence/store.ts";
import { put } from "../../src/server/youtube-intelligence/research-store.ts";
import { upsertChannel } from "../../src/server/youtube-intelligence/repos/channels.ts";
import {
  Claim,
  Source,
  type CheckedClaim,
} from "../../src/features/youtube-intelligence/contracts.ts";
import {
  scoreCall,
  type PriceSeries,
} from "../../src/features/youtube-intelligence/performance.ts";
/**
 * Test helper: write a deterministic, realistic dataset into the current
 * database through the existing store APIs. Specs live as JSON under
 * tests/fixtures/db/<name>.json (see the README there); every id derives from
 * the fixture id and each row's key, so the same spec always yields the same
 * rows. Timestamps come from the spec, never from the clock.
 */
export const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/db/", import.meta.url));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.string().datetime();
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/);
export const FixtureChannel = z.object({
  key,
  id: z.string().regex(/^UC[\w-]{22}$/),
  title: z.string().min(1),
  handle: z.string().regex(/^@[^/?#\s]{2,100}$/),
  uploads: z.string().regex(/^UU[\w-]{22}$/),
  favorite: z.boolean().default(false),
  autoAnalyze: z.boolean().default(false),
  createdAt: isoTime,
});
export const FixtureClaim = z.object({
  key,
  ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/).nullable(),
  tickerExplicit: z.boolean().default(true),
  instrument: z.string().nullable().default(null),
  stance: Claim.shape.stance,
  conviction: Claim.shape.creator_conviction,
  thesis: z.string().min(1),
  horizon: z.string().nullable().default(null),
  conditions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  levels: z
    .array(z.object({ kind: Claim.shape.levels.element.shape.kind, value: z.string() }))
    .default([]),
  quotes: z
    .array(z.object({ segment: z.string(), quote: z.string().min(1), translation: z.string() }))
    .min(1),
  passed: z.boolean().default(true),
  reasons: z.array(z.string()).default([]),
});
export const FixtureRun = z.object({
  key,
  channel: key,
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().min(1),
  publishedAt: isoTime,
  createdAt: isoTime,
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  language: z.string().default("en"),
  cost: z.number().nonnegative().default(0),
  segments: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
      }),
    )
    .min(1),
  claims: z.array(FixtureClaim),
});
export const FixturePrices = z.object({
  symbol: z.string().regex(/^[A-Z0-9.^=-]{1,20}$/),
  from: isoDate,
  to: isoDate,
  fetchedAt: isoTime,
  exchange: z.string().min(1),
  name: z.string().min(1),
  closes: z.array(z.tuple([isoDate, z.number().positive()])).min(1),
});
export const FixtureSpec = z.object({
  id: key,
  asOf: isoDate,
  now: isoTime,
  channels: z.array(FixtureChannel),
  runs: z.array(FixtureRun),
  documents: z
    .array(z.object({ kind: z.string().min(1), id: z.string().min(1), payload: z.unknown() }))
    .default([]),
  prices: z.array(FixturePrices),
  horizonDays: z.number().int().positive().default(90),
});
export type FixtureSpecData = z.infer<typeof FixtureSpec>;
export type Seeded = {
  id: string;
  channels: Record<string, string>;
  runs: Record<string, string>;
  claims: Record<string, string>;
  prices: Record<string, string>;
  settlements: Record<string, string>;
  documents: string[];
};
function digest(...parts: string[]) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
/** A UUID-shaped id that is a pure function of its parts. */
function uuidFrom(...parts: string[]) {
  const h = digest(...parts);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export function fixtureSpec(name: string): FixtureSpecData {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(name)) throw Error(`Invalid fixture name: ${name}`);
  return FixtureSpec.parse(JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, "utf8")));
}
export async function seedFixture(input: string | FixtureSpecData): Promise<Seeded> {
  const spec = typeof input === "string" ? fixtureSpec(input) : FixtureSpec.parse(input);
  const channelsByKey = new Map(spec.channels.map((c) => [c.key, c]));
  for (const r of spec.runs)
    if (!channelsByKey.has(r.channel))
      throw Error(`Fixture run ${r.key} names unknown channel ${r.channel}.`);
  const seeded: Seeded = {
    id: spec.id,
    channels: {},
    runs: {},
    claims: {},
    prices: {},
    settlements: {},
    documents: [],
  };
  const d = db();
  await d.transaction(async () => {
    for (const c of spec.channels) {
      const channel = {
        id: c.id,
        title: c.title,
        handle: c.handle,
        uploads: c.uploads,
        active: true,
        favorite: c.favorite,
        autoAnalyze: c.autoAnalyze,
        createdAt: c.createdAt,
        lastPull: spec.now,
        lastAttempt: spec.now,
        nextPullAt: spec.now,
        nextPageToken: null,
        historyStarted: true,
        error: null,
      };
      // The row is what every surface reads (F28), so the fixture writes it
      // through the repository, as channels.ts does. The `channel` document is
      // written as well and only for the document-migration tests: it is the
      // pre-migration database those tests start from, and nothing in src/
      // writes one any more.
      await upsertChannel(channel);
      await put("channel", c.id, channel);
      seeded.channels[c.key] = c.id;
    }
    const series = new Map<string, PriceSeries>();
    for (const p of spec.prices) {
      const value: PriceSeries = {
        symbol: p.symbol,
        provider: "FMP",
        adjustment: "dividend-adjusted endpoint",
        fetchedAt: p.fetchedAt,
        prices: p.closes.map(([date, close]) => ({ date, close })),
      };
      const id = `fmp:${p.symbol}:${p.from}:${p.to}`;
      await put("prices", id, value);
      await put("instrument", p.symbol, {
        symbol: p.symbol,
        currency: "USD",
        exchange: p.exchange,
        name: p.name,
        verifiedAt: p.fetchedAt,
      });
      series.set(p.symbol, value);
      seeded.prices[p.symbol] = id;
    }
    for (const r of spec.runs) {
      const channel = channelsByKey.get(r.channel)!;
      const runId = uuidFrom(spec.id, "run", r.key);
      const source = Source.parse({
        video_id: r.videoId,
        language: r.language,
        source_kind: "fixture_transcript",
        segment_separator: " ",
        segments: r.segments.map((s) => ({
          id: s.id,
          text: s.text,
          start_seconds: s.start,
          end_seconds: s.end,
        })),
      });
      const sourceHash = digest(JSON.stringify(source.segments));
      const claims: CheckedClaim[] = r.claims.map((c, i) => {
        const id = `c${i + 1}`;
        seeded.claims[`${r.key}/${c.key}`] = id;
        return {
          id,
          claim: Claim.parse({
            thesis_en: c.thesis,
            instrument_as_spoken: c.instrument,
            ticker: c.ticker,
            ticker_explicit: c.tickerExplicit,
            stance: c.stance,
            horizon_en: c.horizon,
            conditions_en: c.conditions,
            creator_conviction: c.conviction,
            risks_en: c.risks,
            levels: c.levels.map((l) => ({ kind: l.kind, value_original: l.value })),
            evidence: c.quotes.map((q) => ({
              segment_id: q.segment,
              quote_original: q.quote,
              quote_translation_en: q.translation,
            })),
          }),
          passed: c.passed,
          reasons: c.reasons,
          audit: {
            verdict: c.passed ? "accept" : "reject",
            reason_en: c.passed ? "Supported by the quoted source." : c.reasons.join(" "),
          },
        };
      });
      const output = {
        metadata: {
          title: r.title,
          channel: channel.title,
          channelId: channel.id,
          publishedAt: r.publishedAt,
          language: r.language,
        },
        sourceHash,
        source,
        claims,
      };
      const input = {
        criticModel: r.model,
        promptSnapshot: { id: r.promptVersion },
        experiment: false,
        pipelineVersion: "fixture",
        fixture: spec.id,
      };
      await d
        .prepare(
          "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,error,input,output,cost,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0)",
        )
        .run(
          runId,
          r.videoId,
          `https://www.youtube.com/watch?v=${r.videoId}`,
          r.model,
          r.promptVersion,
          r.title,
          "completed",
          "complete",
          r.createdAt,
          r.createdAt,
          null,
          JSON.stringify(input),
          JSON.stringify(output),
          r.cost,
        );
      await d
        .prepare("INSERT INTO yi_discoveries VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
        .run(
          r.videoId,
          channel.id,
          JSON.stringify({
            title: r.title,
            videoId: r.videoId,
            channelId: channel.id,
            publishedAt: r.publishedAt,
          }),
          r.createdAt,
          runId,
        );
      seeded.runs[r.key] = runId;
      for (const [i, c] of r.claims.entries()) {
        if (!c.ticker) continue;
        const claimId = `c${i + 1}`,
          callId = `${runId}:${claimId}`,
          call = {
            id: callId,
            ticker: c.ticker,
            channel: channel.title,
            stance: c.stance,
            conviction: c.conviction,
            analysisAt: r.createdAt,
            publishedAt: r.publishedAt,
            sourceHash,
          };
        const stock = series.get(c.ticker),
          spy = series.get("SPY");
        const directional =
          ["long", "short"].includes(c.stance) && ["medium", "high"].includes(c.conviction);
        const row =
          !directional || (stock && spy)
            ? scoreCall(call, stock ?? spy!, spy!, spec.asOf, "leapedge", spec.horizonDays)
            : {
                id: callId,
                status: "unpriced",
                reason: `No fixture price series for ${stock ? "SPY" : c.ticker}.`,
              };
        const id = `${callId}:leapedge:${spec.horizonDays}`;
        await put("settlement", id, {
          ...row,
          runId,
          claimId,
          ticker: c.ticker,
          channel: channel.title,
          stance: c.stance,
          conviction: c.conviction,
          horizonDays: spec.horizonDays,
          benchmark: "SPY",
          asOf: spec.asOf,
          computedFrom: {
            stock: stock ? seeded.prices[c.ticker] : null,
            benchmark: spy ? seeded.prices.SPY : null,
          },
        });
        seeded.settlements[`${r.key}/${c.key}`] = id;
      }
    }
    for (const doc of spec.documents) {
      await put(doc.kind, doc.id, doc.payload);
      seeded.documents.push(`${doc.kind}:${doc.id}`);
    }
  });
  return seeded;
}
