import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileResearchAudit } from '../src/server/youtube-intelligence/research-audit-repair.ts';
const verdict=(id:string)=>({id,accepted:true,reason:'supported',factualStatus:'unverified'});
test('only unanswered sentences are repaired and original findings survive',async()=>{
 const asked:string[][]=[];
 const r=await reconcileResearchAudit(['a','b'],{verdicts:[verdict('a')],coverageFindings:['Missing risk']},async ids=>{asked.push(ids);return {verdicts:[verdict('b')],coverageFindings:[]};});
 assert.deepEqual(asked,[['b']]);assert.deepEqual(r.audit.verdicts.map(v=>v.id),['a','b']);assert.deepEqual(r.audit.coverageFindings,['Missing risk']);assert.equal(r.attempts.length,2);
});
test('a second incomplete response remains unresolved without granting acceptance',async()=>{
 let calls=0;const r=await reconcileResearchAudit(['a','b'],{verdicts:[verdict('a')],coverageFindings:[]},async()=>{calls++;return {verdicts:[],coverageFindings:[]};});
 assert.equal(calls,1);assert.deepEqual(r.missing,['b']);assert.equal(r.audit.verdicts.length,1);
});
test('duplicate conflicting verdicts cannot silently choose a winner',async()=>{
 const r=await reconcileResearchAudit(['a'],{verdicts:[verdict('a'),{...verdict('a'),accepted:false}],coverageFindings:[]},async ids=>({verdicts:ids.map(verdict),coverageFindings:[]}));
 assert.equal(r.attempts.length,2);assert.equal(r.audit.verdicts.length,1);
});
test('restricted verdict repair cannot erase new gaps or upgrade old proposition gaps',async()=>{
 const covered={evidenceId:'k1',status:'covered',sentenceIds:['a'],missingPoints:[],reason:'Event represented'};
 const partial={...covered,status:'partial',missingPoints:[{point:'Future yen monitoring',quote:'Watch further yen appreciation.'}],reason:'Forward monitor missing'};
 for(const [first,second] of [[covered,partial],[partial,covered]]) {
 const r=await reconcileResearchAudit(['a','b'],{verdicts:[verdict('a')],coverageFindings:[],evidenceCoverage:[first]},async()=>({verdicts:[verdict('b')],coverageFindings:[],evidenceCoverage:[second]}));
 assert.equal(r.audit.evidenceCoverage[0].status,'partial');assert.equal(r.audit.evidenceCoverage[0].missingPoints[0].point,'Future yen monitoring');
 }
});
