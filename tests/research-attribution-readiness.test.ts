import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mixedTurnAttribution,sourceAttributionCheck} from '../src/features/youtube-intelligence/research-attribution.ts';
import {validateBrief} from '../src/features/youtube-intelligence/research-brief.ts';
const f=JSON.parse(readFileSync(new URL('./fixtures/readiness/g7-attribution.json',import.meta.url),'utf8'));
const check=(sentence=f.sentence)=>validateBrief({sentences:[sentence],mainTopics:[sentence.topic],omissions:[]},f.evidence,[],f.context,[{id:sentence.id,accepted:true,reason:'Model accepted source association.',factualStatus:'unverified'}]);
test('actual mixed-turn guest attribution is retained as rejection despite model agreement',()=>{
 const before=JSON.stringify(f);assert.equal(mixedTurnAttribution(f.sentence,f.evidence).requiresNeutralRepair,true);
 const r=check({...f.sentence,externalIds:[]});assert.equal(r.sentences.length,0);assert.equal(r.rejected[0].sentence.text,f.sentence.text);assert.match(r.rejected[0].reasons.join(' '),/speaker-turn/);assert.equal(JSON.stringify(f),before);
});
test('neutral discussion preserves separate rate proposals and requires its own model verdict',()=>{
 const neutral={...f.sentence,id:'neutral',text:'The discussion includes a 50-basis-point proposal and a separate 75-basis-point scenario; speaker roles are unresolved.',speaker:'unknown',externalIds:[],financialFacts:[]};
 assert.equal(mixedTurnAttribution(neutral,f.evidence).requiresNeutralRepair,false);assert.equal(check(neutral).sentences.length,1);
 assert.equal(validateBrief({sentences:[neutral],mainTopics:[neutral.topic],omissions:[]},f.evidence,[],f.context,[]).sentences.length,0);
});
test('absence of speaker markers is not automatic rejection or independent identity proof',()=>{
 const quotes=f.evidence.map((e:any)=>({...e,quotes:e.quotes.map((q:any)=>({...q,text:q.text.replaceAll('>>','')}))}));
 assert.equal(mixedTurnAttribution(f.sentence,quotes).requiresNeutralRepair,false);
});
test('personal avoid preference cannot be published as viewer advice even after model acceptance',()=>{
 const quotes=f.evidence.map((e:any)=>({...e,quotes:e.quotes.map((q:any)=>({...q,text:"For me, this stock does not interest me. Honestly I don't want to buy either stock."}))}));
 const candidate={...f.sentence,text:'The speaker advises investors to avoid this stock.',speaker:'unknown',externalIds:[],financialFacts:[]};
 const run=(s:any)=>validateBrief({sentences:[s],mainTopics:[s.topic],omissions:[]},quotes,[],f.context,[{id:s.id,accepted:true,reason:'Model accepted.',factualStatus:'unverified'}]);
 assert.equal(run(candidate).sentences.length,0);
 assert.equal(run({...candidate,text:'The speaker recommends avoiding this stock.'}).sentences.length,0);
 assert.equal(run({...candidate,text:'The speaker personally does not want to buy the stock.'}).sentences.length,1);
 assert.equal(run({...candidate,text:'The speaker does not recommend buying this stock personally.'}).sentences.length,1);
 const explicit=quotes.map((e:any)=>({...e,quotes:e.quotes.map((q:any)=>({...q,text:'I advise investors to avoid this stock.'}))}));
 assert.equal(validateBrief({sentences:[candidate],mainTopics:[candidate.topic],omissions:[]},explicit,[],f.context,[{id:candidate.id,accepted:true,reason:'Explicit advice.',factualStatus:'unverified'}]).sentences.length,1);
});
test('monitoring a company cannot add a before-committing-capital condition',()=>{
 const quotes=f.evidence.map((e:any)=>({...e,quotes:e.quotes.map((q:any)=>({...q,text:'I will watch upcoming earnings to see whether growth and profitability are sustainable.'}))}));
 const candidate={...f.sentence,text:'The speaker advises investors to watch upcoming earnings before committing capital.',speaker:'unknown',externalIds:[],financialFacts:[]};
 assert.equal(validateBrief({sentences:[candidate],mainTopics:[candidate.topic],omissions:[]},quotes,[],f.context,[{id:candidate.id,accepted:true,reason:'Model accepted.',factualStatus:'unverified'}]).sentences.length,0);
});
test('explicit if-scenario stays conditional rather than becoming an unconditional earnings forecast',()=>{
 const evidence=[{id:'k1',quotes:[{text:'If EPS reaches 14, then a 20 times multiple gives a scenario price of 280.'}]}];
 const base={text:'EPS will reach 14.',speaker:'unknown',evidenceIds:['k1']};
 assert.equal(sourceAttributionCheck(base,evidence).requiresNeutralRepair,true);
 assert.equal(sourceAttributionCheck({...base,text:'If EPS reaches 14, a 20 times multiple implies a scenario price of 280.'},evidence).requiresNeutralRepair,false);
 assert.equal(sourceAttributionCheck({...base,text:'EPS will reach 1.60.'},[{id:'k1',quotes:[{text:'If EPS reaches 1.60, the valuation could change.'}]}]).requiresNeutralRepair,true);
});

test('bare trading imperatives cannot strengthen a personal ownership preference into advice',()=>{
 const evidence=[{id:'e',quotes:[{text:"For me, these are not companies I want to own. I don't want to buy either stock."}]}];
 for(const text of ['Avoid these companies.','Buy this stock.','Sell this stock.','Do not buy these companies.','The comparison is complete. Avoid these companies.']){
  assert.equal(sourceAttributionCheck({text,speaker:'unknown',evidenceIds:['e']},evidence).requiresNeutralRepair,true,text);
 }
 for(const text of ['The speaker personally does not want to own these companies.','The speaker does not recommend buying this stock personally.','Avoidance is a personal preference.']){
  assert.equal(sourceAttributionCheck({text,speaker:'unknown',evidenceIds:['e']},evidence).requiresNeutralRepair,false,text);
 }
 const explicit=[{id:'e',quotes:[{text:'For me, I do not want to own it. Avoid this stock.'}]}];
 assert.equal(sourceAttributionCheck({text:'Avoid this stock.',speaker:'unknown',evidenceIds:['e']},explicit).requiresNeutralRepair,false,'explicit source advice remains source advice');
});
