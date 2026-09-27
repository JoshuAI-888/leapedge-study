import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1);
const seconds = z.number().finite().nonnegative();
export const artifactSchema = z.object({ path:text, sha256:sha }).strict();
export type Artifact = z.infer<typeof artifactSchema>;
export const requiredReviewChecks = ['criticalErrors','knownFailuresCorrected','materialOmissions','noMaterialCoverageRegression','knownOmissionsRecovered','attributionNumbersConditions','pointInTimeAndHorizons','sourceTraceability','fullTranscriptAndHoldoutSections','noSilentTruncation','noFalseCompletion','noDuplicateBilling','desktopUi','mobileUi','cloudDeployment'] as const;
const review = z.object({ status:z.enum(['passed','failed','unknown']), evidence:z.array(artifactSchema), note:text }).strict();
const reviews = z.record(z.string(),review);
const arm = z.enum(['current','targeted']);
const caseSchema = z.object({ videoId:text, longVideo:z.boolean(), transcript:artifactSchema, sources:artifactSchema, cutoff:z.iso.datetime(), modelSettings:artifactSchema, context:artifactSchema, reviewSections:artifactSchema }).strict();
const admission = z.object({ videoId:text, arm, attemptId:text, outcome:z.enum(['completed','partial','failed','needs_review','pending']) }).strict();
const runSchema = z.object({ videoId:text, arm, pipelineSha256:sha, inputSha256:sha, outcome:z.enum(['completed','partial','failed','needs_review','pending']), measurementKind:z.enum(['observed','fixture','declared']), scope:z.enum(['fresh-research-from-frozen-source','cached','imported-recovery','unknown']), attemptIds:z.array(text).min(1), ledger:artifactSchema, trace:artifactSchema, output:artifactSchema.nullable(), costs:z.array(z.object({ callId:text, attemptId:text, stage:text, usd:seconds.nullable(), state:z.enum(['settled','unsettled']), outcome:z.enum(['success','failure','unknown']), inputTokens:z.number().int().nonnegative().nullable(), outputTokens:z.number().int().nonnegative().nullable() }).strict()), stages:z.array(z.object({attemptId:text, stage:text, seconds}).strict()), wallSeconds:seconds.nullable(), firstUsefulSeconds:seconds.nullable(), finalVisibleSeconds:seconds.nullable(), quality:reviews }).strict();
export const experimentSchema = z.object({version:z.literal('targeted-audit-experiment.v1'), sourceCohort:artifactSchema, frozenPlan:artifactSchema, currentPipeline:artifactSchema, targetedPipeline:artifactSchema, cases:z.array(caseSchema), admissionsArtifact:artifactSchema, admissions:z.array(admission), runs:z.array(runSchema), acceptance:reviews}).strict();
export type Experiment = z.infer<typeof experimentSchema>;
export function digest(value:unknown):string {
 const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
 return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function frozenPlanPayload(e:Experiment) { return { version:e.version, sourceCohort:e.sourceCohort, cases:e.cases, currentPipeline:e.currentPipeline, targetedPipeline:e.targetedPipeline, timingMetric:'summed-research-stage-seconds', timeReduction:0.30, costReduction:0.25, requiredReviewChecks }; }
const median=(ns:number[])=>{const s=[...ns].sort((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null;};

/** The verifier must inspect retained artifacts, not trust evidence labels. This gate
 * evaluates supplied evidence; it cannot prove reviewer honesty or authorize rollout. */
export function evaluateExperiment(input:unknown, verify:(artifact:Artifact)=>boolean = ()=>false) {
 const e=experimentSchema.parse(input); const reasons:string[]=[];
 const checkArtifact=(a:Artifact)=>{if(!verify(a))reasons.push(`Missing or unverified artifact: ${a.path}`);};
 checkArtifact(e.sourceCohort);checkArtifact(e.frozenPlan);checkArtifact(e.currentPipeline);checkArtifact(e.targetedPipeline);checkArtifact(e.admissionsArtifact);
 for(const c of e.cases)for(const a of [c.transcript,c.sources,c.modelSettings,c.context,c.reviewSections])checkArtifact(a);
 const ids=e.cases.map(c=>c.videoId);
 if(ids.length!==20||new Set(ids).size!==20)reasons.push('Exactly 20 unique frozen cases required');
 if(!e.cases.some(c=>c.longVideo))reasons.push('Designated long video missing');
 const reviewChecks=(r:z.infer<typeof reviews>,names:readonly string[],label:string,allowReviewedFailure=false)=>{for(const name of names){const v=r[name];const requiresPass=!allowReviewedFailure||['noSilentTruncation','noFalseCompletion'].includes(name);if(!v||v.status==='unknown'||(requiresPass&&v.status!=='passed')||!v.evidence.length)reasons.push(`${label}: ${name} ${requiresPass?'not passed':'not assessed'} with evidence`);for(const a of v?.evidence??[])checkArtifact(a);}};
 reviewChecks(e.acceptance,requiredReviewChecks,'acceptance');
 if(e.admissions.some(a=>a.outcome==='pending'))reasons.push('Pending admitted attempts remain');
 const admissions=e.admissions.map(a=>a.attemptId);
 if(new Set(admissions).size!==admissions.length)reasons.push('Duplicate admitted attempt');
 const seenAttempts:string[]=[];const seenCalls=new Set<string>();
 for(const r of e.runs){
  if(!ids.includes(r.videoId))reasons.push(`Unknown case ${r.videoId}`);
  for(const id of r.attemptIds){seenAttempts.push(id);if(!e.admissions.some(a=>a.attemptId===id&&a.videoId===r.videoId&&a.arm===r.arm))reasons.push(`Unregistered attempt ${id}`);}
  if(r.outcome!=='completed')reasons.push(`${r.videoId}/${r.arm}: ${r.outcome}`);
  if(r.measurementKind!=='observed'||r.scope!=='fresh-research-from-frozen-source')reasons.push(`${r.videoId}/${r.arm}: not fresh observed research`);
  if(r.pipelineSha256!==(r.arm==='current'?e.currentPipeline:e.targetedPipeline).sha256)reasons.push(`${r.videoId}/${r.arm}: pipeline identity mismatch`);
  const c=e.cases.find(c=>c.videoId===r.videoId);if(c&&r.inputSha256!==digest(c))reasons.push(`${r.videoId}/${r.arm}: frozen input mismatch`);
  checkArtifact(r.ledger);checkArtifact(r.trace);if(r.output)checkArtifact(r.output);else reasons.push(`${r.videoId}/${r.arm}: missing output`);
  reviewChecks(r.quality,requiredReviewChecks.filter(k=>!['desktopUi','mobileUi','cloudDeployment','noDuplicateBilling'].includes(k)&&(r.arm==='targeted'||k!=='noMaterialCoverageRegression')),`${r.videoId}/${r.arm}`,r.arm==='current');
  if(!r.costs.length||r.costs.some(c=>c.usd===null||c.state!=='settled'||c.outcome==='unknown'))reasons.push(`${r.videoId}/${r.arm}: incomplete costs`);
  for(const c of r.costs){if(seenCalls.has(c.callId))reasons.push(`Duplicate call ${c.callId}`);seenCalls.add(c.callId);if(!r.attemptIds.includes(c.attemptId))reasons.push(`Call outside registered attempts ${c.callId}`);}
  if(!r.stages.length||r.stages.some(s=>!r.attemptIds.includes(s.attemptId))||r.attemptIds.some(id=>!r.stages.some(s=>s.attemptId===id)))reasons.push(`${r.videoId}/${r.arm}: incomplete stage accounting`);
  if(r.wallSeconds===null||r.firstUsefulSeconds===null||r.finalVisibleSeconds===null||r.finalVisibleSeconds<r.firstUsefulSeconds)reasons.push(`${r.videoId}/${r.arm}: incomplete visible/wall timing`);
 }
 if(new Set(seenAttempts).size!==seenAttempts.length)reasons.push('Repeated attempt observations are not additional work');
 for(const a of admissions)if(!seenAttempts.includes(a))reasons.push(`Discarded admitted attempt ${a}`);
 const summarize=(r:z.infer<typeof runSchema>|undefined)=>r?{outcome:r.outcome,scope:r.scope,attempts:r.attemptIds.length,firstAttemptOutcome:e.admissions.find(a=>a.attemptId===r.attemptIds[0])?.outcome??'unknown',attemptOutcomes:r.attemptIds.map(id=>({attemptId:id,outcome:e.admissions.find(a=>a.attemptId===id)?.outcome??'unknown'})),stageSeconds:r.stages.reduce((s,x)=>s+x.seconds,0),wallSeconds:r.wallSeconds,firstUsefulSeconds:r.firstUsefulSeconds,finalVisibleSeconds:r.finalVisibleSeconds,usd:r.costs.some(c=>c.usd===null)?null:r.costs.reduce((s,c)=>s+(c.usd??0),0),stages:r.stages,costs:r.costs}:null;
 const cases=e.cases.map(c=>{const current=e.runs.filter(r=>r.videoId===c.videoId&&r.arm==='current');const targeted=e.runs.filter(r=>r.videoId===c.videoId&&r.arm==='targeted');if(current.length!==1||targeted.length!==1)reasons.push(`${c.videoId}: missing or duplicate pair`);return {videoId:c.videoId,longVideo:c.longVideo,current:current.length===1?summarize(current[0]):null,targeted:targeted.length===1?summarize(targeted[0]):null};});
 const complete=cases.length===20&&new Set(ids).size===20&&e.runs.length===40&&cases.every(c=>c.current&&c.targeted);
 const currentTime=complete?median(cases.map(c=>c.current!.stageSeconds)):null,targetedTime=complete?median(cases.map(c=>c.targeted!.stageSeconds)):null;
 const priced=complete&&cases.every(c=>c.current!.usd!==null&&c.targeted!.usd!==null);
 const currentCost=priced?median(cases.map(c=>c.current!.usd!)):null,targetedCost=priced?median(cases.map(c=>c.targeted!.usd!)):null;
 const medianTimeReduction=currentTime&&targetedTime!==null?1-targetedTime/currentTime:null;
 const medianCostReduction=currentCost&&targetedCost!==null?1-targetedCost/currentCost:null;
 if(medianTimeReduction===null||medianTimeReduction<0.30-1e-10)reasons.push('Median stage time reduction below 30% or unmeasured');
 if(medianCostReduction===null||medianCostReduction<0.25-1e-10)reasons.push('Median cost reduction below 25% or unmeasured');
 for(const c of cases.filter(c=>c.longVideo))if(!c.current||!c.targeted||c.targeted.stageSeconds>=c.current.stageSeconds)reasons.push(`${c.videoId}: long video did not improve`);
 return {version:'targeted-audit-gate.v1',verdict:reasons.length?'not-passed':'eligible-for-user-review',defaultChangeAuthorized:false,expectedPairs:20,representedPairs:cases.filter(c=>c.current&&c.targeted).length,metrics:{medianTimeReduction,medianCostReduction,currentMedianStageSeconds:currentTime,targetedMedianStageSeconds:targetedTime,currentMedianUsd:currentCost,targetedMedianUsd:targetedCost},cases,knownRecordedUsd:{current:e.runs.filter(r=>r.arm==='current').reduce((n,r)=>n+r.costs.reduce((s,c)=>s+(c.usd??0),0),0),targeted:e.runs.filter(r=>r.arm==='targeted').reduce((n,r)=>n+r.costs.reduce((s,c)=>s+(c.usd??0),0),0)},reasons:[...new Set(reasons)],limitations:['Evidence hashes establish integrity, not independent truth of measurements or reviews.','Research-only comparisons exclude imported source acquisition/extraction costs; show these separately in an end-to-end benchmark.','Twenty pairs do not establish 1,000/day capacity or population accuracy.','User approval is required before any default change.']};
}
