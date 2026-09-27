import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest } from './experiment.ts';
import { Source, type Run } from '../../src/features/youtube-intelligence/contracts.ts';
import { TeamPreferences } from '../../src/features/youtube-intelligence/settings.ts';
import { AnalysisContext, BaselinePoint, EvidenceRecord } from '../../src/features/youtube-intelligence/research-brief.ts';
import { RetrievalRecordSchema } from '../../src/server/youtube-intelligence/research-sources.ts';
import { researchPipelineIdentity } from '../../src/features/youtube-intelligence/research-pipeline-choice.ts';
import type { database } from '../../src/server/youtube-intelligence/database.ts';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema=z.object({sourceRunId:z.string(),title:z.string(),context:AnalysisContext,evidence:z.array(EvidenceRecord),baseline:z.array(BaselinePoint).default([]),inventoryOmissions:z.array(z.object({id:z.string(),reason:z.string()})).default([])});
const sourceSchema=z.object({id:z.string(),model:z.string(),promptVersion:z.string(),title:z.string(),status:z.literal('completed'),stage:z.literal('complete'),createdAt:z.iso.datetime(),output:z.record(z.string(),z.unknown())});
const itemSchema=z.object({case:z.number().int().positive(),videoId:z.string().min(1),longVideo:z.boolean(),source:sourceSchema,snapshot:snapshotSchema,researchPlan:z.object({queries:z.array(z.object({query:z.string(),reason:z.string()})),coverage:z.array(z.string())}),retrievals:z.array(RetrievalRecordSchema),researchBaseline:z.array(BaselinePoint),provenance:z.object({artifact:z.string(),sha256:sha,researchRunId:z.string()})});
const fileSchema=z.object({path:z.string(),sha256:sha});
const contentSchema=z.object({version:z.literal('cloud-paired-research.v1'),id:z.string().regex(/^[a-z][a-z0-9_-]{0,50}$/),scope:z.literal('frozen-source-and-retrieval-to-final'),settings:TeamPreferences,implementationFiles:z.array(fileSchema).min(1),cases:z.array(itemSchema).length(20)});
export const FrozenPairBundle=contentSchema.extend({sha256:sha});
export type FrozenPairBundle=z.infer<typeof FrozenPairBundle>;
export type FrozenPairItem=z.infer<typeof itemSchema>;
export type PairArm='current'|'targeted';
export function prepareFrozenBundle(input:unknown):FrozenPairBundle {
 const data=contentSchema.parse({...z.record(z.string(),z.unknown()).parse(input),version:'cloud-paired-research.v1',scope:'frozen-source-and-retrieval-to-final'});
 if(new Set(data.cases.map(c=>c.videoId)).size!==20||new Set(data.cases.map(c=>c.case)).size!==20)throw Error('All20 unique original cases required');
 for(const c of data.cases){Source.parse(c.source.output.source);for(const k of ['claims','keyPoints','mentions'])if(!Array.isArray(c.source.output[k]))throw Error(`Missing processed ${k}`);if(c.snapshot.sourceRunId!==c.source.id||c.snapshot.context.videoId!==c.videoId)throw Error('Source snapshot lineage mismatch');if(c.retrievals.some(r=>r.state!=='complete'))throw Error('Incomplete external retrieval donor; resolve or explicitly freeze an unavailable-source treatment separately');}
 return {...data,sha256:digest(data)};
}
export function assertFrozenBundle(input:unknown):FrozenPairBundle {const b=FrozenPairBundle.parse(input);const {sha256,...payload}=b;if(digest(payload)!==sha256)throw Error('Frozen bundle hash mismatch');return prepareFrozenBundle(payload);}
export function alternatePairs(b:FrozenPairBundle){return b.cases.flatMap((item,i)=>(i%2?['targeted','current']:['current','targeted']).map(arm=>({item,arm:arm as PairArm})));}
export function cloudDatabaseTarget(connection:string){const u=new URL(connection);if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('Postgres required');const socket=u.searchParams.get('host');const cloudSocket=socket!==null&&/^\/cloudsql\/[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/.test(socket);if(socket&&!cloudSocket)throw Error('Only Cloud SQL Unix sockets are supported');if(!cloudSocket&&(['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!u.hostname))throw Error('Live paired runner requires cloud database hostname or Cloud SQL socket');const name=decodeURIComponent(u.pathname.slice(1));if(!/^yti_experiment_[a-z0-9_]+$/.test(name))throw Error('A dedicated yti_experiment_* database is required');return {database:name,hostname:u.hostname};}
export function freshResearchSeed(b:FrozenPairBundle,c:FrozenPairItem,arm:PairArm,now=new Date().toISOString()):Run {
 const pipeline=researchPipelineIdentity(arm==='current'?'current':'targeted-experimental');
 const settings=structuredClone(b.settings);settings.processing.researchPipeline=pipeline.pipeline;
 const id=`paired-${digest({bundle:b.sha256,videoId:c.videoId,arm}).slice(0,40)}`;
 return {id,videoId:c.videoId,url:`https://www.youtube.com/watch?v=${c.videoId}`,model:settings.models.extraction.id,promptVersion:settings.prompts.version,title:`Research brief · ${c.snapshot.title}`,status:'queued',stage:'research-synthesis',createdAt:now,updatedAt:now,error:null,cost:0,input:{task:'research-brief',snapshot:structuredClone(c.snapshot),teamPreferencesSnapshot:settings,criticModel:settings.models.critique.id,pipelineVersion:'research-brief.v1',researchPipeline:pipeline.pipeline,researchPipelineVersion:pipeline.version,researchPipelineIdentity:pipeline,efficiencyVersion:'evidence-efficiency.v1',speculativeResearch:false,reuseResearchCache:false,pairedExperiment:{id:b.id,bundleSha256:b.sha256,arm,scope:b.scope,sourceTimingMeasured:false,sourceCostIncluded:false,searchTimingMeasured:false,searchCostIncluded:false}},output:{researchBaseline:structuredClone(c.researchBaseline),researchPlan:structuredClone(c.researchPlan),retrievals:structuredClone(c.retrievals),frozenRetrievalReplay:{bundleSha256:b.sha256,retainedCostExcluded:true,note:'Fresh draft/audit only; source acquisition/extraction/planning/search replayed identically and excluded from measurements.'}}};
}
function rowRun(row:Record<string,unknown>):Run {const obj=(x:unknown)=>typeof x==='string'?JSON.parse(x):x;return {id:String(row.id),videoId:String(row.video_id),url:String(row.url),model:String(row.model),promptVersion:String(row.prompt_version),title:String(row.title),status:String(row.status),stage:String(row.stage),createdAt:String(row.created_at),updatedAt:String(row.updated_at),error:row.error===null?null:String(row.error),input:obj(row.input),output:obj(row.output),cost:Number(row.cost??0)};}
export async function admitFrozenResearch(db:typeof database,b:FrozenPairBundle,c:FrozenPairItem,arm:PairArm):Promise<Run>{
 assertFrozenBundle(b);const seed=freshResearchSeed(b,c,arm);
 return db.transaction(async()=>{
  const source=await db.prepare('SELECT * FROM yi_runs WHERE id=$1').get(c.source.id) as Record<string,unknown>|undefined;
  if(source){const old=rowRun(source);if(digest(old.output)!==digest(c.source.output))throw Error('Imported source ID conflicts with retained output');}
  else await db.prepare('INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)').run(c.source.id,c.videoId,seed.url,c.source.model,c.source.promptVersion,c.source.title,'completed','complete',c.source.createdAt,c.source.createdAt,JSON.stringify({pairedSourceImport:{bundleSha256:b.sha256,sourceCostIncluded:false}}),JSON.stringify(c.source.output));
  const existing=await db.prepare('SELECT * FROM yi_runs WHERE id=$1').get(seed.id) as Record<string,unknown>|undefined;
  if(existing){const old=rowRun(existing);if(digest(old.input)!==digest(seed.input))throw Error('Admission identity changed; do not resume');return old;}
  await db.prepare('INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)').run(seed.id,seed.videoId,seed.url,seed.model,seed.promptVersion,seed.title,seed.status,seed.stage,seed.createdAt,seed.updatedAt,JSON.stringify(seed.input),JSON.stringify(seed.output));
  await db.prepare('INSERT INTO yi_documents(kind,id,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5)').run('pairedAdmission',seed.id,JSON.stringify({runId:seed.id,videoId:c.videoId,arm,bundleSha256:b.sha256,admittedAt:seed.createdAt}),seed.createdAt,seed.createdAt);
  return seed;
 });
}
export async function assertNoUnsettledCalls(db:typeof database){
 const rows=await db.prepare("SELECT id,status FROM yi_calls WHERE status NOT IN ('completed','released')").all();
 if(rows.length)throw Error('Unsettled or unknown provider outcomes: reconcile retained ledger before resuming; no replacement call admitted');
}
export async function executeFrozenStep(db:typeof database,run:Run,bundle:FrozenPairBundle,step:(run:Run)=>Promise<void>,now=()=>new Date().toISOString()){
 if(!['research-synthesis','research-audit','complete'].includes(run.stage))throw Error('Frozen-source runner refuses acquisition, planning or live retrieval stages');
 await assertNoUnsettledCalls(db);
 const id=`${run.id}:${digest({stage:run.stage,output:run.output})}`;
 const existing=await db.prepare("SELECT payload FROM yi_documents WHERE kind='pairedStep' AND id=$1").get(id) as {payload:unknown}|undefined;
 const old=existing?(typeof existing.payload==='string'?JSON.parse(existing.payload):existing.payload) as Record<string,unknown>:null;
 if(old?.state==='finished')throw Error('Durable run and completed step checkpoint disagree');
 const intent={runId:run.id,stage:run.stage,bundleSha256:bundle.sha256,startedAt:now(),state:'started',interruptedPrior:!!old,priorStartedAt:old?.startedAt??null,executionSeconds:null as number|null,endedAt:null as string|null};
 await db.prepare('INSERT INTO yi_documents(kind,id,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run('pairedStep',id,JSON.stringify(intent),intent.startedAt,intent.startedAt);
 const start=performance.now();run.status='running';let error:unknown;
 try{await step(run);}catch(e){error=e;run.status='failed';run.error=e instanceof Error?e.message:String(e);}
 intent.executionSeconds=old?null:(performance.now()-start)/1000;intent.state='finished';intent.endedAt=now();run.updatedAt=intent.endedAt;
 await db.transaction(async()=>{
  await db.prepare('UPDATE yi_runs SET status=$1,stage=$2,output=$3,title=$4,error=$5,updated_at=$6 WHERE id=$7').run(run.status,run.stage,JSON.stringify(run.output),run.title,run.error,run.updatedAt,run.id);
  await db.prepare("UPDATE yi_documents SET payload=$1,updated_at=$2 WHERE kind='pairedStep' AND id=$3").run(JSON.stringify(intent),run.updatedAt,id);
 });
 return {run,intent,error};
}

/** Match the cloud build allowlist. Never hash or ship the user's untracked UI copy. */
export function implementationManifest(root:string){
 const excluded='src/features/youtube-intelligence/ui/ResearchBrief (1).tsx';
 const fileHash=(path:string)=>{if(lstatSync(resolve(root,path)).isSymbolicLink())throw Error(`Symlink not allowed in implementation manifest: ${path}`);return createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');};
 const tree=(directory:string):{path:string;sha256:string}[]=>readdirSync(resolve(root,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  const path=directory+'/'+entry.name;
  if(path===excluded||entry.name.startsWith('.'))return [];
  if(entry.isSymbolicLink())throw Error(`Symlink not allowed in implementation manifest: ${path}`);
  return entry.isDirectory()?tree(path):[{path,sha256:fileHash(path)}];
 });
 return [...tree('src'),...tree('evaluations/targeted-audit'),...['package.json','package-lock.json','scripts/targeted-audit-paired.ts','scripts/targeted-audit-experiment.ts'].map(path=>({path,sha256:fileHash(path)}))];
}
