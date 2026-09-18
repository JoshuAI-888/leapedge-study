import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
import type { ModelRequestData } from "../src/server/youtube-intelligence/transport/types.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import {
  Mention,
  Source,
  type CheckedClaim,
  type ClaimData,
  type MentionData,
  type SourceData,
} from "../src/features/youtube-intelligence/contracts.ts";
import { GoogleNativeTransport } from "../src/server/youtube-intelligence/transport/google-native.ts";
import { OpenRouterTransport } from "../src/server/youtube-intelligence/transport/openrouter.ts";
import {
  ModelRequest,
  type ModelTransport,
} from "../src/server/youtube-intelligence/transport/types.ts";
import {
  CACHED_SOURCE_NOTE,
  CRITIQUE_BATCH_FORMAT,
  critiqueOutputTokens,
  critiqueResponseSchema,
  parseCritique,
} from "../src/server/youtube-intelligence/schemas/critique.ts";
import {
  estimateTokens,
  transcriptChunks,
} from "../src/features/youtube-intelligence/chunking.ts";

/* ------------------------------------------------------------------ *
 * F15: one batched critique per run with the transcript from an
 * explicit context cache (spec 4.3, 5). The per-claim loop and the
 * source-repair stage are gone.
 * ------------------------------------------------------------------ */

const MODEL = "google/gemini-3.8-flash";
const CRITIC = teamDefaults().models.critique.id;
const line = (i: number) =>
  `Segment ${i}: the creator says he is buying more of name ${i} and holding it.`;
const fixture = (count: number) =>
  Source.parse({
    source_kind: "imported_transcript",
    language: "en",
    segments: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      text: line(i),
      start_seconds: i * 5,
      end_seconds: i * 5 + 5,
    })),
  });
const claim = (i: number): ClaimData => ({
  thesis_en: `The creator is buying name ${i} and holding it.`,
  instrument_as_spoken: `name ${i}`,
  ticker: null,
  ticker_explicit: false,
  stance: "long",
  horizon_en: "into next year",
  conditions_en: [],
  creator_conviction: "high",
  risks_en: [],
  levels: [],
  evidence: [
    { segment_id: `s${i}`, quote_original: line(i), quote_translation_en: line(i) },
  ],
});
const item = (id: string, i: number): CheckedClaim => ({
  id,
  claim: claim(i),
  passed: false,
  reasons: [],
});
const mention = (i: number): MentionData =>
  Mention.parse({
    ticker: `N${i}`,
    instrument_as_spoken: `name ${i}`,
    market: "us-stock",
    stance: "long",
    sentiment: "bullish",
    rationale_en: `The creator says he is buying name ${i}.`,
    source_span: {
      start_id: `s${i}`,
      end_id: `s${i}`,
      start_seconds: i * 5,
      end_seconds: i * 5 + 5,
      text_hash: "a".repeat(64),
    },
    is_call: false,
    claim_id: null,
  });
/** The payload one request carried, unwrapped from the SOURCE DATA envelope. */
function payloadOf(request: ModelRequestData) {
  const text = request.user[0].text;
  return JSON.parse(
    text.slice(text.indexOf("SOURCE DATA (untrusted):\n") + 25),
  ) as {
    source: string | { scope: string; segments: SourceData["segments"] };
    chunk?: number;
    totalChunks?: number;
    claims: { id: string; kind: string; claim: ClaimData }[];
    mentions: { id: string; mention: MentionData }[];
  };
}
/**
 * A critic that answers whatever ids the batch actually asked about, so a test
 * asserts the pipeline's batching rather than restating it in a fixture.
 */
