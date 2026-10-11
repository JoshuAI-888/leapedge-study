/** Offline hosted-worker campaign staging/export. This script never connects to
 * a DB/provider. Execute one reviewed parameterized transaction externally,
 * then reconcile its root AND automatic brief before staging another arm.
 * --mode plan --input exported-roots.json --output campaign.json --budget-cap-usd 5
 * --mode stage --input campaign.json --output arm.json --ordinal 1
 * --mode summarize --input campaign.json --export remote-export.json --output summary.json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { TeamPreferences } from '../src/features/youtube-intelligence/settings.ts';
import { researchPipelineIdentityFromInput } from '../src/features/youtube-intelligence/research-pipeline-choice.ts';
import { controlledInput } from './benchmark-controlled-models.ts';
import { auditResponseHash } from './compare-audit-models.ts';
import { iso } from '../src/server/youtube-intelligence/database.ts';

const Record=z.record(z.string(),z.unknown());
function record(raw:unknown):globalThis.Record<string,unknown>{return Record.parse(typeof raw==='string'?JSON.parse(raw):raw??{});}
const Cap=z.object({id:z.uuid(),maxUsd:z.number().finite().positive().max(5)});
const Variant=z.enum(['baseline','candidate','haiku']);
const Arm=z.object({ordinal:z.number().int().min(1).max(9),runId:z.uuid(),variant:Variant,videoId:z.string(),originalSourceRunId:z.string(),
 model:z.string(),title:z.string(),createdAt:z.iso.datetime(),sourceHash:z.string(),sourceBytesHash:z.string(),
 input:Record,output:Record});
// Keep campaign marker typed while retaining all frozen settings/prompt fields.
const TypedArm=Arm.extend({input:z.looseObject({benchmarkCampaign:Cap})});
const Campaign=z.object({version:z.literal('hosted-model-benchmark.v1'),id:z.uuid(),maxUsd:z.number().finite().positive().max(5),
 generatedAt:z.iso.datetime(),sourceAcquisitionIncluded:z.literal(false),arms:z.array(TypedArm).length(9)});
type CampaignData=z.infer<typeof Campaign>;
const videos=['_mEvVWGfmjU','Mepjkm_0ns4','fSx-Ho8mi18'];

export function createHostedCampaign(raw:unknown,maxUsd:number):CampaignData{
 const roots=z.array(Record).parse(Array.isArray(raw)?raw:record(raw).roots),id=randomUUID(),cap=Cap.parse({id,maxUsd});
 if(roots.length!==3)throw Error('Exactly the three approved frozen source roots are required.');
 const arms:unknown[]=[];
 for(const [index,videoId] of videos.entries()){
  const matches=roots.filter(r=>(r.videoId??r.video_id)===videoId);
  if(matches.length!==1)throw Error(`Exactly one source root is required for ${videoId}.`);
  const root=matches[0],output=record(root.output),originalInput=record(root.input);
  if(!output.source)throw Error(`No retained source for ${videoId}.`);
  const sourceHash=z.string().min(1).parse(output.sourceHash??originalInput.sourceHash);
  const createdAt=z.iso.datetime().parse(iso(root.createdAt??root.created_at));
  const sourceRunId=z.string().min(1).parse(root.id),identity=researchPipelineIdentityFromInput(originalInput);
  // Latin order spreads each treatment across first/second/third position.
  const orders=[['baseline','candidate','haiku'],['candidate','haiku','baseline'],['haiku','baseline','candidate']] as const;
  const order=orders[index];
  for(const variant of order){
   const input=controlledInput(originalInput,variant);
   // Normal analyst/readability surfaces accept source roots with no task.
   // Hosted experiment identity belongs in metadata, not dispatch/UI task type.
   delete input.task;
   // A control must not retain the previous run's efficiency opt-in either.
   if(variant==='baseline')delete input.efficiencyVersion;
   const ordinal=arms.length+1,runId=randomUUID();
   input.origin='manual';input.processingMode='interactive';input.benchmarkCampaign=cap;
   input.benchmarkExperiment={version:'hosted-source-fixed.v1',ordinal,variant,originalSourceRunId:sourceRunId,asOf:createdAt,sourceHash};
   input.researchPipeline=identity.pipeline;input.researchPipelineVersion=identity.version;input.researchPipelineIdentity=identity;
   const frozen={source:structuredClone(output.source),sourceHash,metadata:structuredClone(output.metadata),coverage:structuredClone(output.coverage)};
   const team=TeamPreferences.parse(input.teamPreferencesSnapshot);
   arms.push({ordinal,runId,variant,videoId,originalSourceRunId:sourceRunId,model:z.string().parse(root.model??team.models.extraction.id),
    // queueSourceBrief copies this title into the synthesis snapshot. Keep it
    // identical across treatments; experiment identity stays in input metadata.
    title:String(root.title??videoId),createdAt,sourceHash,sourceBytesHash:auditResponseHash(frozen.source),input,output:frozen});
  }
 }
 return Campaign.parse({version:'hosted-model-benchmark.v1',id,maxUsd,generatedAt:new Date().toISOString(),sourceAcquisitionIncluded:false,arms});
}

function validateCampaign(raw:unknown){
 const campaign=Campaign.parse(raw);
 if(new Set(campaign.arms.map(a=>a.runId)).size!==9)throw Error('Campaign run IDs must be unique.');
 for(const [i,arm] of campaign.arms.entries()){
  if(arm.input.task!==undefined)throw Error('Hosted source roots must omit task for normal analyst-view behavior.');
  if(arm.ordinal!==i+1||arm.input.benchmarkCampaign.id!==campaign.id||arm.input.benchmarkCampaign.maxUsd!==campaign.maxUsd)throw Error('Campaign identity/cap/ordinal mismatch.');
  if(auditResponseHash(arm.output.source)!==arm.sourceBytesHash||arm.output.sourceHash!==arm.sourceHash)throw Error('Campaign frozen source integrity mismatch.');
 }
 return campaign;
}

export function stageHostedArm(raw:unknown,ordinal:number,now=new Date().toISOString()){
 const campaign=validateCampaign(raw);z.number().int().min(1).max(9).parse(ordinal);z.iso.datetime().parse(now);
 const arm=campaign.arms[ordinal-1],team=TeamPreferences.parse(arm.input.teamPreferencesSnapshot);
 // SQL/params are deliberately separate. Callers must bind parameters or use a
 // trusted SQL literal serializer, never shell-interpolate the retained text.
 const sql=`BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended($1,0));
WITH admission AS (
 SELECT 1 WHERE
  NOT EXISTS (SELECT 1 FROM yi_runs WHERE id=$2)
  AND (SELECT COUNT(*) FROM yi_runs WHERE (input::jsonb)->'benchmarkCampaign'->>'id'=$3 AND (input::jsonb)->'benchmarkExperiment'->>'version'='hosted-source-fixed.v1')=$14
  AND NOT EXISTS (SELECT 1 FROM yi_runs r WHERE (r.input::jsonb)->'benchmarkCampaign'->>'id'=$3 AND r.status<>'completed')
  AND NOT EXISTS (SELECT 1 FROM yi_calls c JOIN yi_runs r ON r.id=c.run_id WHERE (r.input::jsonb)->'benchmarkCampaign'->>'id'=$3 AND c.status NOT IN ('completed','released'))
  AND NOT EXISTS (SELECT 1 FROM yi_runs r WHERE (r.input::jsonb)->'benchmarkCampaign'->>'id'=$3 AND (r.input::jsonb)->'benchmarkExperiment'->>'version'='hosted-source-fixed.v1'
   AND NOT EXISTS (SELECT 1 FROM yi_runs child WHERE (child.input::jsonb)->>'task'='research-brief' AND (child.input::jsonb)->'snapshot'->>'sourceRunId'=r.id
    AND (child.input::jsonb)->'benchmarkCampaign'->>'id'=$3 AND child.status='completed'))
)
INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output)
 SELECT $2,$4,$5,$6,$7,$8,'queued','synthesis',$9,$10,$11,$12 FROM admission ON CONFLICT(id) DO NOTHING;
INSERT INTO jobs(id,kind,payload,status,run_after,created_at,updated_at)
 SELECT $13,'analyze',jsonb_build_object('runId',$2::text),'queued',$10,$10,$10
 WHERE EXISTS (SELECT 1 FROM yi_runs r WHERE r.id=$2 AND r.status IN ('queued','running') AND r.input::jsonb=$11::jsonb AND r.output::jsonb=$12::jsonb)
 ON CONFLICT(id) DO NOTHING;
SELECT id,status,stage,input,output FROM yi_runs WHERE id=$2;
COMMIT;`;
 return {version:'hosted-arm-staging.v1',campaignId:campaign.id,ordinal,runId:arm.runId,variant:arm.variant,sourceHash:arm.sourceHash,
  sourceAcquisitionIncluded:false,sql,parameters:[`hosted-benchmark:${campaign.id}`,arm.runId,campaign.id,arm.videoId,`https://www.youtube.com/watch?v=${arm.videoId}`,
   arm.model,team.prompts.version,arm.title,arm.createdAt,now,JSON.stringify(arm.input),JSON.stringify(arm.output),`analyze:${arm.runId}`,ordinal-1],
  admissionNote:'Only one root is admitted. Previous campaign roots and automatic children must be completed; uncertain calls block the next arm. Existing run/job IDs are never reset. An empty returned row means admission refused.',
  workerRequirements:['Normal reservation must enforce benchmarkCampaign atomically under the existing budget advisory lock.','Automatic research child must inherit benchmarkCampaign and frozen model/settings/pipeline/as-of treatment.','Do not stage further arms until root and child ledger/raw responses are reconciled.']};
}

/** PostgreSQL literals for read-only review/connector tools without bind args.
 * E-string escaping handles both apostrophes and backslashes without relying
 * on a session's standard_conforming_strings setting. No shell interpolation.
 */
