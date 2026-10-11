import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/db.ts';
import {create,reserve,settle,markUnknown} from '../src/server/youtube-intelligence/store.ts';
import {teamDefaults} from '../src/features/youtube-intelligence/settings.ts';
import {saveTeamPreferences,runTeamPreferences} from '../src/server/youtube-intelligence/research-store.ts';
import {ensureResearchBrief} from '../src/server/youtube-intelligence/research-pipeline.ts';
import {modelCall} from '../src/server/youtube-intelligence/pipeline.ts';
import {FakeModelTransport} from '../src/server/youtube-intelligence/transport/fake.ts';
import {injectTransport} from '../src/server/youtube-intelligence/transport/index.ts';
test('benchmark campaign limits aggregate roots, children and unknown holds under concurrent admission',async()=>{
 const db=await freshDatabase();try{
  const marker={id:crypto.randomUUID(),maxUsd:1};
  const runs=await Promise.all(Array.from({length:4},(_,i)=>create(`benchmark-${i}`,'fixture',{nonce:crypto.randomUUID(),benchmarkCampaign:marker},'v1')));
  const results=await Promise.allSettled(runs.map(r=>reserve(r.id,'critique',.6)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(String((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/campaign.*limit/i);
  const paid=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value;
  await markUnknown(paid,'Outcome unclear');await assert.rejects(reserve(runs.at(-1)!.id,'coverage',.5),/campaign.*limit/i);
  await settle(paid,.1,{});await reserve(runs.at(-1)!.id,'coverage',.5);
  const outside=await create('outside-campaign','fixture',{nonce:crypto.randomUUID()},'v1');await reserve(outside.id,'critique',.6);
 }finally{await db.close();}
});

test('campaign children inherit frozen controls without loosening their per-run budget',async()=>{
 const db=await freshDatabase();const fake=new FakeModelTransport();const restore=injectTransport(fake);
 try{
  const team=teamDefaults();team.processing.auditedSpeed=true;team.budget.perVideoMaxUsd=.000001;
  const marker={id:crypto.randomUUID(),maxUsd:5};
  const root=await create('benchmark-frozen-child',team.models.extraction.id,{teamPreferencesSnapshot:team,benchmarkCampaign:marker},team.prompts.version);
  root.output={keyPoints:[{id:'k1',passed:true,reasons:[],trust:'L1',claim:{thesis_en:'The creator holds shares.',instrument_as_spoken:'Company',evidence:[{segment_id:'a',quote_original:'The creator holds shares.'}]}}]};
  const changed=structuredClone(team);changed.budget.perVideoMaxUsd=5;changed.processing.auditedSpeed=false;await saveTeamPreferences(changed);
  const child=await ensureResearchBrief(root);assert.ok(child);
  assert.deepEqual(child.input.benchmarkCampaign,marker);
  assert.deepEqual(child.input.auditedExecutionPlan,root.input.auditedExecutionPlan);
  assert.equal(child.input.publicationSafeguardsVersion,'atomic-publication.v1');
  assert.equal((await runTeamPreferences(child)).budget.perVideoMaxUsd,team.budget.perVideoMaxUsd);
  for(const run of [root,child])await assert.rejects(modelCall(run,'synthesis',run.model,'Fixture',{},false,{maxOutputTokens:10}),/per.video.*limit/i);
  assert.equal(fake.requests.length,0,'campaign admission must not bypass a stricter frozen per-run cap');
 }finally{restore();await db.close();}
});
