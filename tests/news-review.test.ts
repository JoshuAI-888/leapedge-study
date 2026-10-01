import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNewsReview,
  finalizeNewsReview,
  sourceWindow,
} from "../src/features/youtube-intelligence/news-review.ts";
import type { ExternalEvidenceData } from "../src/features/youtube-intelligence/research-brief.ts";

const context = { recordedAt: null, videoPublishedAt: "2026-09-01T12:00:00.000Z" };
const source = (id: string, publishedAt: string | null, text: string): ExternalEvidenceData => ({
  id,
  url: `https://news.example/${id}`,
  title: id,
  text,
  publishedAt,
  retrievedAt: "2026-09-28T00:00:00.000Z",
  publicationConfirmed: false,
  dateBasis: "provider estimate",
  sourceClass: "unknown",
  hash: id,
  query: "q",
  timeMode: publishedAt && publishedAt > context.videoPublishedAt ? "current" : "video_date",
  provider: "exa",
});
const before = source("before", "2026-08-20T00:00:00.000Z", "Ondas said the IDIQ contract has a ceiling of $1 billion, with no funded orders yet.");
const after = source("after", "2026-09-15T00:00:00.000Z", "Ondas announced a first funded task order worth $12 million under the IDIQ vehicle.");
const undated = source("undated", null, "Ondas IDIQ commentary without a date.");

test("sources are placed before or after the video, never both", () => {
  assert.equal(sourceWindow(before, context), "asOfVideo");
  assert.equal(sourceWindow(after, context), "sinceVideo");
  assert.equal(sourceWindow(undated, context), "undated");
});

test("structural checks reject uncited, invented, paraphrased and wrong-window citations", () => {
  const draft = {
    summary: [],
    claims: [
      {
        claimId: "s1",
        verdict: "mixed" as const,
        asOfVideo: [
          { text: "A ceiling, not funded revenue.", citations: [{ sourceId: "before", excerpt: "has a ceiling of $1 billion, with no funded orders yet" }] },
          { text: "Paraphrased excerpt.", citations: [{ sourceId: "before", excerpt: "the ceiling is one billion dollars" }] },
          { text: "Later news cited as prior context.", citations: [{ sourceId: "after", excerpt: "first funded task order worth $12 million" }] },
          { text: "No citation at all.", citations: [] },
        ],
        sinceVideo: [
          { text: "A first funded order followed.", citations: [{ sourceId: "after", excerpt: "first  funded task order worth $12 million" }] },
          { text: "Invented source.", citations: [{ sourceId: "ghost", excerpt: "something that was never retrieved" }] },
          { text: "Undated source.", citations: [{ sourceId: "undated", excerpt: "Ondas IDIQ commentary without a date" }] },
        ],
      },
      { claimId: "not-in-brief", verdict: "consistent" as const, asOfVideo: [{ text: "x", citations: [] }], sinceVideo: [] },
    ],
    gaps: [],
  };
  const result = validateNewsReview(draft, [before, after, undated], ["s1", "s2"], context);
  assert.deepEqual(result.accepted.map((s) => s.id), ["s1-asof-1", "s1-since-1"]);
  const reasons = Object.fromEntries(result.rejected.map((r) => [r.id, r.reasons.join(" ")]));
  assert.match(reasons["s1-asof-2"], /not verbatim/);
  assert.match(reasons["s1-asof-3"], /published after the video/);
  assert.match(reasons["s1-asof-4"], /No citation/);
  assert.match(reasons["s1-since-2"], /not retrieved/);
  assert.match(reasons["s1-since-3"], /no publication date/);
  assert.match(reasons["not-in-brief-unknown-1"], /not in this brief/);
  assert.deepEqual(result.claims, [{ claimId: "s1", verdict: "mixed" }]);
});

