import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest, experimentSchema, frozenPlanPayload, requiredReviewChecks, type Artifact, type Experiment } from './experiment.ts';
import { freshResearchSeed, assertFrozenBundle, type FrozenPairBundle } from './paired-runner.ts';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const save=(folder:string,name:string,data:unknown):Artifact=>{const bytes=JSON.stringify(data,null,2)+'\n';writeFileSync(resolve(folder,name),bytes,{flag:'wx',mode:0o600});return {path:name,sha256:hash(bytes)};};
const unknownChecks=()=>Object.fromEntries(requiredReviewChecks.map(k=>[k,{status:'unknown' as const,evidence:[],note:'Not reviewed; no quality or deployment acceptance inferred from execution.'}]));
export function prepareEvaluationArtifacts(bundle:FrozenPairBundle,cohort:unknown,folder:string,sourceReview?:unknown){
 assertFrozenBundle(bundle);const original=z.object({cases:z.array(z.object({videoId:z.string()})).length(20)}).passthrough().parse(cohort);
 if(digest(original.cases.map(c=>c.videoId).sort())!==digest(bundle.cases.map(c=>c.videoId).sort()))throw Error('Original cohort differs from frozen bundle');
 mkdirSync(folder,{recursive:false});
 const sourceCohort=save(folder,'source-cohort.json',cohort);
 const common=save(folder,'common-model-settings.json',bundle.settings);
 const currentPipeline=save(folder,'current-pipeline.json',{pipeline:'current',version:'current-v1',implementationFiles:bundle.implementationFiles});
 const targetedPipeline=save(folder,'targeted-pipeline.json',{pipeline:'targeted-experimental',version:'targeted-experimental-v1',implementationFiles:bundle.implementationFiles});
 const preparedReviews=sourceReview===undefined?null:z.object({cases:z.array(z.object({videoId:z.string(),sourceContentSha256:z.string(),inventoryResearchRunId:z.string()}).passthrough()).length(20)}).parse(sourceReview);
 const cases=bundle.cases.map(c=>{
  const source=z.object({segments:z.array(z.object({id:z.string()}))}).parse(c.source.output.source);
  const sourceReviewCase=preparedReviews?.cases.find(r=>r.videoId===c.videoId);
  if(preparedReviews&&(!sourceReviewCase||sourceReviewCase.sourceContentSha256!==hash(JSON.stringify(c.source.output.source))||sourceReviewCase.inventoryResearchRunId!==c.provenance.researchRunId))throw Error('Source-review manifest does not match selected donor');
  const segmentIds=source.segments.map(s=>s.id);const middle=Math.floor(segmentIds.length/2);
  return {videoId:c.videoId,longVideo:c.longVideo,cutoff:c.snapshot.context.analysedAt,transcript:save(folder,`case-${c.case}-transcript.json`,c.source.output.source),sources:save(folder,`case-${c.case}-external.json`,{researchPlan:c.researchPlan,retrievals:c.retrievals}),modelSettings:common,context:save(folder,`case-${c.case}-context.json`,{snapshot:c.snapshot,researchBaseline:c.researchBaseline,processedSource:c.source.output}),reviewSections:save(folder,`case-${c.case}-review-sections.json`,sourceReviewCase??{status:'selected-not-reviewed',scope:'Full transcript plus deterministic beginning/middle/end spot checks; known-failure review required separately',videoId:c.videoId,allEvidenceIds:c.snapshot.evidence.map(e=>e.id),additionalTranscriptSections:[segmentIds.slice(0,5),segmentIds.slice(Math.max(0,middle-2),middle+3),segmentIds.slice(-5)]})};
 });
 const placeholder={path:'not-created.json',sha256:'0'.repeat(64)};
 const e:Experiment={version:'targeted-audit-experiment.v1',sourceCohort,frozenPlan:placeholder,currentPipeline,targetedPipeline,cases,admissionsArtifact:placeholder,admissions:[],runs:[],acceptance:unknownChecks()};
 e.frozenPlan=save(folder,'frozen-plan.json',frozenPlanPayload(e));
 e.admissionsArtifact=save(folder,'empty-admissions.json',{admissions:[]});
 save(folder,'experiment-preflight.json',e);save(folder,'bundle-link.json',{bundleSha256:bundle.sha256,frozenPlanSha256:e.frozenPlan.sha256,scope:bundle.scope});
 return e;
}
export function readEvaluationArtifacts(bundle:FrozenPairBundle,folder:string){
 const e=experimentSchema.parse(JSON.parse(readFileSync(resolve(folder,'experiment-preflight.json'),'utf8')));
 const link=z.object({bundleSha256:z.string(),frozenPlanSha256:z.string()}).parse(JSON.parse(readFileSync(resolve(folder,'bundle-link.json'),'utf8')));
 if(link.bundleSha256!==bundle.sha256||link.frozenPlanSha256!==e.frozenPlan.sha256)throw Error('Evaluation plan does not match frozen bundle');
 const refs=[e.sourceCohort,e.frozenPlan,e.currentPipeline,e.targetedPipeline,...e.cases.flatMap(c=>[c.transcript,c.sources,c.modelSettings,c.context,c.reviewSections])];
 for(const ref of refs)if(hash(readFileSync(resolve(folder,ref.path)))!==ref.sha256)throw Error(`Evaluation artifact changed: ${ref.path}`);
 if(digest(JSON.parse(readFileSync(resolve(folder,e.frozenPlan.path),'utf8')))!==digest(frozenPlanPayload(e)))throw Error('Frozen evaluation payload mismatch');
 return e;
}
const rawSchema=z.object({bundleSha256:z.string(),evaluationPlanSha256:z.string(),runs:z.array(z.object({id:z.string(),videoId:z.string(),model:z.string(),promptVersion:z.string(),status:z.string(),createdAt:z.string(),updatedAt:z.string(),input:z.record(z.string(),z.any()),output:z.record(z.string(),z.any())})),calls:z.array(z.object({id:z.string(),run_id:z.string(),stage:z.string(),status:z.string(),amount:z.union([z.number(),z.string()]).nullable(),metrics:z.unknown()})),documents:z.array(z.object({kind:z.string(),id:z.string(),payload:z.unknown()}))});
const decoded=(v:unknown)=>typeof v==='string'?JSON.parse(v):v;
export function exportEvaluationArtifacts(bundle:FrozenPairBundle,rawInput:unknown,folder:string,suffix:string){
 if(!/^[a-z0-9_-]+$/.test(suffix))throw Error('Safe unique export suffix required');
 const e=readEvaluationArtifacts(bundle,folder);const raw=rawSchema.parse(rawInput);
 if(raw.bundleSha256!==bundle.sha256||raw.evaluationPlanSha256!==e.frozenPlan.sha256)throw Error('Run did not use this frozen evaluation plan');
 const admissions=raw.documents.filter(d=>d.kind==='pairedAdmission').map(d=>z.object({runId:z.string(),videoId:z.string(),arm:z.enum(['current','targeted']),bundleSha256:z.string()}).parse(decoded(d.payload)));
 if(admissions.some(a=>a.bundleSha256!==bundle.sha256)||new Set(admissions.map(a=>a.runId)).size!==admissions.length)throw Error('Unexpected or duplicate admissions in dedicated experiment');
 const admittedIds=new Set(admissions.map(a=>a.runId));
 if(raw.calls.some(c=>!admittedIds.has(c.run_id)))throw Error('Unregistered provider costs present; refusing to discard spend');
 if(raw.runs.some(r=>r.input.task==='research-brief'&&!admittedIds.has(r.id)))throw Error('Unregistered research run present; refusing to discard attempts');
 for(const a of admissions){const r=raw.runs.find(r=>r.id===a.runId);const item=bundle.cases.find(c=>c.videoId===a.videoId);if(!r||!item||r.videoId!==a.videoId)throw Error('Run/admission identity mismatch');const seed=freshResearchSeed(bundle,item,a.arm,r.createdAt);if(seed.id!==r.id||seed.model!==r.model||seed.promptVersion!==r.promptVersion||digest(seed.input)!==digest(r.input))throw Error('Frozen run input/pipeline identity mismatch');for(const key of ['retrievals','researchPlan','researchBaseline'])if(digest(seed.output[key])!==digest(r.output[key]))throw Error(`Frozen ${key} identity mismatch`);}
 e.admissions=admissions.map(a=>({attemptId:a.runId,videoId:a.videoId,arm:a.arm,outcome:outcome(raw.runs.find(r=>r.id===a.runId)?.status)}));
 e.admissionsArtifact=save(folder,`${suffix}-admissions.json`,{admissions:e.admissions});
 const steps=raw.documents.filter(d=>d.kind==='pairedStep').map(d=>z.object({runId:z.string(),stage:z.string(),state:z.string(),interruptedPrior:z.boolean(),executionSeconds:z.number().nullable()}).parse(decoded(d.payload)));
 e.runs=admissions.map(a=>{
  const r=raw.runs.find(r=>r.id===a.runId);if(!r)throw Error('Admitted attempt missing its durable run');const c=e.cases.find(c=>c.videoId===r.videoId)!;
  const rows=steps.filter(s=>s.runId===r.id);const incompleteTiming=rows.some(s=>s.state!=='finished'||s.interruptedPrior||s.executionSeconds===null);
  const costs=raw.calls.filter(c=>c.run_id===r.id).map(c=>{const metrics=z.record(z.string(),z.unknown()).catch({}).parse(decoded(c.metrics));return {callId:c.id,attemptId:r.id,stage:c.stage,usd:c.amount===null?null:Number(c.amount),state:['completed','released'].includes(c.status)?'settled' as const:'unsettled' as const,outcome:c.status==='completed'?'success' as const:c.status==='released'?'failure' as const:'unknown' as const,inputTokens:typeof metrics.inputTokens==='number'?metrics.inputTokens:null,outputTokens:typeof metrics.outputTokens==='number'?metrics.outputTokens:null};});
  const stages=incompleteTiming?[]:rows.map(s=>({attemptId:r.id,stage:s.stage,seconds:s.executionSeconds!}));
  const record={videoId:r.videoId,arm:a.arm,pipelineSha256:(a.arm==='current'?e.currentPipeline:e.targetedPipeline).sha256,inputSha256:digest(c),outcome:outcome(r.status),measurementKind:'observed' as const,scope:'fresh-draft-audit-from-frozen-retrieval' as const,attemptIds:[r.id],ledger:save(folder,`${suffix}-${r.id}-ledger.json`,{costs}),trace:{path:'pending',sha256:'0'.repeat(64)},output:save(folder,`${suffix}-${r.id}-output.json`,{output:r.output,sourceScope:bundle.scope}),costs,stages,wallSeconds:['queued','running'].includes(r.status)?null:Math.max(0,(Date.parse(r.updatedAt)-Date.parse(r.createdAt))/1000),firstUsefulSeconds:null,finalVisibleSeconds:null,quality:unknownChecks()};
  record.trace=save(folder,`${suffix}-${r.id}-trace.json`,{...record,frozenPlanSha256:e.frozenPlan.sha256,admissions:e.admissions.filter(ad=>ad.attemptId===r.id),timingStatus:incompleteTiming?'interrupted-or-incomplete':'recorded-stage-execution',note:'Browser timings are unknown, never inferred from server timestamps.'});
  return record;
 });
 const result=experimentSchema.parse(e);save(folder,`${suffix}-experiment.json`,result);return result;
}
function outcome(status:string|undefined):'completed'|'partial'|'failed'|'needs_review'|'pending'{return status==='completed'?'completed':status==='failed'?'failed':status==='needs_review'?'needs_review':status==='partial'?'partial':'pending';}
