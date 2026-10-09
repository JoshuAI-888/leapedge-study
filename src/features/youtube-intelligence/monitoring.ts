import { z } from "zod";

/** Standard five-field numeric cron; scheduling uses UTC and 15-minute ticks. */
function fields(raw: string) {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 5) throw Error("Use five cron fields: minute hour day month weekday (UTC).");
  const limits = [[0,59],[0,23],[1,31],[1,12],[0,7]];
  const sets = parts.map((part, i) => {
    const [min,max] = limits[i];
    const values = new Set<number>();
    for (const item of part.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
      if (!match) throw Error("Use numeric cron fields with *, lists, ranges or steps.");
      const step = match[2] ? Number(match[2]) : 1;
      const range = match[1] === "*" ? [min,max] : match[1].split("-").map(Number);
      const start = range[0], end = range[1] ?? (match[2] ? max : start);
      if (start < min || end > max || start > end || step < 1 || step > max-min+1) throw Error("Cron field is outside its allowed range.");
      for(let n=start; n<=end; n+=step) values.add(i===4 && n===7 ? 0 : n);
    }
    return values;
  });
  if ([...sets[0]].some(n => n%15!==0)) throw Error("Choose only 15-minute boundaries: 0, 15, 30, 45 or */15. Minimum frequency is 15 minutes.");
  return { parts, sets };
}
function matches(raw: ReturnType<typeof fields>, at: number) {
  const d = new Date(at), [m,h,day,month,weekday] = raw.sets;
  const dom = day.has(d.getUTCDate()), dow = weekday.has(d.getUTCDay());
  const dayMatch = raw.parts[2] === "*" ? dow : raw.parts[4] === "*" ? dom : dom || dow;
  return m.has(d.getUTCMinutes()) && h.has(d.getUTCHours()) && month.has(d.getUTCMonth()+1) && dayMatch;
}
export function nextMonitoringAt(schedule: string, after: string) {
  const parsed = fields(schedule), time = Date.parse(z.iso.datetime({offset:true}).parse(after));
  const start = Math.floor(time/900000)*900000+900000;
  for(let at=start; at<=time+366*86400000; at+=900000)
    if(matches(parsed,at)) return new Date(at).toISOString();
  throw Error("Schedule has no occurrence in the next year.");
}
export const MonitoringSchedule = z.string().trim().max(100).superRefine((value,ctx) => {
  try { nextMonitoringAt(value,new Date().toISOString()); }
  catch(e) { ctx.addIssue({code:"custom",message:e instanceof Error?e.message:"Invalid schedule"}); }
});
export const MonitoringConfig = z.object({
  enabled: z.boolean().default(false),
  schedule: MonitoringSchedule.default("0 * * * *"),
  maxVideosPerCheck: z.number().int().min(1).max(10).default(1),
  monitorFrom: z.iso.datetime({offset:true}).nullable().default(null),
  nextCheckAt: z.iso.datetime({offset:true}).nullable().default(null),
  lastCheckAt: z.iso.datetime({offset:true}).nullable().default(null),
  lastResult: z.object({channels:z.number(),queued:z.number(),errors:z.number()}).nullable().default(null),
});
export const MonitoringInput = z.strictObject({
  enabled: z.boolean(), schedule: MonitoringSchedule,
  maxVideosPerCheck: z.number().int().min(1).max(10),
  includeRecentHours: z.union([z.literal(0),z.literal(24)]).default(0),
  acknowledgeCosts: z.boolean().default(false),
});
export function scheduleSummary(schedule: string, now = new Date().toISOString()) {
  const parsed = fields(schedule), start = Math.floor(Date.parse(now)/900000)*900000;
  let count=0;
  for(let at=start+900000; at<=start+30*86400000; at+=900000) if(matches(parsed,at)) count++;
  return { platformChecksPer30Days:2880, monitoringChecksPer30Days:count, nextCheckAt:nextMonitoringAt(schedule,now) };
}
