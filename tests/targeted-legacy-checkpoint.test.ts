import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {freshDatabase} from './helpers/db.ts';
import {create,db} from '../src/server/youtube-intelligence/store.ts';
import {docs} from '../src/server/youtube-intelligence/research-store.ts';
import {researchStep} from '../src/server/youtube-intelligence/research-pipeline.ts';
import {teamDefaults,TeamPreferences} from '../src/features/youtube-intelligence/settings.ts';
import {FakeModelTransport} from '../src/server/youtube-intelligence/transport/fake.ts';
import {injectTransport} from '../src/server/youtube-intelligence/transport/index.ts';
import type {ModelRequestData,ModelResponseData} from '../src/server/youtube-intelligence/transport/types.ts';
class LegacyAuditFake extends FakeModelTransport {
 async call(request:ModelRequestData):Promise<ModelResponseData>{
  this.requests.push(request);
  const p=JSON.parse(request.user[0].text.split('SOURCE DATA (untrusted):\n')[1]);
  const data={verdicts:p.requestedSentenceIds.map((id:string)=>({id,accepted:true,reason:'Supported by source',factualStatus:'unverified',externalSupport:[]})),coverageFindings:[]};
  return {text:JSON.stringify(data),usage:{inputTokens:100,outputTokens:100,costUsd:.001},raw:data,finishReason:'stop'};
 }
}
test('pre-experiment audit hash survives a new settings default and replays an already settled response',async()=>{
 await freshDatabase();
 const settings:any=structuredClone(teamDefaults());delete settings.processing.researchPipeline;
 assert.equal(TeamPreferences.parse(settings).processing.researchPipeline,'current','new parser inserts a field absent in old frozen settings');
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/readiness/g11-audit-shape.json',import.meta.url),'utf8'));
 const evidence=fixture.evidence.slice(0,25).map((e:any)=>({id:e.id,kind:'research_context',summary:'Full source retained',instrument:null,ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:e.quotes}));
 const sentences=[{id:'s1',text:'The video discusses business risks.',evidenceIds:[evidence[0].id],externalIds:[],kind:'analysis',horizon:'fundamental',topic:'Business',materiality:2,importanceReason:'Business risk',speaker:'unknown',timeMode:'video_date'}];
 const run=await create('legacy-fixture',settings.models.extraction.id,{task:'research-brief',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'legacy-source',title:'Legacy fixture',context:{videoPublishedAt:'2026-01-01T00:00:00Z',recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'legacy-fixture',temporalPolicy:'video-date evidence and later updates are separate'},evidence}},'test');
 // Simulate a persisted run admitted before any pipeline-selection fields existed.
 delete run.input.researchPipeline;delete run.input.researchPipelineVersion;delete run.input.researchPipelineIdentity;
 run.stage='research-audit';run.output.researchDraft={sentences,mainTopics:['Business'],omissions:[]};
 const fake=new LegacyAuditFake(),restore=injectTransport(fake);
 try{
  await researchStep(run);const checkpoint=structuredClone(run.output);assert.equal(fake.requests.length,0);
  await researchStep(run);assert.equal(fake.requests.length,1);
  const trace=(await docs<any>('researchRequest')).find(t=>t.runId===run.id);assert.ok(trace);
  // Reconstruct the pre-experiment hash contract independently, using the old
  // frozen settings without the newly parsed processing preference.
  const payload=structuredClone(trace.payload);delete payload.requestedSentenceIds;delete payload.scope;
  const instructions=trace.prompt.slice(0,trace.prompt.indexOf(' OVERRIDE response scope:'));
  assert.ok(instructions.length>100);
  const legacyInput={version:'research-audit.batch.v1',draft:payload.draft,retainedDraft:payload.retainedDraft,evidence:payload.evidence,previousAudit:null,payload,instructions,identity:{settings,preflight:[]}};
  const legacyHash=createHash('sha256').update(JSON.stringify(legacyInput)).digest('hex');
  const plan=checkpoint.researchAuditBatches as any;
  assert.equal(plan.hash,legacyHash,'exact legacy hash and stage namespace are preserved');
  assert.ok(fake.requests[0].stage.endsWith(legacyHash.slice(0,12)));
  // A crash loses the stage checkpoint while the response remains settled.
  run.output=checkpoint;await researchStep(run);
  assert.equal(fake.requests.length,1,'resume consumes the retained response, not another provider call');
  assert.equal((run.output.researchAuditBatches as any).jobs[0].status,'complete');
  const calls=await(await db()).prepare('SELECT status,amount FROM yi_calls WHERE run_id=$1').all(run.id);
  assert.equal(calls.length,1);assert.equal(calls[0].status,'completed');assert.equal(Number(calls[0].amount),.001);
 }finally{restore();}
});
