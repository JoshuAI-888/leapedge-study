import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExperiment, experimentSchema, requiredReviewChecks, digest } from '../evaluations/targeted-audit/experiment.ts';

const hash = 'a'.repeat(64);
const ref = { path: 'evidence.json', sha256: hash };
function fixture() {
 const checks = Object.fromEntries(requiredReviewChecks.map(k => [k, { status: 'passed', evidence: [ref], note: 'Source-backed fixture review' }]));
 const cases = Array.from({length:20}, (_,i) => ({ videoId:`video${i}`, longVideo:i===0, transcript:ref, sources:ref, cutoff:'2026-09-19T00:00:00Z', modelSettings:ref, context:ref, reviewSections:ref }));
 const runs = cases.flatMap(c => ['current','targeted'].map(arm => ({ videoId:c.videoId, arm, pipelineSha256:hash, inputSha256:digest(c), outcome:'completed', measurementKind:'observed', scope:'fresh-research-from-frozen-source', attemptIds:[`${c.videoId}-${arm}`], ledger:ref, trace:ref, output:ref, costs:[{ callId:`${c.videoId}-${arm}`, attemptId:`${c.videoId}-${arm}`, stage:'audit', usd:arm==='current'?1:0.7, state:'settled', outcome:'success', inputTokens:100, outputTokens:10 }], stages:[{ attemptId:`${c.videoId}-${arm}`, stage:'audit', seconds:arm==='current'?100:60 }], wallSeconds:arm==='current'?100:60, firstUsefulSeconds:10, finalVisibleSeconds:arm==='current'?101:61, quality:structuredClone(checks) })));
 return { version:'targeted-audit-experiment.v1', sourceCohort:ref, frozenPlan:ref, currentPipeline:ref, targetedPipeline:ref, cases, admissionsArtifact:ref, admissions:runs.flatMap(r=>r.attemptIds.map(attemptId=>({videoId:r.videoId,arm:r.arm,attemptId,outcome:'completed'}))), runs, acceptance:structuredClone(checks) };
}
test('complete fixture can be eligible but never authorizes default promotion', () => {
 const result=evaluateExperiment(fixture(), ()=>true);
 assert.equal(result.verdict,'eligible-for-user-review'); assert.equal(result.defaultChangeAuthorized,false); assert.equal(result.metrics.medianTimeReduction,0.4);
});
test('missing pairs cannot pass and are retained in denominator',()=>{const f=fixture();f.runs.pop();const r=evaluateExperiment(f,()=>true);assert.equal(r.verdict,'not-passed');assert.equal(r.expectedPairs,20);assert.match(r.reasons.join(' '),/missing/);});
test('failed runs and discarded admitted attempts prevent promotion',()=>{const f=fixture();f.runs[0].outcome='failed';f.admissions.push({videoId:'video0',arm:'current',attemptId:'discarded',outcome:'failed'});assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');});
test('unknown quality, cloud acceptance, or missing evidence fail closed',()=>{const f=fixture();f.acceptance.cloudDeployment.status='unknown';f.runs[0].quality.materialOmissions.status='unknown';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');assert.equal(evaluateExperiment(fixture(),()=>false).verdict,'not-passed');});
test('cache-only and imported recovery measurements cannot pass as fresh processing',()=>{const f=fixture();f.runs[0].scope='cached';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');});
test('changed inputs and pipeline identity cannot enter paired metrics',()=>{const f=fixture();f.runs[0].inputSha256='b'.repeat(64);f.runs[1].pipelineSha256='c'.repeat(64);assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');});
test('failed call charges contribute to costs and unknown charges prevent acceptance',()=>{const f=fixture();f.runs[1].costs.push({...f.runs[1].costs[0],callId:'failed-retry',outcome:'failure',usd:10});assert.ok(evaluateExperiment(f,()=>true).cases[0].targeted!.usd!>10);f.runs[1].costs[0].state='unsettled';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');});
test('self-declared fixture measurements cannot be promoted',()=>{const f=fixture();f.runs[0].measurementKind='fixture';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');});
test('long case must improve even when medians improve',()=>{const f=fixture();f.runs[1].stages[0].seconds=101;assert.match(evaluateExperiment(f,()=>true).reasons.join(' '),/long/);});
test('invalid numeric timings and duplicate cohort identifiers are rejected',()=>{const f=fixture();f.runs[0].wallSeconds=-1;assert.equal(experimentSchema.safeParse(f).success,false);const g=fixture();g.cases[1].videoId=g.cases[0].videoId;assert.equal(evaluateExperiment(g,()=>true).verdict,'not-passed');});
test('every attempt must contribute timing and unsettled zero cost cannot hide failure',()=>{const f=fixture();f.admissions.push({videoId:'video0',arm:'current',attemptId:'retry',outcome:'completed'});f.runs[0].attemptIds.push('retry');assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');});
test('evidence cannot pass by default without an artifact verifier',()=>{assert.equal(evaluateExperiment(fixture()).verdict,'not-passed');});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../scripts/targeted-audit-experiment.ts', import.meta.url));
test('preparation lists all original cases but cannot masquerade as frozen measurements',()=>{
 const result=spawnSync(process.execPath,['--experimental-strip-types',cli,'prepare'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const prep=JSON.parse(result.stdout);assert.equal(prep.cases.length,20);assert.equal(prep.paidCalls,0);assert.equal(prep.status,'not-ready-to-run');assert.equal(prep.cases.find((c:{longVideo:boolean})=>c.longVideo).videoId,'ZfOQoh82JTo');assert.equal(experimentSchema.safeParse(prep).success,false);
});
test('CLI rejects fabricated declared measurements without retained runner artifacts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'yti-targeted-gate-'));try{
 const input=join(dir,'input.json');writeFileSync(input,JSON.stringify(fixture()));const r=spawnSync(process.execPath,['--experimental-strip-types',cli,'gate','--input',input],{encoding:'utf8'});assert.equal(r.status,1);const report=JSON.parse(r.stdout);assert.equal(report.verdict,'not-passed');assert.ok(report.reasons.some((x:string)=>x.includes('runner ledger')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('freeze rejects experiments that already admitted work and refuses overwriting evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'yti-targeted-freeze-'));try{
 const input=join(dir,'input.json');writeFileSync(input,JSON.stringify(fixture()));let r=spawnSync(process.execPath,['--experimental-strip-types',cli,'freeze','--input',input],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/before admitting/);
 const f=fixture();f.runs=[];f.admissions=[];writeFileSync(input,JSON.stringify(f));const out=join(dir,'plan.json');r=spawnSync(process.execPath,['--experimental-strip-types',cli,'freeze','--input',input,'--out',out],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(readFileSync(out,'utf8')).cases.length,20);
 r=spawnSync(process.execPath,['--experimental-strip-types',cli,'freeze','--input',input,'--out',out],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/EEXIST/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import { createHash } from 'node:crypto';
import { frozenPlanPayload } from '../evaluations/targeted-audit/experiment.ts';
test('CLI reconciles retained fixture artifacts and detects cost tampering despite a valid ledger hash',()=>{
 const dir=mkdtempSync(join(tmpdir(),'yti-targeted-integrity-'));try{
 const artifact=(name:string,payload:unknown)=>{const data=JSON.stringify(payload);writeFileSync(join(dir,name),data);return {path:name,sha256:createHash('sha256').update(data).digest('hex')};};
 const evidence=artifact('evidence.json',{fixture:true});const f=fixture();f.currentPipeline=artifact('current.json',{pipeline:'current'});f.targetedPipeline=artifact('targeted.json',{pipeline:'targeted'});
 for(const c of f.cases)for(const key of ['transcript','sources','modelSettings','context','reviewSections'] as const)c[key]=evidence;
 for(const q of Object.values(f.acceptance))q.evidence=[evidence];
 f.sourceCohort=artifact('cohort.json',{cases:f.cases.map(c=>({videoId:c.videoId}))});
 f.admissionsArtifact=artifact('admissions.json',{admissions:f.admissions});f.frozenPlan=artifact('plan.json',frozenPlanPayload(experimentSchema.parse(f)));
 for(const [i,r] of f.runs.entries()){
  r.inputSha256=digest(f.cases.find(c=>c.videoId===r.videoId));r.pipelineSha256=(r.arm==='current'?f.currentPipeline:f.targetedPipeline).sha256;
  for(const q of Object.values(r.quality))q.evidence=[evidence];r.output=evidence;
  r.ledger=artifact(`ledger${i}.json`,{costs:r.costs});
  const {videoId,arm,inputSha256,pipelineSha256,measurementKind,scope,attemptIds,stages,wallSeconds,firstUsefulSeconds,finalVisibleSeconds}=r;
  r.trace=artifact(`trace${i}.json`,{frozenPlanSha256:f.frozenPlan.sha256,videoId,arm,inputSha256,pipelineSha256,measurementKind,scope,attemptIds,stages,wallSeconds,firstUsefulSeconds,finalVisibleSeconds,admissions:f.admissions.filter(a=>a.videoId===videoId&&a.arm===arm)});
 }
 const input=join(dir,'input.json');writeFileSync(input,JSON.stringify(f));let result=spawnSync(process.execPath,['--experimental-strip-types',cli,'gate','--input',input],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).defaultChangeAuthorized,false);
 f.runs[1].costs[0].usd=0;writeFileSync(input,JSON.stringify(f));result=spawnSync(process.execPath,['--experimental-strip-types',cli,'gate','--input',input],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stdout,/ledger cost mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('known baseline quality failures do not disqualify a corrected candidate',()=>{
 const f=fixture();f.runs[0].quality.criticalErrors.status='failed';f.runs[0].quality.materialOmissions.status='failed';
 assert.equal(evaluateExperiment(f,()=>true).verdict,'eligible-for-user-review');
});
test('unknown or unsupported baseline quality still blocks comparison',()=>{
 const f=fixture();f.runs[0].quality.criticalErrors.status='unknown';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');
 f.runs[0].quality.criticalErrors.status='failed';f.runs[0].quality.criticalErrors.evidence=[];assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');
});
test('candidate quality failure remains disqualifying even with reviewed baseline',()=>{
 const f=fixture();f.runs[1].quality.criticalErrors.status='failed';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');
});
test('duplicate pairs suppress all comparative medians rather than selecting the first observation',()=>{
 const f=fixture();f.runs.push(structuredClone(f.runs[1]));const r=evaluateExperiment(f,()=>true);assert.equal(r.verdict,'not-passed');assert.equal(r.metrics.medianTimeReduction,null);assert.equal(r.metrics.medianCostReduction,null);assert.equal(r.metrics.currentMedianStageSeconds,null);assert.equal(r.metrics.currentMedianUsd,null);
});
test('candidate requires explicit comparative material coverage review',()=>{
 const f=fixture();f.runs[1].quality.noMaterialCoverageRegression.status='unknown';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');
});
test('baseline truncated processing is not accepted as a fair completed observation',()=>{
 const f=fixture();f.runs[0].quality.noSilentTruncation.status='failed';assert.equal(evaluateExperiment(f,()=>true).verdict,'not-passed');
});