test("the independent check removes unsupported statements and a claim left empty becomes not covered", () => {
  const structural = validateNewsReview(
    {
      summary: [],
      claims: [
        { claimId: "s1", verdict: "consistent", asOfVideo: [{ text: "Ceiling, not revenue.", citations: [{ sourceId: "before", excerpt: "has a ceiling of $1 billion" }] }], sinceVideo: [] },
        { claimId: "s2", verdict: "contradicted", asOfVideo: [], sinceVideo: [{ text: "Overreach.", citations: [{ sourceId: "after", excerpt: "first funded task order" }] }] },
      ],
      gaps: [],
    },
    [before, after],
    ["s1", "s2"],
    context,
  );
  const final = finalizeNewsReview(structural, {
    verdicts: [
      { id: "s1-asof-1", supported: true, reason: "Excerpt states the ceiling." },
      { id: "s2-since-1", supported: false, reason: "A funded order does not contradict the claim." },
    ],
  });
  assert.equal(final.claims[0].verdict, "consistent");
  assert.equal(final.claims[1].verdict, "not_covered");
  assert.equal(final.claims[1].downgraded, true);
  assert.match(final.rejected[0].reasons[0], /Independent check/);
});

test("a default brief is built from the transcript alone: no search plan, no web request", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const { researchStep } = await import("../src/server/youtube-intelligence/research-pipeline.ts");
  const { teamDefaults } = await import("../src/features/youtube-intelligence/settings.ts");
  const { FakeModelTransport } = await import("../src/server/youtube-intelligence/transport/fake.ts");
  const { injectTransport } = await import("../src/server/youtube-intelligence/transport/index.ts");
  const { stubFetch } = await import("./helpers/fetch-stub.ts");
  const db = await freshDatabase();
  const fake = new FakeModelTransport();
  const restore = injectTransport(fake);
  const stub = stubFetch([]);
  try {
    const run = await create("no-web", "fixture", {
      task: "research-brief", webResearch: false, teamPreferencesSnapshot: teamDefaults(),
      snapshot: { sourceRunId: "source", title: "No web", evidence: [], context: {
        videoPublishedAt: "2026-01-01T00:00:00Z", recordedAt: null, analysedAt: "2026-09-20T00:00:00Z",
        language: "en", videoId: "no-web", temporalPolicy: "video-date evidence and later updates are separate" } },
    }, "fixture");
    await researchStep(run);
    assert.equal(run.stage, "research-synthesis");
    assert.equal(fake.requests.length, 0);
    assert.equal(stub.log.length, 0);
    assert.deepEqual(run.output.retrievals, []);
  } finally {
    stub.restore();
    restore();
    await db.close();
  }
});

