import test, { after } from "node:test";
import assert from "node:assert/strict";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { freshDatabase } from "./helpers/db.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
import { listHeaders } from "../src/server/youtube-intelligence/store.ts";
import { loadCostMetrics } from "../src/server/youtube-intelligence/cost-metrics.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";
after(async () => database.close());

const TRANSCRIPT = "a long private transcript ".repeat(2000);
async function insertRun(
  id: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  createdAt = "2026-09-25T00:00:00.000Z",
) {
  await database
    .prepare(
      "INSERT INTO yi_runs (id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,error,input,output,cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .run(
      id,
      `video-${id}`,
      "https://youtube.com/watch?v=fixture",
      "fixture",
      "fixture",
      `Run ${id}`,
      "completed",
      "done",
      createdAt,
      createdAt,
      null,
      JSON.stringify(input),
      JSON.stringify(output),
      0.5,
    );
}

test("listHeaders returns run rows without output and only the input keys lists read", async () => {
  await freshDatabase();
  await insertRun(
    "task",
    {
      task: "research-brief",
      snapshot: { sourceRunId: "source-1", evidence: [{ text: TRANSCRIPT }] },
      researchPipeline: "faithful",
    },
    { source: TRANSCRIPT },
  );
  await insertRun(
    "video",
    { experiment: true, record: "historical", transcript: TRANSCRIPT },
    { claims: [{ passed: true }], source: TRANSCRIPT },
    "2026-09-24T00:00:00.000Z",
  );
  const [task, video] = await listHeaders();
  assert.equal(task.id, "task");
  assert.deepEqual(task.output, {});
  assert.deepEqual(task.input, {
    task: "research-brief",
    snapshot: { sourceRunId: "source-1" },
    researchPipeline: "faithful",
  });
  assert.deepEqual(video.input, { experiment: true, record: "historical" });
  assert.equal(video.cost, 0.5);
  assert.equal(video.createdAt, "2026-09-24T00:00:00.000Z");
});

test("the workspace snapshot leaves Lab diagnostics to the lab action", async () => {
  await freshDatabase();
  await put("comparison", "c1", { id: "c1", hypothesis: "lab only" });
  await put("experiment", "e1", { id: "e1" });
  await insertRun("video", {}, { claims: [], source: TRANSCRIPT });
  const snapshot = (await dispatch("research", "snapshot", undefined)) as Record<string, unknown>;
  for (const key of ["comparisons", "experiments", "evaluations", "calls", "captionAttempts", "captionBenchmarks"])
    assert.equal(key in snapshot, false, `${key} should not be in the snapshot`);
  assert.ok(!JSON.stringify(snapshot).includes("private transcript"));
  const lab = (await dispatch("research", "lab", undefined)) as {
    comparisons: { id: string }[];
    experiments: { id: string }[];
    calls: unknown[];
  };
  assert.deepEqual(lab.comparisons.map((c) => c.id), ["c1"]);
  assert.deepEqual(lab.experiments.map((e) => e.id), ["e1"]);
  assert.ok(Array.isArray(lab.calls));
});

test("cost metrics count accepted claims in Postgres for the newest non-experiment run per video", async () => {
  await freshDatabase();
  await insertRun("old", {}, { claims: [{ passed: true }] }, "2026-09-20T00:00:00.000Z");
  await database.prepare("UPDATE yi_runs SET video_id='same' WHERE id='old'").run();
  await insertRun(
    "new",
    {},
    { claims: [{ passed: true }, { passed: true }, { passed: false }, { passed: "true" }, null] },
    "2026-09-22T00:00:00.000Z",
  );
  await database.prepare("UPDATE yi_runs SET video_id='same' WHERE id='new'").run();
  await insertRun("trial", { experiment: true }, { claims: [{ passed: true }] }, "2026-09-23T00:00:00.000Z");
  const metrics = await loadCostMetrics({ now: "2026-09-30T00:00:00.000Z" });
  assert.deepEqual(
    metrics.context.samples.map((s) => [s.videoId, s.acceptedClaims]),
    [["same", 2]],
  );
});

test("snapshot briefs carry what the overview shows, with readiness computed from the full brief", async () => {
  await freshDatabase();
  const full = {
    id: "b1",
    runId: "brief-run",
    sourceRunId: "source",
    videoId: "video",
    title: "Brief",
    createdAt: "2026-09-25T00:00:00.000Z",
    context: {},
    mainTopics: ["Gold"],
    sentences: [
      {
        id: "s1",
        text: "Gold is the hedge.",
        kind: "creator_view",
        topic: "Gold",
        horizon: "fundamental",
        materiality: 3,
        importanceReason: "Main thesis",
        timeMode: "video_date",
        evidenceIds: ["e1"],
        externalIds: [],
        factualStatus: "unverified",
        fidelity: "faithful",
        auditReason: "a long audit reason ".repeat(50),
        financialFactChecks: [{ note: "check detail" }],
      },
    ],
    evidence: [{ id: "e1", summary: "Gold view", quotes: [{ text: "private quote" }] },
      { id: "e2", summary: "Silver view", quotes: [] }],
    evidenceCoverage: [
      { evidenceId: "e1", status: "covered", sentenceIds: ["s1"], missingPoints: [], reason: "covered" },
    ],
    external: [],
    omissions: ["omission one", "omission two", "omission three", "omission four"],
    coverageFindings: [],
    rejected: [{ text: "withheld draft" }],
    retrievalNotes: [],
    baseline: [],
  };
  await put("researchBrief", "b1", full);
  const snapshot = (await dispatch("research", "snapshot", undefined)) as {
    researchBriefs: Record<string, unknown>[];
  };
  const brief = snapshot.researchBriefs[0] as {
    sentences: Record<string, unknown>[];
    readiness: { status: string; covered: number; total: number; issues: string[]; issueCount: number; coverage?: unknown };
  } & Record<string, unknown>;
  for (const key of ["evidence", "external", "rejected", "omissions", "evidenceCoverage", "baseline"])
    assert.equal(key in brief, false, `${key} should not be in the snapshot brief`);
  assert.equal("auditReason" in brief.sentences[0], false);
  assert.equal("financialFactChecks" in brief.sentences[0], false);
  assert.equal(brief.sentences[0].text, "Gold is the hedge.");
  assert.equal(brief.sentences[0].factualStatus, "unverified");
  // Readiness still counts the withheld draft, omissions and unresolved evidence.
  assert.equal(brief.readiness.status, "partial");
  assert.equal(brief.readiness.covered, 1);
  assert.equal(brief.readiness.total, 2);
  assert.equal(brief.readiness.issues.length, 3);
  assert.ok(brief.readiness.issueCount >= 6);
  assert.equal(brief.readiness.coverage, undefined);
});

test("API reads report database time in a Server-Timing header", async () => {
  const { timed } = await import("../src/server/youtube-intelligence/http.ts");
  await freshDatabase();
  const response = await timed(async () => {
    await database.prepare("SELECT 1").get();
    await database.prepare("SELECT 2").get();
    return Response.json({ ok: true });
  });
  const header = response.headers.get("Server-Timing") ?? "";
  assert.match(header, /total;dur=\d/);
  assert.match(header, /db-query;dur=[\d.]+;desc="2 queries"/);
  assert.deepEqual(await response.json(), { ok: true });
});
