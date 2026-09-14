import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  videoId,
  coverage,
  validateClaim,
  Source,
  type ClaimData,
} from "../src/features/youtube-intelligence/contracts.ts";
import { guard } from "../src/server/youtube-intelligence/http.ts";
const source = Source.parse({
  segments: [
    {
      id: "s1",
      text: "如果已经买了COIN，可以把止损放在140。 😀",
      start_seconds: 0,
      end_seconds: 10,
    },
  ],
});
const claim: ClaimData = {
  thesis_en: "For existing COIN holders, set a stop at 140.",
  instrument_as_spoken: "COIN",
  ticker: "COIN",
  ticker_explicit: true,
  stance: "conditional",
  horizon_en: null,
  conditions_en: ["Already holding COIN"],
  creator_conviction: "unspecified",
  risks_en: [],
  levels: [{ kind: "stop", value_original: "140" }],
  evidence: [
    {
      segment_id: "s1",
      quote_original: "如果已经买了COIN，可以把止损放在140。",
      quote_translation_en: "If already holding COIN, put the stop at 140.",
    },
  ],
};
test("YouTube parser accepts canonical IDs but rejects lookalike hosts and credential URLs", () => {
  assert.equal(videoId("https://youtu.be/wkAqHlYL7bQ?t=30"), "wkAqHlYL7bQ");
  for (const u of [
    "https://youtube.com.evil.test/watch?v=wkAqHlYL7bQ",
    "https://evil.test/wkAqHlYL7bQ",
    "https://user@youtube.com/watch?v=wkAqHlYL7bQ",
  ])
    assert.throws(() => videoId(u));
});
test("Quote checks preserve Chinese punctuation and reject paraphrases and altered numeric levels", () => {
  assert.deepEqual(validateClaim(claim, source), []);
  assert.ok(
    validateClaim(
      {
        ...claim,
        evidence: [
          { ...claim.evidence[0], quote_original: "已经买COIN，止损140。" },
        ],
      },
      source,
    ).length,
  );
  assert.ok(
    validateClaim(
      { ...claim, levels: [{ kind: "stop", value_original: "150" }] },
      source,
    ).length,
  );
});
test("Implicit ETF mappings fail deterministic ticker checks", () => {
  assert.ok(
    validateClaim({ ...claim, ticker: "QQQ", ticker_explicit: false }, source)
      .length,
  );
});
test("Coverage merges overlaps and detects missed late-video content", () => {
  const s = Source.parse({
    segments: [
      { id: "1", text: "x", start_seconds: 0, end_seconds: 1200 },
      { id: "2", text: "y", start_seconds: 1100, end_seconds: 1800 },
    ],
  });
  assert.equal(coverage(s, 2423).coveredSeconds, 1800);
  assert.equal(coverage(s, 2423).status, "incomplete_or_unknown");
});
test("Duplicate segment IDs and reversed timestamps fail source parsing", () => {
  assert.throws(() =>
    Source.parse({ segments: [source.segments[0], source.segments[0]] }),
  );
  assert.throws(() =>
    Source.parse({
      segments: [{ ...source.segments[0], start_seconds: 5, end_seconds: 2 }],
    }),
  );
});
test("Local endpoint guard blocks cross-origin paid requests and public hosts", () => {
  guard(new Request("http://127.0.0.1:3000/api"));
  assert.throws(() =>
    guard(
      new Request("http://127.0.0.1:3000/api", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  );
  assert.throws(() => guard(new Request("https://public.test/api")));
});
test("Persisted jobs deduplicate, fence stale workers and preserve uncertain spend", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yti-test-"));
  process.env.YTI_DB_PATH = join(dir, "test.sqlite");
  process.env.YTI_BUDGET_USD = "2";
  const store = await import("../src/server/youtube-intelligence/store.ts");
  try {
    const a = await store.create("wkAqHlYL7bQ", "model", {}, "v1");
    const b = await store.create("wkAqHlYL7bQ", "model", {}, "v1");
    assert.equal(a.id, b.id);
    const first = (await store.claimNext())!;
    assert.equal(await store.claimNext(), null);
    await (
      await store.db()
    )
      .prepare("UPDATE yi_runs SET lease_until=0 WHERE id=?")
      .run(a.id);
    const second = (await store.claimNext())!;
    await assert.rejects(
      async () => await store.save(first.run, first.token),
      /Stale/,
    );
    second.run.stage = "source";
    second.run.status = "queued";
    await store.save(second.run, second.token);
    assert.equal((await store.get(a.id))?.stage, "source");
    const call = await store.reserve(a.id, "source", 1.5);
    await assert.rejects(
      async () => await store.reserve(a.id, "source", 0.1),
      /uncertain/,
    );
    await assert.rejects(
      async () => await store.reserve(a.id, "another", 1),
      /budget/,
    );
    await store.settle(call, 0.1, {});
    assert.equal((await store.health()).spentOrReservedUsd, 0.1);
  } finally {
    await (await store.db()).close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Incomplete imported source is held for review before any paid synthesis", async () => {
  const { step } =
    await import("../src/server/youtube-intelligence/pipeline.ts");
  const r = {
    id: "x",
    videoId: "wkAqHlYL7bQ",
    url: "https://www.youtube.com/watch?v=wkAqHlYL7bQ",
    model: "test",
    promptVersion: "v1",
    title: "Test",
    status: "running",
    stage: "source",
    createdAt: "",
    updatedAt: "",
    error: null,
    input: { source },
    output: { metadata: { duration: 2423 } },
    cost: 0,
  } as import("../src/features/youtube-intelligence/contracts.ts").Run;
  await step(r);
  assert.equal(r.status, "needs_review");
  assert.equal(r.output.claims, undefined);
});
test("A numeric substring is not evidence for a price", () => {
  assert.ok(
    validateClaim(
      { ...claim, levels: [{ kind: "stop", value_original: "14" }] },
      source,
    ).length,
  );
});

test("Price punctuation is not mistaken for decimal continuation", () => {
  const q =
    "a fair value of 168 bucks, and a future share price of $265, which means";
  const s = {
    source_kind: "fixture",
    segments: [{ id: "p", text: q, start_seconds: 0, end_seconds: 10 }],
  };
  const c = {
    ...claim,
    ticker: null,
    ticker_explicit: false,
    evidence: [{ segment_id: "p", quote_original: q, quote_translation_en: q }],
    levels: [
      { kind: "target" as const, value_original: "$265" },
      { kind: "target" as const, value_original: "168 bucks" },
    ],
  };
  assert.deepEqual(validateClaim(c, s), []);
  assert.ok(
    validateClaim(
      { ...c, levels: [{ kind: "target", value_original: "26" }] },
      s,
    ).length,
  );
});

import { anchorClaimEvidence } from "../src/features/youtube-intelligence/contracts.ts";
test("Verbatim quotes may span adjacent original segments without rewriting any words", () => {
  const source = {
    source_kind: "fixture",
    segments: [
      { id: "a", text: "原文第一段，", start_seconds: 0, end_seconds: 3 },
      { id: "b", text: "连续第二段。", start_seconds: 3, end_seconds: 6 },
    ],
  };
  const c = {
    ...claim,
    ticker: null,
    ticker_explicit: false,
    levels: [],
    evidence: [
      {
        segment_id: "a",
        quote_original: "第一段，连续第二段。",
        quote_translation_en: "First and second passage.",
      },
    ],
  };
  const anchored = anchorClaimEvidence(c, source);
  assert.equal(anchored.evidence[0].end_segment_id, "b");
  assert.equal(
    anchored.evidence[0].quote_original,
    c.evidence[0].quote_original,
  );
  assert.deepEqual(validateClaim(anchored, source), []);
  assert.ok(
    validateClaim(
      anchorClaimEvidence(
        {
          ...c,
          evidence: [
            { ...c.evidence[0], quote_original: "第一段，虚构第二段。" },
          ],
        },
        source,
      ),
      source,
    ).length,
  );
});

test('English caption boundaries preserve spaces without accepting altered words or skipped segments', () => {
  const source = {source_kind:'native_captions_youtube_transcript_api',segment_separator:' ' as const,segments:[
    {id:'a',text:'I would not',start_seconds:0,end_seconds:2},
    {id:'b',text:'buy this stock',start_seconds:2,end_seconds:4},
    {id:'c',text:'until earnings improve.',start_seconds:4,end_seconds:6},
  ]};
  const make = (text:string) => ({...claim,ticker:null,ticker_explicit:false,levels:[],evidence:[{segment_id:'a',quote_original:text,quote_translation_en:text}]});
  const original = JSON.stringify(source.segments);
  const anchored = anchorClaimEvidence(make('would not buy this stock until earnings improve.'),source);
  assert.equal(anchored.evidence[0].end_segment_id,'c');
  assert.deepEqual(validateClaim(anchored,source),[]);
  for(const text of ['would buy this stock','would not until earnings improve.','would not buy this Stock'])
    assert.ok(validateClaim(anchorClaimEvidence(make(text),source),source).length);
  assert.ok(validateClaim(anchored,{...source,segment_separator:''}).length);
  assert.equal(JSON.stringify(source.segments),original);
});
