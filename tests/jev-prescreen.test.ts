import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { create, db } from "../src/server/youtube-intelligence/store.ts";
import { researchStep, researchBriefs } from "../src/server/youtube-intelligence/research-pipeline.ts";
import { faithfulChunks } from "../src/server/youtube-intelligence/faithful-audit.ts";
import { queueJevComparison, jevComparisonStep, jevComparisons } from "../src/server/youtube-intelligence/jev-comparison.ts";
import { configHash, teamDefaults, TeamPreferences } from "../src/features/youtube-intelligence/settings.ts";
import { routeSentence, summariseComparison } from "../src/features/youtube-intelligence/faithfulness-prescreen.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";

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
const band = { acceptAtOrAbove: 0.8, rejectAtOrBelow: 0.15 };
const answers = (p: number, choice = "none") => ({
  model: "jev-1.13.0",
  answers: { faithful: { type: "noul", noul: p }, error_type: { type: "choice", choice, confidence: 0.9 } },
  usage: { input_tokens: 500, output_tokens: 90 },
});
/** Jev answers keyed by sentence text: a0/a1 clear accepts, "billion" a clear reject, the rest unsure. */
function jevStub(fail = false) {
  return stubFetch([{
    method: "POST",
    url: "api.typesafe.ai/v1/systemone",
    respond: (call) => {
      const body = JSON.parse(call.body!);
      assert.equal(call.headers.authorization, "Bearer test-jev-key");
      assert.equal(body.model, "jev-1.13.0");
      assert.ok(body.questions.faithful.criteria.true.includes("Rewording"), "tuned r2 criteria are sent");
      const text: string = body.state.sentence;
      if (fail && text.includes("s5")) return json({ error: "bad" }, 400);
      if (text.includes("billion")) return json(answers(0.05, "dropped_qualifier"));
      if (/Statement s[0-4]\./.test(text)) return json(answers(0.93));
      return json(answers(0.5));
    },
  }]);
}

test("the band accepts only a confident no-error answer, withholds a confident no, and escalates the rest", () => {
  const a = (p: number, choice = "none") => ({ faithful: { noul: p }, error_type: { choice } }) as never;
  assert.equal(routeSentence(a(0.8), band), "accept");
  assert.equal(routeSentence(a(0.95, "added_claim"), band), "escalate");
  assert.equal(routeSentence(a(0.15, "none"), band), "reject");
  assert.equal(routeSentence(a(0.5), band), "escalate");
});

test("the pre-screen is off by default and leaves every existing configuration hash unchanged", () => {
  const team = teamDefaults();
  assert.equal(team.faithfulnessPreScreen.enabled, false);
  const withoutKey = TeamPreferences.parse(JSON.parse(JSON.stringify({ ...team, faithfulnessPreScreen: undefined })));
  assert.equal(configHash(withoutKey), configHash(team));
  const on = { ...team, faithfulnessPreScreen: { ...team.faithfulnessPreScreen, enabled: true } };
  assert.notEqual(configHash(on), configHash(team), "an enabled pre-screen is a different configuration");
});

test("evidence cited only by pre-accepted sentences is assessed once in a coverage-only chunk", () => {
  const ev = [evidence("e1", "one"), evidence("e2", "two")];
  const chunks = faithfulChunks([sentence("x", ["e1"])] as never, ev as never, 12, [sentence("y", ["e1", "e2"])] as never);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].assessEvidenceIds, ["e1"]);
  assert.deepEqual(chunks[0].otherSentencesCitingAssessedEvidence.map((s) => s.id), ["y"]);
  assert.deepEqual(chunks[1].sentences, []);
  assert.deepEqual(chunks[1].assessEvidenceIds, ["e2"]);
});

