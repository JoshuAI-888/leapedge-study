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
 // A missing-verdict repair sees a restricted sentence scope. It may expose
 // additional omissions, but cannot establish a whole-brief coverage upgrade.
 const evidenceCoverage=[...new Set(attempts.flatMap(a=>a.evidenceCoverage.map(c=>c.evidenceId)))].map(evidenceId=>{
  const entries=attempts.flatMap(a=>a.evidenceCoverage.filter(c=>c.evidenceId===evidenceId));
  const first=attempts[0].evidenceCoverage.filter(c=>c.evidenceId===evidenceId);
  const gaps=entries.filter(c=>c.status==='partial'||c.status==='missing'||c.missingPoints.length);
  if(gaps.length) return {...gaps[0],status:'partial' as const,
   missingPoints:[...new Map(gaps.flatMap(c=>c.missingPoints).map(p=>[JSON.stringify(p),p])).values()],
   reason:[...new Set(gaps.map(c=>c.reason))].join(' ')};
  const ambiguous=attempts.some(a=>a.evidenceCoverage.filter(c=>c.evidenceId===evidenceId).length>1);
  if(first.length!==1||ambiguous||entries.some(c=>c.status==='unknown')) return {...entries[0],status:'unknown' as const,reason:'Whole-brief proposition coverage remains unassessed or ambiguous after restricted verdict repair.'};
  return first[0];
 });
 return {audit:{evidenceCoverage,verdicts:expected.flatMap(id=>answered.has(id)?[answered.get(id)!]:[]),coverageFindings:[...new Set(attempts.flatMap(a=>a.coverageFindings))]},missing:expected.filter(id=>!answered.has(id)),attempts};
}