function critic(
  options: { reject?: string[]; omit?: string[]; extra?: string[] } = {},
) {
  return (request: ModelRequestData) => {
    const payload = payloadOf(request);
    const ids = [
      ...payload.claims.map((c) => c.id),
      ...payload.mentions.map((m) => m.id),
      ...(options.extra ?? []),
    ].filter((id) => !(options.omit ?? []).includes(id));
    return {
      json: {
        verdicts: ids.map((id) => ({
          id,
          verdict: (options.reject ?? []).includes(id) ? "reject" : "accept",
          reason_en: (options.reject ?? []).includes(id)
            ? `The source does not support ${id}.`
            : `The cited span supports ${id}.`,
        })),
      },
      // A reported cost closes the ledger row, so a resumed stage can reserve
      // again; an unknown outcome would stay open and block it.
      usage: { inputTokens: 400, outputTokens: 120, costUsd: 0.002 },
    };
  };
}
const fixtureSource = fixture(8);
type RunFixture = {
  source?: SourceData;
  claims?: CheckedClaim[];
  keyPoints?: CheckedClaim[];
  mentions?: MentionData[];
  pointer?: boolean;
};
/** A run parked at the critique stage, with the ledger and budget a real call needs. */
async function critiqueRun(setup: RunFixture) {
  await freshDatabase();
  process.env.YTI_BUDGET_USD = "10";
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const snapshot = {
    id: setup.pointer ? "pointer.test.v1" : "evidence-first.web.v5",
    rationale: "Fixture prompt snapshot for the batched-critique test.",
    transcribe: "Transcribe the supplied source fixture.",
    extraction: "Extract claims from the supplied source fixture.",
    synthesis: "Summarise the supplied claims from the source fixture.",
    critique: "Audit the supplied claims against the source fixture.",
    ...(setup.pointer ? { pointerEvidence: true } : {}),
  };
  const run = await create(
    "critique-run",
    MODEL,
    {
      promptSnapshot: snapshot,
      inferenceConfig: { critiqueMaxTokens: 3000, reasoningEffort: "low" },
    },
    snapshot.id,
  );
  run.stage = "critique";
  run.output.source = setup.source ?? fixtureSource;
  run.output.metadata = { duration: 60 };
  run.output.claims = setup.claims ?? [];
  if (setup.keyPoints) run.output.keyPoints = setup.keyPoints;
  if (setup.mentions) run.output.mentions = setup.mentions;
  return run;
}
/** Run one step with a fake transport injected, returning the fake for its spies. */
async function withFake<T>(
  fake: FakeModelTransport,
  body: () => Promise<T>,
): Promise<T> {
  const restore = injectTransport(fake);
  try {
    return await body();
  } finally {
    restore();
  }
}

test("the batched critic answers every claim in one call, whatever the claim count", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  for (const count of [3, 30]) {
    const source = fixture(count);
    const claims = Array.from({ length: count }, (_, i) => item(`c${i + 1}`, i));
    const run = await critiqueRun({ source, claims });
    const fake = new FakeModelTransport({ responses: { critique: critic() } });
    await withFake(fake, () => step(run));
    assert.equal(
      fake.requests.length,
      1,
      `${count} claims must cost exactly one critic call`,
    );
    assert.equal(fake.requestsFor("critique-0").length, 0, "no per-claim stage");
    const request = fake.requestsFor("critique")[0];
    assert.equal(request.model, CRITIC);
    assert.deepEqual(request.responseSchema, critiqueResponseSchema);
    assert.ok(request.user[0].text.includes(CRITIQUE_BATCH_FORMAT));
    assert.ok(request.user[0].text.includes("Audit the supplied claims"));
    assert.equal(
      request.maxOutputTokens,
      critiqueOutputTokens(count, 3000),
      "the output cap grows with the batch",
    );
    const payload = payloadOf(request);
    assert.deepEqual(
      payload.claims.map((c) => c.id),
      claims.map((c) => c.id),
    );
    assert.deepEqual(payload.mentions, []);
    const audited = run.output.claims as CheckedClaim[];
    assert.equal(audited.filter((c) => c.passed).length, count);
    assert.deepEqual(audited[0].audit, {
      verdict: "accept",
      reason_en: "The cited span supports c1.",
    });
    assert.equal(run.stage, "publish");
    assert.equal(run.output.auditIndex, undefined, "no per-claim cursor remains");
    assert.equal(
      (run.output.critique as { calls: number; items: number }).calls,
      1,
    );
  }
});

