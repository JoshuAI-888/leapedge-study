import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisContext,
  eligibleExternal,
  validateBrief,
  financialCheck,
  prioritiseBriefs,
  evidenceInventory,
  extractionContext,
} from "../src/features/youtube-intelligence/research-brief.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
const run = {
  id: "run",
  videoId: "video",
  createdAt: "2026-09-20T00:00:00Z",
  output: {
    metadata: { publishedAt: "2026-04-10T01:16:13Z" },
    source: {
      segments: [
        { id: "s1", text: "I hold shares", start_seconds: 0, end_seconds: 4 },
      ],
    },
    claims: [
      {
        id: "c1",
        passed: true,
        reasons: [],
        audit: { verdict: "accept" },
        claim: {
          instrument_as_spoken: "Company",
          ticker: null,
          thesis_en: "The creator holds shares.",
          evidence: [{ segment_id: "s1", quote_original: "I hold shares" }],
        },
      },
    ],
  },
} as unknown as Run;
const sentence = {
  id: "s1",
  text: "The creator holds shares.",
  evidenceIds: ["c1"],
  externalIds: [],
  kind: "creator_view",
  horizon: "fundamental" as const,
  topic: "Company",
  materiality: 2,
  importanceReason: "Existing position",
  speaker: "unknown",
  timeMode: "video_date",
};
test("analysis cutoff is publication time, never the later processing date", () => {
  const context = analysisContext(run);
  assert.equal(context.videoPublishedAt, "2026-04-10T01:16:13Z");
  assert.equal(context.recordedAt, null);
  assert.equal(analysisContext({ ...run, output: {} }).videoPublishedAt, null);
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-04-11T00:00:00Z", publicationConfirmed: true },
      context,
      "video_date",
    ),
    false,
  );
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-04-09T00:00:00Z", publicationConfirmed: false },
      context,
      "video_date",
    ),
    false,
  );
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-04-11T00:00:00Z", publicationConfirmed: true },
      context,
      "current",
    ),
    true,
  );
});
test("brief rejects invented citations, unconfirmed historical sources and missing audit verdicts", () => {
  const source = evidenceInventory(run);
  const context = analysisContext(run);
  const raw = {
    sentences: [
      sentence,
      { ...sentence, id: "bad", evidenceIds: ["invented"] },
    ],
    mainTopics: ["Company"],
    omissions: [],
  };
  const result = validateBrief(raw, source, [], context, [
    {
      id: "s1",
      accepted: true,
      reason: "Supported",
      factualStatus: "unverified",
    },
    {
      id: "bad",
      accepted: true,
      reason: "Unsupported",
      factualStatus: "unverified",
    },
  ]);
  assert.deepEqual(
    result.sentences.map((s) => s.id),
    ["s1"],
  );
  assert.equal(result.rejected.length, 1);
  assert.equal(validateBrief(raw, source, [], context, []).sentences.length, 0);
  assert.throws(
    () =>
      validateBrief(raw, source, [], context, [
        {
          id: "s1",
          accepted: true,
          reason: "yes",
          factualStatus: "unverified",
        },
        {
          id: "s1",
          accepted: true,
          reason: "yes",
          factualStatus: "unverified",
        },
      ]),
    /duplicate/i,
  );
});
test("a primary-source badge cannot be granted from transcript agreement alone", () => {
  const result = validateBrief(
    { sentences: [sentence], mainTopics: ["Company"], omissions: [] },
    evidenceInventory(run),
    [],
    analysisContext(run),
    [
      {
        id: "s1",
        accepted: true,
        reason: "Quote agrees",
        factualStatus: "corroborated",
      },
    ],
  );
  assert.equal(result.sentences[0].factualStatus, "unverified");
});
test("extraction context includes prior section without changing original cues", () => {
  const segments = Array.from({ length: 40 }, (_, i) => ({
    id: "s" + i,
    text: i === 5 ? "Stocks I will buy now" : "text",
    start_seconds: i * 3,
    end_seconds: i * 3 + 3,
  }));
  const r = { ...run, output: { ...run.output, source: { segments } } };
  const payload = extractionContext(r, segments.slice(20));
  assert.ok(payload.previousSection.some((s) => s.id === "s5"));
  assert.equal(segments[5].text, "Stocks I will buy now");
});
test("financial checks compute units and reject invalid domains instead of inventing assumptions", () => {
  assert.ok(
    Math.abs(
      financialCheck({ kind: "cagr", initial: 1.6, final: 32.5, years: 10 })
        .value! - 0.3513,
    ) < 0.001,
  );
  assert.equal(
    financialCheck({ kind: "cagr", initial: 0, final: 32.5, years: 10 }).value,
    null,
  );
  assert.equal(
    financialCheck({ kind: "market_cap", earnings: 32.5, multiple: 40 }).value,
    1300,
  );
  assert.equal(
    financialCheck({
      kind: "short_put_breakeven",
      strike: 165,
      premiumPerShare: 12,
    }).value,
    153,
  );
});
test("ranking favours material recent developments, labels backfills and never invents novelty", () => {
  const old = {
    id: "old",
    videoId: "oldvideo",
    publishedAt: "2026-04-01T00:00:00Z",
    createdAt: "2026-09-20T00:00:00Z",
    sentences: [{ ...sentence, materiality: 3 }],
    status: "completed",
  };
  const recent = {
    ...old,
    id: "new",
    videoId: "newvideo",
    publishedAt: "2026-09-19T00:00:00Z",
  };
  const ranked = prioritiseBriefs(
    [old, recent],
    [],
    new Date("2026-09-20T00:00:00Z"),
  );
  assert.equal(ranked[0].id, "new");
  assert.equal(ranked[1].backfill, true);
  assert.equal(ranked[0].novelty, "unknown");
  assert.ok(ranked[0].rankingReasons.length);
});

