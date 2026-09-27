import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest, evaluateExperiment, experimentSchema, frozenPlanPayload, type Artifact } from '../evaluations/targeted-audit/experiment.ts';

const args=process.argv.slice(2);
const value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const command=args[0];
const output=value('--out');
const emit=(v:unknown)=>{const text=JSON.stringify(v,null,2)+'\n';if(output)writeFileSync(output,text,{flag:'wx'});else process.stdout.write(text);};
const rawHash=(s:Buffer)=>createHash('sha256').update(s).digest('hex');
if(command==='prepare') {
 const path=value('--cases')??'docs/delivery/live-comparison-20-20260920.json';
 const bytes=readFileSync(path);
 const source=z.object({cases:z.array(z.object({videoId:z.string().min(1),title:z.string(),duration:z.string(),leapedgeReport:z.string().nullable().optional()})).length(20)}).parse(JSON.parse(bytes.toString()));
 if(new Set(source.cases.map(c=>c.videoId)).size!==20)throw Error('Original cohort must contain 20 unique videos');
 emit({version:'targeted-audit-preparation.v1',status:'not-ready-to-run',sourceCohort:{path:resolve(path),sha256:rawHash(bytes)},paidCalls:0,defaultChanged:false,executionTarget:'cloud-only',timingScope:'fresh research from identical frozen source; not ingestion-to-display',requiredBeforeAdmission:['Cloud topology and costs approved; cloud runner deployed','Choose and hash full retained transcripts and identical external-source/context snapshots for both arms','Freeze date cutoffs, model settings, implementation manifests and source-backed review sections','Freeze plan before any paid admission; record all admissions in a durable registry','Implement cloud runner export of complete calls, attempts, timestamps, stages and browser-visible events'],cases:source.cases.map(c=>({...c,longVideo:c.videoId==='ZfOQoh82JTo',transcript:null,sources:null,cutoff:null,modelSettings:null,context:null,reviewSections:null,retainedLeapEdgeOnly:true})),currentPipeline:null,targetedPipeline:null,limitations:['This preparation file is not an experiment result or frozen runnable plan.','No paid execution, new LeapEdge requests, default change, or quality claims.']});
} else if(command==='freeze') {
 const path=value('--input');if(!path)throw Error('freeze requires --input experiment.json');
 const e=experimentSchema.parse(JSON.parse(readFileSync(path,'utf8')));
 if(e.runs.length||e.admissions.length)throw Error('Freeze before admitting any work');
 if(e.cases.length!==20||new Set(e.cases.map(c=>c.videoId)).size!==20)throw Error('Freeze requires 20 unique cases');
 emit(frozenPlanPayload(e));
} else if(command==='gate') {
 const path=value('--input');if(!path)throw Error('gate requires --input experiment.json');
 const e=experimentSchema.parse(JSON.parse(readFileSync(path,'utf8')));
 const root=resolve(value('--artifact-root')??dirname(resolve(path)));
 const read=(a:Artifact)=>{const bytes=readFileSync(resolve(root,a.path));if(rawHash(bytes)!==a.sha256)throw Error(`Artifact hash mismatch: ${a.path}`);return JSON.parse(bytes.toString()) as unknown;};
 const verify=(a:Artifact)=>{try {const bytes=readFileSync(resolve(root,a.path));return rawHash(bytes)===a.sha256;}catch{return false;}};
 const result=evaluateExperiment(e,verify);
 // Reconcile supplied measurements against retained runner exports. A matching hash
 // alone does not establish that an arbitrary summary contains those measurements.
 const integrity:string[]=[];
 try {const cohort=z.object({cases:z.array(z.object({videoId:z.string()})).length(20)}).parse(read(e.sourceCohort));if(digest(cohort.cases.map(c=>c.videoId).sort())!==digest(e.cases.map(c=>c.videoId).sort()))integrity.push('Frozen cases differ from retained original cohort');}catch{integrity.push('Missing retained original cohort artifact');}
 try {const registry=z.object({admissions:experimentSchema.shape.admissions}).parse(read(e.admissionsArtifact));if(digest(registry.admissions)!==digest(e.admissions))integrity.push('Global admission registry mismatch: discarded or added attempts');}catch{integrity.push('Missing global admission registry export');}
 try { if(digest(read(e.frozenPlan))!==digest(frozenPlanPayload(e)))integrity.push('Frozen plan differs from experiment inputs/thresholds'); } catch {integrity.push('Cannot verify frozen plan');}
 for(const r of e.runs){
  try {const ledger=z.object({costs:experimentSchema.shape.runs.element.shape.costs}).parse(read(r.ledger));if(digest(ledger.costs)!==digest(r.costs))integrity.push(`${r.videoId}/${r.arm}: ledger cost mismatch`);}catch{integrity.push(`${r.videoId}/${r.arm}: missing runner ledger export`);}
  try {const trace=z.object({frozenPlanSha256:z.string(),videoId:z.string(),arm:z.string(),inputSha256:z.string(),pipelineSha256:z.string(),measurementKind:z.string(),scope:z.string(),attemptIds:z.array(z.string()),admissions:experimentSchema.shape.admissions,stages:experimentSchema.shape.runs.element.shape.stages,wallSeconds:z.number().nullable(),firstUsefulSeconds:z.number().nullable(),finalVisibleSeconds:z.number().nullable()}).parse(read(r.trace));
   if(trace.frozenPlanSha256!==e.frozenPlan.sha256)integrity.push(`${r.videoId}/${r.arm}: trace frozen plan mismatch`);
   for(const key of ['videoId','arm','inputSha256','pipelineSha256','measurementKind','scope','attemptIds','stages','wallSeconds','firstUsefulSeconds','finalVisibleSeconds'] as const)if(digest(trace[key])!==digest(r[key]))integrity.push(`${r.videoId}/${r.arm}: trace ${key} mismatch`);
   const expected=e.admissions.filter(a=>a.videoId===r.videoId&&a.arm===r.arm);if(digest(trace.admissions)!==digest(expected))integrity.push(`${r.videoId}/${r.arm}: admission registry mismatch`);
  }catch{integrity.push(`${r.videoId}/${r.arm}: missing runner trace export`);}
 }
 if(integrity.length){result.verdict='not-passed';result.reasons.push(...integrity);}
 emit(result);if(result.verdict!=='eligible-for-user-review')process.exitCode=1;
} else {throw Error('Usage: targeted-audit-experiment.ts prepare [--cases cohort.json] [--out new.json] | freeze --input experiment.json [--out plan.json] | gate --input experiment.json [--artifact-root dir] [--out report.json]');}
