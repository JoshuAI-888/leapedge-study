import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedPublicationProjection } from '../src/features/youtube-intelligence/research-publication.ts';

test('actual publication coverage loses rejected clauses while keeping surviving accepted references',()=>{
 const brief={evidence:[{id:'k1'},{id:'k2'}],sentences:[{id:'safe',evidenceIds:['k1']}],evidenceCoverage:[{evidenceId:'k1',status:'covered',sentenceIds:['safe','unsafe'],missingPoints:[],reason:'Both clauses covered.'},{evidenceId:'k2',status:'covered',sentenceIds:['unsafe'],missingPoints:[],reason:'Candidate covered.'}]};
 const before=structuredClone(brief);
 const result=acceptedPublicationProjection(brief);
 assert.deepEqual(result.acceptedSentenceIds,['safe']);
 assert.deepEqual(result.representedEvidenceIds,['k1']);
 assert.deepEqual(result.missingEvidenceIds,['k2']);
 assert.equal(result.evidenceCoverage[0].status,'partial');
 assert.deepEqual(result.evidenceCoverage[0].sentenceIds,['safe']);
 assert.equal(result.evidenceCoverage[1].status,'missing');
 assert.deepEqual(brief,before);
});
test('missing, duplicate, and unrelated assessment IDs never award publication coverage',()=>{
 const row={evidenceId:'k1',status:'covered',sentenceIds:['safe'],missingPoints:[],reason:'Claimed complete.'};
 const result=acceptedPublicationProjection({evidence:[{id:'k1'},{id:'k2'}],sentences:[{id:'safe',evidenceIds:['k2']}],evidenceCoverage:[row,row]});
 assert.equal(result.evidenceCoverage[0].status,'unknown');
 assert.equal(result.evidenceCoverage[1].status,'unknown');
});
