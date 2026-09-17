import { selectionPrompts } from './selection-prompts.ts';
export function semanticPrompts() {
 const p=selectionPrompts();
 p.id='evidence-first.web.v9-level-semantics-candidate';
 p.rationale='Preserve level relationships and distinguish observed metrics from execution levels; experimental, no promotion.';
 const rules=`
LEVEL SEMANTICS: An observed yield, historical purchase price, valuation multiple, revenue or current price is not automatically support, resistance, entry, stop or target. Only populate a technical level when the speaker explicitly assigns that role. Otherwise retain the observation in narrative context without inventing a level role.
Preserve relational qualifiers in EVERY structured value_original, not just narrative: slightly below $140 must remain slightly below $140, never $140 alone. Preserve above/below, approximately, ranges, breakout vs closing conditions, timeframe and contingencies. If the schema cannot express a condition faithfully, omit that structured level and retain the qualified narrative. Never convert a reference threshold into an exact execution price.
`;
 p.extraction+=rules;p.critique+=rules+' Reject items with any structured level that loses a relational qualifier or assigns an unsupported technical role, even if the narrative is correct.';
 return p;
}
