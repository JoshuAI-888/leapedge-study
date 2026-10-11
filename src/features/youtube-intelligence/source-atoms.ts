import {z} from 'zod';
const original=z.string().min(1).max(400).nullable();
/** Model proposals, never a factual or speaker verification label. Original
 * strings are independently checked against copied ranges and by the critic. */
export const SourceAtom=z.object({
 version:z.literal('source-atom.v1'),
 actorOriginal:original,predicate:z.string().min(1).max(200),objectOriginal:original,
 kind:z.enum(['reported_fact','personal_view','scenario','holding','action','countercase','next_check']),
 quantities:z.array(z.object({literal:z.string().min(1).max(200),unitOriginal:original,periodOriginal:original,basisOriginal:original})).max(4),
 conditionsOriginal:z.array(z.string().min(1).max(400)).max(10),
 opposingOriginal:z.array(z.string().min(1).max(400)).max(10),
});
export type SourceAtomData=z.infer<typeof SourceAtom>;
export const SourceAtomPlan=z.object({version:z.literal('source-atom-plan.v1'),atomisation:z.literal(true).default(true),deduplication:z.boolean().default(true),compactAudit:z.boolean().default(true)});
export function sourceAtomPlan(input:Record<string,unknown>){return input.sourceAtomPlan===undefined?null:SourceAtomPlan.parse(input.sourceAtomPlan);}
const normal=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim();
function occurs(literal:string,quotes:string[]){
 const text=normal(literal),escaped=text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const first=/^[A-Za-z0-9]/.test(text)?'(?<![A-Za-z0-9])':'';
 const last=/[A-Za-z0-9]$/.test(text)?'(?![A-Za-z0-9])':'';
 return quotes.some(q=>new RegExp(first+escaped+last,'u').test(normal(q)));
}
/** No joined quotation can manufacture a condition or a restored number. */
export function sourceAtomIssues(claim:{source_atom?:unknown;evidence:{quote_original:string}[]},required=false):string[]{
 if(claim.source_atom===undefined)return required?['Atomic source metadata missing; proposal withheld.']:[];
 const parsed=SourceAtom.safeParse(claim.source_atom);
 if(!parsed.success)return ['Malformed atomic source metadata; proposal withheld.'];
 const a=parsed.data,quotes=claim.evidence.map(e=>e.quote_original);
 const literals=[a.actorOriginal,a.objectOriginal,...a.quantities.flatMap(q=>[q.literal,q.unitOriginal,q.periodOriginal,q.basisOriginal]),...a.conditionsOriginal,...a.opposingOriginal].filter((s):s is string=>s!==null);
 return [...new Set(literals)].filter(s=>!occurs(s,quotes)).map(s=>`Atomic original field is not supported within one complete cited source range: ${s}. Unknown must stay null; no restored quantity, actor, period or basis.`);
}
export const ATOM_EXTRACTION_INSTRUCTIONS=` SOURCE ATOM CONTRACT: Each key_point is ONE independently assessable material proposition. Do not combine unrelated quantities or companies. A quantity comparison, its qualification, condition and opposing clause must stay with that proposition; do not split away what changes its meaning. Preserve ownership, personal reluctance, sufficient upside tests, retention persistence, adjusted EBITDA versus net profit, cancellation and per-share dilution when supplied. Use source_atom: actorOriginal/objectOriginal and every quantity literal/unitOriginal/periodOriginal/basisOriginal must be exact short substrings of a cited ORIGINAL range, or null when unknown. Copy conditionsOriginal/opposingOriginal exactly; never translate these original fields, invent a unit/year, or restore a decimal. predicate is a short English relation; kind distinguishes reported facts, personal views, scenarios, holdings, actions, countercases and next checks. Keep thesis_en concise English, with the same actor, polarity and qualifications. Unknown speaker is not the uploader. Personal unwillingness to own is not advice to others. Keep calls as actual creator actions under the existing contract. Avoid repeating an already supplied identical proposition; retain every genuinely different condition or period. Choose short complete source ranges including the actor/condition; use separate authentic ranges for distant supporting clauses, never discard necessary context. Atomic metadata is a proposal for independent review, not a verified label.`;
