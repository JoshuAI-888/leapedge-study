import test, {after} from "node:test";
import {database} from "../src/server/youtube-intelligence/database.ts";
after(async()=>database.close());
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
  assert.equal(detail.analystView, null, "an output the view cannot read leaves the detail intact");
  assert.equal(typeof detail.analystViewError, "string");
});

test("checked-finding revisions cross narrow activity/page boundaries without source payloads",async()=>{
 const db=await freshDatabase();
 const run=await create("checked-live","gemini-3.8-flash",{auditedExecutionPlan:{version:"audited-speed.v1",checkedFindings:true}},"v1");
 await db.prepare("UPDATE yi_runs SET status='running',stage='critique',output=$1 WHERE id=$2").run(JSON.stringify({checkedFindingsRevision:3,source:{text:"private checked transcript"}}),run.id);
 const activity=await workspaceActivity();
 assert.equal((activity.active[0] as {findingsRevision?:number}).findingsRevision,3);
 assert.equal((await runSummaryPage()).runs[0].output.checkedFindingsRevision,3);
 assert.doesNotMatch(JSON.stringify(activity),/private checked transcript/);
 await db.prepare("UPDATE yi_runs SET input=$1 WHERE id=$2").run(JSON.stringify({auditedExecutionPlan:{version:"audited-speed.v1",checkedFindings:false}}),run.id);
 assert.equal((await runSummaryPage()).runs[0].output.checkedFindingsRevision,0);
});

test("out-of-order same-stage activity cannot regress a checked-finding revision",async()=>{
 const {applyActivity,mergeRunSummaries,Activity}=await import("../src/features/youtube-intelligence/ui/activity-state.ts");
 await freshDatabase();
 const run=await create("same-stage","fixture",{},"v1");
 const existing={...run,findingsRevision:5};
 const older=Activity.parse({active:[{...run,findingsRevision:3}],activeTruncated:false,terminalRevision:"x",latestRunId:run.id});
 assert.equal((applyActivity([existing],older)[0] as {findingsRevision?:number}).findingsRevision,5);
 assert.equal((mergeRunSummaries([existing],[{...run,findingsRevision:2} as typeof existing])[0] as {findingsRevision?:number}).findingsRevision,5);
 const completed={...existing,status:'completed',stage:'complete'};
 assert.equal(mergeRunSummaries([completed],[{...run,updatedAt:'2099-01-01T00:00:00Z'}])[0].status,'completed');
 assert.equal(applyActivity([completed],Activity.parse({...older,active:[{...run,updatedAt:'2099-01-01T00:00:00Z',findingsRevision:3}]}))[0].stage,'complete');
});

test('malformed counters and child or non-opted-in jobs cannot raise publication revision',async()=>{
 const db=await freshDatabase();
 const run=await create('bad-revision','fixture',{auditedExecutionPlan:{version:'audited-speed.v1',checkedFindings:true}},'v1');
 for(const revision of ['invalid','1',-1,1.5,10000000000]){
  await db.prepare("UPDATE yi_runs SET output=$1 WHERE id=$2").run(JSON.stringify({checkedFindingsRevision:revision}),run.id);
  assert.equal((await workspaceActivity()).active[0].findingsRevision,0);
  assert.equal((await runSummaryPage()).runs[0].output.checkedFindingsRevision,0);
 }
 await db.prepare('UPDATE yi_runs SET input=$1,output=$2 WHERE id=$3').run(JSON.stringify({task:'research-brief',auditedExecutionPlan:{version:'audited-speed.v1',checkedFindings:true}}),JSON.stringify({checkedFindingsRevision:4}),run.id);
 assert.equal((await workspaceActivity()).active[0].findingsRevision,0);
 assert.equal((await runSummaryPage()).runs.length,0);
});
