import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewFinancialFact} from '../src/features/youtube-intelligence/research-brief.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/readiness/chinese-scale-proposal-g-fixture.json',import.meta.url),'utf8'));
const base=fixture.population.fact;
test('actual G population 3.49亿 is349million, preserving original typed proposal and correct prose',()=>{
 const before=JSON.stringify(fixture);const r=reviewFinancialFact(base,fixture.population.quotes);
 assert.equal(r.status,'corrected');assert.equal(r.fact?.value,349);assert.equal(r.fact?.scale,'millions');assert.equal(r.original.value,3.49);assert.match(r.reason,/3.49亿/);assert.equal(JSON.stringify(fixture),before);
});
test('Arabic literals with simplified/traditional Chinese万亿 scale normalize only exact mantissa',()=>{
 for(const [quote,value,expected] of [['按3.49億人口',3.49,349],['人口规模56万人',56,0.56],['人口56萬人',56,0.56]] as const){const r=reviewFinancialFact({...base,quote,value},[quote]);assert.equal(r.status,'corrected');assert.equal(r.fact?.value,expected);}
 const quote='净资产56万美元';const r=reviewFinancialFact({...base,quote,value:56,currency:'USD',unit:'total',unitDescription:'USD'},[quote]);assert.equal(r.fact?.value,0.56);
});
test('equivalent quantities already converted stay unchanged',()=>{
 for(const [value,scale]of [[349,'millions'],[349000000,'ones'],[0.349,'billions']] as const){const r=reviewFinancialFact({...base,value,scale},fixture.population.quotes);assert.equal(r.status,'unchanged');}
});
test('multi-number, ranges, compound scale, mismatched mantissa and dimensions remain unresolved',()=>{
 for(const quote of ['人口3.49万亿','收入3.49亿美元']){assert.equal(reviewFinancialFact({...base,quote},[quote]).status,'unresolved',quote);}
 assert.equal(reviewFinancialFact({...base,value:3.5},fixture.population.quotes).status,'unresolved');
});
test('source anchor and dimensions cannot be bypassed by numeric conversion',()=>{
 assert.equal(reviewFinancialFact(base,[]).status,'unresolved');
 assert.equal(reviewFinancialFact({...base,unitDescription:null},fixture.population.quotes).status,'unresolved');
 assert.equal(reviewFinancialFact({...base,currency:'USD'},fixture.population.quotes).status,'unresolved');
});
test('actual G constant-maturity label needs explicit original-source convention',()=>{
 const before=JSON.stringify(fixture.convention);const r=reviewFinancialFact(fixture.convention.fact,fixture.convention.quotes);
 assert.equal(r.status,'unresolved');assert.equal(r.fact,null);assert.match(r.reason,/convention/);assert.equal(JSON.stringify(fixture.convention),before);
});
test('generic maturity stays generic; literal constant-maturity statement can remain',()=>{
 const f=fixture.convention.fact;assert.equal(reviewFinancialFact({...f,label:'10-year Treasury yield'},fixture.convention.quotes).status,'unchanged');
 const quote='10-year constant maturity Treasury yield was4.93%';assert.equal(reviewFinancialFact({...f,quote},[quote]).status,'unchanged');
});

test('already equivalent compound scales and explicit Korean and Chinese currencies are preserved',()=>{
 for(const [quote,value,scale,currency] of [['12.8万亿美元',12.8,'trillions','USD'],['7.2万亿韩元',7.2,'trillions','KRW'],['100亿元',10,'billions','CNY']] as const){
 const r=reviewFinancialFact({...base,quote,value,scale,currency,unit:'total',unitDescription:currency},[quote]);assert.equal(r.status,'unchanged',quote);assert.equal(r.fact?.value,value);
 }
});

test('bare yuan never establishes CNY or authorizes currency-dependent scale correction',()=>{
 const quote='100亿元';const fact={...base,quote,value:10,scale:'billions' as const,currency:'CNY',unit:'total' as const,unitDescription:'CNY'};
 const r=reviewFinancialFact(fact,[quote]);assert.equal(r.status,'unchanged');assert.match(r.reason,/does not establish.*currency/);assert.equal(reviewFinancialFact({...fact,value:100},[quote]).status,'unresolved');
});

test('already converted quantities in multi-number source remain model-assessed without losing valid figures',()=>{
 const quote='RBC目标640美元，公司订单950亿美元';const r=reviewFinancialFact({...base,quote,value:95,scale:'billions',currency:'USD',unit:'total',unitDescription:'USD'},[quote]);assert.equal(r.status,'unchanged');assert.equal(r.fact?.value,95);assert.match(r.reason,/model-assessed/);
 const mixed='人口3.49亿，财富56万美元';assert.equal(reviewFinancialFact({...base,quote:mixed,value:349},[mixed]).status,'unchanged');assert.equal(reviewFinancialFact({...base,quote:mixed,value:3.49},[mixed]).status,'unresolved','Do not automatically correct one of several source quantities');
});

test('matching contextual wealth range is retained without inventing currency verification',()=>{
 const quote='全美家庭的财富中位数是19万到21万之间';for(const value of [190000,210000]){const r=reviewFinancialFact({...base,quote,value,scale:'ones',currency:'USD',unit:'total',unitDescription:'USD per household'},[quote]);assert.equal(r.status,'unchanged');assert.match(r.reason,/currency remains model-assessed/);}
});
