import { z } from 'zod';
const Input = z.object({
 evidence:z.array(z.object({id:z.string(),instrument:z.string().nullable().optional(),summary:z.string()})),
 sentences:z.array(z.object({id:z.string(),evidenceIds:z.array(z.string())})),
 rejected:z.array(z.unknown()).default([]), omissions:z.array(z.string()).default([]),
 coverageFindings:z.array(z.string()).default([]),
});
/** Coverage accounting is separate from execution, source fidelity and factual truth.
 * Compute on read as well as publish so old briefs cannot hide unresolved material. */
export function researchReadiness(raw: unknown) {
 const brief=Input.parse(raw);
 const coverage=brief.evidence.map(e=>{
  const sentenceIds=brief.sentences.filter(s=>s.evidenceIds.includes(e.id)).map(s=>s.id);
  return {evidenceId:e.id,topic:e.instrument ?? e.summary,status:sentenceIds.length?'represented' as const:'unresolved' as const,sentenceIds};
 });
 const issues=[...brief.omissions,...brief.coverageFindings,
 ...coverage.filter(c=>c.status==='unresolved').map(c=>`Unresolved coverage: ${c.topic} (${c.evidenceId}).`),
 ...(brief.rejected.length?[`${brief.rejected.length} draft point(s) withheld; their material details may be missing.`]:[]),
 ...(!brief.sentences.length?['No accepted research sentences are available.']:[]),
 ...(!brief.evidence.length?['No retained evidence inventory is available.']:[])];
 const status=!brief.sentences.length||!brief.evidence.length?'review_required' as const:issues.length?'partial' as const:'complete' as const;
 return {status,label:status==='complete'?'Coverage accounted for':status==='partial'?'Partial research — review gaps':'Review required — no usable research',issues:[...new Set(issues)],covered:coverage.filter(c=>c.status==='represented').length,total:coverage.length,coverage};
}
