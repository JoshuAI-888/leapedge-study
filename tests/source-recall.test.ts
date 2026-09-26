import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/db.ts';
import {create} from '../src/server/youtube-intelligence/store.ts';
import {step} from '../src/server/youtube-intelligence/pipeline.ts';
import {prompt} from '../src/server/youtube-intelligence/research-store.ts';
import {teamDefaults} from '../src/features/youtube-intelligence/settings.ts';
import {Source} from '../src/features/youtube-intelligence/contracts.ts';
import {FakeModelTransport} from '../src/server/youtube-intelligence/transport/fake.ts';
import {injectTransport} from '../src/server/youtube-intelligence/transport/index.ts';

test('whole-source recall includes numerical policy facts without action keywords despite accepted broad macro context',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();const fake=new FakeModelTransport({responses:{'synthesis-recall-0':{json:{claims:[],key_points:[],mentions:[]},usage:{costUsd:.001}}}});const restore=injectTransport(fake);
 try{
  const run=await create('policy-recall',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';
  run.output={source:Source.parse({source_kind:'imported_transcript',language:'zh',segments:[{id:'a',text:'能源压力使利率持续高企。',start_seconds:200,end_seconds:204},{id:'b',text:'美联储已经加息了25个基点，啊值得注意的是后面的利率预期啊，',start_seconds:225.76,end_seconds:230.12},{id:'c',text:'最新点阵图对应年内还要加息25个基点啊，',start_seconds:230.4,end_seconds:233.94},{id:'d',text:'明年的中位数也在4.1%左右。',start_seconds:234.34,end_seconds:236.78}]}),claims:[],keyPoints:[{id:'k1',passed:true,reasons:[],audit:{verdict:'accept'},claim:{thesis_en:'Energy pressure keeps interest rates elevated.',instrument_as_spoken:null,ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:['Energy pressure persists'],creator_conviction:'low',risks_en:['Higher rates'],levels:[],evidence:[{segment_id:'a',end_segment_id:'a',quote_original:'能源压力使利率持续高企。',quote_translation_en:'Energy pressure keeps rates high.'}]}}],mentions:[]};
  await step(run);assert.equal(fake.requests.length,1,'General chronological recall must inspect policy facts without action regex');
  const request=JSON.stringify(fake.requests[0]);assert.match(request,/4.1%/);assert.match(request,/Energy pressure persists/);assert.match(request,/Higher rates/);assert.match(request,/quote_original/);
  assert.equal((run.output.recallCoverage as {assessment:string}).assessment,'incomplete','An empty answer without proposition accounting is not a completeness pass');
 }finally{restore();await db.close();}
});

import {sourceRecallPlan,assessRecallReconciliation,SOURCE_RECALL_VERSION} from '../src/features/youtube-intelligence/source-recall.ts';
import type {Run} from '../src/features/youtube-intelligence/contracts.ts';

test('full chronological recall accounts for every unchanged cue with bounded windows and no cumulative truncation',()=>{
 const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:Array.from({length:501},(_,i)=>({id:`s${i}`,text:`Ordinary factual information ${i}.`,start_seconds:i*7,end_seconds:i*7+7}))});
 const before=JSON.stringify(source);const windows=sourceRecallPlan(source);const ids=new Set(windows.flatMap(w=>w.map(s=>s.id)));
 assert.equal(ids.size,501);assert.ok(windows.length>10);assert.equal(windows[0][0].id,'s0');assert.equal(windows.at(-1)?.at(-1)?.id,'s500');assert.ok(windows.every(w=>w.length<=40&&w.at(-1)!.end_seconds!-w[0].start_seconds!<=180));assert.equal(JSON.stringify(source),before);
 assert.throws(()=>sourceRecallPlan({...source,segments:[{...source.segments[0],text:'x'.repeat(13000)}]}),/exceeds.*bound/);
});
test('proposition accounting rejects broad-theme substitution, rejected IDs and omitted cue dispositions',()=>{
 const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Rates remain elevated.',start_seconds:0,end_seconds:2},{id:'b',text:'The bank raised rates25bps and projects4.1%.',start_seconds:3,end_seconds:5}]});
 const run={output:{source,claims:[],keyPoints:[{id:'k1',passed:true,reasons:[],claim:{evidence:[{segment_id:'a'}]}}]}} as unknown as Run;
 const review={reviewedSourceIds:['a','b'],propositions:[{summary:'Rates remain elevated.',sourceIds:['a','b'],disposition:'already_retained',existingIds:['k1'],candidateRefs:[],reason:'The broad theme matches.'}],limitations:[]};
 assert.match(assessRecallReconciliation(review,source.segments,run,{claims:0,key_points:0,mentions:0}).warnings.join(' '),/specific proposition/);
 const added={...review,propositions:[{...review.propositions[0],sourceIds:['a']},{summary:'Specific rate action and forecast',sourceIds:['b'],disposition:'added',existingIds:[],candidateRefs:[{bucket:'key_points',index:0}],reason:'Specific numbers missing from accepted broad rate context.'}]};
 assert.equal(assessRecallReconciliation(added,source.segments,run,{claims:0,key_points:1,mentions:0}).assessment,'accounted');
 assert.equal(assessRecallReconciliation({...added,propositions:added.propositions.slice(0,1)},source.segments,run,{claims:0,key_points:1,mentions:0}).assessment,'incomplete');
 assert.equal(assessRecallReconciliation(added,source.segments,run,{claims:0,key_points:0,mentions:0}).assessment,'incomplete');
});

