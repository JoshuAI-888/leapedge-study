import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancialFact, validateBrief, reviewFinancialFact } from '../src/features/youtube-intelligence/research-brief.ts';
import { readFileSync } from 'node:fs';
import { sourceNumericCheck } from '../src/features/youtube-intelligence/research-numeric-check.ts';
const fact=(quote:string,value:number,extra:Record<string,unknown>={})=>FinancialFact.parse({label:'Source quantity',value,currency:null,unit:'total',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'k1',quote,...extra});

test('explicit cents permit a declared conversion without inventing currency or changing the source',()=>{
 const q='Adjusted EPS was 41 cents versus 33 cents.';
 for(const value of [.41,.33]) {
  const original=fact(q,value,{unit:'per_share'}); const before=structuredClone(original);
  assert.equal(sourceNumericCheck(original,[q]).status,'not_assessed');
  assert.deepEqual(original,before);
 }
 assert.equal(sourceNumericCheck(fact('EPS was 41.',.41,{unit:'per_share'}),['EPS was 41.']).status,'unresolved');
});
test('explicit range grammar shares a trailing scale only between its two endpoints',()=>{
 for(const [q,value] of [['Free cash flow between 4.5 and 4.7 billion.',4.5],['Revenue guidance USD8.15 to 8.158 billion.',8.15],['Operating income USD4.889–4.897 billion.',4.889]] as const)
  assert.notEqual(sourceNumericCheck(fact(q,value,{scale:'billions'}),[q]).status,'unresolved');
 const q='There were 220 deals, including 98 valued at least USD5 million.';
 assert.equal(sourceNumericCheck(fact(q,220,{scale:'millions'}),[q]).status,'unresolved','A deal count must not borrow a nearby amount scale');
 assert.equal(sourceNumericCheck(fact('EPS was 160, then 229 and 346.',1.60,{unit:'per_share'}),['EPS was 160, then 229 and 346.']).status,'unresolved');
 assert.equal(sourceNumericCheck(fact('149 customers compared with 849.',1049,{unit:'shares'}),['149 customers compared with 849.']).status,'unresolved');
});
test('omitting typed facts cannot publish an unsupported EPS decimal reconstruction',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/readiness/numeric-ambiguity-proposal-g-fixture.json',import.meta.url),'utf8'));
 const sentence={...f.sentences[0],text:'EPS was 1.56 per share.',financialFacts:[]};
 const result=validateBrief({sentences:[sentence],mainTopics:[sentence.topic],omissions:[]},f.evidence,[],f.context,[{id:sentence.id,accepted:true,reason:'Model accepted.',factualStatus:'unverified'}]);
 assert.equal(result.sentences.length,0);
 assert.match(result.rejected[0].reasons.join(' '),/decimal/i);
});
test('a plausible reconstructed customer count is withheld even without typed metadata',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/readiness/numeric-ambiguity-proposal-g-fixture.json',import.meta.url),'utf8'));
 const sentence={...f.sentences[0],text:'The company has 1,049 customers.',financialFacts:[]};
 const evidence=f.evidence.map((e:any)=>({...e,quotes:e.quotes.map((q:any)=>({...q,text:'The customer count is 149 compared with 849 last year.'}))}));
 const result=validateBrief({sentences:[sentence],mainTopics:[sentence.topic],omissions:[]},evidence,[],f.context,[{id:sentence.id,accepted:true,reason:'Plausibility is not support.',factualStatus:'unverified'}]);
 assert.equal(result.sentences.length,0);
});
test('one explicit percent literal corrects dimension-only metadata and preserves the exact source proposal',()=>{
 const q='Gross margin was approximately 70%.';
 const original=fact(q,70,{unit:'percent',currency:'USD',scale:'millions',relation:'approximate'});
 const before=structuredClone(original);const result=reviewFinancialFact(original,[q]);
 assert.equal(result.status,'corrected');
 assert.equal(result.fact?.value,70);assert.equal(result.fact?.unit,'percent');assert.equal(result.fact?.currency,null);assert.equal(result.fact?.scale,'ones');
 assert.equal(result.fact?.relation,'approximate');assert.deepEqual(original,before);assert.deepEqual(result.original,before);
 const mixed='Margin was 70% on USD9.2 billion of sales.';
 assert.equal(reviewFinancialFact({...original,quote:mixed},[mixed]).status,'unresolved');
});
test('an exact deal count does not inherit the lower bound on its deal-value filter',()=>{
 const q='There were 220 deals worth at least USD1 million.';
 const count=fact(q,220,{unit:'other',unitDescription:'deals',relation:'exact'});
 assert.equal(reviewFinancialFact(count,[q]).status,'unchanged');
 assert.equal(reviewFinancialFact({...count,relation:'greater_than_or_equal'},[q]).status,'unresolved');
 const bound=fact(q,1,{currency:'USD',scale:'millions',relation:'greater_than_or_equal'});
 assert.equal(reviewFinancialFact(bound,[q]).status,'unchanged');
});
