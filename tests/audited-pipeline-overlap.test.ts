import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/db.ts';
import {create} from '../src/server/youtube-intelligence/store.ts';
import {step} from '../src/server/youtube-intelligence/pipeline.ts';
import {prompt} from '../src/server/youtube-intelligence/research-store.ts';
import {teamDefaults} from '../src/features/youtube-intelligence/settings.ts';
import {AuditedExecutionPlan} from '../src/features/youtube-intelligence/audited-execution.ts';
import {Source} from '../src/features/youtube-intelligence/contracts.ts';
import {FakeModelTransport} from '../src/server/youtube-intelligence/transport/fake.ts';
import {injectTransport} from '../src/server/youtube-intelligence/transport/index.ts';
test('discovery overlaps independent critique, remains pending, and paid discovery replays at the barrier',async()=>{
 const db=await freshDatabase();let active=0,peak=0;
 const delayed=(value:unknown)=>async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,20));active--;return {json:value,usage:{costUsd:.001}};};
 const fake=new FakeModelTransport({responses:{critique:delayed({verdicts:[{id:'k1',verdict:'accept',reason_en:'Supported.'}]}),'synthesis-recall-0':delayed({claims:[],key_points:[],mentions:[]})}});const restore=injectTransport(fake);
 try{
  const team=teamDefaults();const run=await create('overlap',team.models.extraction.id,{teamPreferencesSnapshot:team,promptSnapshot:await prompt('evidence-first.web.v8'),auditedExecutionPlan:AuditedExecutionPlan.parse({version:'audited-speed.v1'})},'evidence-first.web.v8');
  run.stage='critique';run.output={source:Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Rates stay high if inflation persists.',start_seconds:0,end_seconds:5}]}),claims:[],keyPoints:[{id:'k1',passed:true,reasons:[],claim:{thesis_en:'Rates stay high if inflation persists.',instrument_as_spoken:null,ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:['Inflation persists'],creator_conviction:'unspecified',risks_en:[],levels:[],evidence:[{segment_id:'a',quote_original:'Rates stay high if inflation persists.',quote_translation_en:'Rates stay high if inflation persists.'}]}}],mentions:[]};
  let revision=0;await step(run,team,{checkpointCheckedFindings:async()=>{revision=Number(run.output.checkedFindingsRevision);}});
  assert.equal(peak,2);assert.equal(run.stage,'publish');assert.equal(revision,1);
  const recall=fake.requests.find(r=>r.stage==='synthesis-recall-0')!;assert.match(recall.user[0].text,/"accepted":false/);
  assert.equal((run.output.keyPoints as {audit?:unknown}[])[0].audit!==undefined,true);
  const calls=fake.requests.length;await step(run,team);assert.equal(fake.requests.length,calls,'already received recall must replay without another bill');
 }finally{restore();await db.close();}
});