test("an analyst news review searches the open web, cites verbatim excerpts, and keeps only checked statements", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  const { putIfAbsent } = await import("../src/server/youtube-intelligence/research-store.ts");
  const { queueNewsReview, newsReviewStep, newsReviews } = await import("../src/server/youtube-intelligence/news-review.ts");
  const { FakeModelTransport } = await import("../src/server/youtube-intelligence/transport/fake.ts");
  const { injectTransport } = await import("../src/server/youtube-intelligence/transport/index.ts");
  const { stubFetch, json } = await import("./helpers/fetch-stub.ts");
  const db = await freshDatabase();
  const priorKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture";
  const bodies: Record<string, unknown>[] = [];
  const stub = stubFetch([{ url: "https://api.exa.ai/search", respond: async (call) => {
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    bodies.push(body);
    const later = typeof body.startPublishedDate === "string";
    return json({ costDollars: { total: 0.005 }, results: [later
      ? { url: "https://news.example/order", title: "First funded order", text: "Ondas announced a first funded task order worth $12 million under the IDIQ vehicle.", publishedDate: "2026-09-15T00:00:00.000Z" }
      : { url: "https://news.example/ceiling", title: "IDIQ ceiling", text: "Ondas said the IDIQ contract has a ceiling of $1 billion, with no funded orders yet.", publishedDate: "2026-08-20T00:00:00.000Z" }] });
  } }]);
  let sourceIds: Record<string, string> = {};
  const fake = new FakeModelTransport({ responses: {
    "synthesis-news-plan": { json: { queries: [{ query: "Ondas IDIQ contract funded orders", claimIds: ["s1"], reason: "Material contract claim" }] }, usage: { costUsd: 0.001 } },
    "synthesis-news-review": (request) => {
      const text = request.user.map((p) => ("text" in p ? p.text : "")).join("");
      for (const m of text.matchAll(/"id":"(web-[a-f0-9]+-\d)","title":"([^"]+)"/g)) sourceIds[m[2]] = m[1];
      return { json: {
        summary: [{ text: "The contract is a ceiling; a first funded order followed.", citations: [
          { sourceId: sourceIds["IDIQ ceiling"], excerpt: "a ceiling of $1 billion, with no funded orders yet" },
          { sourceId: sourceIds["First funded order"], excerpt: "first funded task order worth $12 million" }] }],
        claims: [{ claimId: "s1", verdict: "mixed",
          asOfVideo: [{ text: "At the video date the $1 billion was a ceiling with no funded orders.", citations: [{ sourceId: sourceIds["IDIQ ceiling"], excerpt: "has a ceiling of $1 billion, with no funded orders yet" }] }],
          sinceVideo: [
            { text: "A first funded order of $12 million followed.", citations: [{ sourceId: sourceIds["First funded order"], excerpt: "first funded task order worth $12 million" }] },
            { text: "Revenue will reach $1 billion.", citations: [{ sourceId: sourceIds["First funded order"], excerpt: "revenue will reach one billion" }] }] }],
        gaps: ["No source addressed margins."] }, usage: { costUsd: 0.002 } };
    },
    "critique-news-review": { json: { verdicts: [
      { id: "summary-1", supported: true, reason: "Both excerpts state it." },
      { id: "s1-asof-1", supported: true, reason: "Excerpt states the ceiling." },
      { id: "s1-since-1", supported: true, reason: "Excerpt states the order." }] }, usage: { costUsd: 0.001 } },
  } });
  const restore = injectTransport(fake);
  try {
    await putIfAbsent("researchBrief", "brief-1", {
      id: "brief-1", runId: "brief-1", sourceRunId: "src", title: "Ondas", videoId: "ondas-video", createdAt: "2026-09-02T00:00:00.000Z",
      context: { videoPublishedAt: "2026-09-01T12:00:00.000Z", recordedAt: null, analysedAt: "2026-09-02T00:00:00.000Z", language: "en", videoId: "ondas-video", temporalPolicy: "video-date evidence and later updates are separate" },
      sentences: [{ id: "s1", text: "Ondas has access to a $1 billion contract.", topic: "Ondas", materiality: 3, speaker: "unknown", timeMode: "video_date" }],
    });
    const run = await queueNewsReview("brief-1");
    for (let i = 0; i < 6 && run.status !== "completed"; i++) await newsReviewStep(run);
    assert.equal(run.status, "completed");
    assert.ok(bodies.length === 2 && bodies.every((b) => !("includeDomains" in b)), "news search is not restricted to company domains");
    const [review] = await newsReviews("brief-1");
    assert.equal(review.claims[0].verdict, "mixed");
    assert.equal(review.claims[0].asOfVideo.length, 1);
    assert.equal(review.claims[0].sinceVideo.length, 1);
    assert.equal(review.summary.length, 1);
    assert.match(review.rejected.map((r) => r.reasons.join(" ")).join(" "), /not verbatim/);
    assert.equal(review.independentlyChecked, true);
    assert.deepEqual(review.sources.map((s) => s.window).sort(), ["asOfVideo", "sinceVideo"]);
    assert.equal(review.searchCostUsd, 0.01);
    assert.notEqual(fake.requests.at(-1)!.model, fake.requests[0].model, "the check uses the independent critic model");
  } finally {
    stub.restore();
    restore();
    if (priorKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = priorKey;
    await db.close();
  }
});
