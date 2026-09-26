/** Opt-in isolated Postgres acceptance. Fake transport only; all fetch is blocked. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseArgs,parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {main} from './run-cohort-durable.mjs';
import {FakeModelTransport} from '../src/server/youtube-intelligence/transport/fake.ts';
import {injectTransport} from '../src/server/youtube-intelligence/transport/index.ts';
import {teamDefaults} from '../src/features/youtube-intelligence/settings.ts';
import {Source} from '../src/features/youtube-intelligence/contracts.ts';
const {values}=parseArgs({options:{'runtime-env':{type:'string'},output:{type:'string'}}});
if(!values['runtime-env']||!values.output)throw Error('Requires --runtime-env known-local.env --output NEW-directory; no paid requests.');
const out=resolve(values.output);mkdirSync(out,{recursive:false});
const env=parseEnv(readFileSync(values['runtime-env'],'utf8'));const url=new URL(env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||!['/yti_live','/yti_perf_readiness_ui'].includes(url.pathname))throw Error('Known local cluster only');
// Reuse only the local cluster credentials; main never opens this template DB.
url.pathname='/yti_live';
const fixtureEnv=out+'/fixture.env';writeFileSync(fixtureEnv,'DATABASE_URL='+url.href+'\n',{mode:0o600});
const previousFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Network forbidden in durable fixture');};
const settings=teamDefaults();settings.sources.asrPolicy='when-captions-missing';settings.processing.maxRetriesPerStage=0;
const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'s1',text:'I hold Company shares.',start_seconds:0,end_seconds:5}]});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
const frozen={runs:[{id:'frozen-fixture',videoId:'fixturedur1',model:settings.models.extraction.id,promptVersion:'fixture.durable.v1',title:'Durable fixture',createdAt:'2026-01-03T00:00:00Z',input:{teamPreferencesSnapshot:settings,recoveryOf:'must-remove',recoveryBatch:'must-remove',productionSample:'must-remove',promptSnapshot:{id:'fixture.durable.v1',rationale:'Durable runner fixture only',transcribe:'Transcribe source content exactly.',extraction:'Extract source content with ranges.',synthesis:'Synthesize only retained source content.',critique:'Audit all original source claims.',pointerEvidence:true,temporalResearch:true}},output:{source,metadata:{publishedAt:'2026-01-01T00:00:00Z',language:'en',duration:5}}}],manifest:{cases:[{videoId:'fixturedur1',sourceSha256:createHash('sha256').update(JSON.stringify(stable(source))).digest('hex')}]}};
const input=out+'/input.json';writeFileSync(input,JSON.stringify(frozen),{mode:0o600});
const claim={thesis_en:'The creator holds Company shares.',instrument_as_spoken:'Company',ticker:null,ticker_explicit:false,stance:'hold',horizon_en:null,conditions_en:[],risks_en:[],levels:[],creator_conviction:'unspecified',evidence_ranges:[{start_id:'s1',end_id:'s1'}]};
const scenarios=['admission','paid-response','checkpoint','in-flight'];const results=[];
try{for(const scenario of scenarios){
 const id='fixture_'+Date.now().toString(36)+'_'+scenario.replace('-','_');let tripped=false;
 const fake=new FakeModelTransport({responses:{
  synthesis:async()=>{if(scenario==='in-flight'&&!tripped){tripped=true;process.emit('SIGTERM');await new Promise(resolve=>setImmediate(resolve));}return {json:{claims:[claim],key_points:[],mentions:[]},usage:{costUsd:.02}};},
  critique:req=>{const text=req.user[0].text;const p=JSON.parse(text.slice(text.indexOf('SOURCE DATA (untrusted):\n')+25));return {json:{verdicts:[...(p.claims??[]),...(p.mentions??[])].map(c=>({id:c.id,verdict:'accept',reason_en:'Fixture source matches.'}))},usage:{costUsd:.01}};},
  'synthesis-research-plan':{json:{queries:[],coverage:['Company']},usage:{costUsd:.01}},
  'synthesis-research':{json:{sentences:[],mainTopics:[],omissions:['No usable research in fixture.']},usage:{costUsd:.01}},
  'synthesis-research-coverage':{json:{sentences:[],mainTopics:[],omissions:['No supplement in fixture.']},usage:{costUsd:.01}},
 }});const restore=injectTransport(fake);
 const first=out+'/'+scenario+'-1.json',second=out+'/'+scenario+'-2.json';
 const args=output=>['--live','--id',id,'--input',input,'--output',output,'--runtime-env',fixtureEnv,'--max-usd','5'];
 try{
  const hooks={};
  if(scenario==='admission')hooks.afterAdmission=()=>{if(!tripped){tripped=true;throw Error('Injected admission crash');}};
  if(scenario==='paid-response')hooks.afterStep=({stage})=>{if(stage==='synthesis'&&!tripped){tripped=true;throw Error('Injected checkpoint crash');}};
  if(scenario==='checkpoint')hooks.afterCheckpoint=()=>{if(!tripped){tripped=true;process.emit('SIGTERM');}};
  if(scenario==='checkpoint'||scenario==='in-flight'){await main(args(first),hooks);assert.equal(JSON.parse(readFileSync(first)).state,'paused');}
  else await assert.rejects(main(args(first),hooks),/Injected/);
  await main([...args(second),'--resume']);
  const report=JSON.parse(readFileSync(second));assert.equal(report.state,'finished');
  const sources=report.runs.filter(r=>!r.input.task);assert.equal(sources.length,1,'admission gap must not create another source');
  assert.equal(fake.requests.filter(r=>r.stage==='synthesis').length,1,'durable paid response reused');
  assert.equal(report.calls.filter(c=>c.stage==='synthesis').length,1);
  assert.equal(report.accounting.openHolds.length,0);
  assert.equal(sources[0].input.recoveryOf,undefined);assert.equal(sources[0].input.recoveryBatch,undefined);assert.equal(sources[0].input.productionSample,undefined);
  assert.notEqual(sources[0].createdAt,frozen.runs[0].createdAt,'wall clock must not be rewritten');
  const research=report.runs.find(r=>r.input.task==='research-brief');assert.ok(research,'fixture must reach research admission');
  assert.equal(research.input.snapshot.context.analysedAt,frozen.runs[0].createdAt,'research cutoff must stay frozen');
  results.push({scenario,state:report.state,cases:report.cases,sourceRunCount:sources.length,synthesisCalls:1,providerNetworkCalls:0,fixtureLedgerUsd:report.accounting.settledLedgerUsd,cutoff:research.input.snapshot.context.analysedAt,wallClockCreatedAt:sources[0].createdAt,database:'yti_perf_readiness_'+id});
 }finally{restore();}
}}finally{globalThis.fetch=previousFetch;}
writeFileSync(out+'/summary.json',JSON.stringify({mode:'fake transport, isolated persistent PostgreSQL',actualProviderSpendUsd:0,results},null,2),{mode:0o600});
console.log(JSON.stringify({actualProviderSpendUsd:0,results},null,2));
