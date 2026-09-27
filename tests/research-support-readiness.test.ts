import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ResearchVerdict,ResearchAudit,ResearchAuditResponse,validateBrief,analysisContext,evidenceInventory} from '../src/features/youtube-intelligence/research-brief.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/readiness/g5-support-audit.json',import.meta.url),'utf8'));
fixture.audit = JSON.parse(fixture.rawText);
test('actual G audit with more than8 support references parses without loss or rewriting raw paid response',()=>{
 const before=JSON.stringify(fixture);assert.ok(fixture.audit.verdicts[5].thesisSupportIds.length>8);
 for(const schema of [ResearchAudit,ResearchAuditResponse])assert.deepEqual(schema.parse(fixture.audit).verdicts.map((v:any)=>v.thesisSupportIds),fixture.audit.verdicts.map((v:any)=>v.thesisSupportIds));
 assert.equal(JSON.stringify(fixture),before);
});
test('48 same-draft IDs fit;49 stays bounded, without truncation',()=>{
 const verdict={...fixture.audit.verdicts[5],thesisSupportIds:Array.from({length:48},(_,i)=>`s${i}`)};assert.equal(ResearchVerdict.parse(verdict).thesisSupportIds.length,48);
 assert.equal(ResearchVerdict.safeParse({...verdict,thesisSupportIds:[...verdict.thesisSupportIds,'s49']}).success,false);
});
const run:any={id:'run',videoId:'video',createdAt:'2026-09-20T00:00:00Z',output:{metadata:{publishedAt:'2026-04-10T01:16:13Z'},source:{segments:[{id:'q',text:'The creator holds shares.',start_seconds:0,end_seconds:4}]},claims:[{id:'c1',passed:true,reasons:[],audit:{verdict:'accept'},claim:{instrument_as_spoken:'Company',ticker:null,thesis_en:'The creator holds shares.',evidence:[{segment_id:'q',quote_original:'The creator holds shares.'}]}}]}};
const sentence:any={id:'s1',text:'The creator holds shares.',evidenceIds:['c1'],externalIds:['x1'],kind:'creator_view',horizon:'fundamental',topic:'Company',materiality:2,importanceReason:'Position',speaker:'unknown',timeMode:'video_date'};
const external:any={id:'x1',url:'https://example.com/report',title:'Primary',text:sentence.text,publishedAt:'2026-04-01T00:00:00Z',retrievedAt:'2026-09-20T00:00:00Z',publicationConfirmed:true,dateBasis:'fixture',sourceClass:'primary',hash:'fixture',query:'fixture',timeMode:'video_date',provider:'fixture'};
function check(ids:string[],change:any={}) {
 const counter={...sentence,id:'c',kind:'countercase',externalIds:[],...change},invalid={...sentence,id:'i',kind:'invalidation',externalIds:[]};
 const audit={id:'s1',accepted:true,reason:'Exact match',factualStatus:'corroborated',robustness:'supported',thesisSupportIds:ids,externalSupport:[{externalId:'x1',assertion:sentence.text,quote:sentence.text,relationship:'supports',reason:'Same holder',comparability:{metric:'matched',period:'matched',units:'not_applicable',observationBasis:'matched',reason:'Same holder/date'}}]};
 return validateBrief({sentences:[sentence,counter,invalid],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[external],analysisContext(run),[ResearchVerdict.parse(audit),{id:'c',accepted:change.reject!==true,reason:'Fixture',factualStatus:'unverified'},{id:'i',accepted:true,reason:'Fixture',factualStatus:'unverified'}]).sentences.find((s:any)=>s.id==='s1')!;
}
test('wider reference list still requires retained same-topic/time/horizon countercase and invalidation',()=>{
 assert.equal(check(['c','i']).robustness,'supported','positive threshold control');
 for(const ids of [fixture.audit.verdicts[5].thesisSupportIds,Array.from({length:48},(_,i)=>`unknown-${i}`),['c','unknown'],['i','unknown']])assert.notEqual(check(ids).robustness,'supported');
 for(const change of [{topic:'Other'},{timeMode:'current'},{horizon:'tactical'},{reject:true}])assert.notEqual(check(['c','i'],change).robustness,'supported');
});

test('retained G5 raw response can be schema-replayed without provider traffic or run mutation',()=>{
 const before=fixture.rawText;const fetchBefore=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('No provider requests permitted during schema-only replay');};
 try {const parsed=ResearchAuditResponse.parse(JSON.parse(fixture.rawText));assert.equal(parsed.verdicts[5].thesisSupportIds.length,9);assert.equal(fixture.rawText,before);}
 finally {globalThis.fetch=fetchBefore;}
});
