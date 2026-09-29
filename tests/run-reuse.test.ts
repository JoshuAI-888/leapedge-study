import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import {
  queue,
  put,
  events,
  saveTeamPreferences,
} from "../src/server/youtube-intelligence/research-store.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";
import {
  analyseVideo,
  reuseDecision,
  runIdentity,
  sameIdentity,
} from "../src/server/youtube-intelligence/reuse.ts";

/**
 * F74. A video that already has a completed canonical analysis on the identity
 * a new run would get is answered with that analysis at no cost; anything else
 * — a different pipeline, a failed or held run, or an explicit re-run — queues.
 */
const VIDEO = "reuseVid001";
const URL = `https://www.youtube.com/watch?v=${VIDEO}`;

async function counts() {
  const n = async (sql: string) =>
    Number(((await database.prepare(sql).get()) as { n: unknown }).n);
  return {
    runs: await n("SELECT count(*) AS n FROM yi_runs"),
    jobs: await n("SELECT count(*) AS n FROM jobs"),
    spend: await n("SELECT count(*) AS n FROM yi_calls"),
  };
}
async function finish(id: string, status = "completed", input?: (i: Record<string, unknown>) => Record<string, unknown>) {
  if (input) {
    const row = (await database.prepare("SELECT input FROM yi_runs WHERE id=$1").get(id)) as { input: string };
    await database
      .prepare("UPDATE yi_runs SET input=$1 WHERE id=$2")
      .run(JSON.stringify(input(JSON.parse(row.input))), id);
  }
  await database
    .prepare("UPDATE yi_runs SET status=$1,stage='publish',updated_at=$2 WHERE id=$3")
    .run(status, "2026-09-20T10:00:00.000Z", id);
}
async function fresh() {
  await freshDatabase();
  const settings = teamDefaults();
  settings.sources.captionProvider = "none";
  settings.sources.standby = "none";
  settings.sources.asr = "off";
  await saveTeamPreferences(settings);
}
type Analysed = { id: string; reused: boolean; runId: string; analysedAt: string | null };

test("A completed run on the same identity is reused: no run, no job, no spend", async () => {
  await fresh();
  const first = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  assert.equal(first.reused, false);
  assert.equal(first.runId, first.id);
  await finish(first.id);
  const before = await counts();
  const again = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  assert.equal(again.reused, true);
  assert.equal(again.runId, first.id);
  assert.equal(again.id, first.id);
  assert.equal(again.analysedAt, "2026-09-20T10:00:00.000Z");
  assert.deepEqual(await counts(), before, "nothing was queued or reserved");
  assert.equal((await events("analysis_reused")).at(-1)?.entityId, first.id);
});

test("A completed run from an older pipeline version is never reused", async () => {
  await fresh();
  const old = await queue(VIDEO);
  await finish(old.id, "completed", (i) => ({ ...i, pipelineVersion: "research.v4.reasoning" }));
  const next = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  assert.equal(next.reused, false);
  assert.notEqual(next.id, old.id);
  const job = await database.prepare("SELECT id FROM jobs WHERE id=$1").get(`analyze:${next.id}`);
  assert.ok(job, "the new run was queued");
});

test("A failed or held run is not reused", async () => {
  for (const status of ["failed", "needs_review"]) {
    await fresh();
    const prior = await queue(VIDEO);
    await finish(prior.id, status);
    const next = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
    assert.equal(next.reused, false, status);
    assert.notEqual(next.id, prior.id, status);
  }
});

test("An open run keeps the existing dedupe: the same run comes back", async () => {
  await fresh();
  const open = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  const before = await counts();
  const again = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  assert.equal(again.id, open.id);
  assert.equal(again.reused, false);
  assert.deepEqual(await counts(), before);
});