test("verdict ids map back to claims, key points and mentions", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const claims = [item("c1", 1), item("c2", 2)];
  const keyPoints = [item("k1", 3)];
  const mentions = [mention(4), mention(5)];
  const run = await critiqueRun({ claims, keyPoints, mentions });
  // A rejection extraction already recorded: the two kinds share one list, so a
  // reader must be able to tell which stage refused which mention.
  run.output.rejectedMentions = [
    {
      mention: mention(9),
      reason: "Mention cites no source range.",
      kind: "extraction",
    },
  ];
  const fake = new FakeModelTransport({
    responses: {
      critique: critic({ reject: ["c2", "m1"], omit: ["k1"], extra: ["c9"] }),
    },
  });
  await withFake(fake, () => step(run));
  const payload = payloadOf(fake.requestsFor("critique")[0]);
  assert.deepEqual(
    payload.claims.map((c) => [c.id, c.kind]),
    [
      ["c1", "claim"],
      ["c2", "claim"],
      ["k1", "key_point"],
    ],
  );
  assert.deepEqual(
    payload.mentions.map((m) => [m.id, m.mention.ticker]),
    [
      ["m1", "N4"],
      ["m2", "N5"],
    ],
  );
  const audited = run.output.claims as CheckedClaim[];
  assert.equal(audited[0].passed, true);
  assert.equal(audited[1].passed, false);
  assert.deepEqual(audited[1].reasons, ["The source does not support c2."]);
  assert.equal(audited[1].audit?.verdict, "reject");
  // An id the critic never answered cannot pass by default.
  const points = run.output.keyPoints as CheckedClaim[];
  assert.equal(points[0].passed, false);
  assert.equal(points[0].audit, undefined);
  assert.match(points[0].reasons[0], /no verdict/i);
  // A rejected mention leaves the sentiment set with its reason recorded.
  assert.deepEqual(
    (run.output.mentions as MentionData[]).map((m) => m.ticker),
    ["N5"],
  );
  assert.deepEqual(
    (
      run.output.rejectedMentions as {
        mention: MentionData;
        reason: string;
        kind: string;
      }[]
    ).map((r) => [r.mention.ticker, r.reason, r.kind]),
    [
      ["N9", "Mention cites no source range.", "extraction"],
      ["N4", "The source does not support m1.", "critic"],
    ],
    "each rejection names the stage that refused it",
  );
  const summary = run.output.critique as {
    calls: number;
    items: number;
    mentions: number;
    missingVerdicts: string[];
    unexpectedVerdicts: string[];
  };
  assert.equal(summary.calls, 1);
  assert.deepEqual(summary.missingVerdicts, ["k1"]);
  assert.deepEqual(summary.unexpectedVerdicts, ["c9"]);
});

test("the transcript is cached once per run, reused by a later pass and released at publish", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const run = await critiqueRun({ claims: [item("c1", 1)] });
  const fake = new FakeModelTransport({ responses: { critique: critic() } });
  const settings = teamDefaults();
  assert.equal(settings.processing.contextCaching, true);
  await withFake(fake, () => step(run, settings));
  assert.equal(fake.caches.length, 1, "one explicit cache per run");
  const cache = fake.caches[0];
  assert.equal(cache.model, CRITIC);
  assert.ok(cache.ttlSeconds > 0);
  assert.ok(
    cache.parts[0].text.includes(line(0)),
    "the cache holds the transcript",
  );
  const first = fake.requestsFor("critique")[0];
  assert.equal(first.cachedContent, cache.name);
  assert.equal(
    payloadOf(first).source,
    CACHED_SOURCE_NOTE,
    "a cached transcript is not re-sent inline",
  );
  const record = run.output.contextCache as {
    name: string;
    model: string;
    transport: string;
    deletedAt?: string;
  };
  assert.equal(record.name, cache.name);
  assert.equal(record.deletedAt, undefined);
  // A resumed critique reuses the cache the run already holds.
  (run.output.claims as CheckedClaim[]).push(item("c2", 2));
  run.stage = "critique";
  await withFake(fake, () => step(run, settings));
  assert.equal(fake.caches.length, 1, "the cache is created once, then reused");
  const resumed = run.output.critique as {
    passes: number;
    calls: number;
    items: number;
    cached: boolean;
  };
  assert.deepEqual(
    [resumed.passes, resumed.calls, resumed.items, resumed.cached],
    [2, 2, 2, true],
    "the summary accumulates what both passes paid for",
  );
  const second = fake.requestsFor("critique")[1];
  assert.equal(second.cachedContent, cache.name);
  assert.deepEqual(
    payloadOf(second).claims.map((c) => c.id),
    ["c2"],
    "an already audited claim is not sent again",
  );
  // Publishing releases it; the run records that it was released.
  assert.equal(run.stage, "publish");
  await withFake(fake, () => step(run, settings));
  assert.deepEqual(fake.deletedCaches, [cache.name]);
  assert.ok((run.output.contextCache as { deletedAt?: string }).deletedAt);
  assert.equal(run.status, "completed");
});

test("with context caching off the transcript is inlined and no cache is created", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const run = await critiqueRun({ claims: [item("c1", 1)] });
  const fake = new FakeModelTransport({ responses: { critique: critic() } });
  const settings = teamDefaults();
  settings.processing.contextCaching = false;
  await withFake(fake, () => step(run, settings));
  assert.deepEqual(fake.caches, []);
  const request = fake.requestsFor("critique")[0];
  assert.equal(request.cachedContent, undefined);
  const source = payloadOf(request).source as {
    scope: string;
    segments: SourceData["segments"];
  };
  assert.equal(source.scope, "full transcript");
  assert.equal(source.segments.length, fixtureSource.segments.length);
  assert.equal(run.output.contextCache, undefined);
  await withFake(fake, () => step(run, settings));
  assert.deepEqual(fake.deletedCaches, []);
});

