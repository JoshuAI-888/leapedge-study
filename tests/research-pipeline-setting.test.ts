import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamPreferences, teamDefaults, configHash } from "../src/features/youtube-intelligence/settings.ts";

test("new and legacy preferences retain the current audit path by default", () => {
  assert.equal(teamDefaults().processing.researchPipeline, "current");
  assert.equal(TeamPreferences.parse({ processing: { contextCaching: false } }).processing.researchPipeline, "current");
});

test("experimental pipeline selection survives parsing independently of efficiency profile", () => {
  const current = teamDefaults();
  const experimental = TeamPreferences.parse({ ...current, processing: { ...current.processing, researchPipeline: "targeted-experimental" } });
  assert.equal(experimental.processing.researchPipeline, "targeted-experimental");
  assert.equal(experimental.processing.efficiencyProfile, current.processing.efficiencyProfile);
  assert.notEqual(configHash(experimental), configHash(current));
  assert.equal(TeamPreferences.safeParse({ processing: { researchPipeline: "fast" } }).success, false);
  assert.equal(teamDefaults().processing.researchPipeline, "current");
});

test("frozen pipeline identity rejects unknown versions and keeps legacy explicit", async () => {
  const { ResearchPipelineIdentity, researchPipelineIdentity } = await import("../src/features/youtube-intelligence/research-pipeline-choice.ts");
  assert.deepEqual(researchPipelineIdentity(), { pipeline: "current", version: "current-v1" });
  assert.deepEqual(researchPipelineIdentity("targeted-experimental"), { pipeline: "targeted-experimental", version: "targeted-experimental-v1" });
  assert.equal(ResearchPipelineIdentity.safeParse({ pipeline: "targeted-experimental", version: "current-v1" }).success, false);
  assert.throws(() => researchPipelineIdentity("fast"));
});

test("run display never treats malformed retained identity as the current workspace selection", async () => {
  const { researchPipelineLabel } = await import("../src/features/youtube-intelligence/research-pipeline-choice.ts");
  assert.match(researchPipelineLabel(undefined), /legacy run/);
  assert.match(researchPipelineLabel({ pipeline: "targeted-experimental", version: "targeted-experimental-v1" }), /Experimental.*targeted-experimental-v1/);
  assert.match(researchPipelineLabel({ pipeline: "targeted-experimental", version: "unknown" }), /unavailable/);
});

test("frozen input resolution respects snapshots and fails closed for invalid explicit identities", async () => {
  const { researchPipelineIdentityFromInput } = await import("../src/features/youtube-intelligence/research-pipeline-choice.ts");
  assert.equal(researchPipelineIdentityFromInput({}).pipeline, "current");
  assert.equal(researchPipelineIdentityFromInput({ teamPreferencesSnapshot: { processing: { researchPipeline: "targeted-experimental" } } }).pipeline, "targeted-experimental");
  assert.throws(() => researchPipelineIdentityFromInput({ researchPipelineIdentity: { pipeline: "targeted-experimental", version: "current-v1" } }));
  assert.throws(() => researchPipelineIdentityFromInput({ teamPreferencesSnapshot: { processing: { researchPipeline: "fast" } } }));
});

test("flat admission identity is strict and cannot disagree with nested identity", async () => {
  const { researchPipelineIdentityFromInput } = await import("../src/features/youtube-intelligence/research-pipeline-choice.ts");
  assert.equal(researchPipelineIdentityFromInput({ researchPipeline: "targeted-experimental", researchPipelineVersion: "targeted-experimental-v1" }).pipeline, "targeted-experimental");
  assert.throws(() => researchPipelineIdentityFromInput({ researchPipeline: "targeted-experimental" }));
  assert.throws(() => researchPipelineIdentityFromInput({ researchPipeline: "targeted-experimental", researchPipelineVersion: "targeted-experimental-v1", researchPipelineIdentity: { pipeline: "current", version: "current-v1" } }));
});

test("workspace pipeline choice persists on reload and team reset restores current", async () => {
  const { freshDatabase } = await import("./helpers/db.ts");
  await freshDatabase();
  const R = await import("../src/server/youtube-intelligence/research-store.ts");
  const defaults = await R.teamPreferences();
  await R.saveTeamPreferences({ ...defaults, processing: { ...defaults.processing, researchPipeline: "targeted-experimental" } });
  assert.equal((await R.teamPreferences()).processing.researchPipeline, "targeted-experimental");
  assert.equal((await R.teamPreferences()).processing.efficiencyProfile, defaults.processing.efficiencyProfile);
  await R.saveTeamPreferences(teamDefaults());
  assert.equal((await R.teamPreferences()).processing.researchPipeline, "current");
});

test("read presentation preserves unrecorded legacy identity and isolates malformed rows", async () => {
  const { researchPipelineIdentityForDisplay, researchPipelineLabel } = await import("../src/features/youtube-intelligence/research-pipeline-choice.ts");
  assert.equal(researchPipelineIdentityForDisplay({}), undefined);
  assert.equal(researchPipelineIdentityForDisplay({ teamPreferencesSnapshot: { processing: { researchPipeline: "current" } } }), undefined);
  assert.equal(researchPipelineIdentityForDisplay({ researchPipeline: "targeted-experimental", researchPipelineVersion: "unknown" }), null);
  assert.deepEqual(researchPipelineIdentityForDisplay({ researchPipeline: "targeted-experimental", researchPipelineVersion: "targeted-experimental-v1" }), { pipeline: "targeted-experimental", version: "targeted-experimental-v1" });
  assert.match(researchPipelineLabel(null), /unavailable/);
  assert.doesNotMatch(researchPipelineLabel(null), /Current|legacy/);
  assert.match(researchPipelineLabel(undefined), /legacy/);
});
