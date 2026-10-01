import test from 'node:test';import assert from 'node:assert/strict';
import {semanticBasisIssues,financialBasisIssue} from '../src/features/youtube-intelligence/semantic-basis.ts';
import {retainedSourceWarnings} from '../src/features/youtube-intelligence/research-presentation.ts';
test('ambiguous price while selling puts cannot become a strike in prose without typed facts',()=>{
 const quote='at a79 selling some puts'; const text='He was selling puts around the70s strike level.';
 assert.ok(semanticBasisIssues(text,[quote]).some(r=>r.includes('strike')));
 const sentence={text,speaker:'unknown',evidenceIds:['e'],financialFacts:[]};const original=JSON.stringify(sentence);
 assert.ok(retainedSourceWarnings(sentence,[{id:'e',quotes:[{text:quote}]}]).some(w=>w.kind==='basis_unresolved'));
 assert.equal(JSON.stringify(sentence),original);
 assert.ok(financialBasisIssue({label:'Put strike price',value:79,quote},[quote]));
});
test('explicit strikes and conventional contract notation establish a basis',()=>{
 for(const quote of ['Selling puts at a strike price of $79.','Selling $79 puts.','Selling 79-strike puts.','The exercise price is79.']) {
  assert.deepEqual(semanticBasisIssues('The put strike price is79.',[quote]),[],quote);
  assert.equal(financialBasisIssue({label:'Put strike price',value:79,quote},[quote]),null,quote);
 }
 assert.deepEqual(semanticBasisIssues('Puts around the70s strike level.',['Selling $79 puts.']),[]);
 assert.ok(semanticBasisIssues('The put strike price is79.',['Selling $70 puts.']).length);
});
test('generic price context, uncertainty and labor strikes remain useful',()=>{
 for(const text of ['At79, he discussed selling puts.','The put strike is unspecified.','The strike price was not stated; puts were discussed near79.','A labor strike cost79 million dollars.'])
  assert.deepEqual(semanticBasisIssues(text,['at a79 selling some puts']),[],text);
 assert.ok(semanticBasisIssues('The strike price is79; another option strike is unspecified.',['at a79 selling some puts']).length);
 assert.ok(semanticBasisIssues('The put strike price is79.',['The strike price was not stated; the stock traded79.']).length);
});
