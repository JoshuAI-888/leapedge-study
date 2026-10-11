/** Network-free comparison of matched, retained faithful-audit responses.
 * Usage: node --experimental-strip-types scripts/compare-audit-models.ts --input export.json
 * Never invokes a provider or database. Agreement is not verified accuracy.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { FaithfulResponse } from '../src/server/youtube-intelligence/faithful-audit.ts';

const object = z.record(z.string(), z.unknown());
const finite = z.number().finite().nonnegative();
const sentence = z.looseObject({ id:z.string().min(1), text:z.string(), evidenceIds:z.array(z.string()) });
const payload = z.looseObject({
  sentences:z.array(sentence), evidence:z.array(z.looseObject({id:z.string().min(1),quotes:z.array(z.looseObject({text:z.string()}))})),
  assessEvidenceIds:z.array(z.string()), otherSentencesCitingAssessedEvidence:z.array(sentence).default([]),
});
const requestSchema = z.looseObject({videoId:z.string().min(1),sourceHash:z.string().min(1),hash:z.string().min(1),stage:z.string().startsWith('critique-faithful-'),
  prompt:z.string().min(1),payload,responseSchema:object,maxOutputTokens:z.number().int().positive(),reasoningEffort:z.string().optional()});
const responseSchema=z.looseObject({text:z.string(),model:z.string().optional(),provider:z.string().optional(),finishReason:z.string().optional(),
  usage:z.object({inputTokens:finite,outputTokens:finite,costUsd:finite.nullable()}),raw:z.unknown().optional()});
const resultSchema=z.looseObject({videoId:z.string(),requestHash:z.string(),auditInputHash:z.string(),requestedModel:z.string(),runId:z.string().min(1),
  rawResponse:responseSchema,rawResponseHash:z.string().optional(),responseWallMs:finite.optional(),
  calls:z.array(z.looseObject({id:z.string().min(1),stage:z.string(),status:z.string(),amount:finite,metrics:z.union([object,z.string()]).nullable()}))});
const exportSchema=z.object({requests:z.array(requestSchema).min(1),results:z.array(resultSchema)});
type AuditRequest=z.infer<typeof requestSchema>;
type AuditResult=z.infer<typeof resultSchema>;
const SONNET='anthropic/claude-sonnet-5',HAIKU='anthropic/claude-haiku-5.5';
const cohort=['_mEvVWGfmjU','Mepjkm_0ns4','fSx-Ho8mi18'];
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
/** Boundary parsing can reorder object keys; retention integrity ignores key order only. */
export function auditResponseHash(value:unknown){return hash(canonical(value));}
/** Identity excludes only the model treatment. Payload/schema key order stays exact. */
export function auditInputHash(raw:unknown){
  const r=requestSchema.parse(raw);
  return hash({videoId:r.videoId,sourceHash:r.sourceHash,stage:r.stage,prompt:r.prompt,payload:r.payload,responseSchema:r.responseSchema,maxOutputTokens:r.maxOutputTokens,reasoningEffort:r.reasoningEffort??null});
}
function metrics(raw:AuditResult['calls'][number]['metrics']){
  try{return object.parse(typeof raw==='string'?JSON.parse(raw):raw??{});}catch{return null;}
}
function exactTargets(actual:string[],expected:string[],label:string,issues:string[]){
  for(const id of expected)if(actual.filter(x=>x===id).length!==1)issues.push(`${label} ${id}: no single ${label}.`);
  for(const id of new Set(actual))if(!expected.includes(id))issues.push(`foreign ${label} ${id}.`);
}
function inspect(request:AuditRequest,result:AuditResult|undefined){
  const issues:string[]=[];
  const measurementIssues:string[]=[];
  if(!result)return {issues:['Missing model arm.'],measurementIssues:['Missing model arm.'],acceptedCount:0,settledCostUsd:null as number|null,unknownCalls:0,unknownUsageCost:true,
    responseSeconds:null as number|null,requestFingerprint:null as string|null,provider:null as string|null,servedModel:null as string|null,inputTokens:null as number|null,outputTokens:null as number|null,
    rawResponseHash:null as string|null,verdicts:[] as z.infer<typeof FaithfulResponse>['verdicts'],evidenceCoverage:[] as z.infer<typeof FaithfulResponse>['evidenceCoverage']};
  if(result.requestHash!==request.hash||result.auditInputHash!==auditInputHash(request))measurementIssues.push('Immutable audit input identity differs.');
  const served=result.rawResponse.model?.replace(/-\d{8}$/,'');
  if(served!==result.requestedModel)measurementIssues.push('Served model absent or substituted.');
  if(result.rawResponse.finishReason!=='stop')issues.push('Incomplete provider response.');
  if(result.rawResponse.raw===undefined||result.rawResponse.raw===null)measurementIssues.push('Raw provider response not retained.');
  const rawResponseHash=auditResponseHash(result.rawResponse);
  if(result.rawResponseHash&&result.rawResponseHash!==rawResponseHash)measurementIssues.push('Retained response hash differs.');
  if(!result.calls.length)measurementIssues.push('No model-call ledger retained.');
  const callIds=result.calls.map(c=>c.id);
  if(new Set(callIds).size!==callIds.length)measurementIssues.push('Duplicate model-call ledger IDs.');
  const unknownCalls=result.calls.filter(c=>c.status!=='completed').length;
  const unknownUsageCost=result.rawResponse.usage.costUsd===null;
  if(unknownCalls||unknownUsageCost)measurementIssues.push('Unsettled or unknown cost: no saving calculated.');
  const settledCostUsd=!result.calls.length||unknownCalls||unknownUsageCost?null:result.calls.reduce((s,c)=>s+c.amount,0);
  if(settledCostUsd!==null&&Math.abs(settledCostUsd-result.rawResponse.usage.costUsd!)>1e-8)measurementIssues.push('Settled ledger and normalized billed cost differ.');
  const callMetrics=result.calls.map(c=>metrics(c.metrics));
  if(callMetrics.some(m=>m===null))measurementIssues.push('Invalid retained call metrics.');
  const fingerprint=callMetrics.map(m=>m?.requestFingerprint).find(v=>typeof v==='string'&&v.length>0);
  if(!fingerprint)measurementIssues.push('Model-specific paid request fingerprint missing.');
  if(result.calls.some(c=>c.stage!==request.stage))measurementIssues.push('Ledger stage differs from the selected audit.');
  const seconds=callMetrics.map(m=>m?.seconds);
  const responseSeconds=result.responseWallMs!==undefined?result.responseWallMs/1000:seconds.length===1&&typeof seconds[0]==='number'&&Number.isFinite(seconds[0])&&seconds[0]>=0?seconds[0]:null;
  if(responseSeconds===null)measurementIssues.push('Complete-response time not retained.');
  let parsed:z.infer<typeof FaithfulResponse>|null=null;
  try{parsed=FaithfulResponse.parse(JSON.parse(result.rawResponse.text));}catch{issues.push('Response failed actual FaithfulResponse JSON/schema validation.');}
  const verdicts=parsed?.verdicts??[],evidenceCoverage=parsed?.evidenceCoverage??[];
  if(parsed){
    exactTargets(verdicts.map(v=>v.id),request.payload.sentences.map(s=>s.id),'verdict',issues);
    exactTargets(evidenceCoverage.map(c=>c.evidenceId),request.payload.assessEvidenceIds,'coverage',issues);
    const all=[...request.payload.sentences,...request.payload.otherSentencesCitingAssessedEvidence];
    const accepted=new Set(verdicts.filter(v=>v.accepted&&verdicts.filter(x=>x.id===v.id).length===1&&request.payload.sentences.some(s=>s.id===v.id)).map(v=>v.id));
    for(const s of request.payload.otherSentencesCitingAssessedEvidence)accepted.add(s.id);
    for(const coverage of evidenceCoverage){
      const evidence=request.payload.evidence.find(e=>e.id===coverage.evidenceId);
      if(!evidence){issues.push(`coverage ${coverage.evidenceId}: absent evidence.`);continue;}
      if(new Set(coverage.sentenceIds).size!==coverage.sentenceIds.length)issues.push(`coverage ${coverage.evidenceId}: duplicate sentence references.`);
      for(const id of coverage.sentenceIds)if(!accepted.has(id)||!all.some(s=>s.id===id&&s.evidenceIds.includes(coverage.evidenceId)))issues.push(`coverage ${coverage.evidenceId}: foreign or rejected citing sentence ${id}.`);
      for(const p of coverage.missingPoints)if(!evidence.quotes.some(q=>q.text.includes(p.quote)))issues.push(`coverage ${coverage.evidenceId}: unanchored quote ${JSON.stringify(p.quote)}.`);
      if(coverage.status==='covered'&&(!coverage.sentenceIds.length||coverage.missingPoints.length))issues.push(`coverage ${coverage.evidenceId}: covered status conflicts with accepted citations or missing points.`);
    }
  }
  return {issues,measurementIssues,acceptedCount:verdicts.filter(v=>v.accepted&&request.payload.sentences.some(s=>s.id===v.id)&&verdicts.filter(x=>x.id===v.id).length===1).length,
    settledCostUsd,unknownCalls,unknownUsageCost,responseSeconds,timeBasis:result.responseWallMs!==undefined?'explicit complete-response wall time':'single ledger call seconds',requestFingerprint:typeof fingerprint==='string'?fingerprint:null,
    provider:result.rawResponse.provider??null,servedModel:result.rawResponse.model??null,inputTokens:result.rawResponse.usage.inputTokens,outputTokens:result.rawResponse.usage.outputTokens,rawResponseHash,verdicts,evidenceCoverage};
}
export function compareAuditModels(raw:unknown){
  const data=exportSchema.parse(raw),invalidReasons:string[]=[];
  const ids=data.requests.map(r=>r.videoId);
  if(new Set(ids).size!==ids.length)invalidReasons.push('Select exactly one frozen audit request per video.');
  const knownHashes=new Set(data.requests.map(r=>r.hash));
  for(const r of data.results)if(!ids.includes(r.videoId)||!knownHashes.has(r.requestHash)||![SONNET,HAIKU].includes(r.requestedModel))invalidReasons.push('Foreign result/video/request/model in the comparison export.');
  const videos=data.requests.map(request=>{
    const a=data.results.filter(r=>r.videoId===request.videoId&&r.requestedModel===SONNET),b=data.results.filter(r=>r.videoId===request.videoId&&r.requestedModel===HAIKU);
    if(a.length!==1)invalidReasons.push(`${request.videoId}: no single Sonnet arm.`);
    if(b.length!==1)invalidReasons.push(`${request.videoId}: no single Haiku arm.`);
    const sonnet=inspect(request,a.length===1?a[0]:undefined),haiku=inspect(request,b.length===1?b[0]:undefined);
    for(const [label,arm] of [['sonnet',sonnet],['haiku',haiku]] as const)for(const e of arm.measurementIssues)invalidReasons.push(`${request.videoId}/${label}: ${e}`);
    const disagreements:Array<{target:string;kind:string;sonnet:unknown;haiku:unknown}>=[];
    for(const s of request.payload.sentences){
      const old=sonnet.verdicts.find(v=>v.id===s.id),current=haiku.verdicts.find(v=>v.id===s.id);
      if(old?.accepted!==current?.accepted)disagreements.push({target:s.id,kind:'acceptance',sonnet:old??null,haiku:current??null});
    }
    for(const id of request.payload.assessEvidenceIds){
      const old=sonnet.evidenceCoverage.find(c=>c.evidenceId===id),current=haiku.evidenceCoverage.find(c=>c.evidenceId===id);
      if(old?.status!==current?.status||JSON.stringify(old?.sentenceIds??[])!==JSON.stringify(current?.sentenceIds??[]))disagreements.push({target:id,kind:'coverage',sonnet:old??null,haiku:current??null});
    }
    return {videoId:request.videoId,sourceHash:request.sourceHash,stage:request.stage,originalTraceHash:request.hash,auditInputHash:auditInputHash(request),arms:{sonnet,haiku},disagreements,
      sourceReviewRequired:['Literal financial amounts, units and periods','Actor/action and speaker attribution','Conditional recommendation versus unconditional action','Watch/entry and ownership distinctions','Opposing cases and omitted material evidence','Every changed acceptance or coverage decision']};
  });
  const comparable=invalidReasons.length===0;
  return {version:'audit-model-comparison.v1',networkFree:true,comparable,invalidReasons,fullPilotCohort:cohort.every(id=>ids.includes(id))&&ids.length===cohort.length,
    qualityVerdict:videos.some(v=>v.arms.sonnet.issues.length||v.arms.haiku.issues.length)?'failed':'review-required',
    caveats:['Decision agreement is not verified accuracy.','Three selected stage pairs are not an end-to-end benchmark, population quality estimate or p95.','Costs exclude source acquisition and infrastructure; unknown costs remain unknown.','Do not retry a possibly paid unknown outcome merely to complete this comparison.'],
    videos:videos.map(v=>({...v,improvement:comparable?{costUsd:v.arms.sonnet.settledCostUsd!-v.arms.haiku.settledCostUsd!,responseSeconds:v.arms.sonnet.responseSeconds!-v.arms.haiku.responseSeconds!}:null}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const index=process.argv.indexOf('--input');if(index<0||!process.argv[index+1])throw Error('Required --input retained-comparison.json');
  const result=compareAuditModels(JSON.parse(readFileSync(process.argv[index+1],'utf8')));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');if(!result.comparable||result.qualityVerdict==='failed')process.exitCode=1;
}
