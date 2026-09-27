import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {claimLease,put} from './research-store.ts';
const Config=z.object({enabled:z.boolean(),paused:z.boolean(),project:z.string().regex(/^[a-z][a-z0-9-]+$/),region:z.string().regex(/^[a-z]+-[a-z]+[0-9]+$/),job:z.string().regex(/^[a-z][a-z0-9-]+$/)});
type Result={status:'disabled'|'paused'|'debounced'|'running'|'launched'|'failed'|'unknown';operation?:string};
type Dependencies={claim:()=>Promise<boolean>;record:(result:Result)=>Promise<void>;request:(url:string,init?:RequestInit)=>Promise<Response>};
/** Wakeup is a hint, never the queue or the execution authority. The lease is
 * acquired before HTTP and no database transaction is held over network IO. */
export async function launchCloudWorker(raw:unknown,d:Dependencies):Promise<Result>{
 const c=Config.parse(raw);
 if(!c.enabled)return {status:'disabled'};if(c.paused)return {status:'paused'};
 if(!await d.claim())return {status:'debounced'};
 let attempted=false;
 const deadline=AbortSignal.timeout(12000);
 try{
  const tokenResponse=await d.request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.any([deadline,AbortSignal.timeout(3000)])});
  if(!tokenResponse.ok)throw Error('Cloud identity unavailable');
  const token=z.object({access_token:z.string().min(20)}).parse(await tokenResponse.json()).access_token;
  const resource=`https://run.googleapis.com/v2/projects/${c.project}/locations/${c.region}/jobs/${c.job}`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  let pageToken:string|undefined;
  for(let page=0;page<10;page++){
   const listed=await d.request(`${resource}/executions?pageSize=100${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`,{headers,signal:AbortSignal.any([deadline,AbortSignal.timeout(5000)])});
   if(!listed.ok)throw Error('Execution inventory unavailable');
   const inventory=z.object({executions:z.array(z.object({completionTime:z.string().optional()}).passthrough()).max(100).default([]),nextPageToken:z.string().max(8192).optional()}).parse(await listed.json());
   if(inventory.executions.some(e=>!e.completionTime)){const result={status:'running'} as const;await d.record(result);return result;}
   pageToken=inventory.nextPageToken;if(!pageToken)break;
   if(page===9)throw Error('Execution inventory exceeds bounded wake scan; scheduled recovery required');
  }
  // Persist the unknown boundary before POST; a network timeout is not proof
  // that Google rejected creation. Subsequent wakes inspect execution inventory.
  await d.record({status:'unknown'});attempted=true;
  const response=await d.request(`${resource}:run`,{method:'POST',headers,body:'{}',signal:AbortSignal.any([deadline,AbortSignal.timeout(5000)])});
  if(!response.ok)throw Error('Job launch not confirmed');
  const operation=z.object({name:z.string().regex(/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/operations\/[A-Za-z0-9_-]+$/)}).parse(await response.json()).name;
  const result={status:'launched',operation} as const;await d.record(result);return result;
 }catch{
  const result={status:attempted?'unknown':'failed'} as const;await d.record(result);return result;
 }
}
/** Call after successful enqueue transaction. Disabled unless explicitly enabled
 * on the hosted web; a Cloud Run worker must never recursively launch itself. */
export async function requestCloudWorkerWake():Promise<Result>{
 if(process.env.YTI_CLOUD_WAKE_ENABLED!=='true'||process.env.CLOUD_RUN_JOB)return {status:'disabled'};
 const config={enabled:true,paused:['true','1'].includes(process.env.YTI_QUEUE_PAUSED??''),project:process.env.YTI_CLOUD_PROJECT,region:process.env.YTI_CLOUD_REGION,job:process.env.YTI_CLOUD_WORKER_JOB};
 const c=Config.parse(config),id=randomUUID(),at=Date.now();
 return launchCloudWorker(c,{claim:()=>claimLease('cloud-worker-wake',`${c.project}:${c.region}:${c.job}`,at+60000,at),record:result=>put('cloudWorkerWake',id,{...result,at:new Date().toISOString(),project:c.project,region:c.region,job:c.job}).then(()=>undefined),request:(url,init)=>fetch(url,init)});
}
