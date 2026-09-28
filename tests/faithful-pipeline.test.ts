import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { create } from "../src/server/youtube-intelligence/store.ts";
import { researchStep, researchBriefs } from "../src/server/youtube-intelligence/research-pipeline.ts";
import { faithfulChunks } from "../src/server/youtube-intelligence/faithful-audit.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
import { TransportError } from "../src/server/youtube-intelligence/transport/types.ts";

const evidence = (id: string, text: string) => ({
  id, kind: "creator_call", summary: text, instrument: "Ondas", ticker: null, stance: "watch", horizon: null,
  conditions: [], risks: [], levels: [], trust: "L1",
  quotes: [{ startId: `${id}-q`, endId: `${id}-q`, text, translation: "", start: 0, end: 4, hash: null }],
});
const sentence = (id: string, evidenceIds: string[], text = `Statement ${id}.`) => ({
  id, text, evidenceIds, externalIds: [], kind: "creator_view", horizon: "fundamental", topic: "Ondas",
  materiality: 2, importanceReason: "Material", speaker: "unknown", timeMode: "video_date", calculation: null,
});
const context = {
  videoPublishedAt: "2026-09-01T00:00:00Z", recordedAt: null, analysedAt: "2026-09-20T00:00:00Z",
  language: "en", videoId: "v3-video", temporalPolicy: "video-date evidence and later updates are separate",
};

test("evidence is assessed once, in the chunk of its first citing sentence, with every citing sentence visible", () => {
  const ev = [evidence("e1", "one"), evidence("e2", "two")];
  const sentences = [...Array.from({ length: 12 }, (_, i) => sentence(`a${i}`, ["e1"])), sentence("b0", ["e1", "e2"])];
  const chunks = faithfulChunks(sentences as never, ev as never);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].assessEvidenceIds, ["e1"]);
  assert.deepEqual(chunks[1].assessEvidenceIds, ["e2"]);
  assert.deepEqual(chunks[0].otherSentencesCitingAssessedEvidence.map((s) => s.id), ["b0"]);
});

async function runV3(critic: (stage: string, ids: string[]) => unknown) {
  const db = await freshDatabase();
  const sentences = Array.from({ length: 14 }, (_, i) => sentence(`s${i}`, ["e1"]));
  sentences[3] = sentence("s3", ["e1"], "Ondas will earn US$1 billion of revenue.");
  let active = 0, peak = 0;
  const fake = new FakeModelTransport({ responses: {
    "synthesis-research": { json: { sentences, mainTopics: ["Ondas"], omissions: [] }, usage: { costUsd: 0.01 } },
    ...Object.fromEntries([1, 2].map((n) => [`critique-faithful-${n}`, async (request: { user: { text?: string }[] }) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      const payload = JSON.parse(request.user.map((p) => p.text ?? "").join("").split("SOURCE DATA (untrusted):\n")[1]);
      return critic(`critique-faithful-${n}`, payload.sentences.map((s: { id: string }) => s.id));
    }])),
  } });
  const restore = injectTransport(fake);
  const settings = teamDefaults();
  const run = await create("v3-video", settings.models.extraction.id, {
    task: "research-brief", webResearch: false, researchPipeline: "faithful", researchPipelineVersion: "faithful-v1",
    teamPreferencesSnapshot: { ...settings, processing: { ...settings.processing, researchPipeline: "faithful" } },
    snapshot: { sourceRunId: "src", title: "Ondas", context,
      evidence: [evidence("e1", "The IDIQ has a ceiling of one billion dollars, no funded orders yet."), evidence("e2", "Margins are thin.")] },
  }, "test");
  try {
    for (let i = 0; i < 6 && !["completed", "needs_review", "failed"].includes(run.status); i++) await researchStep(run);
    return { run, fake, peak, briefs: await researchBriefs() };
  } finally {
    restore();
    await db.close();
  }
}

test("v3 checks fidelity in parallel chunks, withholds unfaithful statements and lists uncited evidence", async () => {
  const { run, fake, peak, briefs } = await runV3((_stage, ids) => ({
    json: {
      verdicts: ids.map((id) => id === "s3"
        ? { id, accepted: false, reason: "The quote describes a contract ceiling with no funded orders, not revenue." }
        : { id, accepted: true, reason: "Matches the cited quote." }),
      evidenceCoverage: ids.includes("s0") ? [{ evidenceId: "e1", status: "partial", sentenceIds: ["s0"], missingPoints: [{ point: "Not yet funded", quote: "no funded orders yet" }], reason: "Funding qualifier absent." }] : [],
    },
    usage: { costUsd: 0.004 },
  }));
  assert.equal(fake.requests.filter((r) => r.stage.startsWith("critique-faithful")).length, 2);
  assert.equal(fake.requests.length, 3, "one synthesis plus two parallel checks; no plan, search or repair calls");
  assert.equal(peak, 2, "chunks ran concurrently");
  assert.notEqual(fake.requests[1].model, fake.requests[0].model, "independent critic model");
  const [brief] = briefs;
  assert.equal(brief.sentences.length, 13);
  assert.match(brief.rejected.find((r) => r.sentence.id === "s3")!.reasons.join(" "), /ceiling/);
  const coverage = Object.fromEntries(brief.evidenceCoverage!.map((c) => [c.evidenceId, c.status]));
  assert.deepEqual(coverage, { e1: "partial", e2: "missing" });
  assert.equal(run.stage, "complete");
  assert.deepEqual(run.output.faithfulAudit, { chunks: 2, failures: 0 });
});

test("a failed check chunk withholds its sentences for review instead of publishing them unchecked", async () => {
  const { run, briefs } = await runV3((stage, ids) => {
    if (stage === "critique-faithful-2") throw new TransportError("server", "provider unavailable", 503);
    return { json: { verdicts: ids.map((id) => ({ id, accepted: true, reason: "Matches." })), evidenceCoverage: [] }, usage: { costUsd: 0.004 } };
  });
  assert.equal(run.status, "needs_review");
  const [brief] = briefs;
  assert.equal(brief.sentences.length, 12);
  assert.ok(brief.rejected.some((r) => /withheld, not disproven/.test(r.reasons.join(" "))));
});
