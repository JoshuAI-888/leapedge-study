import { z } from 'zod';
import { EvidenceCoverage } from './research-readiness.ts';

const Publication = z.object({
 evidence:z.array(z.object({id:z.string()})),
 sentences:z.array(z.object({id:z.string(),evidenceIds:z.array(z.string())})),
 evidenceCoverage:z.array(EvidenceCoverage).default([]),
});

/** Accounting over independently accepted publication sentences only. Never
 * promotes a shared citation into a proposition-completeness assessment. */
export function acceptedPublicationProjection(raw:unknown) {
 const brief=Publication.parse(raw);
 const acceptedSentenceIds=brief.sentences.map(s=>s.id);
 const representedEvidenceIds=brief.evidence.filter(e=>brief.sentences.some(s=>s.evidenceIds.includes(e.id))).map(e=>e.id);
 const missingEvidenceIds=brief.evidence.filter(e=>!representedEvidenceIds.includes(e.id)).map(e=>e.id);
 const evidenceCoverage=brief.evidence.map(e=>{
  const rows=brief.evidenceCoverage.filter(c=>c.evidenceId===e.id);
  if(rows.length!==1)return EvidenceCoverage.parse({evidenceId:e.id,status:'unknown',sentenceIds:[],missingPoints:[],reason:'Publication has no unique independent proposition assessment. Citation presence alone does not establish completeness.'});
  const row=rows[0];
  const sentenceIds=row.sentenceIds.filter(id=>brief.sentences.some(s=>s.id===id&&s.evidenceIds.includes(e.id)));
  if(sentenceIds.length===row.sentenceIds.length)return {...row,sentenceIds};
  return {...row,sentenceIds,status:sentenceIds.length?'partial' as const:'missing' as const,
   reason:`Publication withheld ${row.sentenceIds.length-sentenceIds.length} assessed candidate(s); original coverage cannot establish completeness of the accepted projection. ${row.reason}`};
 });
 return {acceptedSentenceIds,representedEvidenceIds,missingEvidenceIds,evidenceCoverage};
}
