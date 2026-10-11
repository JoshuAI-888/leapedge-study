import test from 'node:test';
import assert from 'node:assert/strict';
import { Source } from '../src/features/youtube-intelligence/contracts.ts';
import { sourceRecallPlan } from '../src/features/youtube-intelligence/source-recall.ts';
import { packedRecallPlan, localRecallInventory, sharedAdmission } from '../src/server/youtube-intelligence/audited-recall.ts';
test('packed recall preserves every unchanged original cue and overlaps boundaries',()=>{
 const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:Array.from({length:160},(_,i)=>({id:`s${i}`,text:`Fact ${i}, subject to its original condition.`,start_seconds:i*3,end_seconds:i*3+3}))});
 const before=JSON.stringify(source);const windows=packedRecallPlan(source);
 assert.ok(windows.length<sourceRecallPlan(source).length);
 assert.equal(new Set(windows.flatMap(w=>w.map(s=>s.id))).size,160);
 assert.ok(windows.every(w=>w.length<=60&&JSON.stringify(w).length<=18000&&w.at(-1)!.end_seconds!-w[0].start_seconds!<=240));
 assert.deepEqual(windows[0].slice(-3),windows[1].slice(0,3));assert.equal(JSON.stringify(source),before);
 assert.throws(()=>packedRecallPlan({...source,segments:[{...source.segments[0],text:'x'.repeat(19000)}]}),/exceeds/);
});
test('local recall retains whole relevant candidates and never calls pending evidence accepted',()=>{
 const source=Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'If rates fall, revenue may grow.',start_seconds:0,end_seconds:3},{id:'b',text:'Unrelated company.',start_seconds:4,end_seconds:6}]});
 const full=[{id:'c1',accepted:false,conditions_en:['Only if rates fall'],risks_en:['Rates stay high'],evidence:[{segment_id:'a',end_segment_id:'a',quote_original:source.segments[0].text}]},{id:'c2',accepted:true,evidence:[{segment_id:'b',quote_original:source.segments[1].text}]}];
 assert.deepEqual(localRecallInventory(full,[source.segments[0]],source),[full[0]]);
 assert.equal(localRecallInventory(full,[source.segments[0]],source)[0].accepted,false);
});
test('critique and discovery share bounded admission and all started siblings drain',async()=>{
 const admit=sharedAdmission(2);let active=0,peak=0,finished=0;
 const jobs=Array.from({length:6},(_,i)=>admit(async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;finished++;if(i===1)throw Error('failed');return i;}));
 const settled=await Promise.allSettled(jobs);assert.equal(peak,2);assert.equal(finished,6);assert.equal(settled[1].status,'rejected');
});
