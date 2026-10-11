import test from 'node:test';import assert from 'node:assert/strict';
import {EvidenceRecord} from '../src/features/youtube-intelligence/research-brief.ts';
import {buildAtomEvidenceIndex,expandAtomEvidenceIndex,atomSynthesisContext} from '../src/server/youtube-intelligence/source-atom-index.ts';
const record=()=>EvidenceRecord.parse({id:'k1',kind:'research_context',summary:'Planet reports EBITDA, not net profit.',instrument:'Planet',ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',source_atom:{version:'source-atom.v1',actorOriginal:'Planet',predicate:'reports',objectOriginal:null,kind:'reported_fact',quantities:[],conditionsOriginal:[],opposingOriginal:['not net profit']},quotes:[{startId:'s1',endId:'s2',text:'Planet reports EBITDA, not net profit.',translation:'',start:1,end:4,hash:null}]});
test('identical accepted atom bodies share one dictionary entry with every evidence id and complete source range retained',()=>{
 const a=record(),b={...a,id:'k2',quotes:[{...a.quotes[0],startId:'s3',endId:'s4',start:10,end:13}]};const input=[a,b],index=buildAtomEvidenceIndex(input);
 assert.equal(index.atoms.length,1);assert.equal(index.inventory.length,2);assert.equal(index.quotes.length,2);assert.deepEqual(expandAtomEvidenceIndex(index),input);
});
test('same quote and atom are encoded once without erasing citation ownership',()=>{
 const a=record(),index=buildAtomEvidenceIndex([a,{...a,id:'k2'}]);assert.equal(index.atoms.length,1);assert.equal(index.quotes.length,1);assert.deepEqual(index.inventory.map(r=>r.id),['k1','k2']);
});
test('different actors, periods, opposing clauses, ownership or personal stance cannot merge',()=>{
 const a=record();const variants=[{...a,id:'k2',source_atom:{...a.source_atom!,actorOriginal:'Comcast'}},{...a,id:'k3',horizon:'Q3'},{...a,id:'k4',source_atom:{...a.source_atom!,opposingOriginal:[]}},{...a,id:'k5',summary:'I own Planet.'},{...a,id:'k6',source_atom:{...a.source_atom!,kind:'personal_view' as const}}];
 assert.equal(buildAtomEvidenceIndex([a,...variants]).atoms.length,6);
});
test('lost or tampered entries fail integrity checks and duplicate evidence ids are refused',()=>{
 const index=buildAtomEvidenceIndex([record()]);assert.throws(()=>expandAtomEvidenceIndex({...index,atoms:[]}),/integrity|missing/i);assert.throws(()=>buildAtomEvidenceIndex([record(),record()]),/duplicate/i);
});
test('compression is selected only when it saves payload bytes including decoding instructions',()=>{
 assert.equal(atomSynthesisContext([record()]).encoded,false);
 const a=record();a.summary+='x'.repeat(1500);a.quotes[0].text+='y'.repeat(2500);
 const source=Array.from({length:12},(_,i)=>({...a,id:`k${i}`}));const ctx=atomSynthesisContext(source);assert.equal(ctx.encoded,true);assert.ok(ctx.actualBytes<ctx.originalBytes);assert.deepEqual(expandAtomEvidenceIndex(ctx.payload.atomEvidenceIndex),source);
});

test('unique proposition metadata can still share exact quotations when a quote dictionary is the smallest context',()=>{
 const items=Array.from({length:8},(_,i)=>({...record(),id:'e'+i,summary:'Unique '+i,quotes:[{...record().quotes[0],text:'x'.repeat(4000)}],source_atom:{...record().source_atom!,predicate:'unique relation '+i}}));
 const context=atomSynthesisContext(items);
 assert.ok('evidenceIndex' in context.payload);
});
