import { MonitoringConfig, MonitoringInput, nextMonitoringAt } from "../../features/youtube-intelligence/monitoring.ts";
import { doc, put, putIfAbsent, researchDB } from "./research-store.ts";
import { json } from "./database.ts";

const KIND="channelMonitoring", ID="default";
export async function monitoringStatus() {
  return { ...MonitoringConfig.parse(await doc(KIND,ID) ?? {}), schedulerAvailable:process.env.YTI_CRON_ENABLED==="true" };
}
export async function saveMonitoring(input: unknown) {
  const p=MonitoringInput.parse(input);
  if(p.enabled && !p.acknowledgeCosts) throw Error("Acknowledge the cost warning before enabling or changing monitoring.");
  const d=await researchDB();
  await putIfAbsent(KIND,ID,MonitoringConfig.parse({}));
  return d.transaction(async () => {
    const row=await d.prepare("SELECT payload FROM yi_documents WHERE kind=$1 AND id=$2 FOR UPDATE").get(KIND,ID);
    const old=MonitoringConfig.parse(json(row!.payload)), now=new Date().toISOString();
    const enabledFrom=old.enabled && old.monitorFrom ? old.monitorFrom : new Date(Date.now()-p.includeRecentHours*3600000).toISOString();
    const next=MonitoringConfig.parse({...old,enabled:p.enabled,schedule:p.schedule,maxVideosPerCheck:p.maxVideosPerCheck,monitorFrom:p.enabled?enabledFrom:old.monitorFrom,nextCheckAt:p.enabled?nextMonitoringAt(p.schedule,now):null});
    await put(KIND,ID,next);
    return {...next,schedulerAvailable:process.env.YTI_CRON_ENABLED==="true"};
  });
}

/** Persist the next occurrence before IO: duplicate ticks cannot buy duplicate work. */
export async function monitoringTick(options: {force?:boolean}={}) {
  const d=await researchDB(), now=new Date().toISOString();
  const claimed=await d.transaction(async () => {
    const row=await d.prepare("SELECT payload FROM yi_documents WHERE kind=$1 AND id=$2 FOR UPDATE").get(KIND,ID);
    const config=MonitoringConfig.parse(row?json(row.payload):{});
    if(!config.enabled) return {reason:"Monitoring paused"} as const;
    if(!options.force && config.nextCheckAt && config.nextCheckAt>now) return {reason:"Not due"} as const;
    // A separate claim lease also bounds concurrent explicit Check now requests.
    const inserted=await d.prepare("INSERT INTO yi_documents(kind,id,payload,created_at,updated_at) VALUES('monitoringLease','default',$1,$2,$2) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE (yi_documents.payload::jsonb->>'until')::bigint<$3").run(JSON.stringify({until:Date.now()+300000}),now,Date.now());
    if(!inserted.changes) return {reason:"Check already running"} as const;
    const next={...config,nextCheckAt:nextMonitoringAt(config.schedule,now),lastCheckAt:now};
    await put(KIND,ID,next);
    return {config:next};
  });
  if("reason" in claimed) return {skipped:true,reason:claimed.reason};
  try {
    const { pullDue }=await import("./channels.ts");
    const result=await pullDue({intervalMinutes:15,maxVideos:claimed.config.maxVideosPerCheck,monitorFrom:claimed.config.monitorFrom!,canQueue:async()=> (await monitoringStatus()).enabled});
    await d.transaction(async()=> {
      const row=await d.prepare("SELECT payload FROM yi_documents WHERE kind=$1 AND id=$2 FOR UPDATE").get(KIND,ID);
      // Never overwrite a concurrent toggle or edited schedule after provider IO.
      const current=MonitoringConfig.parse(json(row!.payload));
      await put(KIND,ID,{...current,lastResult:result});
    });
    return {skipped:false,...result};
  } finally {
    // Keep a short debounce for simultaneous manual checks; scheduled cadence is persisted separately.
    await put("monitoringLease",ID,{until:Date.now()+5000});
  }
}
