"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { MonitoringConfig, scheduleSummary } from "../monitoring.ts";
import { action } from "./api.ts";
import { useWorkspace } from "./workspace.tsx";
import { money } from "./viewmodel.ts";
const Status = MonitoringConfig.extend({schedulerAvailable:z.boolean()});
const choices = [
  ["*/15 * * * *", "Every 15 minutes"], ["*/30 * * * *", "Every 30 minutes"],
  ["0 * * * *", "Hourly"], ["0 */6 * * *", "Every 6 hours"],
  ["0 9 * * *", "Daily at 09:00 UTC"], ["0 9 * * 1", "Monday at 09:00 UTC"],
];
export function ChannelMonitoring() {
  const {data,busy,perform}=useWorkspace();
  const [status,setStatus]=useState<z.infer<typeof Status>|null>(null);
  const [enabled,setEnabled]=useState(false), [schedule,setSchedule]=useState("0 * * * *"), [maximum,setMaximum]=useState(1), [recent,setRecent]=useState(false), [ack,setAck]=useState(false), [error,setError]=useState("");
  async function load() {
    try { const s=Status.parse(await action("channels","monitoringStatus")); setStatus(s); setEnabled(s.enabled); setSchedule(s.schedule); setMaximum(s.maxVideosPerCheck); setAck(false); setRecent(false); setError(""); }
    catch(e) { setError(e instanceof Error?e.message:"Monitoring settings unavailable"); }
  }
  useEffect(()=>{void load();},[data]);
  let summary: ReturnType<typeof scheduleSummary>|null=null, invalid="";
  try { summary=scheduleSummary(schedule); } catch(e) { invalid=e instanceof Error?e.message:"Invalid schedule"; }
  if(!data) return null;
  const selected=data.cost.context.selectedChannelIds.length;
  return <section className="yi-panel" aria-label="Channel monitoring">
    <h2>Channel monitoring</h2>
    <p><strong>{status?.enabled?"Monitoring on":"Monitoring off"}</strong> · This setting applies to the shared workspace.</p>
    {error && <p role="alert">{error}</p>}
    <label className="yi-row"><input type="checkbox" role="switch" aria-label="Enable channel monitoring" checked={enabled} disabled={!status||busy} onChange={e=>{setEnabled(e.target.checked);setAck(false);}}/> Enable channel monitoring</label>
    <p>When off, no new automatic analyses are queued. In-flight provider requests may finish. Manual video submissions still work. Per-channel processing choices are retained.</p>
    <div className="yi-row">
      <label>Monitoring schedule <select aria-label="Monitoring schedule" value={choices.some(([v])=>v===schedule)?schedule:"custom"} onChange={e=>{if(e.target.value!=="custom")setSchedule(e.target.value);else setSchedule("0 12 * * 1-5");setAck(false);}}>
        {choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="custom">Custom cron (UTC)</option>
      </select></label>
      <label>Cron expression (UTC) <input aria-label="Cron expression (UTC)" value={schedule} maxLength={100} onChange={e=>{setSchedule(e.target.value);setAck(false);}}/></label>
      <label>Maximum new analyses per check <input aria-label="Maximum new analyses per check" type="number" min="1" max="10" value={maximum} onChange={e=>{setMaximum(Number(e.target.value));setAck(false);}}/></label>
    </div>
    <p>Five fields: minute, hour, day of month, month, weekday. Numeric lists, ranges and steps supported. Minutes must be 0, 15, 30 or 45. All times are UTC. Checks can arrive late; missed checks run once, without catch-up bursts.</p>
    {invalid?<p role="alert">{invalid}</p>:<p>{summary?.monitoringChecksPer30Days.toLocaleString()} monitoring checks over the next 30 days · next scheduled time {summary?.nextCheckAt}. Up to 3 channels are refreshed per check; larger lists rotate as channels become due.</p>}
    <div className="yi-warning" role="note" aria-label="Monitoring cost warning">
      <strong>Cost warning</strong>
      <p>The Vercel scheduler checks every 15 minutes: 2,880 function invocations and database checks per 30 days, including while monitoring is off. Turning this toggle off pauses work; it does not disable Vercel’s platform scheduler. Each check uses hosting/database resources; its dollar cost depends on your plan, runtime and allowances. <a href="https://vercel.com/joshu-ai/youtube-intelligence/settings/cron-jobs" target="_blank" rel="noreferrer">Disable the platform scheduler in Vercel</a> to stop those checks entirely.</p>
      <p>{selected} channels selected for automatic processing · projected analysis spend {money(data.cost.projection.projectedMonthlyUsd)} / month · measured analysis-only average {money(data.cost.projection.measuredCostPerVideoUsd)} per video. An unknown projection is not zero cost. Briefs, transcription, hosting and other services can add cost. Faster checks improve freshness; they do not necessarily create more uploads.</p>
      <p>Current model budget: {money(data.cost.budget.effectiveLimitUsd)} · remaining {money(data.cost.budget.remainingUsd)}. {summary ? `At this schedule, at most ${summary.monitoringChecksPer30Days * maximum} new analyses can be queued in 30 days before spend limits apply. ` : ""}The per-check limit controls new analyses, not dollars; reserved and in-flight work can settle after pausing. Existing model reservation limits remain enforced.</p>
      {enabled && <label className="yi-row"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand the ongoing check costs and automatic analysis charges.</label>}
    </div>
    {enabled&&!status?.enabled && <label className="yi-row"><input type="checkbox" checked={recent} onChange={e=>{setRecent(e.target.checked);setAck(false);}}/> Include uploads from the last 24 hours when starting (may incur analysis charges). Otherwise, only uploads published after enabling are eligible.</label>}
    {status&&!status.schedulerAvailable && <p role="alert">The server scheduler is unavailable. Monitoring can be saved, but scheduled checks require the production scheduler setup.</p>}
    <div className="yi-row">
      <button disabled={!status||busy||!!invalid||!Number.isInteger(maximum)||maximum<1||maximum>10||(enabled&&!ack)} onClick={()=>void perform(()=>action("channels","saveMonitoring",{enabled,schedule,maxVideosPerCheck:maximum,includeRecentHours:recent?24:0,acknowledgeCosts:ack}),enabled?"Channel monitoring enabled. Cost limits still apply.":"Channel monitoring paused. In-flight work may finish.").then(ok=>{if(ok)void load();})}>Save monitoring</button>
      <button className="yi-secondary" disabled={busy||!status?.enabled} onClick={()=>void perform(()=>action("channels","checkMonitoring",null),result=>{const r=z.object({result:z.object({skipped:z.boolean(),reason:z.string().optional(),channels:z.number().optional(),queued:z.number().optional(),errors:z.number().optional()})}).parse(result).result;return r.skipped?r.reason??"Check skipped":`Checked ${r.channels} channels; queued ${r.queued} analyses; ${r.errors} channel errors.`;}).then(ok=>{if(ok)void load();})}>Check now (may incur charges)</button>
    </div>
    {status?.lastCheckAt && <p>Last check: {status.lastCheckAt} · {status.lastResult?.channels??0} channels · {status.lastResult?.queued??0} new analyses · {status.lastResult?.errors??0} errors. {status.enabled?`Next: ${status.nextCheckAt}`:"Paused"}</p>}
  </section>;
}
