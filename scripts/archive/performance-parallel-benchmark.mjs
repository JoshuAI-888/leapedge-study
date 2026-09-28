/** Controlled fixture benchmark: node scripts/performance-parallel-benchmark.mjs <checkout> <output.json>. No network or paid calls. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(process.argv[2]);
const output = process.argv[3];
process.chdir(root);
process.env.YTI_DB = "pglite";
delete process.env.DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fixture";
process.env.EXA_API_KEY = "fixture";
process.env.YTI_BUDGET_USD = "100";
globalThis.fetch = async () => {
  throw Error("Unexpected network blocked by benchmark");
};
const load = (p) => import(pathToFileURL(resolve(root, p)).href);
const { freshDatabase } = await load("tests/helpers/db.ts");
const { create } = await load("src/server/youtube-intelligence/store.ts");
const { step } = await load("src/server/youtube-intelligence/pipeline.ts");
const { researchStep } = await load(
  "src/server/youtube-intelligence/research-pipeline.ts",
);
const { Source } = await load("src/features/youtube-intelligence/contracts.ts");
const { FakeModelTransport } = await load(
  "src/server/youtube-intelligence/transport/fake.ts",
);
const { injectTransport } = await load(
  "src/server/youtube-intelligence/transport/index.ts",
);
const { teamDefaults } = await load(
  "src/features/youtube-intelligence/settings.ts",
);
const { stubFetch, json } = await load("tests/helpers/fetch-stub.ts");
const delayMs = 400;
const delay = () => new Promise((r) => setTimeout(r, delayMs));
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const results = [];
for (let repetition = 0; repetition < 3; repetition++) {
  const db = await freshDatabase();
  const snapshot = {
    id: "parallel-benchmark",
    transcribe: "transcribe",
    synthesis: "synthesize",
    extraction: "extract",
    critique: "critique",
    pointerEvidence: true,
  };
  const source = Source.parse({
    source_kind: "native_captions",
    segment_separator: " ",
    segments: Array.from({ length: 128 }, (_, i) => ({
      id: `s${i}`,
      text: `If Company ${Math.floor(i / 16)} falls below 500, exit the position.`,
      start_seconds: i * 30,
      end_seconds: i * 30 + 30,
    })),
  });
  const responses = {};
  let active = 0,
    peak = 0;
  for (let i = 0; i < 8; i++)
    responses[`synthesis-chunk-${i}`] = async () => {
      active++;
      peak = Math.max(peak, active);
      await delay();
      active--;
      return {
        json: {
          claims: [
            {
              thesis_en: `Exit Company ${i} on a break below 500.`,
              instrument_as_spoken: `Company ${i}`,
              ticker: null,
              ticker_explicit: false,
              stance: "conditional",
              horizon_en: null,
              conditions_en: ["break below 500"],
              creator_conviction: "unspecified",
              risks_en: [],
              levels: [{ kind: "stop", value_original: "500" }],
              evidence_ranges: [
                { start_id: `s${i * 16}`, end_id: `s${i * 16}` },
              ],
            },
          ],
          key_points: [],
          mentions: [],
        },
        usage: { costUsd: 0 },
      };
    };
  const fake = new FakeModelTransport({ responses });
  const restore = injectTransport(fake);
  const run = await create(
    "long-benchmark",
    "fixture",
    { promptSnapshot: snapshot },
    snapshot.id,
  );
  run.stage = "synthesis";
  run.output.source = source;
  run.output.extractionPlan = Array.from({ length: 8 }, (_, i) =>
    source.segments.slice(i * 16, i * 16 + 16),
  );
  let iterations = 0;
  const started = performance.now();
  while (run.stage === "synthesis") {
    await step(run);
    assert.ok(++iterations < 20);
  }
  const elapsedMs = performance.now() - started;
  assert.equal(fake.requests.length, 8);
  assert.equal(run.output.claims.length, 8);
  const extraction = {
    elapsedMs,
    providerCalls: fake.requests.length,
    providerDelayMs: delayMs,
    peakConcurrent: peak,
    steps: iterations,
    outputHash: hash(run.output.claims),
    claimCount: run.output.claims.length,
    claims: run.output.claims,
  };
  restore();
  let searchActive = 0,
    searchPeak = 0;
  const stub = stubFetch([
    {
      url: "https://api.exa.ai/search",
      respond: async () => {
        searchActive++;
        searchPeak = Math.max(searchPeak, searchActive);
        await delay();
        searchActive--;
        return json({
          costDollars: { total: 0 },
          results: [
            {
              url: "https://www.sec.gov/Archives/fixture",
              title: "Company filing",
              text: "Published on: January 1, 2025\nReported revenue was 10 billion dollars.",
              publishedDate: "2025-01-01",
            },
          ],
        });
      },
    },
  ]);
  const research = await create(
    "research-benchmark",
    "fixture",
    {
      task: "research-brief",
      teamPreferencesSnapshot: teamDefaults(),
      snapshot: {
        sourceRunId: "source",
        title: "Research benchmark",
        evidence: [],
        context: {
          videoPublishedAt: "2026-01-01T00:00:00Z",
          recordedAt: null,
          analysedAt: "2026-09-20T00:00:00Z",
          language: "en",
          videoId: "research-benchmark",
          temporalPolicy: "video-date evidence and later updates are separate",
        },
      },
    },
    "fixture",
  );
  research.stage = "research-sources";
  research.output.researchPlan = {
    queries: [
      { query: "Company revenue", reason: "material" },
      { query: "Company margins", reason: "material" },
    ],
    coverage: [],
  };
  let searchSteps = 0;
  const searchStarted = performance.now();
  while (research.stage === "research-sources") {
    await researchStep(research);
    assert.ok(++searchSteps < 10);
  }
  const searchElapsedMs = performance.now() - searchStarted;
  const sources = research.output.retrievals.map((r) => ({
    query: r.query,
    timeMode: r.timeMode,
    state: r.state,
    sources: r.sources.map((s) => ({
      url: s.url,
      text: s.text,
      publishedAt: s.publishedAt,
      publicationConfirmed: s.publicationConfirmed,
      sourceClass: s.sourceClass,
      hash: s.hash,
      query: s.query,
      timeMode: s.timeMode,
    })),
  }));
  assert.equal(stub.log.length, 4);
  results.push({
    repetition: repetition + 1,
    extraction,
    researchSources: {
      elapsedMs: searchElapsedMs,
      providerCalls: stub.log.length,
      providerDelayMs: delayMs,
      peakConcurrent: searchPeak,
      steps: searchSteps,
      outputHash: hash(sources),
      sources,
    },
  });
  stub.restore();
  await db.close();
}
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const report = {
  root,
  kind: "controlled fake-provider benchmark; no live network; no paid calls; not end-to-end production latency",
  delayMs,
  repetitions: 3,
  summary: {
    extractionMedianMs: median(results.map((r) => r.extraction.elapsedMs)),
    researchSourcesMedianMs: median(
      results.map((r) => r.researchSources.elapsedMs),
    ),
  },
  results,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    root,
    summary: report.summary,
    hashes: results.map((r) => [
      r.extraction.outputHash,
      r.researchSources.outputHash,
    ]),
    peaks: results.map((r) => [
      r.extraction.peakConcurrent,
      r.researchSources.peakConcurrent,
    ]),
  }),
);
