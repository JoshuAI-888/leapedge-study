import test from 'node:test';import assert from 'node:assert/strict';
import {compactFaithfulChunks,compactFaithfulPayload} from '../src/server/youtube-intelligence/compact-faithful-audit.ts';
import {weightedFaithfulChunks,faithfulAudit} from '../src/server/youtube-intelligence/faithful-audit.ts';
import {EvidenceRecord,ResearchSentence} from '../src/features/youtube-intelligence/research-brief.ts';
import {expandEvidenceIndex} from '../src/server/youtube-intelligence/research-evidence-index.ts';
import {expandAtomEvidenceIndex} from '../src/server/youtube-intelligence/source-atom-index.ts';
const evidence=Array.from({length:8},(_,i)=>EvidenceRecord.parse({id:`e${i}`,kind:'research_context',summary:'A reported metric',instrument:'Planet',ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{startId:'s1',endId:'s2',text:'Original source including all conditions. '+ 'x'.repeat(4000),translation:'',start:1,end:8,hash:null}]}));
const sentences=Array.from({length:8},(_,i)=>ResearchSentence.parse({id:`s${i}`,text:'A reported metric.',topic:'Planet',kind:'reported_fact',horizon:'general',speaker:'unknown',timeMode:'video_date',evidenceIds:[`e${i}`],externalIds:[],materiality:3,importanceReason:'Material',novelty:{status:'unknown',baselineIds:[],reason:'No history'},financialFacts:[]}));
const rawEvidence=(payload:any)=>payload.evidence??(payload.evidenceIndex?expandEvidenceIndex(payload.evidenceIndex):expandAtomEvidenceIndex(payload.atomEvidenceIndex));
test('shared quote context uses fewer adequate batches and fewer bytes without truncation',()=>{
 const original=weightedFaithfulChunks(sentences,evidence),plan=compactFaithfulChunks(sentences,evidence);
 assert.ok(plan.length<original.length);assert.ok(plan.length<=4);
 const total=(chunks:any[])=>chunks.reduce((n,c)=>n+JSON.stringify(compactFaithfulPayload(c)).length,0);
 assert.ok(total(plan)<total(original));
 for(const chunk of plan)assert.ok(rawEvidence(compactFaithfulPayload(chunk)).every((e:any)=>e.quotes[0].text===evidence[0].quotes[0].text));
});
test('every target and coverage owner is unique and each coverage assessment retains all original citing statements',()=>{
 const plan=compactFaithfulChunks(sentences,evidence,[{...sentences[0],id:'accepted-original'}]);
 assert.deepEqual(plan.flatMap(c=>c.sentences.map(s=>s.id)).sort(),sentences.map(s=>s.id).sort());
 assert.deepEqual(plan.flatMap(c=>c.assessEvidenceIds).sort(),evidence.map(e=>e.id).sort());
 for(const chunk of plan)for(const id of chunk.assessEvidenceIds){const all=[...chunk.sentences,...chunk.otherSentencesCitingAssessedEvidence];assert.ok(all.some(s=>s.evidenceIds.includes(id)));if(id==='e0')assert.ok(all.some(s=>s.id==='accepted-original'));}
});
test('large unique source quotations retain bounded jobs and full data',()=>{
 const huge=evidence.map((e,i)=>({...e,quotes:[{...e.quotes[0],text:`${i}:`+'y'.repeat(45000)}]}));const plan=compactFaithfulChunks(sentences,huge);assert.ok(plan.length<=4);assert.equal(plan.flatMap(c=>c.assessEvidenceIds).length,8);
 for(const chunk of plan)for(const s of chunk.sentences)for(const id of s.evidenceIds)assert.equal(chunk.evidence.find(e=>e.id===id)?.quotes[0].text,huge.find(e=>e.id===id)?.quotes[0].text);
});
test('the independent audit still targets changed sentences and gives no new verdict to immutable originals',async()=>{
 let calls=0;const checked=await faithfulAudit({sentences:sentences.slice(0,1),evidence:evidence.slice(0,1),retainedSentences:[{...sentences[0],id:'old'}],compactPlan:true,invoke:async(_stage,_prompt,raw:any)=>{calls++;assert.deepEqual(raw.sentences.map((s:any)=>s.id),['s0']);assert.ok(raw.otherSentencesCitingAssessedEvidence.some((s:any)=>s.id==='old'));return {verdicts:[{id:'s0',accepted:true,reason:'Supported'}],evidenceCoverage:[{evidenceId:'e0',status:'covered',sentenceIds:['s0','old'],missingPoints:[],reason:'Both checked'}]};}});
 assert.equal(calls,1);assert.deepEqual(checked.verdicts.map(v=>v.id),['s0']);
});
