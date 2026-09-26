import { z } from 'zod';
import { ResearchAudit } from '../../features/youtube-intelligence/research-brief.ts';
/** One bounded repair of missing/ambiguous verdict IDs. Provider call identity
 * and payment replay remain the caller's modelCall responsibility. */
export async function reconcileResearchAudit(ids: string[], initial:unknown, repair:(ids:string[])=>Promise<unknown>) {
 const expected=z.array(z.string()).parse(ids);
 if(new Set(expected).size!==expected.length) throw Error('Duplicate requested audit ID.');
 const attempts=[ResearchAudit.parse(initial)];
 const answered=new Map<string,z.infer<typeof ResearchAudit>['verdicts'][number]>();
 function merge(a:z.infer<typeof ResearchAudit>,allowed:string[]) {
  for(const id of allowed) {
   const matches=a.verdicts.filter(v=>v.id===id);
   if(matches.length===1) answered.set(id,matches[0]);
  }
 }
 merge(attempts[0],expected);
 const missing=expected.filter(id=>!answered.has(id));
 if(missing.length){const next=ResearchAudit.parse(await repair(missing));attempts.push(next);merge(next,missing);}
 return {audit:{verdicts:expected.flatMap(id=>answered.has(id)?[answered.get(id)!]:[]),coverageFindings:[...new Set(attempts.flatMap(a=>a.coverageFindings))]},missing:expected.filter(id=>!answered.has(id)),attempts};
}
