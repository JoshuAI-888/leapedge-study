// Research execution is separate from source execution and brief quality.
type Job = {id:string;task:string;sourceRunId:string|null;status:string;stage:string;error:string|null;createdAt:string;updatedAt:string};
type Brief = {id:string;runId:string;sourceRunId:string};
const sourceId = (job:Job) => job.sourceRunId;
const task = (job:Job) => job.task;
export function researchLifecycle(sourceRunId:string,jobs:Job[],briefs:Brief[],selectedBriefId:string|null=null) {
 const attempts=jobs.filter(j=>task(j)==='research-brief'&&sourceId(j)===sourceRunId)
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 const latest=attempts[0]??null;
 const retained=briefs.filter(b=>b.sourceRunId===sourceRunId);
 const active=attempts.filter(j=>['queued','running'].includes(j.status));
 const latestBrief=latest?retained.find(b=>b.runId===latest.id||b.id===latest.id):null;
 const history=attempts.map(j=>({id:j.id,status:j.status,stage:j.stage,error:j.error??null,createdAt:j.createdAt,updatedAt:j.updatedAt}));
 let state='not_started',heading='Research not started',message='Source processing and investment research are separate steps.';
 if(latest){
  if(['failed','needs_review'].includes(latest.status)){
   state=latest.status;heading=latest.status==='failed'?'Latest research attempt failed':'Latest research attempt needs review';
   if(latestBrief){heading=latest.status==='needs_review'?'Latest research published with unresolved issues':'Latest research attempt failed with a retained brief';message='A brief from this attempt is retained. Inspect its unresolved issues, attempt details and source evidence before relying on it.';}
   else message=latest.stage==='research-audit'?'The latest attempt did not complete the required research audit. No new brief from this attempt is available.':'No new brief from this attempt is available. Review the stage and error details.';
  }else if(['queued','running'].includes(latest.status)){
   state=latest.status;heading=latest.status==='queued'?'New research attempt queued':'New research attempt in progress';
   message='This attempt has not published a new research brief yet.';
  }else if(latest.status==='completed'){
   state=latestBrief?'published':'publication_missing';heading=latestBrief?'Latest research attempt published':'Research completed without an available brief';
   message=latestBrief?'Publication does not establish completeness or factual verification; inspect the brief readiness separately.':'The completed attempt has no matching retained brief. Review the attempt before relying on an earlier revision.';
  }else{state='unknown';heading='Research state requires review';message='The retained attempt has an unrecognised execution state.';}
 }
 return {state,heading,message,latest:latest?{id:latest.id,status:latest.status,stage:latest.stage,error:latest.error??null}:null,
  history,selectedEarlierRevision:!!selectedBriefId&&!!latestBrief&&selectedBriefId!==latestBrief.id,
  selectedRevisionNotice:!!selectedBriefId&&!!latestBrief&&selectedBriefId!==latestBrief.id?'You are viewing an earlier revision. The attempt status above describes the latest attempt.':null,
  retainedBriefCount:retained.length,showEarlierBriefNotice:!!latest&&!latestBrief&&retained.length>0,
  earlierBriefNotice:retained.length?'Earlier published revisions remain available and do not represent the outcome of the latest attempt.':null,
  activeAttemptIds:active.map(j=>j.id),generationDisabled:active.length>0,
  generationLabel:active.length?'Research attempt in progress…':latest?'Start new research attempt':'Generate research brief',
  sourceStatusLabel:'Source processing complete'};
}
