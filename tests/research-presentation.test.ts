import test from "node:test";
import assert from "node:assert/strict";
import { factualSupportLabel, thesisRobustnessLabel, externalRelationshipLabel } from "../src/features/youtube-intelligence/research-presentation.ts";
const matched = { metric: "matched", period: "matched", units: "matched", observationBasis: "matched", reason: "Same metric and measurement basis." } as const;
const support = { relationship: "supports", assertion: "Revenue grew 10 percent.", comparability: matched } as const;
const conflict = { ...support, relationship: "contradicts" } as const;

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
