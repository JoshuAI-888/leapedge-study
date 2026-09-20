import test from "node:test";
import assert from "node:assert/strict";
import { freezeEfficiency } from "../src/server/youtube-intelligence/efficiency.ts";
test("rollout defaults off and explicit frozen run flags survive later profiles", () => {
  const input = { origin: "manual" };
  assert.deepEqual(freezeEfficiency(input, {}), input);
  const frozen = freezeEfficiency(input, {YTI_EFFICIENCY_PROFILE:"conservative"});
  assert.equal(frozen.speculativeResearch, false);
  assert.equal(frozen.reuseResearchCache, true);
  assert.deepEqual(freezeEfficiency(frozen, {YTI_EFFICIENCY_PROFILE:"experimental-overlap"}), frozen);
  assert.deepEqual(freezeEfficiency({task:"research-brief"}, {YTI_EFFICIENCY_PROFILE:"experimental-overlap"}), {task:"research-brief"});
  assert.throws(() => freezeEfficiency(input, {YTI_EFFICIENCY_PROFILE:"typo"}));
});

test('workspace profile overrides deployment default and freezes new-run flags', () => {
  const env = { YTI_EFFICIENCY_PROFILE: 'experimental-overlap' };
  const withProfile = (efficiencyProfile: string) => ({ teamPreferencesSnapshot: { processing: { efficiencyProfile } } });
  const standard = freezeEfficiency(withProfile('off'), env);
  assert.equal(standard.speculativeResearch, false);
  assert.equal(standard.reuseResearchCache, false);
  assert.equal(standard.efficiencyVersion, null);
  const efficient = freezeEfficiency(withProfile('conservative'), env);
  assert.equal(efficient.speculativeResearch, false);
  assert.equal(efficient.reuseResearchCache, true);
  assert.equal(efficient.efficiencyVersion, 'evidence-efficiency.v1');
  const inherited = freezeEfficiency(withProfile('deployment-default'), env);
  assert.equal(inherited.speculativeResearch, true);
  assert.deepEqual(freezeEfficiency(standard, env), standard);
  assert.throws(() => freezeEfficiency(withProfile('invalid'), env));
});

test('saved workspace profile is used for manual runs without a prebuilt settings snapshot', async () => {
  const { freshDatabase } = await import('./helpers/db.ts');
  const { create } = await import('../src/server/youtube-intelligence/store.ts');
  const { teamDefaults } = await import('../src/features/youtube-intelligence/settings.ts');
  const { saveTeamPreferences } = await import('../src/server/youtube-intelligence/research-store.ts');
  const db = await freshDatabase();
  try {
    const team = teamDefaults();
    team.processing.efficiencyProfile = 'experimental-overlap';
    await saveTeamPreferences(team);
    const first = await create('profile-first', 'fixture', {}, 'fixture');
    assert.equal(first.input.speculativeResearch, true);
    team.processing.efficiencyProfile = 'off'; await saveTeamPreferences(team);
    const second = await create('profile-second', 'fixture', {}, 'fixture');
    assert.equal(second.input.speculativeResearch, false);
    assert.equal(first.input.speculativeResearch, true, 'already admitted input is immutable');
  } finally { await db.close(); }
});

test('Standard remains disabled after JSON persistence and explicit re-admission under a new default', () => {
  const frozen = freezeEfficiency({}, {}, 'off');
  const persisted = JSON.parse(JSON.stringify(frozen));
  const readmitted = freezeEfficiency(persisted, {YTI_EFFICIENCY_PROFILE:'experimental-overlap'});
  assert.equal(readmitted.efficiencyVersion, null);
  assert.equal(readmitted.speculativeResearch, false);
  assert.equal(readmitted.reuseResearchCache, false);
});
