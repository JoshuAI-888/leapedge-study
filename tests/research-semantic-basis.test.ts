import test from 'node:test';import assert from 'node:assert/strict';
import {reviewFinancialFact,validateBrief,FinancialFact} from '../src/features/youtube-intelligence/research-brief.ts';
const fact=(quote:string,patch:Record<string,unknown>={})=>FinancialFact.parse({label:'Five-year revenue CAGR',value:36,currency:null,unit:'percent',unitDescription:'compound annual growth rate',relation:'exact',scale:'ones',period:'5years',basis:'not_stated',nature:'reported',evidenceId:'e',quote,...patch});
const context={videoPublishedAt:'2026-01-01T00:00:00Z',recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'v',channelId:null,temporalPolicy:'video-date evidence and later updates are separate' as const};
function publish(text:string,quote:string,financialFacts:ReturnType<typeof fact>[]=[],calculation:unknown=null){const sentence={id:'s',text,evidenceIds:['e'],externalIds:[],kind:'analysis',horizon:'fundamental',topic:'Company',materiality:2,importanceReason:'Material',speaker:'unknown',timeMode:'video_date',financialFacts,calculation};return validateBrief({sentences:[sentence],mainTopics:['Company'],omissions:[]},[{id:'e',kind:'research_context',summary:'Model summary says CAGR36% and daily yield2.2%',instrument:null,ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{text:quote,startId:'q',endId:'q',start:0,end:10,hash:null,translation:''}]}],[],context,[{id:'s',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);}
test('period growth cannot gain CAGR convention in typed field or prose, even without a typed field',()=>{const quote='Five-year revenue growth36%.';const f=fact(quote),before=JSON.stringify(f);assert.equal(reviewFinancialFact(f,[quote]).status,'unresolved');assert.equal(publish('Revenue had36% five-year CAGR.',quote).sentences.length,0);assert.equal(JSON.stringify(f),before);});
test('explicit CAGR and neutral unspecified period-growth basis remain useful',()=>{const quote='Revenue CAGR was36% over five years.';assert.equal(reviewFinancialFact(fact(quote),[quote]).status,'unchanged');assert.equal(publish('Revenue CAGR was36%.',quote).sentences.length,1);assert.equal(publish('Reported five-year revenue growth was36%; CAGR basis is unspecified.','Five-year revenue growth36%.').sentences.length,1);});
test('correct audited calculation can derive CAGR from supported endpoints and duration',()=>{const q='Revenue grew from100 to121 over2years.';const calculation={expression:{kind:'cagr',initial:100,final:121,years:2},units:'same source revenue units',assumptions:'Same revenue measure and scale over two years'};assert.equal(publish('Calculated revenue CAGR was10%.',q,[],calculation).sentences.length,1);assert.equal(publish('Calculated revenue CAGR was36%.',q,[],calculation).sentences.length,0);assert.equal(publish('Calculated revenue CAGR was10%.','Revenue grew substantially.',[],calculation).sentences.length,0);});
test('APY paid daily cannot become daily percentage return, in prose or typed convention',()=>{const quote='The account pays2.2% APY, credited daily.';assert.equal(publish('The account offers daily yield of2.2%.',quote).sentences.length,0);assert.equal(reviewFinancialFact(fact(quote,{label:'Daily return',value:2.2,unitDescription:'daily percentage return'}),[quote]).status,'unresolved');});
test('ordinary APY, daily crediting and genuine explicitly stated daily return pass',()=>{for(const [text,quote]of [['The account pays2.2% APY credited daily.','The account pays2.2% APY, credited daily.'],['Daily return is2.2%.','Daily return is2.2%.']])assert.equal(publish(text,quote).sentences.length,1);});
test('unrelated quoted APY/CAGR cannot establish or conflict with another metric',()=>{assert.equal(publish('Revenue CAGR was36%.','Revenue growth was36%. Another metric CAGR was10%.').sentences.length,0);assert.equal(publish('Daily return is3%.','Daily return is3%. Another account pays2.2% APY.').sentences.length,1);});
test('mixed daily-yield/APY wording remains ambiguous while neutral stated basis is preserved',()=>{const quote='Earning a daily yield of3.5% and2.2% APY respectively.';assert.equal(publish('Daily yields are3.5% and2.2%.',quote).sentences.length,0);assert.equal(publish('The source lists3.5% and2.2% APY; payment frequency is unclear.',quote).sentences.length,1);});
test('same numeric value cannot borrow an explicitly different metric convention',()=>{assert.equal(publish('Revenue CAGR was36%.','Revenue growth was36%. Profit CAGR was36%.').sentences.length,0);});
test('genuine daily return is not vetoed by another annual-rate clause with the same number',()=>{assert.equal(publish('Daily return is3%.','Daily return is3%. Another account pays3% APY.').sentences.length,1);});
test('an unrelated uncertainty disclaimer cannot excuse a positive CAGR invention',()=>{assert.equal(publish('Revenue CAGR was36%; another metric CAGR is unknown.','Revenue growth was36%.').sentences.length,0);});
test('neutral APY wording with recognized source word-number remains unverified after both guards',async()=>{
 const {semanticBasisIssues}=await import('../src/features/youtube-intelligence/semantic-basis.ts');const quote='earning a daily yield of three and a half% and 2.2% APY respectively.';const text='Stated yields are3.5% and2.2% APY respectively; frequency remains unclear.';
 assert.deepEqual(semanticBasisIssues(text,[quote]),[]);
 const f=fact(quote,{label:'USDC stated yield',value:3.5,unitDescription:'yield basis unspecified'});const result=publish(text,quote,[f]);
 assert.equal(result.sentences.length,1);assert.equal(result.sentences[0].factualStatus,'unverified');
});
test('ambiguous option price cannot become strike prose at publication, with no typed facts',()=>{
 const q='at a79 selling some puts';const bad=publish('Selling puts around the70s strike level.',q);
 assert.equal(bad.sentences.length,0);
 assert.equal(publish('At79 he discussed selling puts; the strike is unspecified.',q).sentences.length,1);
 assert.equal(publish('Selling puts at a strike price of79.','Selling $79 puts.').sentences.length,1);
});
test('calculated CAGR accepts explicit numeric-hyphen-year duration without inventing duration',()=>{
 const calc={expression:{kind:'cagr',initial:100,final:121,years:2},units:'same source revenue units',assumptions:'Same revenue measure and scale'};
 assert.equal(publish('Calculated revenue CAGR was10%.','Revenue grew from100 to121 over a 2-year period.',[],calc).sentences.length,1);
 for(const quote of ['Revenue grew from100 to121 over a 3-year period.','Revenue grew from100 to121 over two years.']){
  assert.equal(publish('Calculated revenue CAGR was10%.',quote,[],calc).sentences.length,0);
 }
 assert.equal(publish('Calculated revenue CAGR was10%.','Revenue grew from100 to130 over a 2-year period.',[],calc).sentences.length,0);
});
