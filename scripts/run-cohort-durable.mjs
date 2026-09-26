/** Explicit live benchmark controller. Importing helpers never connects or spends. */
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { z } from 'zod';
const hash=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
export function benchmarkDatabaseName(id){if(!/^[a-z][a-z0-9_]{0,35}$/.test(id))throw Error('Invalid benchmark identifier');return 'yti_perf_readiness_'+id;}
export function assertResumeIdentity(expected,actual){if(JSON.stringify(stable(expected))!==JSON.stringify(stable(actual)))throw Error('Resume identity mismatch. Changed code, source, settings or limits require a separately identified experiment.');}
export function frozenSourceOutput(output){
 const keys=['source','metadata','sourceHash','coverage','limitations','transcriptionCompleteness'];
 return structuredClone(Object.fromEntries(keys.filter(key=>output[key]!==undefined).map(key=>[key,output[key]])));
}
export function ledgerAccounting(calls){
 const completed=calls.filter(c=>c.status==='completed');
 const sum=rows=>rows.reduce((n,c)=>n+Number(c.amount??0),0);
 return {settledLedgerUsd:sum(completed),settledModelUsd:sum(completed.filter(c=>!c.stage.startsWith('external-search-'))),settledExternalUsd:sum(completed.filter(c=>c.stage.startsWith('external-search-'))),openHolds:calls.filter(c=>['reserved','unknown'].includes(c.status)).map(c=>({id:c.id,runId:c.run_id,stage:c.stage,status:c.status,amount:c.amount})),note:'Historical ledger prices; excludes unpriced credits. Cumulative snapshots must not be added. Cache consumer donor charges are not added again.'};
}
const Control=z.object({version:z.literal('durable-cohort.v1'),identity:z.record(z.string(),z.unknown()),state:z.string(),startedAt:z.string(),sessions:z.array(z.record(z.string(),z.unknown())),cases:z.array(z.object({videoId:z.string(),cutoff:z.string(),sourceRunId:z.string().nullable(),researchRunId:z.string().nullable(),state:z.string()})),timings:z.array(z.record(z.string(),z.unknown())),failures:z.array(z.record(z.string(),z.unknown()))});
export async function main(argv=process.argv.slice(2), testHooks={}){
 const {values}=parseArgs({args:argv,options:{live:{type:'boolean',default:false},resume:{type:'boolean',default:false},id:{type:'string'},input:{type:'string'},output:{type:'string'},'runtime-env':{type:'string'},'max-usd':{type:'string'},'max-minutes':{type:'string',default:'120'}}});
 if(!values.live||!values.id||!values.input||!values.output||!values['runtime-env']||!(Number(values['max-usd'])>0))throw Error('Required --live --id identifier --input frozen.json --output NEW.json --runtime-env local.env --max-usd N [--resume].');
 const maxMinutes=Number(values['max-minutes']);if(!Number.isFinite(maxMinutes)||maxMinutes<1||maxMinutes>360)throw Error('max-minutes must be 1–360.');
 const name=benchmarkDatabaseName(values.id),file=resolve(values.output),root=resolve(import.meta.dirname,'..');
 if(existsSync(file))throw Error('Each session requires a new output path; never overwrite previous evidence.');
 const rawInput=readFileSync(resolve(values.input),'utf8');
 const frozen=z.object({runs:z.array(z.object({id:z.string(),videoId:z.string(),model:z.string(),promptVersion:z.string(),title:z.string(),createdAt:z.string(),input:z.record(z.string(),z.any()),output:z.record(z.string(),z.any())})).min(1).max(20),manifest:z.object({cases:z.array(z.object({videoId:z.string(),sourceSha256:z.string()}))})}).parse(JSON.parse(rawInput));
 if(new Set(frozen.runs.map(r=>r.videoId)).size!==frozen.runs.length)throw Error('Duplicate cohort video');
 for(const r of frozen.runs){const entry=frozen.manifest.cases.find(c=>c.videoId===r.videoId);if(!entry||hash(JSON.stringify(stable(r.output.source)))!==entry.sourceSha256)throw Error('Frozen transcript hash mismatch');}
 const runtime=parseEnv(readFileSync(values['runtime-env'],'utf8'));const local=new URL(runtime.DATABASE_URL);
 if(local.hostname!=='127.0.0.1'||local.pathname!=='/yti_live')throw Error('Requires known local cluster connection; remote/production connections forbidden.');
 const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});if(git.status!==0)throw Error('Cannot establish code revision');
 const tree=dir=>readdirSync(resolve(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?tree(dir+'/'+e.name):[{path:dir+'/'+e.name,sha256:hash(readFileSync(resolve(root,dir,e.name)))}]);
 const files=[...tree('src'),...['package.json','package-lock.json','scripts/run-cohort-durable.mjs'].map(path=>({path,sha256:hash(readFileSync(resolve(root,path)))}))];
 const settings=structuredClone(frozen.runs[0].input.teamPreferencesSnapshot);settings.processing.parallelVideos=1;settings.budget.monthlyUsd=Number(values['max-usd']);settings.budget.perVideoMaxUsd=Math.min(settings.budget.perVideoMaxUsd,Number(values['max-usd']));
 const identity={revision:git.stdout.trim(),implementationSha256:hash(JSON.stringify(files)),inputSha256:hash(rawInput),settingsSha256:hash(JSON.stringify(stable(settings))),maxUsd:Number(values['max-usd']),treatment:'conservative-no-overlap-frozen-transcript'};
 local.pathname='/postgres';const admin=new pg.Client({connectionString:local.href});await admin.connect();
 try{const found=(await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[name])).rows.length;if(found&&!values.resume)throw Error('Dedicated database exists; inspect and explicitly resume.');if(!found&&values.resume)throw Error('Resume database absent.');if(!found)await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 local.pathname='/'+name;
 const lock=new pg.Client({connectionString:local.href});await lock.connect();
 if(!(await lock.query('SELECT pg_try_advisory_lock(914722) AS acquired')).rows[0].acquired){await lock.end();throw Error('Benchmark already has an active controller.');}
 let database,control,stopReason=null;
 const requestStop=signal=>{stopReason??=signal;};
 const onInt=()=>requestStop('SIGINT'),onTerm=()=>requestStop('SIGTERM');
 process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
 try{
  for(const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED','GEMINI_API_KEY','OPENROUTER_API_KEY','YOUTUBE_API_KEY','TRANSCRIPTAPI_API_KEY','SUPADATA_API_KEY','EXA_API_KEY'])delete process.env[key];
  for(const key of ['GEMINI_API_KEY','OPENROUTER_API_KEY','EXA_API_KEY'])if(runtime[key])process.env[key]=runtime[key];
  Object.assign(process.env,{DATABASE_URL:local.href,DATABASE_URL_UNPOOLED:local.href,YTI_DB:'postgres',YTI_DB_ROLE:'direct',YTI_QUEUE_PAUSED:'true',YTI_EMAIL_SEND_ENABLED:'false',YTI_BUDGET_USD:String(values['max-usd'])});
  const migration=spawnSync(process.execPath,['--experimental-strip-types','scripts/migrate.ts'],{cwd:root,env:process.env,encoding:'utf8'});if(migration.status!==0)throw Error('Dedicated benchmark migration failed; database preserved.');
  const S=await import('../src/server/youtube-intelligence/store.ts');const R=await import('../src/server/youtube-intelligence/research-store.ts');
  ({database}=await import('../src/server/youtube-intelligence/database.ts'));
  const {step}=await import('../src/server/youtube-intelligence/pipeline.ts');const {ensureResearchBrief}=await import('../src/server/youtube-intelligence/research-pipeline.ts');
  const {TeamPreferences}=await import('../src/features/youtube-intelligence/settings.ts');TeamPreferences.parse(settings);
  const retained=await R.doc('benchmarkControl',values.id);
  if(values.resume){if(!retained)throw Error('No durable control record; inspect interrupted initialization.');control=Control.parse(retained);assertResumeIdentity(control.identity,identity);}
  else {control={version:'durable-cohort.v1',identity,state:'running',startedAt:new Date().toISOString(),sessions:[],cases:frozen.runs.map(r=>({videoId:r.videoId,cutoff:r.createdAt,sourceRunId:null,researchRunId:null,state:'not-started'})),timings:[],failures:[]};}
  const calls=await database.prepare('SELECT * FROM yi_calls').all();if(ledgerAccounting(calls).openHolds.length)throw Error('Uncertain paid outcomes retained in dedicated DB. Reconcile before resuming; do not create replacement calls.');
  await R.saveTeamPreferences(settings);
  const session={startedAt:new Date().toISOString(),endedAt:null,stopReason:null};control.sessions.push(session);control.state='running';
  writeFileSync(file,JSON.stringify({state:'initializing',identity}),{flag:'wx',mode:0o600});
  const checkpoint=async()=>{
   await R.put('benchmarkControl',values.id,control);
   const calls=await database.prepare('SELECT * FROM yi_calls').all();
   const output={...control,implementationFiles:files,runs:await S.list(),briefs:await R.docs('researchBrief'),calls,accounting:ledgerAccounting(calls),documents:await database.prepare('SELECT * FROM yi_documents').all(),responses:await database.prepare('SELECT * FROM yi_responses').all(),boundary:'Frozen transcript replay. Real run createdAt retained; analysis cutoff passed separately in a temporary runtime view. Acquisition, production queue and browser excluded.'};
   writeFileSync(file+'.tmp',JSON.stringify(output,null,2),{mode:0o600});renameSync(file+'.tmp',file);
  };
  const sessionStarted=Date.now();
  const stop=()=>{if(Date.now()-sessionStarted>maxMinutes*60000)stopReason??='session-time-limit';return !!stopReason;};
  const execute=async(run,cutoff)=>{
   let count=0;
   while(['queued','running'].includes(run.status)&&!stop()){
    if(count++>=80){run.status='failed';run.error='Bounded stage limit';}
    const stage=run.stage,start=performance.now(),actualCreatedAt=run.createdAt;
    if(run.status!=='failed'){
     run.status='running';
     // Freeze economic context without falsifying the durable wall-clock record.
     if(!run.input.task)run.createdAt=cutoff;
     try{await step(run,settings);}catch(error){run.status='failed';run.error=error.message;control.failures.push({runId:run.id,videoId:run.videoId,stage,error:error.message,at:new Date().toISOString()});}
     finally{run.createdAt=actualCreatedAt;}
    }
    await testHooks.afterStep?.({run,stage});
    await database.prepare('UPDATE yi_runs SET stage=$1,status=$2,output=$3,title=$4,error=$5,updated_at=$6 WHERE id=$7').run(run.stage,run.status,JSON.stringify(run.output),run.title,run.error??null,new Date().toISOString(),run.id);
    control.timings.push({runId:run.id,stage,executionSeconds:(performance.now()-start)/1000,completedAt:new Date().toISOString()});await checkpoint();await testHooks.afterCheckpoint?.({run,stage});
    if(ledgerAccounting(await database.prepare('SELECT * FROM yi_calls').all()).openHolds.length){stopReason='unresolved-provider-outcome';break;}
   }
   return run;
  };
  await checkpoint();
  for(const item of control.cases){
   if(stop())break;
   if(['completed','failed','needs_review','no-research-evidence'].includes(item.state))continue;
   const old=frozen.runs.find(r=>r.videoId===item.videoId);
   // Recovery of an admission/control-checkpoint gap uses stable benchmark tags,
   // including completed rows; create() alone only deduplicates active runs.
   let source=item.sourceRunId?await S.get(item.sourceRunId):(await S.list()).find(r=>r.videoId===item.videoId&&r.input.benchmarkId===values.id&&!r.input.task);
   if(!source){const cleanInput={...old.input};for(const key of ['recoveryOf','recoveryBatch','productionSample'])delete cleanInput[key];source=await S.create(old.videoId,old.model,{...cleanInput,benchmarkId:values.id,teamPreferencesSnapshot:settings,efficiencyVersion:'evidence-efficiency.v1',speculativeResearch:false,reuseResearchCache:true},old.promptVersion);await testHooks.afterAdmission?.({run:source});}
   item.sourceRunId=source.id;item.state='running';
   if(source.stage==='metadata'&&source.status==='queued'){
    source.stage='synthesis';source.title=old.title;source.output=frozenSourceOutput(old.output);
    await database.prepare('UPDATE yi_runs SET stage=$1,title=$2,output=$3 WHERE id=$4').run(source.stage,source.title,JSON.stringify(source.output),source.id);
   }
   await checkpoint();source=await execute(source,item.cutoff);if(stop())break;
   if(source.status!=='completed'){item.state=source.status;await checkpoint();continue;}
   let research=item.researchRunId?await S.get(item.researchRunId):await ensureResearchBrief({...source,createdAt:item.cutoff});
   if(!research){item.state='no-research-evidence';await checkpoint();continue;}
   item.researchRunId=research.id;
   if(research.status==='queued'&&research.stage==='metadata'){research.output.researchBaseline=[];await database.prepare('UPDATE yi_runs SET output=$1 WHERE id=$2').run(JSON.stringify(research.output),research.id);}
   await checkpoint();research=await execute(research,item.cutoff);item.state=research.status;await checkpoint();
  }
  control.state=stopReason?'paused':'finished';session.endedAt=new Date().toISOString();session.stopReason=stopReason;await checkpoint();
 }finally{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);if(database)await database.close();await lock.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