test("the transcript is chunked only above processing.chunkAboveTokens", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const source = fixture(1200);
  const tokens = estimateTokens(source.segments);
  assert.ok(tokens > 10000 && tokens < 700000, `fixture is ${tokens} tokens`);
  assert.equal(transcriptChunks(source, 700000).length, 1);
  assert.ok(transcriptChunks(source, 10000).length > 1);
  const claimsFor = () => [item("c1", 0), item("c2", 600), item("c3", 1199)];
  const settings = () => {
    const team = teamDefaults();
    team.processing.contextCaching = false;
    return team;
  };
  const wide = { describe: { contextLength: 4000000 } };
  // Below the threshold: one pass over the whole transcript.
  const single = await critiqueRun({ source, claims: claimsFor() });
  const fakeSingle = new FakeModelTransport({
    responses: { critique: critic() },
    ...wide,
  });
  await withFake(fakeSingle, () => step(single, settings()));
  assert.equal(fakeSingle.requestsFor("critique").length, 1);
  assert.equal(
    (single.output.critique as { chunks: number; transcriptTokens: number })
      .chunks,
    1,
  );
  // Above it: one pass per chunk, each carrying only its own segments and the
  // claims cited there, and every claim still gets exactly one verdict.
  const chunked = await critiqueRun({ source, claims: claimsFor() });
  const team = settings();
  team.processing.chunkAboveTokens = 10000;
  const chunkStages = Object.fromEntries(
    transcriptChunks(source, 10000).map((_, i) => [
      `critique-chunk-${i}`,
      critic(),
    ]),
  );
  const fake = new FakeModelTransport({ responses: chunkStages, ...wide });
  await withFake(fake, () => step(chunked, team));
  const calls = fake.requests.filter((r) => r.stage.startsWith("critique"));
  assert.ok(calls.length > 1, `chunked run made ${calls.length} calls`);
  const chunkCount = transcriptChunks(source, 10000).length;
  assert.ok(calls.length <= chunkCount);
  for (const request of calls)
    assert.match(request.stage, /^critique-chunk-\d+$/);
  assert.equal(
    new Set(calls.map((r) => r.stage)).size,
    calls.length,
    "each chunk reserves its own ledger stage",
  );
  assert.deepEqual(fake.caches, [], "a chunked transcript is not cached");
  const seen: string[] = [];
  for (const request of calls) {
    const payload = payloadOf(request);
    const inlined = payload.source as { segments: SourceData["segments"] };
    assert.ok(inlined.segments.length > 0);
    assert.equal(payload.totalChunks, chunkCount);
    for (const entry of payload.claims) {
      seen.push(entry.id);
      assert.ok(
        inlined.segments.some(
          (s) => s.id === entry.claim.evidence[0].segment_id,
        ),
        `${entry.id} travels with the chunk that holds its evidence`,
      );
    }
  }
  assert.deepEqual(seen.sort(), ["c1", "c2", "c3"]);
  assert.equal(
    (chunked.output.claims as CheckedClaim[]).filter((c) => c.passed).length,
    3,
  );
  const summary = chunked.output.critique as { chunks: number; calls: number };
  assert.equal(summary.chunks, chunkCount);
  assert.equal(summary.calls, calls.length);
});

test("a legacy run with no pointer evidence uses the same batched critic", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const claims = [item("c1", 1), item("c2", 2)];
  const run = await critiqueRun({ claims, pointer: false });
  assert.equal(
    (run.input.promptSnapshot as { pointerEvidence?: boolean }).pointerEvidence,
    undefined,
  );
  const fake = new FakeModelTransport({ responses: { critique: critic() } });
  await withFake(fake, () => step(run));
  assert.equal(fake.requestsFor("critique").length, 1);
  const payload = payloadOf(fake.requestsFor("critique")[0]);
  assert.equal(payload.claims.length, 2);
  assert.equal(
    payload.claims[0].claim.evidence[0].source_span,
    undefined,
    "legacy quote evidence reaches the critic unchanged",
  );
  assert.equal(
    (run.output.claims as CheckedClaim[]).every((c) => c.passed),
    true,
  );
  assert.equal(run.stage, "publish");
});

