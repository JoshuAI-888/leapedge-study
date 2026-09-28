/** Explicit bounded, fresh windowed-ASR acquisition. Preparation alone never runs this. */
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import pg from 'pg';
const { values } = parseArgs({options:{live:{type:'boolean',default:false},'max-usd':{type:'string'},'max-steps':{type:'string',default:'60'},'max-minutes':{type:'string',default:'45'},resume:{type:'string'},output:{type:'string'},'runtime-env':{type:'string'},id:{type:'string'},'window-seconds':{type:'string',default:'300'}}});
if (!values.live || !values.output || !values.id || !values['runtime-env'] || !(Number(values['max-usd'])>0)) throw Error('Required explicit --live --id NEW_EXPERIMENT --runtime-env private-local.env --max-usd N --output NEW.json; optional --window-seconds 120..600 --resume RUN_ID. Paid calls possible.');
const stepsLimit=Number(values['max-steps']), minutesLimit=Number(values['max-minutes']);
if (!Number.isInteger(stepsLimit)||stepsLimit<1||stepsLimit>200||!Number.isFinite(minutesLimit)||minutesLimit<1||minutesLimit>180) throw Error('Invalid bounded step/time limits.');
const windowSeconds=Number(values['window-seconds']);
if(!/^[a-z][a-z0-9_]{0,24}$/.test(values.id)||!Number.isInteger(windowSeconds)||windowSeconds<120||windowSeconds>600)throw Error('Invalid experiment id or window-seconds; valid windows 120–600 seconds.');
const target=resolve(values.output);
if (existsSync(target)) throw Error('Output exists; never overwrite a prior attempt.');
const runtime=parseEnv(readFileSync(values['runtime-env'],'utf8'));
const local=new URL(runtime.DATABASE_URL);
if(local.hostname!=='127.0.0.1'||local.pathname!=='/yti_live')throw Error('Only known local cluster permitted; no remote or production database connection.');
if (!runtime.GEMINI_API_KEY) throw Error('Native Gemini key absent.');
const databaseName='yti_perf_readiness_asr_'+values.id;
local.pathname='/postgres';
const admin=new pg.Client({connectionString:local.href});await admin.connect();
try {
 const found=(await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[databaseName])).rows.length;
 if(found&&!values.resume)throw Error('Dedicated ASR database already exists; inspect it and explicitly resume its run. No automatic new paid attempt.');
 if(!found&&values.resume)throw Error('Resume requested but dedicated database absent.');
 if(!found)await admin.query('CREATE DATABASE '+databaseName);
}finally{await admin.end();}
local.pathname='/'+databaseName;
const experimentLock=new pg.Client({connectionString:local.href});await experimentLock.connect();
if(!(await experimentLock.query('SELECT pg_try_advisory_lock(914723) AS acquired')).rows[0].acquired){await experimentLock.end();throw Error('ASR experiment already running.');}
for(const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED','GEMINI_API_KEY','OPENROUTER_API_KEY','YOUTUBE_API_KEY','TRANSCRIPTAPI_API_KEY','SUPADATA_API_KEY','EXA_API_KEY'])delete process.env[key];
Object.assign(process.env,{DATABASE_URL:local.href,DATABASE_URL_UNPOOLED:local.href,YTI_DB:'postgres',YTI_DB_ROLE:'direct',YTI_QUEUE_PAUSED:'true',YTI_EMAIL_SEND_ENABLED:'false',YTI_BUDGET_USD:String(values['max-usd']),GEMINI_API_KEY:runtime.GEMINI_API_KEY});
const migration=spawnSync(process.execPath,['--experimental-strip-types','scripts/migrate.ts'],{env:process.env,encoding:'utf8'});
if(migration.status!==0)throw Error('Dedicated ASR migration failed; database preserved for inspection.');
const S=await import('../src/server/youtube-intelligence/store.ts');
const R=await import('../src/server/youtube-intelligence/research-store.ts');
const {step}=await import('../src/server/youtube-intelligence/pipeline.ts');
const {database}=await import('../src/server/youtube-intelligence/database.ts');
const {TeamPreferences}=await import('../src/features/youtube-intelligence/settings.ts');
const frozen=JSON.parse(readFileSync('data/readiness-20260927/frozen-cohort.json'));
const old=frozen.runs.find(r=>r.videoId==='ZfOQoh82JTo');
if(!old||old.output.metadata.duration!==3920)throw Error('Expected frozen original long-cohort metadata, duration3920s.');
const settings=structuredClone(old.input.teamPreferencesSnapshot);
settings.sources.asr='gemini-windowed';settings.sources.asrPolicy='always';settings.sources.windowSeconds=windowSeconds;
settings.sources.allowGeneratedTranscript=true;
settings.transport.fallbackToOpenRouter=false;
settings.models.transcription.transport='google-native';
settings.processing.maxRetriesPerStage=1;
settings.budget.perVideoMaxUsd=Number(values['max-usd']);
const parsed=TeamPreferences.parse(settings);
function hashes(dir){return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?hashes(dir+'/'+e.name):[{path:dir+'/'+e.name,sha256:createHash('sha256').update(readFileSync(dir+'/'+e.name)).digest('hex')}]);}
const implementationFiles=[...hashes('src'),...['scripts/verify-long-asr-controlled.mjs','package.json','package-lock.json'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))];
const experiment={id:values.id,windowSeconds,videoId:old.videoId,metadataSha256:createHash('sha256').update(JSON.stringify(old.output.metadata)).digest('hex'),promptSha256:createHash('sha256').update(JSON.stringify(old.input.promptSnapshot)).digest('hex'),implementationSha256:createHash('sha256').update(JSON.stringify(implementationFiles)).digest('hex'),settingsSha256:createHash('sha256').update(JSON.stringify(parsed)).digest('hex')};
let run;
if(values.resume){
 run=await S.get(values.resume);
 if(!run||run.videoId!=='ZfOQoh82JTo'||run.stage!=='asr-source')throw Error('Resume must be this video at asr-source in isolated database.');
 if(JSON.stringify(run.input.asrExperiment)!==JSON.stringify(experiment))throw Error('Resume experiment identity mismatch; changed settings/code/window size require a new id/database.');
 const open=await database.prepare("SELECT id FROM yi_calls WHERE run_id=$1 AND status IN ('reserved','unknown')").all(run.id);
 if(open.length)throw Error('Uncertain paid outcome; reconcile retained provider responses before explicit resume.');
}else{
 run=await S.create(old.videoId,old.model,{teamPreferencesSnapshot:parsed,audioTrustRequested:true,audioTrustConfig:parsed,promptSnapshot:old.input.promptSnapshot,efficiencyVersion:null,speculativeResearch:false,reuseResearchCache:false,experiment:true,asrExperiment:experiment},old.promptVersion);
 run.stage='asr-source';run.title=old.title;run.output={metadata:old.output.metadata};
}
await R.saveTeamPreferences(parsed);
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
const report={implementationFiles,implementationSha256:createHash('sha256').update(JSON.stringify(implementationFiles)).digest('hex'),experiment,version:'fresh-long-asr-controlled.v1',runId:run.id,videoId:run.videoId,revision:git,startedAt:new Date().toISOString(),limits:{maxUsd:Number(values['max-usd']),maxSteps:stepsLimit,maxMinutes:minutesLimit},boundary:'Fresh forced native ASR acquisition only. Skips caption availability probe and metadata API; metadata frozen. No extraction/synthesis/research or LeapEdge.',sourceDurationSeconds:3920,plannedBaseWindows:Math.ceil(3920/windowSeconds),model:parsed.models.transcription.id,state:'running',steps:[],calls:[],responses:[],run:null};
writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
async function save(){
 await database.prepare('UPDATE yi_runs SET stage=$1,status=$2,output=$3,error=$4,title=$5,updated_at=$6 WHERE id=$7').run(run.stage,run.status,JSON.stringify(run.output),run.error??null,run.title,new Date().toISOString(),run.id);
 report.run=await S.get(run.id);report.calls=await database.prepare('SELECT * FROM yi_calls WHERE run_id=$1').all(run.id);report.responses=await database.prepare('SELECT * FROM yi_responses WHERE run_id=$1').all(run.id);
 report.settledModelUsd=report.calls.filter(c=>c.status==='completed').reduce((sum,c)=>sum+Number(c.amount),0);
 report.openHolds=report.calls.filter(c=>['reserved','unknown'].includes(c.status)).map(c=>({id:c.id,stage:c.stage,status:c.status,amount:c.amount}));
 if(run.output.source)report.sourceSha256=createHash('sha256').update(JSON.stringify(run.output.source)).digest('hex');
 writeFileSync(target+'.tmp',JSON.stringify(report,null,2),{mode:0o600});renameSync(target+'.tmp',target);
}
let stopRequested=false;
process.on('SIGINT',()=>{stopRequested=true;});process.on('SIGTERM',()=>{stopRequested=true;});
const started=performance.now();run.status='running';run.error=null;
try{
 await save();
 while(run.stage==='asr-source'&&run.status==='running'&&!stopRequested&&report.steps.length<stepsLimit&&(performance.now()-started)<minutesLimit*60000){
  const stageStarted=performance.now();
  try{await step(run,parsed);}catch(error){run.status='failed';run.error=error.message;}
  report.steps.push({index:report.steps.length,seconds:(performance.now()-stageStarted)/1000,stage:run.stage,status:run.status,error:run.error??null,windows:run.output.asrWindows?.length??0,gapChecks:run.output.asrGapChecks?.length??0});
  await save();console.log(JSON.stringify(report.steps.at(-1)));
 }
 report.state=run.stage==='synthesis'?'asr_complete':run.status==='failed'?'failed':run.status==='needs_review'?'needs_review':'bounded_stop';
 if(report.state==='bounded_stop')run.status='queued';
 report.wallSeconds=(performance.now()-started)/1000;report.finishedAt=new Date().toISOString();
}finally{await save();await database.close();await experimentLock.end();}
