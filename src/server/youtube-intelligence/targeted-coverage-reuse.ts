import {createHash} from 'node:crypto';
import {z} from 'zod';
import {EvidenceCoverage} from '../../features/youtube-intelligence/research-readiness.ts';
export const CoverageImpact = z.object({complete:z.boolean(),sentenceIds:z.array(z.string()),affectedEvidenceIds:z.array(z.string())});
const Entry=z.object({id:z.string()}).passthrough();
const Sentence=Entry.extend({evidenceIds:z.array(z.string())});
const Input=z.object({evidence:z.array(Entry),priorEvidence:z.array(Entry),priorCoverage:z.array(EvidenceCoverage),priorAccepted:z.array(Sentence),accepted:z.array(Sentence),priorContext:z.unknown(),context:z.unknown(),impact:z.unknown()});
export const auditDigest=(value:unknown):string=>createHash('sha256').update((JSON.stringify(value) ?? "undefined")).digest('hex');
/** Coverage remains a retained model assessment, never a factual accuracy badge.
 * Unknown influence or a changed original accepted statement invalidates reuse. */
export function planCoverageReuse(raw:unknown){
 const i=Input.parse(raw),impact=CoverageImpact.safeParse(i.impact);
 if(new Set(i.evidence.map(e=>e.id)).size!==i.evidence.length)throw Error('Duplicate targeted coverage evidence ID.');
 const priorIds=new Set(i.priorAccepted.map(s=>s.id));
 const added=i.accepted.filter(s=>!priorIds.has(s.id)).map(s=>s.id);
 const unique=(ids:string[])=>new Set(ids).size===ids.length;
 const sameIds=(a:string[],b:string[])=>unique(a)&&unique(b)&&a.length===b.length&&a.every(id=>b.includes(id));
 const stable=unique(i.accepted.map(s=>s.id))&&unique(i.priorAccepted.map(s=>s.id))&&auditDigest(i.context)===auditDigest(i.priorContext)&&i.priorAccepted.every(s=>auditDigest(i.accepted.find(c=>c.id===s.id))===auditDigest(s));
 const directImpact=new Set(i.accepted.filter(s=>!priorIds.has(s.id)).flatMap(s=>s.evidenceIds));
 const completeImpact=impact.success&&impact.data.complete&&sameIds(impact.data.sentenceIds,added)&&unique(impact.data.affectedEvidenceIds)&&impact.data.affectedEvidenceIds.every(id=>i.evidence.some(e=>e.id===id));
 const reused:z.infer<typeof EvidenceCoverage>[]=[];
 const reassessIds:string[]=[];
 for(const evidence of i.evidence){
  const entries=i.priorCoverage.filter(c=>c.evidenceId===evidence.id),entry=entries.length===1?entries[0]:null;
  const prior=i.priorEvidence.filter(e=>e.id===evidence.id);
  const valid=stable&&completeImpact&&prior.length===1&&auditDigest(prior[0])===auditDigest(evidence)&&entry?.status==='covered'&&!entry.missingPoints.length&&entry.sentenceIds.length>0&&unique(entry.sentenceIds)&&entry.sentenceIds.every(id=>i.priorAccepted.some(s=>s.id===id&&s.evidenceIds.includes(evidence.id)))&&!impact.data.affectedEvidenceIds.includes(evidence.id)&&!directImpact.has(evidence.id);
  if(valid)reused.push(entry!);else reassessIds.push(evidence.id);
 }
 return {reused,reassessIds};
}
