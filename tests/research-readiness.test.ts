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
 const r=researchReadiness({evidence,sentences:[{id:'s1',evidenceIds:['c1','m1']}],rejected:[],omissions:[],coverageFindings:[]});
 assert.equal(r.status,'complete'); assert.equal(r.label,'Coverage accounted for');
});
