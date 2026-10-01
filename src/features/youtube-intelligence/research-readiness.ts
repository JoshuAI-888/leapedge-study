import { z } from 'zod';
import {inspectLimitations} from './limitation-consistency.ts';
export const EvidenceCoverage = z.object({
 evidenceId:z.string(), status:z.enum(['covered','partial','missing','unknown']),
 sentenceIds:z.array(z.string()),
 missingPoints:z.array(z.object({point:z.string().min(1),quote:z.string().min(1)})),
 reason:z.string().min(1),
});
const Input = z.object({
 evidence:z.array(z.object({id:z.string(),instrument:z.string().nullable().optional(),summary:z.string(),quotes:z.array(z.object({text:z.string()})).default([])})),
 sentences:z.array(z.object({id:z.string(),evidenceIds:z.array(z.string())})),
 rejected:z.array(z.unknown()).default([]), omissions:z.array(z.string()).default([]),
 coverageFindings:z.array(z.string()).default([]),
 evidenceCoverage:z.array(EvidenceCoverage).default([]),
});
/** Coverage accounting is separate from execution, source fidelity and factual truth.
 * Compute on read as well as publish so old briefs cannot hide unresolved material. */
export function researchReadiness(raw: unknown) {
 const brief=Input.parse(raw);
 const assessmentIssues:string[]=[];
 const unassessedIds:string[]=[];
 const coverage=brief.evidence.map(e=>{
  const sentenceIds=brief.sentences.filter(s=>s.evidenceIds.includes(e.id)).map(s=>s.id);
  const matches=brief.evidenceCoverage.filter(a=>a.evidenceId===e.id);
  const assessment=matches.length===1?matches[0]:null;
  const anchored=assessment?.missingPoints.every(p=>e.quotes.some(q=>q.text.includes(p.quote)));
  const validIds=assessment?.sentenceIds.every(id=>sentenceIds.includes(id));
  const valid=assessment && anchored && validIds && (assessment.status!=='covered'||(assessment.sentenceIds.length>0&&!assessment.missingPoints.length));
  // Citation accounting and proposition assessment are independent. An invalid
  // critic quote is retained as diagnostic input, never accepted as source evidence.
  const assessmentStatus = !matches.length ? 'missing' as const : !valid ? 'invalid' as const : assessment.status === 'unknown' ? 'unknown' as const : 'valid' as const;
  if(assessmentStatus !== 'valid') unassessedIds.push(e.id);
  const missing=valid && (assessment.status==='partial'||assessment.status==='missing');
  if(missing) assessmentIssues.push(`Missing material detail (${e.id}): ${assessment.missingPoints.map(p=>p.point).join('; ') || assessment.reason}`);
  return {evidenceId:e.id,topic:e.instrument ?? e.summary,status:sentenceIds.length&&!missing?'represented' as const:'unresolved' as const,assessmentStatus,repairEligible:!sentenceIds.length || !!missing || assessmentStatus !== 'valid',sentenceIds};
 });
 const noteConflicts=inspectLimitations(brief).flatMap(note=>note.warning?[note.warning]:[]);
 const issues=[...noteConflicts,...assessmentIssues,
 ...(unassessedIds.length?[`Key details not assessed in ${unassessedIds.length} evidence item(s) (${unassessedIds.join(', ')}). Citations alone do not establish that all conditions and warnings are included.`]:[]),
 ...brief.omissions,...brief.coverageFindings,
 ...coverage.filter(c=>c.status==='unresolved').map(c=>`Unresolved coverage: ${c.topic} (${c.evidenceId}).`),
 ...(brief.rejected.length?[`${brief.rejected.length} draft point(s) withheld; their material details may be missing.`]:[]),
 ...(!brief.sentences.length?['No accepted research sentences are available.']:[]),
 ...(!brief.evidence.length?['No retained evidence inventory is available.']:[])];
 const status=!brief.sentences.length||!brief.evidence.length?'review_required' as const:issues.length?'partial' as const:'complete' as const;
 return {status,label:status==='complete'?'Coverage accounted for':status==='partial'?'Partial research — review gaps':'Review required — no usable research',issues:[...new Set(issues)],covered:coverage.filter(c=>c.status==='represented').length,total:coverage.length,coverage};
}
