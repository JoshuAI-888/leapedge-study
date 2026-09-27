import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/db.ts';
import {create, get} from '../src/server/youtube-intelligence/store.ts';
import {saveTeamPreferences} from '../src/server/youtube-intelligence/research-store.ts';
import {teamDefaults} from '../src/features/youtube-intelligence/settings.ts';
import {dispatch} from '../src/server/youtube-intelligence/actions/index.ts';

test('admission freezes the research pipeline and switching preferences cannot alter queued runs', async () => {
 const db = await freshDatabase();
 try {
  const team = teamDefaults();
  await saveTeamPreferences(team);
  const original = await create('pipeline-first', 'fixture', {}, 'fixture');
  assert.equal(original.input.researchPipeline, 'current');
  assert.equal(original.input.researchPipelineVersion, 'current-v1');
  team.processing.researchPipeline = 'targeted-experimental';
  await saveTeamPreferences(team);
  const candidate = await create('pipeline-second', 'fixture', {}, 'fixture');
  assert.equal(candidate.input.researchPipeline, 'targeted-experimental');
  assert.equal(candidate.input.researchPipelineVersion, 'targeted-experimental-v1');
  const child = await create('pipeline-child', 'fixture', {task:'research-brief',snapshot:{sourceRunId:original.id},researchPipeline:'targeted-experimental'}, 'fixture');
  const overview = await dispatch('research','snapshot',undefined) as {jobs:{id:string,researchPipelineIdentity?:{pipeline:string,version:string}}[]};
  assert.deepEqual(overview.jobs.find(job=>job.id===child.id)?.researchPipelineIdentity,{pipeline:'targeted-experimental',version:'targeted-experimental-v1'});
  assert.equal((await get(original.id))!.input.researchPipeline, 'current');
  const resumed = await create('pipeline-first', 'fixture', original.input, 'fixture');
  assert.equal(resumed.id, original.id);
  const historicalSnapshot = await create('pipeline-snapshot', 'fixture', {teamPreferencesSnapshot:{processing:{}}}, 'fixture');
  assert.equal(historicalSnapshot.input.researchPipeline, 'current', 'old snapshots never inherit a new experimental default');
  await assert.rejects(create('pipeline-invalid', 'fixture', {researchPipeline:'invalid'}, 'fixture'));
  await assert.rejects(create('pipeline-version', 'fixture', {researchPipeline:'current',researchPipelineVersion:'targeted-experimental-v1'}, 'fixture'));
 } finally {await db.close();}
});
