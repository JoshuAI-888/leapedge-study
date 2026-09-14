import { fidelityPrompts } from './fidelity-prompts.ts';
export function selectionPrompts() {
 const p = fidelityPrompts();
 p.id='evidence-first.web.v8-source-selection-candidate';
 p.rationale='Experimental source-ID selection and explicit instrument inventory. No default promotion; whole-cue evidence remains semantically and audio unverified.';
 p.extraction += `
OUTPUT CONTRACT OVERRIDE: Return claims and key_points in the same format EXCEPT replace evidence with evidence_segment_ids (array of supplied segment IDs). Do not generate quote text or translations: the application copies exact original segments. Select only relevant segments and enough context to support ALL fields, prices and ticker identity. Never select unrelated occurrences just to satisfy a field. If a numeric level or ticker cannot be supported, omit the level or use ticker=null; do not invent identity.
Also return inventory: [{instrument_as_spoken, source_segment_ids, disposition: "represented"|"incidental"|"unsupported", reason_en}]. Scan the entire source before writing claims. Each substantive instrument view must have a corresponding claim, including hold/avoid/watch and distinct views in grouped discussions. Record why any mention is excluded; do not create unsupported claims to fill inventory.
This override replaces earlier instructions requesting quotation copying. English synthesis remains required. All original conditions and stance rules still apply.`;
 return p;
}
