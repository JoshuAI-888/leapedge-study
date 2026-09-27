/** Portable paired runner. Only explicit `run --live` can execute model calls. */
import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { prepareFrozenBundle, assertFrozenBundle, alternatePairs, cloudDatabaseTarget, admitFrozenResearch, assertNoUnsettledCalls, executeFrozenStep, implementationManifest } from '../evaluations/targeted-audit/paired-runner.ts';
import { prepareEvaluationArtifacts, readEvaluationArtifacts, exportEvaluationArtifacts } from '../evaluations/targeted-audit/paired-artifacts.ts';
import { digest } from '../evaluations/targeted-audit/experiment.ts';
const args=process.argv.slice(2),command=args[0];
const arg=(flag:string)=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
const required=(flag:string)=>{const value=arg(flag);if(!value||value.startsWith('--'))throw Error(`Required ${flag}`);return value;};
const bytesHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8')) as unknown;
const output=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const root=resolve(import.meta.dirname,'..');
const implementationFiles=()=>implementationManifest(root);
if(command==='prepare'){
 const folder=resolve(arg('--data-dir')??'data/readiness-20260927');
 const frozen=z.object({manifest:z.object({cases:z.array(z.object({case:z.number(),videoId:z.string(),sourceSha256:z.string()})).length(20)}),runs:z.array(z.object({videoId:z.string(),createdAt:z.string()}))}).parse(json(resolve(folder,'frozen-cohort.json')));
 const run=z.object({id:z.string(),videoId:z.string(),model:z.string(),promptVersion:z.string(),title:z.string(),status:z.string(),stage:z.string(),createdAt:z.string(),updatedAt:z.string(),input:z.record(z.string(),z.any()),output:z.record(z.string(),z.any())});
 const artifacts=['candidate-g-session-2.json','candidate-h-session-1.json','candidate-h-remaining8-session-2.json','candidate-h19-audit-recovery-session-1.json'].map(name=>{const path=resolve(folder,name);return {name,path,sha256:bytesHash(readFileSync(path)),data:z.object({runs:z.array(run)}).parse(json(path))};});
 const donors=frozen.manifest.cases.map(c=>{
  const selected=artifacts.flatMap(a=>a.data.runs.filter(r=>r.videoId===c.videoId&&r.input.task==='research-brief'&&r.status==='completed').map(r=>({a,r}))).sort((a,b)=>b.r.updatedAt.localeCompare(a.r.updatedAt))[0];if(!selected)throw Error(`Missing completed donor for ${c.videoId}`);
  const snapshot=selected.r.input.snapshot;const source=selected.a.data.runs.find(r=>r.id===snapshot?.sourceRunId);if(!source)throw Error('Missing processed-source donor');
  if(digest(source.output.source)!==c.sourceSha256)throw Error(`Transcript differs from frozen original case ${c.case}`);
  if(snapshot.context.analysedAt!==frozen.runs.find(r=>r.videoId===c.videoId)?.createdAt)throw Error('Original analysis cutoff changed');
  return {case:c.case,videoId:c.videoId,longVideo:c.videoId==='ZfOQoh82JTo',source,snapshot,researchPlan:selected.r.output.researchPlan,retrievals:selected.r.output.retrievals,researchBaseline:selected.r.output.researchBaseline,provenance:{artifact:selected.a.name,sha256:selected.a.sha256,researchRunId:selected.r.id},settings:selected.r.input.teamPreferencesSnapshot};
 });
 const settings=arg('--settings')?json(required('--settings')):structuredClone(donors[0].settings);
 const budget=Number(required('--max-usd'));if(!Number.isFinite(budget)||budget<=0)throw Error('Positive bounded --max-usd required');
 const common=z.record(z.string(),z.any()).parse(settings);common.budget={...common.budget,monthlyUsd:budget};common.processing={...common.processing,researchPipeline:'current',parallelVideos:1,contextCaching:false};
 const bundle=prepareFrozenBundle({id:required('--id'),settings:common,implementationFiles:implementationFiles(),cases:donors});
 output(required('--out'),bundle);console.log(JSON.stringify({status:'frozen-input-bundle-prepared',id:bundle.id,sha256:bundle.sha256,cases:20,arms:40,scope:bundle.scope,paidCalls:0,qualityAccepted:false}));
}else if(command==='prepare-evaluation'){
 const bundle=assertFrozenBundle(json(required('--bundle')));const e=prepareEvaluationArtifacts(bundle,json(arg('--cohort')??'docs/delivery/live-comparison-20-20260920.json'),resolve(required('--dir')),json(arg('--review-manifest')??'evaluations/targeted-audit/source-review-manifest.json'));console.log(JSON.stringify({frozenPlanSha256:e.frozenPlan.sha256,cases:20,qualityAccepted:false}));
}else if(command==='export'){
 const bundle=assertFrozenBundle(json(required('--bundle')));const e=exportEvaluationArtifacts(bundle,json(required('--results')),resolve(required('--dir')),required('--suffix'));console.log(JSON.stringify({observations:e.runs.length,expectedPairs:20,qualityAccepted:false}));
}else if(command==='run'){
 if(!args.includes('--live'))throw Error('Explicit run --live required');
 if(!(process.env.K_SERVICE||process.env.CLOUD_RUN_JOB||process.env.YTI_CLOUD_EXECUTION==='true'))throw Error('Cloud execution identity required; this is not a Mac worker command');
 const file=resolve(required('--out'));if(existsSync(file))throw Error('Use a new session output path');
 const bundle=assertFrozenBundle(json(required('--bundle')));
 const evaluation=readEvaluationArtifacts(bundle,resolve(required('--evaluation-dir')));
 for(const f of bundle.implementationFiles){if(bytesHash(readFileSync(resolve(root,f.path)))!==f.sha256)throw Error(`Frozen implementation mismatch: ${f.path}`);}
 if(digest(implementationFiles())!==digest(bundle.implementationFiles))throw Error('Implementation file set changed');
 const connection=process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;if(!connection)throw Error('Cloud direct database connection env required');
 cloudDatabaseTarget(connection);
 Object.assign(process.env,{DATABASE_URL:connection,DATABASE_URL_UNPOOLED:connection,YTI_DB:'postgres',YTI_DB_ROLE:'direct',YTI_QUEUE_PAUSED:'true',YTI_EMAIL_SEND_ENABLED:'false',YTI_BUDGET_USD:String(bundle.settings.budget.monthlyUsd)});
 // No source acquisition/search stages are reachable; stripping those keys also
 // turns an accidental dependency into a failure rather than a paid live fetch.
 for(const key of ['EXA_API_KEY','TRANSCRIPTAPI_API_KEY','SUPADATA_API_KEY','YOUTUBE_API_KEY'])delete process.env[key];
 const lock=new pg.Client({connectionString:connection});await lock.connect();let stop:string|null=null;lock.on('error',()=>{stop='controller-lock-lost';});
 const lockId=0;if(!(await lock.query('SELECT pg_try_advisory_lock($1,$2) AS acquired',[914723,lockId])).rows[0].acquired){await lock.end();throw Error('This experiment already has an active controller');}
 const {database}=await import('../src/server/youtube-intelligence/database.ts');const R=await import('../src/server/youtube-intelligence/research-store.ts');const S=await import('../src/server/youtube-intelligence/store.ts');const {researchStep}=await import('../src/server/youtube-intelligence/research-pipeline.ts');
 const onTerm=()=>{stop??='termination-requested';};process.on('SIGTERM',onTerm);process.on('SIGINT',onTerm);
 try{
  await database.prepare('SELECT version FROM yi_migrations').all();
  const controls=await R.docs<{bundleSha256:string}>('pairedController');if(controls.some(c=>c.bundleSha256!==bundle.sha256))throw Error('Dedicated database already belongs to another frozen experiment');
  const retained=await R.doc<Record<string,unknown>>('pairedController',bundle.id);
  if(retained&&!args.includes('--resume'))throw Error('Existing experiment requires explicit --resume');if(!retained&&args.includes('--resume'))throw Error('No experiment to resume');
  if(!retained&&(await database.prepare('SELECT id FROM yi_runs LIMIT 1').all()).length)throw Error('New experiment requires an empty dedicated migrated database');
  if(retained&&(retained.bundleSha256!==bundle.sha256||retained.evaluationPlanSha256!==evaluation.frozenPlan.sha256))throw Error('Resume bundle identity changed');
  await assertNoUnsettledCalls(database);await R.saveTeamPreferences(bundle.settings);
  const began=new Date().toISOString();const maxMinutes=Number(arg('--max-minutes')??'180');if(!Number.isFinite(maxMinutes)||maxMinutes<=0||maxMinutes>720)throw Error('Session limit must be 1–720 minutes');
  const control={...(retained??{}),id:bundle.id,bundleSha256:bundle.sha256,evaluationPlanSha256:evaluation.frozenPlan.sha256,scope:bundle.scope,state:'running',sessionStartedAt:began,sessionEndedAt:null as string|null,stopReason:null as string|null};
  await R.put('pairedController',bundle.id,control);output(file,{state:'starting',bundleSha256:bundle.sha256});
  const exportCheckpoint=async()=>{
   await R.put('pairedController',bundle.id,control);
   const raw={version:'cloud-paired-results.v1',...control,exportedAt:new Date().toISOString(),runs:await S.list(),calls:await database.prepare('SELECT * FROM yi_calls').all(),documents:await database.prepare('SELECT * FROM yi_documents').all(),responses:await database.prepare('SELECT * FROM yi_responses').all(),limitations:['Source extraction/planning/search are imported, not timed or charged again.','No browser-visible latency is inferred from server publication.','Quality and cloud/UI acceptance require separate source-backed review.']};
   writeFileSync(file+'.tmp',JSON.stringify(raw,null,2),{mode:0o600});renameSync(file+'.tmp',file);
  };
  for(const {item,arm} of alternatePairs(bundle)){
   if(stop)break;if(Date.now()-Date.parse(began)>maxMinutes*60000){stop='session-time-limit';break;}
   await assertNoUnsettledCalls(database);
   const paid=await database.prepare("SELECT COALESCE(SUM(amount),0) AS usd FROM yi_calls WHERE status='completed'").get() as {usd:unknown};if(Number(paid.usd)>=bundle.settings.budget.monthlyUsd){stop='bounded-spend-guard';break;}
   let run=await admitFrozenResearch(database,bundle,item,arm);await exportCheckpoint();let steps=0;
   while(['queued','running'].includes(run.status)&&!stop){
    if(Date.now()-Date.parse(began)>maxMinutes*60000){stop='session-time-limit';break;}
    if(steps++>=200){stop='stage-count-guard';break;}
    const result=await executeFrozenStep(database,run,bundle,researchStep);run=result.run;
    const diagnostics=[run.error,run.output.coverageRepairError,(run.output.supplementalAuditFailure as {reason?:unknown}|undefined)?.reason].map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
    if(/\bHTTP(?:\s+status)?\s*[:=]?\s*(401|402|403)\b/i.test(diagnostics))stop='provider-account-blocked';
    await exportCheckpoint();await assertNoUnsettledCalls(database);
   }
  }
  control.state=stop?'paused':'finished';control.stopReason=stop;control.sessionEndedAt=new Date().toISOString();await exportCheckpoint();
  console.log(JSON.stringify({state:control.state,bundleSha256:bundle.sha256,stopReason:stop,output:file,defaultChanged:false}));
 }finally{process.off('SIGTERM',onTerm);process.off('SIGINT',onTerm);await database.close();await lock.end();}
}else throw Error('Usage: prepare --id ID --max-usd N --out bundle.json [--settings settings.json] [--data-dir retained-dir] | run --live --bundle bundle.json --out NEW-session.json [--resume] [--max-minutes 180]');
