import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { create, get } from "../src/server/youtube-intelligence/store.ts";
import {
  researchStep,
  researchBriefs,
} from "../src/server/youtube-intelligence/research-pipeline.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
const sentence = {
  id: "point",
  text: "The creator holds shares.",
  evidenceIds: ["c1"],
  externalIds: [],
  kind: "holding",
  horizon: "fundamental",
  topic: "Company",
  materiality: 2,
  importanceReason: "Existing position",
  speaker: "unknown",
  timeMode: "video_date",
  calculation: null,
};
test("research stages resume paid synthesis and retain original evidence, independent critique and actual cost", async () => {
  const db = await freshDatabase();
  const settings = teamDefaults();
  const fake = new FakeModelTransport({
    responses: {
      "synthesis-research-plan": {
        json: { queries: [], coverage: ["Company"] },
        usage: { costUsd: 0.01 },
      },
      "synthesis-research": {
        json: {
          sentences: [
            sentence,
            { ...sentence, id: "invented", evidenceIds: ["missing"] },
          ],
          mainTopics: ["Company"],
          omissions: [],
        },
        usage: { costUsd: 0.02 },
      },
      "critique-research": {
        json: {
          verdicts: [
            {
              id: "point",
              accepted: true,
              reason: "Holding supported.",
              factualStatus: "corroborated",
            },
            {
              id: "invented",
              accepted: true,
              reason: "Accepted by model but invalid reference.",
              factualStatus: "unverified",
            },
          ],
          coverageFindings: ["No valuation data supplied."],
        },
        usage: { costUsd: 0.03 },
      },
    },
  });
  const restore = injectTransport(fake);
  try {
    const run = await create(
      "research-video",
      settings.models.extraction.id,
      {
        task: "research-brief",
        teamPreferencesSnapshot: settings,
        snapshot: {
          sourceRunId: "original",
          title: "Company",
          context: {
            videoPublishedAt: "2026-01-01T00:00:00Z",
            recordedAt: null,
            analysedAt: "2026-09-20T00:00:00Z",
            language: "en",
            videoId: "research-video",
            temporalPolicy:
              "video-date evidence and later updates are separate",
          },
          evidence: [
            {
              id: "c1",
              kind: "creator_call",
              summary: "Holds shares",
              instrument: "Company",
              ticker: null,
              stance: "hold",
              horizon: null,
              conditions: [],
              risks: [],
              levels: [],
              trust: "L1",
              quotes: [
                {
                  startId: "s1",
                  endId: "s1",
                  text: "I hold shares",
                  translation: "",
                  start: 0,
                  end: 4,
                  hash: null,
                },
              ],
            },
          ],
        },
      },
      "test",
    );
    await researchStep(run);
    assert.equal(run.stage, "research-sources");
    run.stage = "metadata";
    await researchStep(run);
    assert.equal(fake.requests.length, 1, "restart reused recorded response");
    await researchStep(run);
    await researchStep(run);
    await researchStep(run);
    assert.equal(run.status, "completed");
    assert.equal(fake.requests.length, 3);
    const [brief] = await researchBriefs();
    assert.equal(brief.sourceRunId, "original");
    assert.equal(brief.sentences.length, 1);
    assert.equal(brief.rejected.length, 1);
    assert.equal(brief.sentences[0].factualStatus, "unverified");
    assert.equal(brief.sentences[0].robustness, "insufficient");
    assert.equal(brief.modelCostUsd, 0.06);
    assert.equal((await get(run.id))?.cost, 0.06);
    assert.notEqual(fake.requests[0].model, fake.requests[2].model);
  } finally {
    restore();
    await db.close();
  }
});

