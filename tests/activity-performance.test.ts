import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { create } from "../src/server/youtube-intelligence/store.ts";
import {
  runSummaryPage,
  workspaceActivity,
} from "../src/server/youtube-intelligence/run-summaries.ts";

test("run pages exclude transcript and job payloads and retain stable pagination on tied timestamps", async () => {
  const db = await freshDatabase();
  for (let n = 0; n < 5; n++) {
    const run = await create(
      `video${n}`,
      "gemini-3.8-flash",
      n === 4 ? { task: "researchBrief" } : {},
      "v1",
    );
    await db
      .prepare("UPDATE yi_runs SET created_at=$1,output=$2 WHERE id=$3")
      .run(
        "2026-09-20T00:00:00Z",
        JSON.stringify({
          source: { text: "private transcript" },
          claims: [{ passed: true }, { passed: false }],
          metadata: { title: "title" },
        }),
        run.id,
      );
  }
  const one = await runSummaryPage({ limit: 2 });
  assert.equal(one.runs.length, 2);
  assert.ok(one.nextCursor);
  assert.equal(one.runs[0].output.acceptedEvidenceCount, 1);
  assert.equal(JSON.stringify(one).includes("private transcript"), false);
  const two = await runSummaryPage({ limit: 2, cursor: one.nextCursor! });
  assert.equal(two.runs.length, 2);
  assert.equal(two.nextCursor, null);
  assert.equal(new Set([...one.runs, ...two.runs].map((r) => r.id)).size, 4);
  await assert.rejects(() => runSummaryPage({ limit: 10001 }));
  await assert.rejects(() => runSummaryPage({ cursor: "bad" }));
});

test("activity reports terminal changes and active progress without reading large outputs", async () => {
  const db = await freshDatabase();
  const run = await create("video", "gemini-3.8-flash", {}, "v1");
  const before = await workspaceActivity();
  assert.equal(before.active.length, 1);
  assert.equal(before.active[0].id, run.id);
  assert.equal("output" in before.active[0], false);
  await db
    .prepare("UPDATE yi_runs SET status='completed',updated_at=$1 WHERE id=$2")
    .run("2026-09-20T10:00:00Z", run.id);
  const after = await workspaceActivity();
  assert.equal(after.active.length, 0);
  assert.notEqual(before.terminalRevision, after.terminalRevision);
});

test("late status and page responses cannot regress newer completed rows", async () => {
  const { mergeRunSummaries, applyActivity } = await import(
    "../src/features/youtube-intelligence/ui/activity-state.ts"
  );
  const db = await freshDatabase();
  const created = await create("video", "gemini-3.8-flash", {}, "v1");
  const old = (await runSummaryPage()).runs[0];
  await db
    .prepare("UPDATE yi_runs SET status='completed',updated_at=$1 WHERE id=$2")
    .run("2099-01-01T00:00:00Z", created.id);
  const fresh = (await runSummaryPage()).runs[0];
  assert.equal(mergeRunSummaries([fresh], [old])[0].status, "completed");
  assert.equal(
    applyActivity([fresh], {
      active: [old],
      activeTruncated: false,
      latestRunId: old.id,
      terminalRevision: "old",
    })[0].status,
    "completed",
  );
});

test("activity route preserves workspace access protection", async () => {
  const { GET } = await import("../src/app/api/intelligence/activity/route.ts");
  const response = await GET(
    new Request("https://untrusted.example/api/intelligence/activity"),
  );
  assert.equal(response.status, 400);
});

test("loaded older activity can refresh by IDs without resetting pagination or exposing jobs", async () => {
  const db = await freshDatabase();
  const old = await create("old", "gemini-3.8-flash", {}, "v1");
  const job = await create(
    "job",
    "gemini-3.8-flash",
    { task: "researchBrief" },
    "v1",
  );
  await db
    .prepare(
      "UPDATE yi_runs SET status='failed',error='provider error' WHERE id=$1",
    )
    .run(old.id);
  const page = await runSummaryPage({ ids: [old.id, job.id] });
  assert.equal(page.runs.length, 1);
  assert.equal(page.runs[0].status, "failed");
  assert.equal(page.nextCursor, null);
  await assert.rejects(() => runSummaryPage({ ids: Array(101).fill(old.id) }));
});

test("workspace summaries omit duplicated analysis payloads while detail keeps transcript and audits", async () => {
  const db = await freshDatabase();
  const run = await create("deep-detail", "gemini-3.8-flash", {}, "v1");
  const output = {
    source: { text: "retained transcript" },
    extractionPlan: { chunks: ["large retained context"] },
    claims: [{ id: "c1", passed: true, audit: { reason: "retained audit" } }],
    keyPoints: [],
  };
  await db
    .prepare("UPDATE yi_runs SET status='completed',output=$1 WHERE id=$2")
    .run(JSON.stringify(output), run.id);
  const { dispatch } = await import(
    "../src/server/youtube-intelligence/actions/index.ts"
  );
  const snapshot = (await dispatch("research", "snapshot", undefined)) as {
    runs: { id: string; output: unknown }[];
    evaluationRuns: { id: string; output: unknown }[];
    researchBriefs: unknown[];
  };
  assert.deepEqual(snapshot.runs.find((r) => r.id === run.id)?.output, {});
  assert.deepEqual(
    snapshot.evaluationRuns.find((r) => r.id === run.id)?.output,
    {},
  );
  assert.ok(Array.isArray(snapshot.researchBriefs));
  const { GET } = await import(
    "../src/app/api/intelligence/runs/[id]/route.ts"
  );
  const response = await GET(
    new Request(`http://localhost/api/intelligence/runs/${run.id}`),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.deepEqual(detail.run.output.source, output.source);
  assert.deepEqual(detail.run.output.extractionPlan, output.extractionPlan);
  assert.deepEqual(detail.run.output.claims, output.claims);
  assert.ok(Array.isArray(detail.researchBriefs));
  assert.ok(Array.isArray(detail.evidenceSpans));
});
