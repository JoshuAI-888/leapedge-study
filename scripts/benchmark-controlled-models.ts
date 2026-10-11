/** Explicit, bounded live pilot using normal modelCall reservations and durable responses.
 * Default is a dry plan. No credentials in artifacts. Live requires persistent Postgres.
 * --mode audit|pipeline --input retained-traces.json --output new-export.json
 * --budget-cap-usd <remaining task allocation, <=5> --live [--variant baseline|candidate|haiku]
 * Existing output is never overwritten or automatically resumed after an uncertain outcome.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { TeamPreferences } from '../src/features/youtube-intelligence/settings.ts';
import { AuditedExecutionPlan } from '../src/features/youtube-intelligence/audited-execution.ts';
import { auditInputHash, auditResponseHash } from './compare-audit-models.ts';

const object=z.record(z.string(),z.unknown());
const Trace=z.looseObject({runId:z.string().min(1),stage:z.string().startsWith('critique-faithful-'),model:z.literal('anthropic/claude-sonnet-5'),
 prompt:z.string().min(1),payload:object,responseSchema:object,maxOutputTokens:z.number().int().positive(),reasoningEffort:z.literal('low'),settings:TeamPreferences,hash:z.string().min(1)});
type TraceData=z.infer<typeof Trace>;
const Mapping=z.record(z.string(),z.object({videoId:z.string().min(1),sourceHash:z.string().min(1)}));
const videos=['_mEvVWGfmjU','Mepjkm_0ns4','fSx-Ho8mi18'];
const SONNET='anthropic/claude-sonnet-5',HAIKU='anthropic/claude-haiku-5.5';
type Variant='baseline'|'candidate'|'haiku';
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function auditPairs(raw:unknown,mappingRaw:unknown){
 const traces=z.array(Trace).parse(raw),mapping=Mapping.parse(mappingRaw);
 return videos.flatMap((videoId,index)=>{
  const candidates=traces.filter(t=>mapping[t.runId]?.videoId===videoId).sort((a,b)=>Buffer.byteLength(JSON.stringify(b.payload))-Buffer.byteLength(JSON.stringify(a.payload))||a.stage.localeCompare(b.stage)||a.hash.localeCompare(b.hash));
  const trace=candidates[0];if(!trace)throw Error(`No retained audit for ${videoId}.`);
  const request={...structuredClone(trace),...mapping[trace.runId]};
  const order=index%2?[HAIKU,SONNET]:[SONNET,HAIKU];
  return order.map(model=>({request,model}));
 });
}
/** Never lift an existing lifetime/workspace limit. Parent supplies remaining shared allocation. */
export function benchmarkBudgetCeiling(existing:number|undefined,used:number,allocation:number){
 z.number().finite().nonnegative().parse(used);z.number().finite().positive().max(5).parse(allocation);
 if(existing!==undefined)z.number().finite().nonnegative().parse(existing);
 const ceiling=Math.min(existing??Infinity,used+allocation);if(ceiling<=used)throw Error('Existing budget has no available headroom.');return ceiling;
}
/** Treatment is frozen in every new root; original source settings remain unmodified. */
export function controlledInput(raw:Record<string,unknown>,variant:Variant){
 const input=structuredClone(raw);
 const settings=TeamPreferences.parse(input.teamPreferencesSnapshot);
 settings.processing.auditedSpeed=false;settings.processing.parallelVideos=1;settings.processing.maxRetriesPerStage=0;
 input.task='source-model-benchmark';input.teamPreferencesSnapshot=settings;
 input.speculativeResearch=false;input.reuseResearchCache=false;
 delete input.auditedExecutionPlan;delete input.publicationSafeguardsVersion;
 for(const key of ['recoveryOf','recoveryBatch','productionSample','automaticMonitoring','snapshot','sourceRunId'])delete input[key];
 if(variant!=='baseline'){
  input.auditedExecutionPlan=AuditedExecutionPlan.parse({version:'audited-speed.v1',criticRouting:'default'});
  input.publicationSafeguardsVersion='atomic-publication.v1';input.efficiencyVersion='evidence-efficiency.v1';
 }
 if(variant==='haiku'){
  settings.models.critique.id=HAIKU;settings.models.critique.transport='openrouter';
  settings.models.context.id=HAIKU;settings.models.context.transport='openrouter';
  input.criticModel=HAIKU;
 }
 return input;
}
type DriverRun={stage:string;status:string;output:Record<string,unknown>;error:string|null};
/** While model work runs, persisted rows stay paused and have no queue job. */
export async function drivePausedRun<T extends DriverRun>(run:T,runtime:{step:(run:T)=>Promise<void>;save:(run:T)=>Promise<void>;checkpoint:()=>Promise<void>;onTiming?:(timing:{stage:string;executionMs:number;checkpointMs:number})=>void},limit=80){
 const timings:Array<{stage:string;executionMs:number;checkpointMs:number}>=[];run.status='running';
 for(let i=0;run.status==='running'&&i<limit;i++){
  const stage=run.stage,start=performance.now();
  try{await runtime.step(run);}catch(error){run.status='failed';run.error=safeError(error);}
  const executionMs=performance.now()-start,checkpoint=performance.now(),memoryStatus=run.status;
  if(memoryStatus==='running')run.status='paused';await runtime.save(run);run.status=memoryStatus;
  const timing={stage,executionMs,checkpointMs:performance.now()-checkpoint};timings.push(timing);runtime.onTiming?.(timing);await runtime.checkpoint();
 }
 if(run.status==='running'){run.status='failed';run.error='Benchmark step limit reached.';await runtime.save(run);await runtime.checkpoint();}
 return {status:run.status,error:run.error,timings};
}
function safeError(error:unknown){
 let message=error instanceof Error?error.message:String(error);
 for(const name of ['OPENROUTER_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY','TYPESAFE_API_KEY','CHEAPER_INFERENCE_API_KEY','DATABASE_URL','DATABASE_URL_UNPOOLED']){
  const secret=process.env[name];if(secret)message=message.replaceAll(secret,'[redacted]');
 }
 return message.slice(0,1600);
}
async function main(){
 const {values}=parseArgs({options:{mode:{type:'string'},input:{type:'string'},output:{type:'string'},live:{type:'boolean',default:false},'budget-cap-usd':{type:'string'},variant:{type:'string'}}});
 if(!['audit','pipeline'].includes(values.mode??'')||!values.input||!values.output)throw Error('Required --mode audit|pipeline --input retained-traces.json --output new-export.json.');
 const traces=z.array(Trace).parse(JSON.parse(readFileSync(values.input,'utf8')));
 if(!values.live){process.stdout.write(JSON.stringify({live:false,mode:values.mode,retainedTraces:traces.length,videoCount:3,maxPaidCalls:values.mode==='audit'?6:null,note:'No DB or provider access. Live requires persistent DB, explicit remaining allocation and a new output path.'},null,2)+'\n');return;}
 if(process.env.YTI_DB==='pglite'||!process.env.DATABASE_URL)throw Error('Live pilot requires a persistent configured Postgres database, never in-memory PGlite.');
 if(!process.env.OPENROUTER_API_KEY)throw Error('OPENROUTER_API_KEY is not configured.');
 const allocation=z.number().finite().positive().max(5).parse(Number(values['budget-cap-usd']));
 const variant=values.variant===undefined?null:z.enum(['baseline','candidate','haiku']).parse(values.variant);
 // Claim the destination before any DB write or paid call. A failed process
 // leaves run IDs for read-only reconciliation instead of inviting a repeat.
 writeFileSync(values.output,JSON.stringify({state:'initializing',paidWorkStarted:false}),{flag:'wx',mode:0o600});
 process.env.YTI_QUEUE_PAUSED='true';process.env.YTI_EMAIL_SEND_ENABLED='false';
 const {database}=await import('../src/server/youtube-intelligence/database.ts');
 const S=await import('../src/server/youtube-intelligence/store.ts');
 const {modelCall,step}=await import('../src/server/youtube-intelligence/pipeline.ts');
 const {researchStep}=await import('../src/server/youtube-intelligence/research-pipeline.ts');
 const {researchEvidenceInventoryWithDiagnostics}=await import('../src/server/youtube-intelligence/research-evidence-inventory.ts');
 const {analysisContext}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const {claimsForRun}=await import('../src/server/youtube-intelligence/repos/claims.ts');
 const {docs}=await import('../src/server/youtube-intelligence/research-store.ts');
 const {researchPipelineIdentityFromInput}=await import('../src/features/youtube-intelligence/research-pipeline-choice.ts');
 type Run=NonNullable<Awaited<ReturnType<typeof S.get>>>;
 const output:Record<string,unknown>={version:'controlled-model-pilot.v1',mode:values.mode,allocationUsd:allocation,state:'running',sourceAcquisitionIncluded:false,
  requests:[],results:[],failures:[],manifest:[],runs:[],calls:[],responses:[],briefs:[],timings:[],readinessScope:'Experimental stage/pipeline results; no verified accuracy or population latency claim.'};
 const ids:string[]=[];
 async function saveExport(){
  output.runs=await Promise.all(ids.map(id=>S.get(id)));
  output.calls=ids.length?await database.prepare('SELECT * FROM yi_calls WHERE run_id=ANY($1::text[]) ORDER BY id').all(ids):[];
  output.responses=ids.length?await database.prepare('SELECT * FROM yi_responses WHERE run_id=ANY($1::text[]) ORDER BY created_at,id').all(ids):[];
  output.briefs=(await docs<{runId:string}>('researchBrief')).filter(b=>ids.includes(b.runId));
  const temp=values.output+'.writing';writeFileSync(temp,JSON.stringify(output,null,2)+'\n',{mode:0o600});renameSync(temp,values.output!);
 }
 async function persist(run:Run){await database.prepare('UPDATE yi_runs SET title=$1,status=$2,stage=$3,input=$4,output=$5,error=$6,updated_at=$7 WHERE id=$8').run(run.title,run.status,run.stage,JSON.stringify(run.input),JSON.stringify(run.output),run.error,new Date().toISOString(),run.id);}
 async function insert(videoId:string,model:string,input:Record<string,unknown>,stage:string,createdAt:string,title:string,initialOutput:Record<string,unknown>={}){
  const id=randomUUID(),now=new Date().toISOString();
  await database.prepare('INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)').run(id,videoId,`https://www.youtube.com/watch?v=${videoId}`,model,String(TeamPreferences.parse(input.teamPreferencesSnapshot).prompts.version),title,'paused',stage,createdAt,now,JSON.stringify(input),JSON.stringify(initialOutput));
  ids.push(id);await saveExport();return (await S.get(id))!;
 }
 try{
  const used=Number((await database.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM yi_calls WHERE status<>'released'").get() as {total:unknown}).total);
  const old=process.env.YTI_BUDGET_USD;process.env.YTI_BUDGET_USD=String(benchmarkBudgetCeiling(old===undefined?undefined:Number(old),used,allocation));
  output.budget={initialGlobalCommitmentUsd:used,effectiveLifetimeCeilingUsd:Number(process.env.YTI_BUDGET_USD),note:'Includes any competing DB spend; tighter current workspace/per-video limits also apply. Parent allocation must already subtract prior task spend.'};
  const mapping:Record<string,{videoId:string;sourceHash:string}>={};
  const roots=new Map<string,Run>();
  for(const childId of new Set(traces.map(t=>t.runId))){
   const child=await S.get(childId);if(!child)throw Error('Retained source child is unavailable.');
   const snapshot=z.object({sourceRunId:z.string()}).parse(child.input.snapshot);
   const root=await S.get(snapshot.sourceRunId);if(!root?.output.source)throw Error('Retained source root has no frozen source.');
   const sourceHash=typeof root.output.sourceHash==='string'?root.output.sourceHash:digest(root.output.source);
   mapping[childId]={videoId:root.videoId,sourceHash};roots.set(root.videoId,root);
  }
  if(values.mode==='audit'){
   const pairs=auditPairs(traces,mapping);output.requests=pairs.filter((_,i)=>i%2===0).map(p=>p.request);
   for(const {request,model} of pairs){
    const settings=structuredClone(request.settings);settings.models.critique={...settings.models.critique,id:model,transport:'openrouter'};settings.processing.maxRetriesPerStage=0;
    settings.budget.perVideoMaxUsd=Math.min(settings.budget.perVideoMaxUsd,allocation);
    const run=await insert(request.videoId,model,{task:'audit-model-comparison',teamPreferencesSnapshot:settings,experiment:{version:'audit-model-comparison.v1',originalTraceHash:request.hash,auditInputHash:auditInputHash(request)},sourceHash:request.sourceHash},request.stage,new Date().toISOString(),`Audit model comparison · ${request.videoId}`,{sourceHash:request.sourceHash});
    (output.manifest as unknown[]).push({videoId:request.videoId,runId:run.id,model,requestHash:request.hash});await saveExport();
    const start=performance.now();let error:string|null=null;
    try{run.output.comparisonResult=await modelCall(run,request.stage,model,request.prompt,request.payload,false,{settings,responseSchema:request.responseSchema,maxOutputTokens:request.maxOutputTokens,reasoningEffort:request.reasoningEffort});run.status='completed';}
    catch(e){error=safeError(e);run.status='failed';run.error=error;}
    const responseWallMs=performance.now()-start;await persist(run);
    const calls=await database.prepare('SELECT * FROM yi_calls WHERE run_id=$1 ORDER BY attempt,id').all(run.id);
    const call=calls.at(-1) as {id?:string}|undefined;
    const normalized=call?.id?await S.retainedResponse(call.id+':normalized'):undefined;
    const uncertain=calls.some(c=>(c as {status?:unknown}).status!=='completed')||normalized!==undefined&&(normalized as {usage?:{costUsd?:unknown}}).usage?.costUsd==null;
    if(normalized)(output.results as unknown[]).push({videoId:request.videoId,requestHash:request.hash,auditInputHash:auditInputHash(request),requestedModel:model,runId:run.id,rawResponse:normalized,rawResponseHash:auditResponseHash(normalized),calls,responseWallMs,error});
    if(error||!normalized||uncertain)(output.failures as unknown[]).push({videoId:request.videoId,runId:run.id,model,error:error??(uncertain?'Uncertain outcome/cost; remaining calls stopped.':'No normalized response retained.'),calls});
    await saveExport();console.log(JSON.stringify({mode:'audit',videoId:request.videoId,model,runId:run.id,status:run.status,seconds:responseWallMs/1000}));
    if(error||!normalized||uncertain){output.state='stopped-after-failure';break;}
   }
  }else{
   for(const [index,videoId] of videos.entries()){
    const original=roots.get(videoId);if(!original)throw Error(`No frozen source for ${videoId}.`);
    const order:Variant[]=variant?[variant]:index%2?['candidate','baseline','haiku']:['baseline','candidate','haiku'];
    for(const treatment of order){
     const input=controlledInput(original.input,treatment),settings=TeamPreferences.parse(input.teamPreferencesSnapshot);
     input.researchPipelineIdentity=researchPipelineIdentityFromInput(original.input);
     input.researchPipeline=input.researchPipelineIdentity && (input.researchPipelineIdentity as {pipeline:string}).pipeline;
     const frozenSource=structuredClone({source:original.output.source,metadata:original.output.metadata,sourceHash:mapping[traces.find(t=>mapping[t.runId]?.videoId===videoId)!.runId].sourceHash,coverage:original.output.coverage});
     const root=await insert(videoId,original.model,input,'synthesis',original.createdAt,`Benchmark ${treatment} · ${original.title}`,frozenSource);
     const childInput={task:'research-brief',snapshot:{sourceRunId:root.id},teamPreferencesSnapshot:settings,criticModel:settings.models.critique.id,promptSnapshot:original.input.promptSnapshot,
      pipelineVersion:'research-brief.v1',webResearch:false,researchPipeline:input.researchPipeline,researchPipelineVersion:input.researchPipelineVersion,researchPipelineIdentity:input.researchPipelineIdentity,
      efficiencyVersion:input.efficiencyVersion,speculativeResearch:false,reuseResearchCache:false,auditedExecutionPlan:input.auditedExecutionPlan,publicationSafeguardsVersion:input.publicationSafeguardsVersion};
     const child=await insert(videoId,settings.models.extraction.id,childInput,'metadata',original.createdAt,`Benchmark ${treatment} brief · ${original.title}`,{researchBaseline:[]});
     const queuedAt=new Date().toISOString(),start=performance.now();
     (output.manifest as unknown[]).push({videoId,runId:root.id,childRunId:child.id,treatment,queuedAt,originalSourceRunId:original.id,sourceHash:frozenSource.sourceHash,sourceBytesHash:digest(frozenSource.source),resumedStage:'synthesis'});await saveExport();
     const rootOutcome=await drivePausedRun(root,{step:r=>step(r,settings),save:persist,checkpoint:saveExport,onTiming:t=>(output.timings as unknown[]).push({run_id:root.id,...t})});
     await saveExport();
     if(rootOutcome.status!=='completed'){output.state='stopped-after-failure';break;}
     const inventory=researchEvidenceInventoryWithDiagnostics(root),rows=await claimsForRun(root.id);
     const evidence=inventory.evidence.filter(e=>!rows.some(r=>r.id===`${root.id}:${e.id}`&&(r.trustBasis as {latestReviewVerdict?:string}|null)?.latestReviewVerdict==='rejected')).map(e=>({...e,trust:rows.find(r=>r.id===`${root.id}:${e.id}`)?.trustLevel??e.trust}));
     if(!evidence.length){child.status='failed';child.error='No accepted source evidence; brief was not invoked.';await persist(child);output.state='stopped-after-failure';await saveExport();break;}
     child.input.snapshot={sourceRunId:root.id,title:root.title,context:{...analysisContext(root),analysedAt:original.createdAt},evidence,baseline:[],inventoryOmissions:[...inventory.omissions,...((root.output.limitations??[]) as string[]).map((reason,i)=>({id:`source-${i}`,reason}))]};
     await persist(child);await saveExport();
     const childOutcome=await drivePausedRun(child,{step:researchStep,save:persist,checkpoint:saveExport,onTiming:t=>(output.timings as unknown[]).push({run_id:child.id,...t})});
     (output.manifest as Record<string,unknown>[]).at(-1)!.completeResponseSeconds=(performance.now()-start)/1000;
     await saveExport();console.log(JSON.stringify({mode:'pipeline',videoId,treatment,runId:root.id,childRunId:child.id,status:childOutcome.status,seconds:(performance.now()-start)/1000}));
     if(childOutcome.status!=='completed'){output.state='stopped-after-failure';break;}
    }
    if(output.state==='stopped-after-failure')break;
   }
  }
  if(output.state==='running')output.state='finished';await saveExport();
 }catch(error){output.state='failed';output.error=safeError(error);await saveExport();throw Error(safeError(error));}
 finally{await database.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});