test("a section heading before the chunk boundary is citable source evidence, not just advisory context", async () => {
  const db = await freshDatabase();
  const { step } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const { prompt } = await import(
    "../src/server/youtube-intelligence/research-store.ts"
  );
  const { Source } = await import(
    "../src/features/youtube-intelligence/contracts.ts"
  );
  const fake = new FakeModelTransport({
    responses: {
      "synthesis-chunk-1": {
        json: { claims: [], key_points: [], mentions: [] },
        usage: { costUsd: 0.001 },
      },
    },
  });
  const restore = injectTransport(fake);
  try {
    const settings = teamDefaults();
    const run = await create(
      "section-test",
      settings.models.extraction.id,
      {
        promptSnapshot: await prompt("evidence-first.web.v8"),
        teamPreferencesSnapshot: settings,
      },
      "evidence-first.web.v8",
    );
    const segments = Array.from({ length: 50 }, (_, i) => ({
      id: "s" + i,
      text:
        i === 15
          ? "The stocks I will buy right now"
          : i === 25
            ? "Company A is attractively positioned."
            : "Source context",
      start_seconds: i * 3,
      end_seconds: i * 3 + 3,
    }));
    run.stage = "synthesis";
    run.output = {
      source: Source.parse({
        segments,
        source_kind: "imported_transcript",
        language: "en",
      }),
      metadata: { publishedAt: "2026-04-01T00:00:00Z" },
      extractionPlan: [segments.slice(0, 20), segments.slice(20)],
      chunkIndex: 1,
      chunkDrafts: [{ claims: [], key_points: [], mentions: [] }],
    };
    await step(run);
    const text = fake.requests[0].user[0].text;
    const payload = JSON.parse(
      text.slice(text.indexOf("SOURCE DATA (untrusted):\n") + 25),
    );
    assert.ok(payload.source.some((cue: { id: string }) => cue.id === "s15"));
    assert.ok(payload.source.some((cue: { id: string }) => cue.id === "s25"));
    assert.equal(
      payload.analysisContext.videoPublishedAt,
      "2026-04-01T00:00:00Z",
    );
  } finally {
    restore();
    await db.close();
  }
});

for (const bucket of ["claims", "key_points"] as const)
  test(`recall ${bucket} remain unaccepted and return to independent critique before publication`, async () => {
    const db = await freshDatabase();
    const { step } = await import(
      "../src/server/youtube-intelligence/pipeline.ts"
    );
    const { prompt } = await import(
      "../src/server/youtube-intelligence/research-store.ts"
    );
    const { Source } = await import(
      "../src/features/youtube-intelligence/contracts.ts"
    );
    const fake = new FakeModelTransport({
      responses: {
        "synthesis-recall-0": {
          json: {
            claims: [],
            key_points: [],
            [bucket]: [
              {
                thesis_en: "The creator is bullish on CoreWeave.",
                instrument_as_spoken: "CoreWeave",
                ticker: null,
                ticker_explicit: false,
                stance: "long",
                horizon_en: null,
                conditions_en: [],
                creator_conviction: "medium",
                risks_en: [],
                levels: [],
                evidence_ranges: [{ start_id: "a", end_id: "c" }],
              },
            ],
            mentions: [],
          },
          usage: { costUsd: 0.001 },
        },
      },
    });
    const restore = injectTransport(fake);
    try {
      const settings = teamDefaults();
      const run = await create(
        "recall-test",
        settings.models.extraction.id,
        {
          promptSnapshot: await prompt("evidence-first.web.v8"),
          teamPreferencesSnapshot: settings,
        },
        "evidence-first.web.v8",
      );
      run.stage = "publish";
      run.output = {
        source: Source.parse({
          source_kind: "imported_transcript",
          language: "en",
          segments: [
            {
              id: "a",
              text: "CoreWeave is one of my favorites. I am",
              start_seconds: 0,
              end_seconds: 3,
            },
            {
              id: "b",
              text: "bullish on CoreWeave.",
              start_seconds: 3,
              end_seconds: 6,
            },
            {
              id: "c",
              text: "It has active power and dilution risks.",
              start_seconds: 6,
              end_seconds: 9,
            },
          ],
        }),
        claims: [],
        keyPoints: [],
        mentions: [],
      };
      await step(run);
      assert.equal(run.output.recallChecked, true);
      assert.notEqual(run.status, "completed");
      assert.ok(["translate", "critique"].includes(run.stage));
      const claims = run.output[
        bucket === "claims" ? "claims" : "keyPoints"
      ] as { passed: boolean; reasons: string[] }[];
      assert.equal(claims.length, 1);
      assert.equal(claims[0].passed, false);
      assert.deepEqual(claims[0].reasons, []);
    } finally {
      restore();
      await db.close();
    }
  });