test('retained recall checkpoint resumes original window plan without selecting or paying again for processed windows',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();const fake=new FakeModelTransport({responses:{'synthesis-recall-1':{json:{claims:[],key_points:[],mentions:[],reconciliation:{reviewedSourceIds:['b'],propositions:[{summary:'Closing credits',sourceIds:['b'],disposition:'not_material',existingIds:[],candidateRefs:[],reason:'Closing credits contain no research information.'}],limitations:[]}},usage:{costUsd:.001}}}});const restore=injectTransport(fake);
 try{
 const run=await create('recall-resume',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';
 const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Opening credits',start_seconds:0,end_seconds:2},{id:'b',text:'Closing credits',start_seconds:200,end_seconds:202}]});
 run.output={source,claims:[],keyPoints:[],mentions:[],recallPlanVersion:SOURCE_RECALL_VERSION,recallPlan:source.segments.map(s=>[s]),recallIndex:1,recallCandidates:[{index:0,sourceIds:['a'],assessment:'accounted',warnings:[],addedIds:[]}]};
 const plan=JSON.stringify(run.output.recallPlan);await step(run);assert.equal(fake.requests.length,1);assert.equal(fake.requests[0].stage,'synthesis-recall-1');assert.equal(JSON.stringify(run.output.recallPlan),plan);assert.equal((run.output.recallCoverage as {assessment:string}).assessment,'accounted');assert.equal((run.output.recallCoverage as {semanticCompleteness:string}).semanticCompleteness,'not_established');
 }finally{restore();await db.close();}
});

test('reconciliation cannot count an addition discarded by reference normalization as accounted coverage',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const fake=new FakeModelTransport({responses:{'synthesis-recall-0':{json:{claims:[],key_points:[{thesis_en:'A policy forecast.',instrument_as_spoken:null,ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:[],creator_conviction:'low',risks_en:[],levels:[],evidence_ranges:[{start_id:'missing',end_id:'missing'}]}],mentions:[],reconciliation:{reviewedSourceIds:['a'],propositions:[{summary:'Policy forecast',sourceIds:['a'],disposition:'added',existingIds:[],candidateRefs:[{bucket:'key_points',index:0}],reason:'This forecast is absent from inventory.'}],limitations:[]}},usage:{costUsd:.001}}}});const restore=injectTransport(fake);
 try{
 const run=await create('recall-normalization',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';run.output={source:Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'The policy forecast is 4.1%.',start_seconds:0,end_seconds:3}]}),claims:[],keyPoints:[],mentions:[]};
 await step(run);assert.equal((run.output.recallCoverage as {assessment:string}).assessment,'incomplete');assert.match(JSON.stringify(run.output.recallCandidates),/not retained as a structurally valid candidate/);assert.equal((run.output.keyPoints as unknown[]).length,0);assert.equal(fake.requests.length,1);
 }finally{restore();await db.close();}
});
