import {z} from 'zod';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const Name=z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/);
const Secret=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*:[1-9][0-9]*$/);
const Account=z.string().regex(/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/);
const Secrets=z.partialRecord(z.enum(['DATABASE_URL','DATABASE_URL_UNPOOLED','YTI_ACCESS_TOKEN','GEMINI_API_KEY','OPENROUTER_API_KEY','YOUTUBE_API_KEY','TRANSCRIPTAPI_API_KEY','SUPADATA_API_KEY','EXA_API_KEY','FMP_API_KEY','CRON_SECRET','YTI_PUSH_CALLBACK_SECRET']),Secret);
const Experiment=z.object({job:Name,migrationJob:Name,serviceAccount:Account,bundleBucket:z.string().regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/),resultsBucket:z.string().regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/),secrets:Secrets}).strict();
const Config=z.object({project:Name,region:z.string().regex(/^[a-z]+-[a-z]+[0-9]+$/),image:z.string().regex(/^[a-z0-9-]+-docker\.pkg\.dev\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/),webService:Name,workerJob:Name,migrationJob:Name,webServiceAccount:Account,workerServiceAccount:Account,migrationServiceAccount:Account,cloudSqlInstance:z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/),origin:z.string().regex(/^https:\/\/[a-z0-9.-]+$/),budgetUsd:z.number().positive(),monthlyBudgetUsd:z.number().positive(),transcriptCredits:z.number().int().positive(),webSecrets:Secrets,workerSecrets:Secrets,migrationSecrets:Secrets,webIapEnabled:z.boolean().default(false),wakeEnabled:z.boolean().default(false),experiment:Experiment.optional()}).strict();
export function cloudPlan(raw:unknown){
 const c=Config.parse(raw);
 if(!c.webSecrets.DATABASE_URL||!c.webSecrets.YTI_ACCESS_TOKEN||!c.workerSecrets.DATABASE_URL||!c.migrationSecrets.DATABASE_URL||!c.migrationSecrets.DATABASE_URL_UNPOOLED)throw Error('Runtime, access and migration secret references are required.');
 const base=[`--project=${c.project}`,`--region=${c.region}`,`--image=${c.image}`];
 const secretArg=(secrets:z.infer<typeof Secrets>)=>'--set-secrets='+Object.entries(secrets).map(([key,value])=>`${key}=${value}`).join(',');
 const env=`--set-env-vars=NODE_ENV=production,YTI_QUEUE_PAUSED=true,YTI_BUDGET_USD=${c.budgetUsd},YTI_HARD_BUDGET_USD_MONTH=${c.monthlyBudgetUsd},YTI_TRANSCRIPT_CREDIT_BUDGET=${c.transcriptCredits},YTI_POOL_MAX=8,YTI_APP_ORIGIN=${c.origin},YTI_EFFICIENCY_PROFILE=conservative,YTI_CLOUD_WAKE_ENABLED=${c.wakeEnabled},YTI_CLOUD_PROJECT=${c.project},YTI_CLOUD_REGION=${c.region},YTI_CLOUD_WORKER_JOB=${c.workerJob}`;
 const commands=[
  {purpose:'Deploy private web; authentication and cloud acceptance precede any public exposure',command:'gcloud',args:['run','deploy',c.webService,...base,`--service-account=${c.webServiceAccount}`,`--add-cloudsql-instances=${c.cloudSqlInstance}`,'--execution-environment=gen2','--no-allow-unauthenticated',...(c.webIapEnabled?['--iap']:[]),'--min-instances=0','--max-instances=3','--concurrency=40','--cpu=1','--memory=1Gi','--timeout=300s',env,secretArg(c.webSecrets)]},
  {purpose:'Deploy worker definition only; this does not execute provider work',command:'gcloud',args:['run','jobs','deploy',c.workerJob,...base,`--service-account=${c.workerServiceAccount}`,`--set-cloudsql-instances=${c.cloudSqlInstance}`,'--args=worker','--tasks=1','--parallelism=1','--max-retries=0','--task-timeout=3600s','--cpu=2','--memory=2Gi',env,secretArg(c.workerSecrets)]},
  {purpose:'Deploy migration job definition only; backup and explicit execution are separate',command:'gcloud',args:['run','jobs','deploy',c.migrationJob,...base,`--service-account=${c.migrationServiceAccount}`,`--set-cloudsql-instances=${c.cloudSqlInstance}`,'--args=migrate','--tasks=1','--parallelism=1','--max-retries=0','--task-timeout=900s','--cpu=1','--memory=512Mi',env,secretArg(c.migrationSecrets)]},
 ];
 if(c.experiment){
  const e=c.experiment;
  if(!e.secrets.DATABASE_URL||!e.secrets.DATABASE_URL_UNPOOLED||!e.secrets.GEMINI_API_KEY||!e.secrets.OPENROUTER_API_KEY)throw Error('Experiment requires dedicated database and model secret references.');
  commands.push({purpose:'Deploy isolated paired experiment definition; disabled until reviewed bundle, database and bucket acceptance',command:'gcloud',args:['run','jobs','deploy',e.job,...base,`--service-account=${e.serviceAccount}`,`--set-cloudsql-instances=${c.cloudSqlInstance}`,'--args=experiment','--tasks=1','--parallelism=1','--max-retries=0','--task-timeout=14400s','--cpu=2','--memory=4Gi',env+',YTI_CLOUD_EXPERIMENT_ENABLED=false,YTI_CLOUD_EXPERIMENT_RESUME=false',secretArg(e.secrets),`--add-volume=mount-path=/bundle,type=cloud-storage,bucket=${e.bundleBucket},readonly=true`,`--add-volume=mount-path=/results,type=cloud-storage,bucket=${e.resultsBucket},readonly=false`]});
  commands.push({purpose:'Deploy dedicated experiment schema migration definition',command:'gcloud',args:['run','jobs','deploy',e.migrationJob,...base,`--service-account=${c.migrationServiceAccount}`,`--set-cloudsql-instances=${c.cloudSqlInstance}`,'--args=migrate','--tasks=1','--parallelism=1','--max-retries=0','--task-timeout=900s','--cpu=1','--memory=512Mi',env,secretArg({DATABASE_URL:e.secrets.DATABASE_URL,DATABASE_URL_UNPOOLED:e.secrets.DATABASE_URL_UNPOOLED})]});
 }
 return commands;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2];if(!file)throw Error('Usage: node --experimental-strip-types deploy/cloud/plan.ts reviewed-config.json (prints only; no deployment)');
 try{console.log(JSON.stringify(cloudPlan(JSON.parse(readFileSync(file,'utf8'))),null,2));}catch{console.error('Cloud configuration invalid. Use project metadata and pinned secret references, never credential values.');process.exitCode=1;}
}
