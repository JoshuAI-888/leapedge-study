import test from 'node:test';
import assert from 'node:assert/strict';
import { activityReadiness, latestResearchBySource } from '../src/features/youtube-intelligence/ui/viewmodel.ts';
const brief=(sourceRunId:string,status:'complete'|'partial'|'review_required',createdAt='2026-09-27')=>({sourceRunId,createdAt,readiness:{status}});

test('completed extraction cannot display Ready when its research is empty or partial',()=>{
 const empty=activityReadiness({status:'completed'},brief('a','review_required'));
 assert.equal(empty.label,'Research review required');assert.equal(empty.filter,'Needs review');assert.equal(empty.needsReview,true);
 const partial=activityReadiness({status:'completed'},brief('b','partial'));
 assert.equal(partial.label,'Analysis complete · research partial');assert.equal(partial.filter,'Needs review');
 assert.equal(activityReadiness({status:'completed'},brief('c','complete')).needsReview,false);
 assert.equal(activityReadiness({status:'completed'}).label,'Analysis complete · no research brief');
});
test('latest brief is selected by source run, not video or older revision',()=>{
 const latest=latestResearchBySource([brief('a','partial','2026-09-26'),brief('a','complete','2026-09-27'),brief('b','review_required','2026-09-28')]);
 assert.equal(latest.get('a')?.readiness.status,'complete');assert.equal(latest.get('b')?.readiness.status,'review_required');
});
test('successful brief cannot conceal a genuine failed extraction or an active run',()=>{
 assert.equal(activityReadiness({status:'failed'},brief('a','complete')).label,'Analysis failed · needs review');
 assert.equal(activityReadiness({status:'failed'},brief('a','complete')).needsReview,true);
 assert.equal(activityReadiness({status:'running'},brief('a','partial')).label,'Analysing');
 assert.equal(activityReadiness({status:'failed'},brief('a','complete'),true).label,'Recovered · earlier attempt failed');
});
