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
 const db=await freshDatabase();const settings=teamDefaults();const fake=new FakeModelTransport({responses:{'synthesis-recall-1':{json:{claims:[],key_points:[],mentions:[],reconciliation:{reviewedSourceIds:['b'],propositions:[{summary:'Closing credits',sourceIds:['b'],disposition:'not_material',exclusionBasis:'nonfinancial_filler',existingIds:[],candidateRefs:[],reason:'Closing credits contain no research information.'}],limitations:[]}},usage:{costUsd:.001}}}});const restore=injectTransport(fake);
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

test('descriptive macro data and policy forecasts cannot be excluded for lacking a trading stance',()=>{
 const source=Source.parse({source_kind:'imported_transcript',language:'zh',segments:[{id:'cpi',text:'美国8月CPI环比上涨0.4%',start_seconds:177,end_seconds:181},{id:'fed',text:'最新点阵图对应年内还要加息25个基点啊，明年的中位数也在4.1%左右。',start_seconds:230,end_seconds:237}]});
 const run={output:{source,claims:[],keyPoints:[]}} as unknown as Run;
 for(const [id,summary,reason] of [['cpi','Inflation data supports the inflation backdrop.','Descriptive macro economic release data without establishing an instrument stance.'],['fed','Fed policy projections show another25bps and around4.1%.','Standard macro commentary explaining Federal Reserve rate mechanics and expectations.']]){
  const p={summary,sourceIds:[id],disposition:'not_material',exclusionBasis:'nonfinancial_filler',existingIds:[],candidateRefs:[],reason};
  const review=assessRecallReconciliation({reviewedSourceIds:[id],propositions:[p],limitations:[]},source.segments.filter(s=>s.id===id),run,{claims:0,key_points:0,mentions:0});assert.equal(review.assessment,'incomplete');assert.match(review.warnings.join(' '),/exclusion|materiality/i);
 }
});

test('research key points retain reported rates and prices without inventing trade-level roles',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const point={thesis_en:'BOJ policy rate is1.25%; oil remains104 per barrel and a hypothetical bond yields5%.',instrument_as_spoken:null,ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:['Higher yields can compress valuations'],creator_conviction:'unspecified',risks_en:[],levels:[{kind:'entry',value_original:'1.25'},{kind:'resistance',value_original:'104'},{kind:'support',value_original:'100'},{kind:'entry',value_original:'5%'}],evidence_ranges:[{start_id:'a',end_id:'a'}]};
 const raw={claims:[],key_points:[point],mentions:[]};const original=JSON.stringify(raw);const fake=new FakeModelTransport({responses:{'synthesis-recall-0':{json:raw,usage:{costUsd:.001}}}});const restore=injectTransport(fake);
 try{
 const run=await create('context-levels',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';run.output={source:Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'The policy rate is1.25%, oil is104 per barrel above100, and suppose a bond yields5%.',start_seconds:0,end_seconds:8}]}),claims:[],keyPoints:[],mentions:[]};
 await step(run);const points=run.output.keyPoints as {passed:boolean;claim:{thesis_en:string;conditions_en:string[];levels:unknown[];evidence:{quote_original:string}[]}}[];assert.equal(points.length,1);assert.deepEqual(points[0].claim.levels,[]);assert.equal(points[0].claim.thesis_en,point.thesis_en);assert.deepEqual(points[0].claim.conditions_en,point.conditions_en);assert.match(points[0].claim.evidence[0].quote_original,/1.25%/);assert.equal(points[0].passed,false);assert.equal(JSON.stringify(raw),original);
 const diagnostics=run.output.contextLevelNormalizations as {original:{levels:unknown[]}}[];assert.equal(diagnostics[0].original.levels.length,4);assert.equal(run.stage,'critique');
 }finally{restore();await db.close();}
});

test('exclusions require explicit valid basis while key-point contract accepts omitted levels and preserves claims',async()=>{
 const {parsePointerExtraction,normalizeResearchContextLevels,RESEARCH_CONTEXT_POLICY}=await import('../src/server/youtube-intelligence/schemas/extraction.ts');
 const item={thesis_en:'Policy guidance affects discount rates.',instrument_as_spoken:null,ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:['Discount rate changes'],creator_conviction:'unspecified',risks_en:[],evidence_ranges:[{start_id:'a',end_id:'a'}]};
 const extraction=parsePointerExtraction({claims:[{...item,stance:'long',levels:[{kind:'entry',value_original:'100'}]}],key_points:[item],mentions:[]});assert.deepEqual(extraction.key_points[0].levels,[]);assert.equal(normalizeResearchContextLevels(extraction).extraction.claims[0].levels[0].kind,'entry');assert.match(RESEARCH_CONTEXT_POLICY,/claims, key_points and mentions/);assert.match(RESEARCH_CONTEXT_POLICY,/require NO trading stance/);
 const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Subscribe to the channel.',start_seconds:0,end_seconds:2}]});const run={output:{source,claims:[],keyPoints:[]}} as unknown as Run;const p={summary:'Subscription reminder',sourceIds:['a'],disposition:'not_material',existingIds:[],candidateRefs:[],reason:'Channel subscription administration.'};
 for(const exclusionBasis of [undefined,'standard_macro'])assert.equal(assessRecallReconciliation({reviewedSourceIds:['a'],propositions:[{...p,exclusionBasis}],limitations:[]},source.segments,run,{claims:0,key_points:0,mentions:0}).assessment,'incomplete');
 assert.equal(assessRecallReconciliation({reviewedSourceIds:['a'],propositions:[{...p,exclusionBasis:'channel_administration'}],limitations:[]},source.segments,run,{claims:0,key_points:0,mentions:0}).assessment,'accounted');
});

