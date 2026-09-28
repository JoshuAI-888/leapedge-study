import test from 'node:test';
import assert from 'node:assert/strict';
import {researchLifecycle} from '../src/features/youtube-intelligence/research-lifecycle.ts';
const failed={"id": "bae7c03b-35a1-4a85-8795-55b4a555f689", "status": "failed", "stage": "research-audit", "error": "[\n  {\n    \"origin\": \"array\",\n    \"code\": \"too_big\",\n    \"maximum\": 8,\n    \"inclusive\": true,\n    \"path\": [\n      \"verdicts\",\n      5,\n      \"thesisSupportIds\"\n    ],\n    \"message\": \"Too big: expected array to have <=8 items\"\n  }\n]", "createdAt": "2026-09-26T23:05:44.335Z", "updatedAt": "2026-09-26T23:07:16.600Z", "task": "research-brief", "sourceRunId": "64e2995b-4dfc-4225-847f-0061b2c096e8"};
const source=failed.sourceRunId;
const old={id:'old-brief',runId:'old-job',sourceRunId:source,createdAt:'2026-09-25T00:00:00Z'};
const newer=(status:string,id='new-job')=>({...failed,id,status,error:null,createdAt:'2026-09-27T01:00:00Z'});
test('actual G case 5 failed audit is explicit without a published brief',()=>{
 const result=researchLifecycle(source,[failed],[]);
 assert.equal(result.state,'failed');assert.match(result.message,/required research audit/);
 assert.equal(result.latest!.stage,'research-audit');assert.equal(result.latest!.error,failed.error);
 assert.equal(result.generationLabel,'Start new research attempt');assert.equal(result.generationDisabled,false);
 assert.equal(result.sourceStatusLabel,'Source processing complete');
});
test('newer failed attempt remains visible alongside older published revision',()=>{
 const result=researchLifecycle(source,[failed],[old]);
 assert.equal(result.state,'failed');assert.equal(result.showEarlierBriefNotice,true);assert.equal(result.retainedBriefCount,1);
});
test('new pending attempt is shown with old failure retained in history',()=>{
 const result=researchLifecycle(source,[failed,newer('queued')],[old]);
 assert.equal(result.state,'queued');assert.equal(result.generationDisabled,true);
 assert.equal(result.history.find(j=>j.id===failed.id)!.error,failed.error);
});
test('successful latest publication removes active failure banner, retains historical failure',()=>{
 const result=researchLifecycle(source,[failed,newer('completed')],[old,{...old,id:'new-brief',runId:'new-job'}]);
 assert.equal(result.state,'published');assert.equal(result.showEarlierBriefNotice,false);
 assert.equal(result.history.find(j=>j.id===failed.id)!.status,'failed');
 assert.match(result.message,/does not establish completeness/);
});
test('needs-review and completed-without-publication cannot masquerade as success',()=>{
 assert.equal(researchLifecycle(source,[newer('needs_review')],[old]).state,'needs_review');
 assert.equal(researchLifecycle(source,[newer('completed')],[old]).state,'publication_missing');
});
test('ignore unrelated source jobs and do not order historical attempts by later touch time',()=>{
 const oldFailed={...failed,updatedAt:'2030-01-01T00:00:00Z'};
 const unrelated={...newer('failed','other'),sourceRunId:'other-source'};
 const result=researchLifecycle(source,[oldFailed,newer('running'),unrelated],[old]);
 assert.equal(result.state,'running');assert.equal(result.history.length,2);
});

test('needs_review with a published partial brief never claims publication absence',()=>{
 const result=researchLifecycle(source,[failed,newer('needs_review')],[old,{...old,id:'partial-new',runId:'new-job'}]);
 assert.match(result.heading,/published with unresolved issues/);assert.doesNotMatch(result.message,/No new brief|usable/);
 assert.equal(result.showEarlierBriefNotice,false);
});
test('selected older revision stays explicit when a newer brief exists',()=>{
 const result=researchLifecycle(source,[newer('completed')],[old,{...old,id:'new-brief',runId:'new-job'}],old.id);
 assert.equal(result.state,'published');assert.equal(result.selectedEarlierRevision,true);assert.match(result.selectedRevisionNotice!,/earlier revision/);
});