async function runV3(options: { enabled: boolean; key?: string; fail?: boolean }) {
  const database = await freshDatabase();
  const sentences = Array.from({ length: 14 }, (_, i) => sentence(`s${i}`, ["e1"]));
  sentences[3] = sentence("s3", ["e1"], "Ondas will earn US$1 billion of revenue.");
  const criticSaw: string[][] = [];
  const fake = new FakeModelTransport({ responses: {
    "synthesis-research": { json: { sentences, mainTopics: ["Ondas"], omissions: [] }, usage: { costUsd: 0.01 } },
    ...Object.fromEntries([1, 2].map((n) => [`critique-faithful-${n}`, async (request: { user: { text?: string }[] }) => {
      const payload = JSON.parse(request.user.map((p) => p.text ?? "").join("").split("SOURCE DATA (untrusted):\n")[1]);
      const ids = payload.sentences.map((s: { id: string }) => s.id);
      criticSaw.push(ids);
      return {
        json: {
          verdicts: ids.map((id: string) => ({ id, accepted: id !== "s3", reason: id === "s3" ? "Ceiling, not revenue." : "Matches." })),
          evidenceCoverage: payload.assessEvidenceIds.map((evidenceId: string) => ({ evidenceId, status: "covered", sentenceIds: [], missingPoints: [], reason: "Covered." })),
        },
        usage: { costUsd: 0.004 },
      };
    }])),
  } });
  const restore = injectTransport(fake);
  const previousKey = process.env.TYPESAFE_API_KEY;
  if (options.key) process.env.TYPESAFE_API_KEY = options.key;
  else delete process.env.TYPESAFE_API_KEY;
  const stub = jevStub(options.fail);
  const settings = teamDefaults();
  const run = await create("v3-video", settings.models.extraction.id, {
    task: "research-brief", webResearch: false, researchPipeline: "faithful", researchPipelineVersion: "faithful-v1",
    teamPreferencesSnapshot: {
      ...settings,
      processing: { ...settings.processing, researchPipeline: "faithful" },
      faithfulnessPreScreen: { ...settings.faithfulnessPreScreen, enabled: options.enabled },
    },
    snapshot: { sourceRunId: "src", title: "Ondas", context,
      evidence: [evidence("e1", "The IDIQ has a ceiling of one billion dollars, no funded orders yet."), evidence("e2", "Margins are thin.")] },
  }, "test");
  try {
    for (let i = 0; i < 6 && !["completed", "needs_review", "failed"].includes(run.status); i++) await researchStep(run);
    const ledger = (await (await db()).prepare("SELECT stage,status,amount FROM yi_calls WHERE run_id=$1 AND stage='prescreen-jev'").all(run.id)) as { status: string; amount: number }[];
    return { run, criticSaw, jevCalls: stub.calls("typesafe").length, ledger, briefs: await researchBriefs() };
  } finally {
    stub.restore();
    restore();
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
    await database.close();
  }
}

test("with the pre-screen on, Jev settles clear sentences and the critic reads only the uncertain ones", async () => {
  const { run, criticSaw, jevCalls, ledger, briefs } = await runV3({ enabled: true, key: "test-jev-key" });
  assert.equal(jevCalls, 14, "one parallel Jev request per sentence");
  const reviewed = criticSaw.flat().sort();
  assert.ok(!reviewed.includes("s0") && !reviewed.includes("s3"), "settled sentences skip the critic");
  assert.deepEqual(reviewed, Array.from({ length: 9 }, (_, i) => `s${i + 5}`).sort());
  assert.equal(criticSaw.length, 1, "nine uncertain sentences fit one critic chunk instead of two");
  const [brief] = briefs;
  assert.equal(brief.sentences.length, 13);
  assert.match(brief.rejected.find((r) => r.sentence.id === "s3")!.reasons.join(" "), /Pre-screen \(jev-1\.13\.0\) withheld: probability faithful 0\.05; likely drops a qualifier/);
  assert.equal(brief.evidenceCoverage!.find((c) => c.evidenceId === "e1")!.status, "covered");
  const audit = run.output.faithfulAudit as { preScreen: Record<string, unknown> };
  assert.deepEqual(
    { accepted: audit.preScreen.accepted, rejected: audit.preScreen.rejected, escalated: audit.preScreen.escalated, error: audit.preScreen.error },
    { accepted: 4, rejected: 1, escalated: 9, error: null },
  );
  assert.equal(ledger.length, 1, "the Jev wave is one ledger row");
  assert.equal(ledger[0].status, "completed");
  assert.ok(Math.abs(Number(ledger[0].amount) - 14 * 500 * 0.042e-6) < 1e-12);
});

