import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceIndex, expandEvidenceIndex } from '../src/server/youtube-intelligence/research-evidence-index.ts';
import { EvidenceRecord } from '../src/features/youtube-intelligence/research-brief.ts';
const record = EvidenceRecord.parse({id:'c1',kind:'creator_call',summary:'Conditional preference',instrument:'Credo',ticker:null,stance:'conditional',horizon:null,conditions:['under 170'],risks:[],levels:[],trust:'L1',quotes:[{startId:'s1',endId:'s2',text:'I prefer Credo under 170.',translation:'',start:1,end:4,hash:null}]});
test('indexed evidence round trips every field while storing repeated quotations once', () => {
 const evidence = [record, {...record,id:'k1',kind:'research_context' as const}];
 const index = buildEvidenceIndex(evidence);
 assert.equal(index.quotes.length,1);
 assert.deepEqual(expandEvidenceIndex(index), evidence);
 assert.equal(index.inventory.length,2);
 assert.equal(index.hash,buildEvidenceIndex(evidence).hash);
 assert.notEqual(index.hash,buildEvidenceIndex([{...record,conditions:[]}]).hash);
});
test('same words at different timestamps remain distinct source references', () => {
 const index = buildEvidenceIndex([record,{...record,id:'k1',quotes:[{...record.quotes[0],startId:'s3',endId:'s4',start:9,end:12}]}]);
 assert.equal(index.quotes.length,2);
 assert.throws(()=>expandEvidenceIndex({...index,quotes:[]}), /integrity|missing/i);
});
