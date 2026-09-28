import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import {reviewFinancialFact,validateBrief} from '../src/features/youtube-intelligence/research-brief.ts';
const f=JSON.parse(readFileSync(new URL('./fixtures/readiness/g9-fraction-external.json',import.meta.url),'utf8')),b=f.brief,s=b.sentences.find((s:any)=>s.id==='s-13'),fact=s.financialFacts[0];
const quotes=b.evidence.filter((e:any)=>e.id===fact.evidenceId).flatMap((e:any)=>e.quotes.map((q:any)=>q.text));
test('G actual about2/3 proportion is approximate66.6667percent, not0.6667percent, original remains',()=>{const before=JSON.stringify(f);const r=reviewFinancialFact(fact,quotes);assert.equal(r.status,'corrected');assert.equal(r.fact?.value,66.6667);assert.equal(r.fact?.relation,'approximate');assert.equal(r.original.value,.6667);assert.equal(JSON.stringify(f),before);});
test('valid rounded proportion remains; dates, currency, two fractions, zero denominator and nonmatching values unresolved',()=>{
 assert.equal(reviewFinancialFact({...fact,value:66.67},quotes).status,'unchanged');
 for(const quote of ['Supply reported on2/3 this year.','About2/3 of USD revenue','About2/3 of supply plus1/4 of output','About2/0 of supply','About2/3 of supply onJune4','About2/3 of supply in2027'])assert.equal(reviewFinancialFact({...fact,quote},[quote]).status,'unresolved',quote);
 assert.equal(reviewFinancialFact({...fact,value:.3},quotes).status,'unresolved');assert.equal(reviewFinancialFact(fact,[]).status,'unresolved');
});
const externalSentence=b.sentences.find((s:any)=>s.id==='s-11');
const audit={id:externalSentence.id,accepted:true,reason:'Claimed external support',factualStatus:'corroborated',externalSupport:[]};
function run(a:any=audit,ext:any=b.external,phase?:'structural_preflight'|'publication',sentence:any=externalSentence){return validateBrief({sentences:[sentence],mainTopics:[sentence.topic],omissions:[]},b.evidence,ext,b.context,[a],[],{phase});}
test('actualG external confirmation prose rejected after full audit with no valid support; original untouched',()=>{const before=JSON.stringify(externalSentence);const r=run();assert.equal(r.sentences.length,0);assert.equal(r.rejected[0].sentence.text,externalSentence.text);assert.match(r.rejected[0].reasons.join(' '),/external confirmation/);assert.equal(JSON.stringify(externalSentence),before);});
test('preflight must keep candidate so critic can supply primary exact assertion support',()=>{assert.equal(run({...audit,factualStatus:'unverified'},b.external,'structural_preflight').sentences.length,1);});
test('full comparable primary evidence can support confirmation; unknown source class cannot',()=>{
 const source={...b.external.find((e:any)=>e.id===externalSentence.externalIds[0]),sourceClass:'primary',text:externalSentence.text};
 const link={externalId:source.id,assertion:externalSentence.text,quote:source.text,relationship:'supports',reason:'Exact statement verified',comparability:{metric:'matched',period:'matched',units:'matched',observationBasis:'matched',reason:'Same assertion and period'}};
 assert.equal(run({...audit,externalSupport:[link]},[source]).sentences.length,1);
 assert.equal(run({...audit,externalSupport:[link]},[{...source,sourceClass:'unknown'}]).sentences.length,0);
});
test('neutral useful source-attributed candidate remains eligible after independent audit',()=>{const sentence={...externalSentence,text:'The video describes Samsung as a competitor after its HBM4 production progress.',externalIds:[]};assert.equal(run({...audit,factualStatus:'unverified'},[],'publication',sentence).sentences.length,1);});
test('negated or requested external verification remains useful caution, not a claimed confirmation',()=>{
 for(const text of ['No external confirmation was found.','The filing did not confirm the assertion.','This needs external verification.','The claim cannot be independently verified.','The external filing could confirm the claim if released.']){
 const sentence={...externalSentence,text,externalIds:[]};assert.equal(run({...audit,factualStatus:'unverified'},[],'publication',sentence).sentences.length,1,text);}
});
test('separate caution does not mask a later positive unsupported confirmation assertion',()=>{
 const sentence={...externalSentence,text:'No external verification was available earlier. External corporate releases now confirm the claim.',externalIds:[]};assert.equal(run({...audit,factualStatus:'unverified'},[],'publication',sentence).sentences.length,0);
});
test('partial audit can support exact confirmation clause without upgrading the rest of the sentence',()=>{
 const clause='External corporate releases confirm Samsung production progress';const sentence={...externalSentence,text:clause+'. The video also discusses competition.'};
 const source={...b.external.find((e:any)=>e.id===sentence.externalIds[0]),sourceClass:'primary',text:clause};
 const link={externalId:source.id,assertion:clause,quote:clause,relationship:'supports',reason:'Exact clause only',comparability:{metric:'matched',period:'matched',units:'matched',observationBasis:'matched',reason:'Same claim and period'}};
 const r=run({...audit,factualStatus:'partial',externalSupport:[link]},[source],'publication',sentence);assert.equal(r.sentences.length,1);assert.equal(r.sentences[0].factualStatus,'partial');
});

test('negative object or forecast modality does not hide a positive confirmation claim',()=>{
 for(const text of ['Independent filings confirm no revenue decline.','External filings confirm revenue may improve.']){
 const sentence={...externalSentence,text,externalIds:[]};assert.equal(run({...audit,factualStatus:'unverified'},[],'publication',sentence).sentences.length,0,text);
 }
});
