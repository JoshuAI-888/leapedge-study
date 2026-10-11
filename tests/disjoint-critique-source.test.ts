import test from 'node:test';
import assert from 'node:assert/strict';
import { Source, Mention, deriveEvidence } from '../src/features/youtube-intelligence/contracts.ts';
import { critiquePayload } from '../src/server/youtube-intelligence/schemas/critique.ts';
function fixture() {
 const source=Source.parse({source_kind:'captions',language:'en',segments:[{id:'first',text:'I watch earnings growth.',start_seconds:0,end_seconds:3},{id:'gap',text:'UNCITED_GAP_SENTINEL',start_seconds:4,end_seconds:7},{id:'later',text:'For me debt and an eight percent return on capital do not interest me.',start_seconds:521,end_seconds:529}]});
 const span=(id:string)=>{const q=deriveEvidence(source,{start_id:id,end_id:id});return {start_id:id,end_id:id,start_seconds:q.start_seconds,end_seconds:q.end_seconds,text_hash:q.text_hash};};
 const mention=Mention.parse({ticker:null,instrument_as_spoken:'Company',market:'unknown',stance:'watch',sentiment:'neutral',rationale_en:'Growth with personal reservations.',is_call:false,claim_id:null,source_span:span('first'),source_ranges:[span('first'),span('later')]});
 return {source,mention};
}
test('chunked critique receives every separate retained mention quote, without fabricating a continuous span',()=>{
 const {source,mention}=fixture();const original=structuredClone(mention);
 const payload=critiquePayload({claims:[],mentions:[{id:'m1',mention}],segments:[source.segments[0]],chunk:{index:0,total:2},retainedSource:source});
 const ranges=payload.mentions[0].citedSourceRanges;
 assert.deepEqual(ranges?.map(r=>r.source_span.start_id),['first','later']);
 assert.deepEqual(ranges?.map(r=>r.quote_original),[source.segments[0].text,source.segments[2].text]);
 assert.ok(!JSON.stringify(payload).includes('UNCITED_GAP_SENTINEL'));
 assert.deepEqual(mention,original);
});
test('a chunked disjoint mention cannot lose a corrupted or unavailable secondary source range',()=>{
 const {source,mention}=fixture();
 assert.throws(()=>critiquePayload({claims:[],mentions:[{id:'m1',mention}],segments:[source.segments[0]],chunk:{index:0,total:2}}),/retained source/i);
 mention.source_ranges![1].text_hash='a'.repeat(64);
 assert.throws(()=>critiquePayload({claims:[],mentions:[{id:'m1',mention}],segments:[source.segments[0]],chunk:{index:0,total:2},retainedSource:source}),/hash/i);
});
test('historical single-pointer mentions keep the original critique payload shape',()=>{
 const {source,mention}=fixture();delete mention.source_ranges;
 const input={claims:[],mentions:[{id:'m1',mention}],segments:source.segments,chunk:{index:0,total:2}};
 assert.deepEqual(critiquePayload({...input,retainedSource:source}),critiquePayload(input));
});