test("a claim with a structural reason is never sent to the critic and no call is made for an empty batch", async () => {
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const rejected = { ...item("c1", 1), reasons: ["Quote does not match the retained source."] };
  const run = await critiqueRun({ claims: [rejected] });
  const fake = new FakeModelTransport({ responses: { critique: critic() } });
  await withFake(fake, () => step(run));
  assert.deepEqual(fake.requests, []);
  assert.deepEqual(fake.caches, []);
  assert.equal(run.stage, "publish");
  assert.equal((run.output.claims as CheckedClaim[])[0].passed, false);
});

test("an incomplete generated transcript is held for review; there is no source-repair stage", async () => {
  await freshDatabase();
  process.env.YTI_BUDGET_USD = "10";
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const run = await create(
    "no-repair",
    MODEL,
    {
      // The flag the removed stage keyed on: a run that still carries it gets
      // the review hold, never a second paid transcription pass.
      sourceRepairEnabled: true,
      source: {
        source_kind: "model_generated_transcript",
        segments: [
          { id: "s0", text: line(0), start_seconds: 0, end_seconds: 5 },
        ],
      },
    },
    "fixture",
  );
  run.stage = "source";
  run.output.metadata = { duration: 2400 };
  const fake = new FakeModelTransport();
  await withFake(fake, () => step(run));
  assert.equal(run.status, "needs_review");
  assert.equal(run.stage, "source");
  assert.deepEqual(fake.requests, []);
  assert.equal(run.output.sourceBeforeRepair, undefined);
  assert.match(String(run.error), /Import a complete timed transcript/);
});

test("parseCritique accepts either envelope and refuses a duplicated id", () => {
  const one = { id: "c1", verdict: "accept", reason_en: "Supported." };
  assert.deepEqual(parseCritique({ verdicts: [one] }), [one]);
  assert.deepEqual(parseCritique([one]), [one]);
  assert.throws(() => parseCritique({ verdicts: [one, one] }), /two verdicts/);
  assert.throws(() => parseCritique({ verdicts: [{ ...one, verdict: "maybe" }] }));
  assert.throws(() => parseCritique({ verdicts: [{ ...one, reason_en: "" }] }));
  assert.deepEqual(
    parseCritique({
      verdicts: [{ ...one, cross_claim_notes: "c2 contradicts this horizon." }],
    })[0].cross_claim_notes,
    "c2 contradicts this horizon.",
  );
});

test("GoogleNativeTransport creates, names and deletes an explicit cache; OpenRouter ignores one", async () => {
  const created: unknown[] = [];
  const deleted: unknown[] = [];
  const transport = new GoogleNativeTransport({
    caches: {
      async create(params) {
        created.push(params);
        return {
          name: "cachedContents/abc123",
          model: params.model,
          expireTime: "2026-09-17T00:30:00Z",
          usageMetadata: { totalTokenCount: 4242 },
        };
      },
      async delete(params) {
        deleted.push(params);
        return {};
      },
    },
  });
  const cache = await transport.createCache(
    "gemini-3.8-flash",
    [{ type: "text", text: "the retained transcript" }],
    1800,
  );
  assert.deepEqual(cache, {
    name: "cachedContents/abc123",
    model: "gemini-3.8-flash",
    expireTime: "2026-09-17T00:30:00Z",
    tokens: 4242,
  });
  assert.deepEqual(created, [
    {
      model: "gemini-3.8-flash",
      config: {
        contents: [
          { role: "user", parts: [{ text: "the retained transcript" }] },
        ],
        ttl: "1800s",
      },
    },
  ]);
  await transport.deleteCache(cache.name);
  assert.deepEqual(deleted, [{ name: cache.name }]);
  await assert.rejects(
    () => transport.createCache("gemini-3.8-flash", [], 1800),
    /at least one part/,
  );
  // The request names the cache; the native config carries it.
  const request = ModelRequest.parse({
    stage: "critique",
    model: "gemini-3.8-flash",
    user: [{ type: "text", text: "audit these ids" }],
    cachedContent: cache.name,
    responseSchema: critiqueResponseSchema,
    maxOutputTokens: 3000,
    temperature: 0,
  });
  assert.equal(transport.parameters(request).config?.cachedContent, cache.name);
  // OpenRouter cannot cache: the field is ignored, never sent as an unknown key.
  const body = new OpenRouterTransport().body(request) as Record<string, unknown>;
  assert.equal(body.cachedContent, undefined);
  assert.equal(JSON.stringify(body).includes(cache.name), false);
  const openRouter: ModelTransport = new OpenRouterTransport();
  assert.equal(openRouter.createCache, undefined, "no cache seam to call");
  assert.equal(
    transport.parameters(
      ModelRequest.parse({ ...request, cachedContent: undefined }),
    ).config?.cachedContent,
    undefined,
  );
});
