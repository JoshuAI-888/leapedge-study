import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedSourceWarnings} from '../src/features/youtube-intelligence/research-presentation.ts';
import {mixedTurnAttribution} from '../src/features/youtube-intelligence/research-attribution.ts';
const sentence=(text:string)=>({text,speaker:'unknown',evidenceIds:['e'],financialFacts:[]});
const evidence=(text:string)=>[{id:'e',quotes:[{text}]}];
test('retained unsupported CAGR and daily-rate prose visibly warn without rewriting originals',()=>{
 for(const [text,quote]of [
  ['Revenue had36% five-year CAGR.','Five-year revenue growth36%.'],
  ['Daily yields are3.5% and2.2%.','earning a daily yield of three and a half% and2.2% APY respectively.'],
 ]){const s=sentence(text),e=evidence(quote),before=JSON.stringify({s,e});
  const warnings=retainedSourceWarnings(s,e);
  assert.ok(warnings.some(w=>w.kind==='basis_unresolved'));
  assert.equal(JSON.stringify({s,e}),before);
  assert.deepEqual(warnings.find(w=>w.kind==='basis_unresolved')?.evidenceIds,['e']);
 }
});
test('retained basis warnings preserve explicit, calculated and neutral useful clauses',()=>{
 for(const [text,quote]of [
  ['Revenue CAGR was36%.','Revenue CAGR was36%.'],
  ['Daily return is2.2%.','Daily return is2.2%.'],
  ['The account pays2.2% APY credited daily.','The account pays2.2% APY, credited daily.'],
  ['Reported growth was36%; CAGR basis is unspecified.','Five-year revenue growth36%.'],
  ['Stated yields are3.5% and2.2% APY; frequency remains unclear.','earning a daily yield of three and a half% and2.2% APY respectively.'],
 ])assert.deepEqual(retainedSourceWarnings(sentence(text),evidence(quote)),[]);
 const s={...sentence('Calculated revenue CAGR was10%.'),calculation:{expression:{kind:'cagr' as const,initial:100,final:121,years:2},units:'same revenue units',assumptions:'same measure'}};
 assert.deepEqual(retainedSourceWarnings(s,evidence('Revenue grew from100 to121 over2years.')),[]);
});
test('unrelated evidence cannot provide retained CAGR basis or trigger a daily-rate conflict',()=>{
 const unrelated=[{id:'other',quotes:[{text:'Revenue CAGR was36%. Account pays2.2% APY.'}]}];
 assert.ok(retainedSourceWarnings(sentence('Revenue CAGR was36%.'),unrelated).some(w=>w.kind==='basis_unresolved'));
 assert.deepEqual(retainedSourceWarnings(sentence('Daily return is2.2%.'),unrelated),[]);
});
test('plural role words do not bypass mixed-turn attribution warning',()=>{
 const e=evidence("I'm not short, but if I was I would cover before the IPO. >> I am psychologically short.");
 for(const role of ['hosts','guests','creators','commentators','interviewers','interviewees']){
  const s=sentence(`The ${role} would cover any short ahead of an IPO.`);
  assert.equal(mixedTurnAttribution(s,e).requiresNeutralRepair,true);
  assert.ok(retainedSourceWarnings(s,e).some(w=>w.kind==='attribution_unresolved'));
 }
 for(const text of ['A speaker holds Treasury bonds.', 'The speakers discuss valuation.'])assert.equal(mixedTurnAttribution(sentence(text),e).requiresNeutralRepair,false);
 assert.equal(mixedTurnAttribution(sentence('The discussion considers covering a hypothetical short before an IPO.'),e).requiresNeutralRepair,false);
 assert.equal(mixedTurnAttribution(sentence('The hosts would cover any short.'),evidence('I would cover a short.')).requiresNeutralRepair,false);
});