export function postgresLiteral(value:unknown):string{
 if(value===null)return 'NULL';
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Non-finite SQL parameter.');return String(value);}
 if(typeof value==='boolean')return value?'TRUE':'FALSE';
 if(Array.isArray(value))return `ARRAY[${value.map(postgresLiteral).join(',')}]::text[]`;
 if(typeof value!=='string'||value.includes('\u0000'))throw Error('Unsupported SQL parameter.');
 return `E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
}
export function renderPostgresSQL(sql:string,parameters:unknown[]){
 // One pass: dollar signs inside newly quoted payloads are never substituted.
 return sql.replace(/\$(\d+)\b/g,(_match,index:string)=>{
  const i=Number(index)-1;if(i<0||i>=parameters.length)throw Error('Missing SQL bind parameter.');return postgresLiteral(parameters[i]);
 });
}

/** Read-only connector queries scoped to campaign roots AND their source briefs.
 * Child joins do not depend on cap inheritance, so a missing marker is visible.
 */
export function hostedExportQueries(raw:unknown){
 const campaign=validateCampaign(raw),ids=campaign.arms.map(a=>a.runId);
 const scope=`SELECT id FROM yi_runs WHERE id=ANY($1::text[]) OR ((input::jsonb)->>'task'='research-brief' AND (input::jsonb)->'snapshot'->>'sourceRunId'=ANY($1::text[]))`;
 return {parameters:[ids],queries:{runs:`SELECT * FROM yi_runs WHERE id IN (${scope}) ORDER BY created_at,id`,calls:`SELECT * FROM yi_calls WHERE run_id IN (${scope}) ORDER BY run_id,stage,id`,
  responses:`SELECT * FROM yi_responses WHERE run_id IN (${scope}) ORDER BY created_at,id`,timings:`SELECT * FROM yi_stage_timings WHERE run_id IN (${scope}) ORDER BY claimed_at,id`},
  briefsNote:'Include exact researchBrief documents for discovered child IDs using the existing document store export; never export credentials or unrelated documents.'};
}

export function summarizeHostedCampaign(rawCampaign:unknown,rawExport:unknown){
 const campaign=validateCampaign(rawCampaign),exported=record(rawExport);
 const rows=(key:string)=>z.array(Record).parse(exported[key]??[]);
 const runs=rows('runs').map((r):globalThis.Record<string,unknown>&{input:globalThis.Record<string,unknown>;output:globalThis.Record<string,unknown>}=>({...r,input:record(r.input),output:record(r.output)}));
 const rootIds=new Set(campaign.arms.map(a=>a.runId));
 const selected=runs.filter(r=>rootIds.has(String(r.id))||r.input.task==='research-brief'&&rootIds.has(String(record(r.input.snapshot).sourceRunId)));
 const selectedIds=new Set(selected.map(r=>String(r.id)));
 const scoped=(key:string)=>rows(key).filter(r=>selectedIds.has(String(r.run_id??r.runId)));
 const calls=scoped('calls'),responses=scoped('responses'),timings=scoped('timings').map((t):globalThis.Record<string,unknown>&{claimed_at:string|null;finished_at:string|null}=>({...t,claimed_at:iso(t.claimed_at),finished_at:iso(t.finished_at)})),briefs=scoped('briefs');
 const arms=campaign.arms.map(arm=>{
  const root=selected.find(r=>r.id===arm.runId),children=selected.filter(r=>r.input.task==='research-brief'&&record(r.input.snapshot).sourceRunId===arm.runId);
  const ids=new Set([arm.runId,...children.map(r=>String(r.id))]),paid=calls.filter(c=>ids.has(String(c.run_id??c.runId))),steps=timings.filter(t=>ids.has(String(t.run_id??t.runId)));
  const issues:string[]=[];
  if(root){
   if(auditResponseHash(root.output.source)!==arm.sourceBytesHash)issues.push('Retained source bytes differ from the frozen campaign source.');
   if(root.output.sourceHash!==arm.sourceHash)issues.push('Retained source hash differs from the frozen campaign source.');
   for(const r of [root,...children]){
    const marker=Cap.safeParse(r.input.benchmarkCampaign);
    if(!marker.success||marker.data.id!==campaign.id||marker.data.maxUsd!==campaign.maxUsd)issues.push(`Missing/changed campaign marker on ${r.id}.`);
   }
   if(children.length!==1)issues.push('Expected exactly one automatic research child.');
   if(root.status!=='completed'||children.some(c=>c.status!=='completed'))issues.push('Root and child have not both completed.');
  }
  const uncertain=paid.filter(c=>!['completed','released'].includes(String(c.status)));
  if(uncertain.length)issues.push('Unsettled or unknown calls prevent a settled total.');
  const committed=paid.filter(c=>c.status!=='released');
  const amounts=committed.map(c=>Number(c.amount));
  if(amounts.some(n=>!Number.isFinite(n)||n<0))issues.push('Invalid retained ledger amount.');
  const committedUsd=amounts.every(n=>Number.isFinite(n)&&n>=0)?amounts.reduce((a,b)=>a+b,0):null;
  const complete=!!root&&root.status==='completed'&&children.length===1&&children[0].status==='completed';
  const execution=steps.map(t=>Number(t.execution_ms));
  const unfinishedTiming=steps.some(t=>!t.finished_at||t.execution_ms==null);
  if(complete&&(!steps.length||unfinishedTiming))issues.push('Stage timing export is incomplete.');
  const queue=steps.map(t=>Number(t.queue_ms)),checkpoints=steps.map(t=>Number(t.checkpoint_ms));
  const normalized=responses.filter(r=>ids.has(String(r.run_id??r.runId))&&String(r.id).endsWith(':normalized'));
  for(const call of paid.filter(c=>c.status==='completed')){
   const metrics=record(call.metrics),provider=typeof metrics.provider==='string'?metrics.provider.toLowerCase():'';
   // Jev's typed probability answers are checkpointed under faithfulAudit.preScreen,
   // not modelCall's text envelope. Search/other native ledger calls also have
   // their own records; keep all raw evidence without demanding that envelope.
   const jev=provider==='typesafe'||/^prescreen-jev(?:-|$)|^compare-prescreen-jev(?:-|$)/.test(String(call.stage));
   const generative=!jev&&(typeof metrics.requestFingerprint==='string'||/^synthesis(?:-|$)|^critique(?:-|$)|^translate(?:-|$)|^transcribe(?:-|$)/.test(String(call.stage)));
   if(generative&&!normalized.some(r=>r.id===`${call.id}:normalized`))issues.push(`Missing retained normalized response for ${call.id}.`);
  }
  const latest=steps.map(t=>Date.parse(t.finished_at??'')).filter(Number.isFinite),earliest=steps.map(t=>Date.parse(t.claimed_at??'')).filter(Number.isFinite);
  // created_at is frozen as-of, so it must NEVER stand in for submission time.
  const firstStage=steps.filter(t=>(t.run_id??t.runId)===arm.runId).sort((a,b)=>(a.claimed_at??'').localeCompare(b.claimed_at??''))[0];
  const submitted=firstStage&&Number.isFinite(Date.parse(firstStage.claimed_at??''))&&Number.isFinite(Number(firstStage.queue_ms))?Date.parse(firstStage.claimed_at??'')-Number(firstStage.queue_ms):null;
  const retainedPublishedAt=iso(root?.output.checkedFindingsPublishedAt);
  const validPublication=z.iso.datetime().safeParse(retainedPublishedAt);
  let firstCheckedAt=validPublication.success?validPublication.data:null;
  let firstCheckedTimingBasis:'publication-checkpoint'|'root-completion'|'unavailable'=firstCheckedAt?'publication-checkpoint':'unavailable';
  if(root?.output.checkedFindingsPublishedAt!==undefined&&!validPublication.success)issues.push('Invalid retained checked-findings publication timestamp.');
  // A legacy baseline has no incremental publication checkpoint. Its final
  // root checkpoint is an explicitly labelled approximation, not critique time.
  if(firstCheckedAt===null&&arm.variant==='baseline'&&root?.status==='completed'){
   const finishedRoot=steps.filter(t=>(t.run_id??t.runId)===arm.runId).map(t=>Date.parse(t.finished_at??'')).filter(Number.isFinite);
   if(finishedRoot.length){firstCheckedAt=new Date(Math.max(...finishedRoot)).toISOString();firstCheckedTimingBasis='root-completion';}
  }
  const checkedInstant=firstCheckedAt===null?null:Date.parse(firstCheckedAt);
  let firstCheckedSeconds=submitted!==null&&checkedInstant!==null?(checkedInstant-submitted)/1000:null;
  if(firstCheckedSeconds!==null&&firstCheckedSeconds<0){issues.push('Checked-findings publication timestamp precedes actual submission.');firstCheckedSeconds=null;firstCheckedTimingBasis='unavailable';}
  if(firstCheckedSeconds===null)firstCheckedTimingBasis='unavailable';
  return {ordinal:arm.ordinal,variant:arm.variant,videoId:arm.videoId,runId:arm.runId,childRunIds:children.map(c=>c.id),status:root?complete?'completed':String(root.status):'not-staged',sourceHash:arm.sourceHash,
   sourceBytesHash:arm.sourceBytesHash,asOf:arm.createdAt,comparable:complete&&!issues.length,issues,committedUsd,settledCostUsd:complete&&!uncertain.length?committedUsd:null,
   unknownCalls:paid.filter(c=>c.status==='unknown').length,unsettledCalls:uncertain.length,paidCalls:paid.filter(c=>c.status==='completed').length,
   executionSeconds:steps.length&&!unfinishedTiming&&execution.every(Number.isFinite)?execution.reduce((a,b)=>a+b,0)/1000:null,
   queueSeconds:steps.length&&queue.every(Number.isFinite)?queue.reduce((a,b)=>a+b,0)/1000:null,
   checkpointSeconds:steps.length&&!unfinishedTiming&&checkpoints.every(Number.isFinite)?checkpoints.reduce((a,b)=>a+b,0)/1000:null,
   firstCheckedAt,firstCheckedSeconds,firstCheckedTimingBasis,
   observedWorkSpanSeconds:complete&&latest.length&&earliest.length?(Math.max(...latest)-Math.min(...earliest))/1000:null,
   observedSubmissionToBriefSeconds:complete&&submitted!==null&&latest.length?(Math.max(...latest)-submitted)/1000:null};
 });
 return {version:'hosted-model-summary.v1',campaignId:campaign.id,maxUsd:campaign.maxUsd,sourceAcquisitionIncluded:false,qualityVerdict:'review-required',
  note:'Stage/pipeline observations only; semantic quality requires literal source, actor/condition, safety and coverage review. No population latency or accuracy claim from this cohort.',arms,
  raw:{runs:selected,calls,responses,timings,briefs},exportQueries:hostedExportQueries(campaign)};
}

function main(){
 const {values}=parseArgs({options:{mode:{type:'string'},input:{type:'string'},output:{type:'string'},'sql-output':{type:'string'},export:{type:'string'},ordinal:{type:'string'},'budget-cap-usd':{type:'string'}}});
 if(!values.input||!values.output)throw Error('Require --input and a new --output path.');
 const input=JSON.parse(readFileSync(values.input,'utf8'));let result:unknown;
 if(values.mode==='plan')result=createHostedCampaign(input,Number(values['budget-cap-usd']));
 else if(values.mode==='stage'){
  const staged=stageHostedArm(input,Number(values.ordinal));result=staged;
  if(values['sql-output'])writeFileSync(values['sql-output'],renderPostgresSQL(staged.sql,staged.parameters)+'\n',{flag:'wx',mode:0o600});
 }
 else if(values.mode==='summarize'&&values.export)result=summarizeHostedCampaign(input,JSON.parse(readFileSync(values.export,'utf8')));
 else throw Error('Use --mode plan|stage|summarize; summarize requires --export.');
 writeFileSync(values.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({mode:values.mode,output:values.output,offline:true}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