test("an unsupported optional calculation is withheld with a visible limitation without losing the cited draft", async () => {
  const { parseResearchDraft } = await import(
    "../src/features/youtube-intelligence/research-brief.ts"
  );
  const result = parseResearchDraft({
    sentences: [
      {
        ...sentence,
        calculation: {
          expression: { kind: "discounted_cash_flow", initial: 10, final: 20 },
          units: "percent",
          assumptions: "Same basis",
        },
      },
    ],
    mainTopics: ["Company"],
    omissions: [],
  });
  assert.equal(result.sentences.length, 1);
  assert.equal(result.sentences[0].calculation, null);
  assert.match(result.omissions[0], /calculation.*withheld/i);
  assert.throws(() =>
    parseResearchDraft({
      sentences: [{ ...sentence, evidenceIds: [] }],
      mainTopics: [],
      omissions: [],
    }),
  );
});

test("overlong topic navigation does not discard supported content", async () => {
  const { parseResearchDraft } = await import(
    "../src/features/youtube-intelligence/research-brief.ts"
  );
  const parsed = parseResearchDraft({
    sentences: [sentence],
    mainTopics: Array.from({ length: 10 }, (_, i) => "Topic " + i),
    omissions: [],
  });
  assert.equal(parsed.mainTopics.length, 8);
  assert.equal(parsed.sentences.length, 1);
});

test("a future-dated video cannot admit a source published after analysis time", () => {
  const context = {
    ...analysisContext(run),
    videoPublishedAt: "2027-01-01T00:00:00Z",
  };
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-12-31T00:00:00Z", publicationConfirmed: true },
      context,
      "video_date",
    ),
    false,
  );
});

test("typed arithmetic distinguishes enterprise value, percentages and option contract cash", () => {
  assert.equal(
    financialCheck({
      kind: "enterprise_value_bridge",
      equityValue: 100,
      debt: 30,
      cash: 12,
      preferred: 2,
      nonControllingInterest: 1,
    }).value,
    121,
  );
  assert.equal(
    financialCheck({
      kind: "percentage_point_change",
      initialPercent: 10,
      finalPercent: 12,
    }).value,
    2,
  );
  assert.equal(
    financialCheck({ kind: "percentage_change", initial: 10, final: 12 }).value,
    0.2,
  );
  assert.equal(
    financialCheck({
      kind: "option_premium_total",
      premiumPerShare: 12,
      contractMultiplier: 100,
      contracts: 2,
    }).value,
    2400,
  );
});
test("novelty requires a dated prior baseline and an independent novelty verdict", () => {
  const raw = {
    sentences: [
      {
        ...sentence,
        novelty: {
          status: "new_detail",
          baselineIds: ["prior"],
          reason: "Adds a disclosed holding to earlier company research.",
        },
      },
    ],
    mainTopics: ["Company"],
    omissions: [],
  };
  const audit = [
    {
      id: "s1",
      accepted: true,
      reason: "Holding supported",
      factualStatus: "unverified" as const,
      noveltyAccepted: true,
    },
  ];
  const absent = validateBrief(
    raw,
    evidenceInventory(run),
    [],
    analysisContext(run),
    audit,
  );
  assert.equal(absent.sentences[0].novelty.status, "unknown");
  const baseline = [
    {
      id: "prior",
      sourceRunId: "older",
      publishedAt: "2026-04-09T00:00:00Z",
      topic: "Company",
      text: "Avoid new purchases.",
      evidence: evidenceInventory(run),
    },
  ];
  assert.equal(
    validateBrief(
      raw,
      evidenceInventory(run),
      [],
      analysisContext(run),
      audit,
      baseline,
    ).sentences[0].novelty.status,
    "new_detail",
  );
  assert.equal(
    validateBrief(
      raw,
      evidenceInventory(run),
      [],
      analysisContext(run),
      [{ ...audit[0], noveltyAccepted: false }],
      baseline,
    ).sentences[0].novelty.status,
    "unknown",
  );
});

test("overflowing valuation arithmetic is unavailable rather than an infinite target", () => {
  assert.equal(
    financialCheck({ kind: "market_cap", earnings: 1e308, multiple: 1e308 })
      .value,
    null,
  );
});

test('recall windows cover an explicit stance split across cues but exclude already-cited action cues',async()=>{
 const {actionRecallWindows}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const source={segments:[{id:'a',text:'CoreWeave is one of my favorites. I am',start_seconds:0,end_seconds:3},{id:'b',text:'bullish on CoreWeave.',start_seconds:3,end_seconds:6},{id:'c',text:'It has active power and dilution risks.',start_seconds:6,end_seconds:9}]};
 const r={...run,output:{source,claims:[]}};
 assert.ok(actionRecallWindows(r).some(w=>w.some(c=>c.id==='b')));
 const covered={...r,output:{...r.output,claims:[{id:'c1',passed:true,reasons:[],claim:{evidence:[{segment_id:'a',end_segment_id:'c'}]}}]}} as unknown as Run;
 assert.equal(actionRecallWindows(covered).length,0);
});
