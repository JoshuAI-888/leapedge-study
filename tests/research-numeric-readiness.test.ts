import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{reviewFinancialFact,validateBrief}from'../src/features/youtube-intelligence/research-brief.ts';
import{sourceNumericCheck,numericalSentenceDisposition}from'../src/features/youtube-intelligence/research-numeric-check.ts';
const f=JSON.parse(readFileSync(new URL('./fixtures/readiness/numeric-ambiguity-proposal-g-fixture.json',import.meta.url),'utf8'));
const checks=(s:any)=>s.financialFacts.filter((x:any)=>[1.56,1.01,2.4].includes(x.value));
test('actual G EPS/CPI decimal reconstructions remain unresolved instead of silently accepted or changed to raw integers',()=>{
 const before=JSON.stringify(f);
 for(const s of f.sentences)for(const fact of checks(s)){
  const quotes=f.evidence.filter((e:any)=>e.id===fact.evidenceId).flatMap((e:any)=>e.quotes.map((q:any)=>q.text));
  const r=reviewFinancialFact(fact,quotes);
  assert.equal(r.status,'unresolved');assert.equal(r.original.value,fact.value);
 }
 assert.equal(JSON.stringify(f),before);
});
test('actual unsafe prose is withheld too; hiding a field cannot leave same reconstructed decimal published',()=>{
 for(const s of f.sentences){const original=validateBrief({sentences:[s],mainTopics:[s.topic],omissions:[]},f.evidence,[],f.context,[{id:s.id,accepted:true,reason:s.auditReason,factualStatus:'unverified'}]);
 const status=original.sentences.length?'published':'neutral_repair_required';assert.equal(status,'neutral_repair_required');}
});
const base={...f.sentences[0].financialFacts[0],value:4.7,scale:'billions',unit:'total',currency:'USD'};
test('unambiguous money scales, explicit per-share values and valid bp conversions pass literal test',()=>{
 for(const fact of [{...base,quote:'Net income was USD4.7billion.',value:4700,scale:'millions'},{...base,quote:'EPS was USD1.56 per share.',value:1.56,scale:'ones',unit:'per_share'},{...base,quote:'The move was25basis points.',value:.25,scale:'ones',currency:null,unit:'percentage_points'}])assert.equal(sourceNumericCheck(fact,[fact.quote]).status,'literal_supported');
});
test('missing percent, decimal shifts, ambiguous multiple figures, denominator/currency mismatch are unresolved',()=>{
 for(const fact of [{...base,quote:'CPI which is24.',value:2.4,unit:'percent',currency:null,scale:'ones'},{...base,quote:'EPS USD156 per share.',value:1.56,unit:'per_share',scale:'ones'},{...base,quote:'Revenue was EUR4.7billion.'}])assert.equal(sourceNumericCheck(fact,[fact.quote]).status,'unresolved');
});
test('qualitative replacement remains eligible for audit with raw numeric ambiguity visible',()=>{
 const s={...f.sentences[0],text:'The discussion describes earnings growth alongside balance-sheet risks; precise EPS is unresolved in the retained captions.'};const r=numericalSentenceDisposition(s,f.evidence);assert.equal(r.status,'retain_with_checks');assert.ok(r.checks.some(c=>c.status==='unresolved'));
});

test('multiple figures and bare dollar currency matching values remain not assessed, rather than discarding useful claims',()=>{
 for(const fact of [{...base,quote:'USD156 versus USD101.',value:156,scale:'ones'},{...base,quote:'Revenue$4.7billion.'},{...base,quote:'USD4.7billion.',unit:'per_share'}])assert.equal(sourceNumericCheck(fact,[fact.quote]).status,'not_assessed');
});
test('G case10 prior EPS3.53/0.88 remain unverified reconstructions with raw353/88 retained, no integer correction',()=>{
 const g=JSON.parse(readFileSync(new URL('./fixtures/readiness/numeric-ambiguity-proposal-g-case10.json',import.meta.url),'utf8'));const before=JSON.stringify(g);
 for(const s of g.sentences)for(const fact of s.financialFacts.filter((v:any)=>[3.53,.88].includes(v.value))){const q=g.evidence.filter((e:any)=>e.id===fact.evidenceId).flatMap((e:any)=>e.quotes.map((q:any)=>q.text));const r=sourceNumericCheck(fact,q);assert.equal(r.status,'unresolved');assert.equal(r.original.value,fact.value);assert.equal(r.original.quote,fact.quote);}
 assert.equal(JSON.stringify(g),before);
});

test('numeric ambiguity waits for the full audit and permits an explicitly disclosed independently supported correction',()=>{
 const original=f.sentences[0];const fact=original.financialFacts[0];
 const text='Reported EPS was USD1.56 per share; the captions have a decimal ambiguity that is explicitly disclosed.';
 const sentence={...original,text,financialFacts:[fact],externalIds:['primary']};
 const ext={id:'primary',url:'https://example.com/report',title:'Primary report',text,publishedAt:'2026-09-13T00:00:00Z',retrievedAt:'2026-09-14T00:00:00Z',publicationConfirmed:true,dateBasis:'fixture',sourceClass:'primary' as const,hash:'fixture',query:'EPS',timeMode:'video_date' as const,provider:'fixture'};
 const draft={sentences:[sentence],mainTopics:[sentence.topic],omissions:[]};
 const verdict={id:sentence.id,accepted:true,reason:'Fixture independently audited',factualStatus:'unverified' as const};
 assert.equal(validateBrief(draft,f.evidence,[ext],f.context,[verdict],[],{phase:'structural_preflight'}).sentences.length,1);
 assert.equal(validateBrief(draft,f.evidence,[ext],f.context,[verdict]).sentences.length,0);
 const supported={...verdict,factualStatus:'corroborated' as const,externalSupport:[{externalId:'primary',assertion:text,quote:text,relationship:'supports' as const,reason:'Exact independently supported correction and disclosure',comparability:{metric:'matched' as const,period:'matched' as const,units:'matched' as const,observationBasis:'matched' as const,reason:'Same metric and period'}}]};
 const accepted=validateBrief(draft,f.evidence,[ext],f.context,[supported]);assert.equal(accepted.sentences.length,1);assert.equal(accepted.sentences[0].financialFacts.length,0,'Caption-grounded typed field remains unresolved; do not launder it through external prose support');assert.equal(accepted.sentences[0].financialFactChecks?.[0].original.value,1.56);
});