for(const alreadyChecked of [false,true])test(`legacy recall policy checkpoint remains incomplete without repeating paid work (checked=${alreadyChecked})`,async()=>{
 const db=await freshDatabase();const settings=teamDefaults();const fake=new FakeModelTransport({responses:{}});const restore=injectTransport(fake);
 try{
 const run=await create('old-recall-policy',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Standard macro data.',start_seconds:0,end_seconds:3}]});
 run.output={source,claims:[],keyPoints:[],mentions:[],recallPlanVersion:'source-recall.full-chronological.v1',recallPlan:[source.segments],recallIndex:1,recallChecked:alreadyChecked,recallCandidates:[{index:0,sourceIds:['a'],assessment:'accounted',addedIds:[]}],recallCoverage:{assessment:'accounted'}};
 await step(run);assert.equal(fake.requests.length,0);assert.equal((run.output.recallCoverage as {assessment:string}).assessment,'incomplete');assert.match(JSON.stringify(run.output.limitations),/policy.*legacy|legacy.*policy/i);
 }finally{restore();await db.close();}
});
for(const levels of [undefined,[{kind:'entry',value_original:'5%'}]])test(`legacy nonpointer research context accepts omitted levels and preserves any removed proposals (${levels?'populated':'omitted'})`,async()=>{
 const db=await freshDatabase();const settings=teamDefaults();const point={thesis_en:'A hypothetical bond yield illustrates valuation discounting.',instrument_as_spoken:null,ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:['Higher discount rate'],creator_conviction:'unspecified',risks_en:[],...(levels?{levels}:{}),evidence:[{segment_id:'a',quote_original:'Suppose a bond yields5%.',quote_translation_en:'Suppose a bond yields5%.'}]};const raw={claims:[],key_points:[point]};const original=JSON.stringify(raw);const fake=new FakeModelTransport({responses:{synthesis:{json:raw,usage:{costUsd:.001}}}});const restore=injectTransport(fake);
 try{
 const run=await create('legacy-context',settings.models.extraction.id,{promptSnapshot:{...(await prompt('evidence-first.web.v5')),pointerEvidence:false},teamPreferencesSnapshot:settings},'evidence-first.web.v5');run.stage='synthesis';run.output={source:Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Suppose a bond yields5%.',start_seconds:0,end_seconds:3}]}),metadata:{},claims:[],keyPoints:[],mentions:[]};
 await step(run);assert.deepEqual((run.output.keyPoints as {claim:{levels:unknown[]}}[])[0].claim.levels,[]);assert.equal(JSON.stringify(raw),original);assert.equal(fake.requests.length,1);assert.equal(run.stage,'critique');if(levels)assert.equal((run.output.contextLevelNormalizations as {original:{levels:unknown[]}}[])[0].original.levels.length,1);
 }finally{restore();await db.close();}
});

test('a new run requests every recall window concurrently in one step against one frozen inventory and applies them in order',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 let active=0,peak=0;
 const reply=(summary:string,id:string)=>async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,20));active--;return {json:{claims:[],key_points:[],mentions:[],reconciliation:{reviewedSourceIds:[id],propositions:[{summary,sourceIds:[id],disposition:'not_material',exclusionBasis:'nonfinancial_filler',existingIds:[],candidateRefs:[],reason:`${summary} contains no research information.`}],limitations:[]}},usage:{costUsd:.001}};};
 const fake=new FakeModelTransport({responses:{'synthesis-recall-0':reply('Greeting','a'),'synthesis-recall-1':reply('Sponsor read','b'),'synthesis-recall-2':reply('Closing credits','c')}});const restore=injectTransport(fake);
 try{
  const run=await create('parallel-recall',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';
  const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Hello everyone.',start_seconds:0,end_seconds:2},{id:'b',text:'This video is sponsored.',start_seconds:2,end_seconds:4},{id:'c',text:'Thanks for watching.',start_seconds:4,end_seconds:6}]});
  run.output={source,claims:[],keyPoints:[],mentions:[],recallPlanVersion:SOURCE_RECALL_VERSION,recallPlan:source.segments.map(s=>[s])};
  await step(run);
  assert.deepEqual(fake.requests.map(r=>r.stage).sort(),['synthesis-recall-0','synthesis-recall-1','synthesis-recall-2']);
  assert.equal(peak,3,'windows were requested concurrently');
  assert.equal(run.output.recallIndex,3,'all windows applied in one step');
  assert.deepEqual((run.output.recallCandidates as {index:number}[]).map(c=>c.index),[0,1,2]);
  const inventories=new Set(fake.requests.map(r=>JSON.stringify(r.user).match(/"existing":(\{.*?\}|\[.*?\])/)?.[0]));
  assert.equal(inventories.size,1,'every window reviewed the same frozen inventory');
  assert.equal(run.output.recallChecked,true);
 }finally{restore();await db.close();}
});
