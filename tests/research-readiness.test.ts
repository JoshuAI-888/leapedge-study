import test from 'node:test';
import assert from 'node:assert/strict';
import { researchReadiness } from '../src/features/youtube-intelligence/research-readiness.ts';
const evidence = [{id:'c1',instrument:'Credo',summary:'Favorite below 170'}, {id:'m1',instrument:'Dutch Bros',summary:'Moat questioned'}];
test('zero accepted sentences cannot be a usable completed brief',()=>{
 assert.equal(researchReadiness({evidence,sentences:[],rejected:[],omissions:[],coverageFindings:[]}).status,'review_required');
});
test('missing company evidence stays visible despite a completed summary',()=>{
 const r=researchReadiness({evidence,sentences:[{id:'s1',evidenceIds:['c1']}],rejected:[],omissions:[],coverageFindings:[]});
 assert.equal(r.status,'partial'); assert.equal(r.covered,1); assert.equal(r.total,2); assert.equal(r.coverage[1].status,'unresolved');
});
test('citing every company does not erase independently reported missing qualifications',()=>{
 const r=researchReadiness({evidence,sentences:[{id:'s1',evidenceIds:['c1','m1']}],rejected:[],omissions:[],coverageFindings:['Entry qualification omitted']});
 assert.equal(r.status,'partial'); assert.ok(r.issues.includes('Entry qualification omitted'));
});
test('fully accounted inventory is coverage complete, not a claim of factual verification',()=>{
 const r=researchReadiness({evidence,sentences:[{id:'s1',evidenceIds:['c1','m1']}],rejected:[],omissions:[],coverageFindings:[],evidenceCoverage:evidence.map(e=>({evidenceId:e.id,status:'covered',sentenceIds:['s1'],missingPoints:[],reason:'All material propositions represented.'}))});
 assert.equal(r.status,'complete'); assert.equal(r.label,'Coverage accounted for');
});
test('citation presence cannot cover a missing forward condition in the same evidence item',()=>{
 const r=researchReadiness({evidence:[{id:'k5',summary:'BOJ decision and next yen check',quotes:[{text:'Raised 25 basis points. Watch further yen appreciation.'}]}],sentences:[{id:'s4',evidenceIds:['k5']}],evidenceCoverage:[{evidenceId:'k5',status:'partial',sentenceIds:['s4'],missingPoints:[{point:'Further yen appreciation must be monitored',quote:'Watch further yen appreciation.'}],reason:'Decision covered; monitoring omitted.'}]});
 assert.equal(r.status,'partial'); assert.equal(r.coverage[0].status,'unresolved'); assert.match(r.issues.join(' '),/Further yen appreciation/);
});
test('missing proposition assessment remains explicitly unknown despite citations',()=>{
 const r=researchReadiness({evidence,sentences:[{id:'s1',evidenceIds:['c1','m1']}]});
 assert.equal(r.status,'partial'); assert.match(r.issues.join(' '),/not assessed/i);
});
test('unanchored or duplicate coverage verdicts cannot award complete status',()=>{
 for(const assessments of [[{evidenceId:'c1',status:'covered',sentenceIds:['s1'],missingPoints:[{point:'Fabricated',quote:'not retained'}],reason:'Claimed coverage'}],Array.from({length:2},()=>({evidenceId:'c1',status:'covered',sentenceIds:['s1'],missingPoints:[],reason:'Conflicting duplicate'}))]) {
 const r=researchReadiness({evidence:[evidence[0]],sentences:[{id:'s1',evidenceIds:['c1']}],evidenceCoverage:assessments});assert.equal(r.status,'partial');assert.match(r.issues.join(' '),/not assessed/);
 }
});
