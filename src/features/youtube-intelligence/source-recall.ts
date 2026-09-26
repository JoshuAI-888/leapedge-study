import {z} from 'zod';
import type {SourceData,CheckedClaim,Run} from './contracts.ts';

export const SOURCE_RECALL_VERSION='source-recall.full-chronological.v1';
/** Small full-source review windows, independent of action vocabulary or previous citation coverage. */
export function sourceRecallPlan(source:SourceData) {
 const windows:SourceData['segments'][]=[];let current:SourceData['segments']=[];
 const bytes=(items:SourceData['segments'])=>new TextEncoder().encode(JSON.stringify(items)).length;
 for(const cue of source.segments){
  if(bytes([cue])>12000 || (cue.start_seconds!==null&&cue.end_seconds!==null&&cue.end_seconds-cue.start_seconds>180))throw Error('One source cue exceeds the recall window bound; retain and resolve its original boundary rather than truncate it.');
  const exceeds=(items:SourceData['segments'])=>items.length>=40||bytes([...items,cue])>12000||(cue.end_seconds!==null&&items[0]?.start_seconds!==null&&items.length>0&&cue.end_seconds-items[0].start_seconds! > 180);
  if(current.length&&exceeds(current)){windows.push(current);current=current.slice(-Math.min(3,Math.max(0,current.length-1)));while(current.length&&exceeds(current))current.shift();}
  current.push(cue);
 }
 if(current.length)windows.push(current);return windows;
}
export function sourceRecallInventory(run:Run){
 return (['claims','keyPoints'] as const).flatMap(bucket=>((run.output[bucket]??[]) as CheckedClaim[]).map(c=>({
  id:c.id,bucket,accepted:c.passed&&!c.reasons?.length,auditReasons:c.reasons??[],
  // Whole candidate retained: a broad thesis is never a substitute for its actual qualifiers and quotes.
  ...c.claim,
 })));
}
export const RecallReconciliation=z.object({
 reviewedSourceIds:z.array(z.string()).max(200),
 propositions:z.array(z.object({
  summary:z.string().min(1).max(1500),sourceIds:z.array(z.string()).min(1).max(200),
  disposition:z.enum(['already_retained','added','not_material','unresolved']),
  existingIds:z.array(z.string()).max(40),
  candidateRefs:z.array(z.object({bucket:z.enum(['claims','key_points','mentions']),index:z.number().int().min(0)})).max(40),
  reason:z.string().min(1).max(1500),
 })).max(96),
 limitations:z.array(z.string()).max(30),
});
export function assessRecallReconciliation(raw:unknown,window:SourceData['segments'],run:Run,counts:{claims:number;key_points:number;mentions:number}){
 const parsed=RecallReconciliation.safeParse(raw);const warnings:string[]=[];
 if(!parsed.success)return {assessment:'incomplete' as const,warnings:['Window proposition reconciliation missing or malformed; a completed model call is not a semantic completeness pass.'],reconciliation:null};
 const review=parsed.data;const ids=new Set(window.map(s=>s.id));const accepted=new Map(sourceRecallInventory(run).filter(c=>c.accepted).map(c=>[c.id,c]));
 const original=(run.output.source as SourceData).segments;
 const coveredIds=(id:string)=>new Set((accepted.get(id)?.evidence??[]).flatMap(e=>{const first=original.findIndex(s=>s.id===e.segment_id),last=original.findIndex(s=>s.id===(e.end_segment_id??e.segment_id));return first>=0&&last>=first?original.slice(first,last+1).map(s=>s.id):[];}));
 if(review.reviewedSourceIds.length!==ids.size||new Set(review.reviewedSourceIds).size!==ids.size||review.reviewedSourceIds.some(id=>!ids.has(id)))warnings.push('Window review does not account for every original source cue exactly once.');
 if([...ids].some(id=>!review.propositions.some(p=>p.sourceIds.includes(id))))warnings.push("Proposition/materiality accounting leaves original cues unaccounted for.");
 if(!review.propositions.length)warnings.push('No proposition-level materiality accounting was returned for this source window.');
 for(const p of review.propositions){
  if(p.sourceIds.some(id=>!ids.has(id)))warnings.push('Proposition references source cues outside its reviewed window.');
  if(p.disposition==='already_retained'&&(!p.existingIds.length||p.existingIds.some(id=>!accepted.has(id))))warnings.push('Claimed existing coverage lacks accepted evidence IDs; rejected candidates cannot establish coverage.');
  if(p.disposition==='already_retained'&&p.sourceIds.some(id=>!p.existingIds.some(existing=>coveredIds(existing).has(id))))warnings.push('Claimed existing coverage does not anchor the specific proposition source cues; broad theme agreement is insufficient.');
  if(p.disposition==='added'&&(!p.candidateRefs.length||p.candidateRefs.some(ref=>ref.index>=counts[ref.bucket])))warnings.push('Proposed addition does not map to returned candidates.');
  if(p.disposition==='unresolved')warnings.push(`Unresolved proposition: ${p.summary}`);
 }
 warnings.push(...review.limitations);
 return {assessment:warnings.length?'incomplete' as const:'accounted' as const,warnings:[...new Set(warnings)],reconciliation:review};
}
export const RECALL_RECONCILIATION_INSTRUCTIONS=' Review every chronological cue in this bounded window. Reconcile each material proposition separately: specific numbers and units, events, dates, actors, conditions, exceptions, holdings, no-position disclosures, risks, causal limits and future monitoring criteria. An already-covered broad theme or a quoted passage is NOT proof that every proposition in it was retained. Compare against the full accepted inventory quotes, conditions, risks and levels. Return reconciliation.reviewedSourceIds containing every window cue exactly once, and propositions with exact sourceIds, disposition, existingIds or zero-based candidateRefs, plus a concrete comparison reason. Existing IDs qualify only when their accepted statement actually preserves this proposition. Add missing specifics even when the broad topic is present. Assign every cue to at least one proposition or explicit materiality disposition, including opening/closing filler. For genuinely immaterial passages use not_material with a reason; ambiguous or unresolved omissions must be disclosed. Empty extraction arrays require explicit proposition accounting, not a bare empty answer. This is a bounded review pass, never proof of semantic completeness.';