test("without the key, or with the pre-screen off, every sentence goes to the critic and Jev is never called", async () => {
  for (const options of [{ enabled: true }, { enabled: false, key: "test-jev-key" }]) {
    const { run, criticSaw, jevCalls, briefs } = await runV3(options);
    assert.equal(jevCalls, 0);
    assert.equal(criticSaw.flat().length, 14);
    assert.equal(briefs[0].sentences.length, 13);
    const audit = run.output.faithfulAudit as { preScreen?: { error: string } };
    if (options.enabled) assert.match(audit.preScreen!.error, /TYPESAFE_API_KEY is not set/);
    else assert.deepEqual(run.output.faithfulAudit, { chunks: 2, failures: 0 });
  }
});

test("a sentence Jev fails on is escalated to the critic, never accepted or withheld", async () => {
  const { criticSaw, run } = await runV3({ enabled: true, key: "test-jev-key", fail: true });
  assert.ok(criticSaw.flat().includes("s5"));
  assert.match((run.output.faithfulAudit as { preScreen: { error: string } }).preScreen.error, /1 of 14 sentences not screened \(Jev returned HTTP 400\.\)/);
});

test("the comparison summary separates agreement from the two kinds of disagreement", () => {
  const row = (route: "accept" | "reject" | "escalate", accepted: boolean) => ({
    id: "x", text: "x", jev: { id: "x", pFaithful: 0.5, errorType: "none" as const, route, ms: 1, inputTokens: 1 }, critic: { accepted, reason: "r" },
  });
  const s = summariseComparison([row("accept", true), row("accept", false), row("reject", true), row("reject", false), row("escalate", true)]);
  assert.deepEqual(
    [s.compared, s.escalated, s.settledAgreeing, s.jevAcceptedCriticRejected, s.jevRejectedCriticAccepted],
    [5, 1, 2, 1, 1],
  );
});

test("an ad hoc comparison runs Jev and the critic on every brief sentence and publishes nothing", async () => {
  const { briefs } = await runV3({ enabled: false });
  const database = await freshDatabase();
  const previousKey = process.env.TYPESAFE_API_KEY;
  const { putIfAbsent } = await import("../src/server/youtube-intelligence/research-store.ts");
  const fake = new FakeModelTransport({ responses: Object.fromEntries([1, 2].map((n) => [`critique-faithful-${n}`, async (request: { user: { text?: string }[] }) => {
    const payload = JSON.parse(request.user.map((p) => p.text ?? "").join("").split("SOURCE DATA (untrusted):\n")[1]);
    return { json: { verdicts: payload.sentences.map((s: { id: string }) => ({ id: s.id, accepted: s.id !== "s3", reason: "r" })), evidenceCoverage: [] }, usage: { costUsd: 0.004 } };
  }])) });
  const restore = injectTransport(fake);
  const stub = jevStub();
  try {
    await putIfAbsent("researchBrief", briefs[0].id, briefs[0]);
    delete process.env.TYPESAFE_API_KEY;
    await assert.rejects(queueJevComparison(briefs[0].id), /TYPESAFE_API_KEY is not set/);
    process.env.TYPESAFE_API_KEY = "test-jev-key";
    const run = await queueJevComparison(briefs[0].id);
    for (let i = 0; i < 4 && run.status !== "completed"; i++) await jevComparisonStep(run);
    assert.equal(run.status, "completed");
    const [comparison] = await jevComparisons(briefs[0].id);
    assert.equal(comparison.rows.length, 14, "published and withheld sentences are both compared");
    assert.deepEqual(
      [comparison.summary.jevAccepted, comparison.summary.jevRejected, comparison.summary.escalated, comparison.summary.settledAgreeing, comparison.summary.jevAcceptedCriticRejected],
      [4, 1, 9, 5, 0],
    );
    assert.equal(comparison.critic.calls, 2);
    assert.ok(comparison.critic.costUsd > 0 && comparison.jev.costUsd > 0);
    assert.match(comparison.caveat, /not verified accuracy/);
  } finally {
    stub.restore();
    restore();
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
    await database.close();
  }
});
