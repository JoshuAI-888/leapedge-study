import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedFaithfulChunks } from '../src/server/youtube-intelligence/faithful-audit.ts';
const evidence=Array.from({length:8},(_,i)=>({id:`e${i}`,quotes:[{text:'x'.repeat(4000)}]})) as any;
const retained=Array.from({length:8},(_,i)=>({id:`s${i}`,text:'supported',evidenceIds:[`e${i}`]})) as any;
test('coverage-only work is spread without omitting accepted citation context',()=>{
 const chunks=weightedFaithfulChunks([],evidence,retained);
 assert.ok(chunks.length>1);assert.ok(chunks.length<=4);
 assert.deepEqual(chunks.flatMap(c=>c.assessEvidenceIds).sort(),evidence.map((e:any)=>e.id).sort());
 assert.deepEqual(chunks.flatMap(c=>c.sentences),[]);
 for(const chunk of chunks)for(const id of chunk.assessEvidenceIds){assert.ok(chunk.otherSentencesCitingAssessedEvidence.some(s=>s.evidenceIds.includes(id)));assert.ok(chunk.evidence.some(e=>e.id===id));}
});
test('each escalated assertion receives one target and every cited quote remains intact',()=>{
 const chunks=weightedFaithfulChunks(retained,evidence,[]);
 assert.deepEqual(chunks.flatMap(c=>c.sentences.map(s=>s.id)).sort(),retained.map((s:any)=>s.id).sort());
 for(const chunk of chunks)for(const s of chunk.sentences)for(const id of s.evidenceIds)assert.ok(chunk.evidence.find(e=>e.id===id)?.quotes[0].text.length===4000);
});
