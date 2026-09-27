import {z} from 'zod';
const Limits=z.object({admissionSeconds:z.number().int().min(1).max(2700),idlePolls:z.number().int().min(1).max(120)});
type Dependencies={now:()=>number;stopping:()=>boolean;dispatch:()=>Promise<unknown>;sweep:()=>Promise<unknown>;capacity:()=>Promise<number>;process:()=>Promise<unknown>;sleep:()=>Promise<void>;close:()=>Promise<void>;log:(value:unknown)=>void};
/** Cloud Run may terminate in ten seconds. This deadline stops new admission
 * early; durable stage leases and unknown-paid-outcome guards remain authoritative. */
export async function runCloudWorker(raw:unknown,d:Dependencies){
 const limits=Limits.parse(raw),deadline=d.now()+limits.admissionSeconds*1000;
 const active=new Set<Promise<void>>();let idle=0,lastSweep=-Infinity,reason:'idle'|'deadline'|'signal'='deadline';
 try{
  await d.dispatch();
  while(!d.stopping()&&d.now()<deadline){
   if(d.now()-lastSweep>=60000){await d.sweep();lastSweep=d.now();}
   const capacity=z.number().int().min(1).max(100).parse(await d.capacity());
   if(idle>=limits.idlePolls*capacity){reason='idle';break;}
   while(!d.stopping()&&d.now()<deadline&&active.size<capacity){
    let work:Promise<void>;
    work=d.process().then(async result=>{if(result){idle=0;d.log(result);}else{idle++;await d.sleep();}}).catch(async error=>{d.log({event:'worker-error',errorClass:error instanceof Error?error.name:'UnknownError'});await d.sleep();}).finally(()=>active.delete(work));
    active.add(work);
   }
   if(active.size)await Promise.race(active);
  }
  if(d.stopping())reason='signal';
 }finally{await Promise.allSettled(active);await d.close();}
 return {reason};
}
