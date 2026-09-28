import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mixedTurnAttribution} from '../src/features/youtube-intelligence/research-attribution.ts';
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