test("A forced re-run queues a fresh paid run and records that it was asked for", async () => {
  await fresh();
  const first = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  await finish(first.id);
  const forced = (await dispatch("runs", "analyse", { url: URL, force: true })) as Analysed;
  assert.equal(forced.reused, false);
  assert.notEqual(forced.id, first.id);
  const row = (await database.prepare("SELECT input FROM yi_runs WHERE id=$1").get(forced.id)) as { input: string };
  assert.deepEqual(JSON.parse(row.input).rerun, { requested: true, previousRunId: first.id });
  const requested = (await events<{ previousRunId: string }>("rerun_requested")).at(-1);
  assert.equal(requested?.entityId, forced.id);
  assert.equal(requested?.payload.previousRunId, first.id);
  // A second click while the forced run is still open is the same run.
  const twice = (await dispatch("runs", "analyse", { url: URL, force: true })) as Analysed;
  assert.equal(twice.id, forced.id);
  // The forced run has the same identity, so once it completes it is reused.
  await finish(forced.id);
  const reused = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  assert.equal(reused.reused, true);
  assert.equal(reused.id, forced.id);
});

test("Only the canonical run is a reuse candidate: a publication's choice wins", async () => {
  await fresh();
  const chosen = await queue(VIDEO);
  await finish(chosen.id, "completed", (i) => ({ ...i, pipelineVersion: "research.v4.reasoning" }));
  // A newer completed run on today's identity that the team did not publish.
  const newer = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  await finish(newer.id);
  await put("publication", VIDEO, { videoId: VIDEO, runId: chosen.id, at: "2026-09-21T00:00:00.000Z" });
  const next = (await dispatch("runs", "analyse", { url: URL })) as Analysed;
  assert.equal(next.reused, false, "the published run is on an older pipeline");
  // An experimental completed run is never a candidate either.
  await fresh();
  const experiment = await queue(VIDEO);
  await finish(experiment.id, "completed", (i) => ({ ...i, experiment: true }));
  assert.equal(((await dispatch("runs", "analyse", { url: URL })) as Analysed).reused, false);
});

test("The decision is a pure function of the candidate, the identity and force", () => {
  const identity = runIdentity({
    model: "m",
    promptVersion: "p",
    input: { criticModel: "c", transcriptionModel: "t", pipelineVersion: "v5", transcriptionWindowSeconds: 0 },
  });
  const done = { id: "r1", status: "completed", identity, completedAt: "2026-09-20T10:00:00.000Z" };
  assert.deepEqual(reuseDecision({ candidate: done, identity, force: false }), {
    reuse: true,
    runId: "r1",
    analysedAt: "2026-09-20T10:00:00.000Z",
  });
  assert.deepEqual(reuseDecision({ candidate: done, identity, force: true }), { reuse: false, reason: "forced" });
  assert.deepEqual(reuseDecision({ candidate: null, identity, force: false }), { reuse: false, reason: "no-analysis" });
  assert.deepEqual(
    reuseDecision({ candidate: { ...done, status: "failed" }, identity, force: false }),
    { reuse: false, reason: "not-completed" },
  );
  for (const change of [
    { pipelineVersion: "v4" },
    { criticModel: "other" },
    { transcriptionModel: "other" },
    { promptVersion: "p2" },
    { model: "m2" },
    { transcriptionWindowSeconds: 600 },
  ]) {
    const other = { ...identity, ...change };
    assert.equal(sameIdentity(identity, other), false, JSON.stringify(change));
    assert.deepEqual(reuseDecision({ candidate: done, identity: other, force: false }), {
      reuse: false,
      reason: "different-pipeline",
    });
  }
  // A run that never recorded a pipeline version is older than any that did.
  const legacy = runIdentity({ model: "m", promptVersion: "p", input: {} });
  assert.equal(sameIdentity(legacy, identity), false);
  assert.equal(sameIdentity(legacy, { ...legacy }), false, "an unrecorded pipeline never matches");
});

test("The analyse input is validated", async () => {
  await fresh();
  await assert.rejects(() => dispatch("runs", "analyse", { url: URL, force: "yes" }));
  await assert.rejects(() => dispatch("runs", "analyse", { url: URL, extra: 1 }));
  await assert.rejects(() => analyseVideo("not a video id", {}));
});
