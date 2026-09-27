import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResumeIdentity, ledgerAccounting, benchmarkDatabaseName, frozenSourceOutput } from '../scripts/run-cohort-durable.mjs';
test('frozen source replay preserves acquisition limitations without inheriting old research',()=>{
 const original={source:{segments:[{text:'Original words'}]},metadata:{duration:5},limitations:['Ownership wording unresolved'],transcriptionCompleteness:{status:'windows_processed_gaps_checked'},researchDraft:{sentences:['Old analysis']}};
 const replay=frozenSourceOutput(original);
 assert.deepEqual(replay.limitations,original.limitations);
 assert.deepEqual(replay.transcriptionCompleteness,original.transcriptionCompleteness);
 assert.equal(replay.researchDraft,undefined);
 replay.source.segments[0].text='Changed copy';
 assert.equal(original.source.segments[0].text,'Original words');
});
test('resuming refuses any implementation, source or settings change',()=>{
 const identity={implementationSha256:'a',inputSha256:'b',settingsSha256:'c'};
 assert.doesNotThrow(()=>assertResumeIdentity(identity,{...identity}));
 for(const field of Object.keys(identity))assert.throws(()=>assertResumeIdentity(identity,{...identity,[field]:'changed'}),/identity/);
});
test('ledger costs separate external calls and unknown holds without doubling donors',()=>{
 const result=ledgerAccounting([{id:'a',run_id:'r',stage:'critique',status:'completed',amount:.2},{id:'b',run_id:'r',stage:'external-search-key',status:'completed',amount:.007},{id:'c',run_id:'r',stage:'critique',status:'unknown',amount:.1}]);
 assert.equal(result.settledModelUsd,.2);assert.equal(result.settledExternalUsd,.007);assert.equal(result.settledLedgerUsd,.20700000000000002);assert.equal(result.openHolds.length,1);
});
test('benchmark cannot name a production or remote database',()=>{
 assert.equal(benchmarkDatabaseName('test_a'),'yti_perf_readiness_test_a');
 assert.throws(()=>benchmarkDatabaseName('prod;DROP DATABASE'),/identifier/);
 assert.throws(()=>benchmarkDatabaseName('../yti_live'),/identifier/);
});

test('research-only import preserves frozen evidence and explicit cutoff, excludes prior research and spend',async()=>{
 const {researchOnlySourceOutput,benchmarkTreatment,selectBenchmarkRuns}=await import('../scripts/run-cohort-durable.mjs');
 const {createHash}=await import('node:crypto');
 const original={id:'G-source',status:'completed',stage:'complete',videoId:'video',output:{source:{segments:[{id:'s1',text:'Original words',start_seconds:0,end_seconds:5}],language:'en'},claims:[{id:'c1',passed:true,reasons:[],audit:{verdict:'accept'},claim:{instrument_as_spoken:'Company',thesis_en:'Original words',evidence:[{segment_id:'s1',quote_original:'Original words'}]}}],keyPoints:[],mentions:[],mentionChecks:{},metadata:{publishedAt:'2026-01-01T00:00:00Z'},limitations:['Unverified source wording'],researchDraft:{sentences:['old']},researchBriefId:'old',modelCostUsd:8}};
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
 const entry={sourceRunId:original.id,sourceOutputSha256:createHash('sha256').update(JSON.stringify(canonical(original.output))).digest('hex'),cutoff:'2026-02-01T00:00:00Z'};
 const copied=researchOnlySourceOutput(original,entry);
 assert.equal(copied.claims[0].claim.evidence[0].quote_original,'Original words');
 assert.throws(()=>researchOnlySourceOutput({...original,status:'failed'},entry),/completed/);
 assert.deepEqual(copied.claims,original.output.claims);assert.deepEqual(copied.mentionChecks,{});assert.deepEqual(copied.limitations,original.output.limitations);
 assert.equal(copied.researchDraft,undefined);assert.equal(copied.researchBriefId,undefined);assert.equal(copied.modelCostUsd,undefined);
 assert.equal(copied.benchmarkSourceImport.originalSourceRunId,'G-source');assert.equal(copied.benchmarkSourceImport.analysisCutoff,entry.cutoff);
 copied.source.segments[0].text='copy';assert.equal(original.output.source.segments[0].text,'Original words');
 assert.throws(()=>researchOnlySourceOutput(original,{...entry,sourceOutputSha256:'wrong'}),/hash/);
 assert.throws(()=>researchOnlySourceOutput(original,{...entry,cutoff:undefined}),/cutoff/);
 assert.throws(()=>assertResumeIdentity({treatment:benchmarkTreatment(false)},{treatment:benchmarkTreatment(true)}),/identity/);
 assert.deepEqual(selectBenchmarkRuns([original,{...original,videoId:'other'}],'video').map((r:any)=>r.videoId),['video']);
 assert.throws(()=>selectBenchmarkRuns([original],'absent'),/selector/);
});

test('fatal provider account errors fail current case and preserve untouched cohort denominator and costs',async()=>{
 const {containProviderAccountFailure}=await import('../scripts/run-cohort-durable.mjs');
 for(const error of [Object.assign(new Error('credential failure'),{name:'TransportError',status:401}), 'Mandatory research audit unavailable: Provider HTTP 402. No automatic paid retry.', 'Provider HTTP 403']){
  const control={providerAccountBlock:undefined as {runId:string}|undefined,cases:[{videoId:'one',sourceRunId:'s1',researchRunId:'r1',state:'running'},{videoId:'two',sourceRunId:null,researchRunId:null,state:'not-started'}],failures:[],timings:[{executionSeconds:4}]};
  const run={id:'r1',videoId:'one',status:'failed',error:typeof error==='string'?error:error.message};
  assert.equal(containProviderAccountFailure(control,run,error),'provider-account-blocked');
  assert.equal(control.cases[0].state,'failed');assert.equal(control.cases[1].state,'not-started');assert.equal(control.cases.length,2);assert.equal(control.timings[0].executionSeconds,4);
  assert.ok(control.providerAccountBlock);assert.equal(control.providerAccountBlock.runId,'r1');assert.equal(run.error,typeof error==='string'?error:error.message);
 }
 for(const error of ['Schema max 402 exceeded','Provider HTTP 429','Provider HTTP 500','HTTP 4020',new Error('Missing source')])assert.equal(containProviderAccountFailure({cases:[]},{id:'x',status:'failed'},error),null);
});
