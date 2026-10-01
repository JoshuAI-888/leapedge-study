import test from "node:test";
import assert from "node:assert/strict";
import { factualSupportLabel, thesisRobustnessLabel, externalRelationshipLabel, financialFactRows, retainedSourceWarnings } from "../src/features/youtube-intelligence/research-presentation.ts";
import { FinancialFact, reviewFinancialFact } from "../src/features/youtube-intelligence/research-brief.ts";
const matched = { metric: "matched", period: "matched", units: "matched", observationBasis: "matched", reason: "Same metric and measurement basis." } as const;
const support = { relationship: "supports", assertion: "Revenue grew 10 percent.", comparability: matched } as const;
const conflict = { ...support, relationship: "contradicts" } as const;

test("historical quantity display corrects anchored units without rewriting the retained fact", () => {
  const original = FinancialFact.parse({label:'Rate hike',value:25,currency:null,unit:'percentage_points',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'e1',quote:'加息25个基点'});
  const snapshot=JSON.stringify(original);
  const evidence=[{id:'e1',quotes:[{text:'美联储已经加息25个基点。'}]}];
  const rows=financialFactRows({evidenceIds:['e1'],financialFacts:[original]},evidence);
  assert.equal(rows[0].status,'corrected');assert.equal(rows[0].fact?.unit,'basis_points');
  assert.equal(rows[0].original.unit,'percentage_points');assert.equal(JSON.stringify(original),snapshot);
  assert.equal(financialFactRows({evidenceIds:['different'],financialFacts:[original]},evidence)[0].status,'unresolved');
});
test("published correction history is displayed once and unresolved proposed quantities stay visible",()=>{
  const original=FinancialFact.parse({label:'Rate hike',value:25,currency:null,unit:'percentage_points',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'e1',quote:'加息25个基点'});
  const evidence=[{id:'e1',quotes:[{text:original.quote}]}];
  const check=reviewFinancialFact(original,[original.quote]);assert.ok(check.fact);
  const rows=financialFactRows({evidenceIds:['e1'],financialFacts:[check.fact],financialFactChecks:[check]},evidence);
  assert.equal(rows.length,1);assert.equal(rows[0].status,'corrected');assert.equal(rows[0].original.unit,'percentage_points');
  const unresolved=reviewFinancialFact({...original,scale:'millions'},[original.quote]);
  const proposed=financialFactRows({evidenceIds:['e1'],financialFacts:[],financialFactChecks:[unresolved]},evidence);
  assert.equal(proposed.length,1);assert.equal(proposed[0].fact,null);assert.equal(proposed[0].original.value,25);
});

test("legacy labels without retained comparable assertion support stay unverified", () => {
  assert.equal(factualSupportLabel({ factualStatus: "corroborated" }), "Unverified · no retained assertion support");
  assert.equal(factualSupportLabel({ factualStatus: "partial", externalSupport: [{relationship:"supports"}] }), "Unverified · comparison not established");
  assert.equal(factualSupportLabel({ factualStatus: "disputed" }), "Unverified · no retained contradiction support");
  assert.equal(factualSupportLabel({ factualStatus: "disputed", externalSupport: [{relationship:"contradicts"}] }), "Potential conflict · comparison unverified");
});
test("only an established comparison and factual verdict display a dispute", () => {
  assert.equal(factualSupportLabel({ factualStatus: "disputed", externalSupport: [conflict] }), "Disputed · comparable retained contradiction");
  assert.equal(factualSupportLabel({ factualStatus: "unverified", externalSupport: [conflict] }), "Potential conflict · factual assessment unverified");
  assert.equal(factualSupportLabel({ factualStatus: "partial", externalSupport: [support] }), "Partially corroborated");
  assert.equal(factualSupportLabel({ factualStatus: "corroborated", externalSupport: [support] }), "Corroborated · model assessed");
});
test("mismatched yield observation conventions never display Disputed or supported thesis", () => {
  const link = {...conflict, assertion:'The yield was 4.40 percent.',comparability:{...matched,observationBasis:'mismatched' as const,reason:'Intraday observation versus daily close.'}};
  assert.equal(factualSupportLabel({factualStatus:'disputed',externalSupport:[link]}),'Potential conflict · comparison unverified');
  assert.equal(thesisRobustnessLabel({robustness:'fragile',factualStatus:'disputed',externalSupport:[link]}),'Not established · comparison unverified');
  assert.equal(externalRelationshipLabel(link),'Potential conflict · comparison unverified');
  assert.equal(externalRelationshipLabel({...link,relationship:'supports'}),'Proposed support · comparison unverified');
});
test("numeric support with missing units or periods cannot retain a supported badge", () => {
  const link={...support,comparability:{...matched,period:'unknown' as const}};
  assert.equal(factualSupportLabel({factualStatus:'corroborated',externalSupport:[link]}),'Unverified · comparison not established');
  assert.equal(thesisRobustnessLabel({robustness:'supported',factualStatus:'corroborated',externalSupport:[link]}),'Not established · comparison unverified');
  assert.equal(thesisRobustnessLabel({robustness:'supported',factualStatus:'corroborated'}),'Not established · no retained assertion support');
  assert.equal(thesisRobustnessLabel({robustness:'supported',factualStatus:'corroborated',externalSupport:[support]}),'Supported · model assessed');
  assert.equal(thesisRobustnessLabel({robustness:'supported',factualStatus:'disputed',externalSupport:[conflict]}),'Not established · conflicting factual support');
});
test("qualitative comparisons accept explicit non-applicable dimensions, never numeric claims",()=>{
  const link={...conflict,assertion:'The company announced a merger.',comparability:{metric:'matched' as const,period:'not_applicable' as const,units:'not_applicable' as const,observationBasis:'not_applicable' as const,reason:'A discrete event, not numeric measurement.'}};
  assert.equal(externalRelationshipLabel(link),'Contradicts · comparable evidence');
  assert.equal(externalRelationshipLabel({...link,assertion:'Revenue was 10 million.'}),'Potential conflict · comparison unverified');
});

test('retained source warnings distinguish corrections and unresolved facts without rewriting history',()=>{
 const fact=FinancialFact.parse({label:'Rate hike',value:25,currency:null,unit:'percentage_points',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'e1',quote:'加息25个基点'});
 const sentence={text:'The rate hike was 25 percentage points.',speaker:'unknown',evidenceIds:['e1'],financialFacts:[fact]};
 const original=JSON.stringify(sentence);
 const rows=retainedSourceWarnings(sentence,[{id:'e1',quotes:[{text:fact.quote}]}]);
 assert.equal(rows[0].kind,'quantity_corrected');assert.equal(JSON.stringify(sentence),original);
 assert.equal(retainedSourceWarnings({...sentence,evidenceIds:[]},[{id:'e1',quotes:[{text:fact.quote}]}])[0].kind,'quantity_unresolved');
});
test('retained role attribution is flagged for mixed turns without inferring a speaker identity',()=>{
 const sentence={text:'The host recommends buying.',speaker:'unknown',evidenceIds:['e1'],financialFacts:[]};
 const before=JSON.stringify(sentence);const evidence=[{id:'e1',quotes:[{text:'I would buy. >> I disagree.'}]}];
 assert.equal(retainedSourceWarnings(sentence,evidence)[0].kind,'attribution_unresolved');
 assert.equal(JSON.stringify(sentence),before);
 assert.deepEqual(retainedSourceWarnings({...sentence,text:'The discussion includes a buying view and disagreement.'},evidence),[]);
 assert.deepEqual(retainedSourceWarnings(sentence,[{id:'other',quotes:[{text:'>> unrelated'}]}]),[]);
});
