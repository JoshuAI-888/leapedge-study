import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedCampaign, stageHostedArm, summarizeHostedCampaign, postgresLiteral, renderPostgresSQL } from '../scripts/benchmark-hosted-models.ts';
import { TeamPreferences } from '../src/features/youtube-intelligence/settings.ts';

function roots(){return ['_mEvVWGfmjU','Mepjkm_0ns4','fSx-Ho8mi18'].map((videoId,i)=>({id:`source-${i}`,videoId,model:'google/gemini-3.8-flash',title:videoId,createdAt:'2026-10-10T00:00:00.000Z',input:{teamPreferencesSnapshot:TeamPreferences.parse({}),researchPipeline:'faithful',researchPipelineVersion:'faithful-v1'},output:{source:{segments:[{id:1,text:'If revenues grow, I expect upside.'}]},sourceHash:`source-hash-${i}`,metadata:{title:videoId},coverage:{complete:true}}}));}
test('hosted campaign freezes nine source arms with one shared bounded cap and fresh IDs',()=>{
 const original=roots(),campaign=createHostedCampaign(original,.75);
 assert.equal(campaign.arms.length,9);assert.equal(new Set(campaign.arms.map(x=>x.runId)).size,9);
 assert.ok(campaign.arms.every(x=>x.input.benchmarkCampaign.id===campaign.id&&x.input.benchmarkCampaign.maxUsd===.75));
 assert.equal(campaign.arms[0].createdAt,original[0].createdAt);assert.equal(campaign.arms[0].input.origin,'manual');
 assert.ok(campaign.arms.every(a=>a.input.task===undefined));
 assert.equal(campaign.arms[0].input.auditedExecutionPlan,undefined);assert.ok(campaign.arms[1].input.auditedExecutionPlan);
 assert.equal(campaign.arms[2].input.criticModel,'anthropic/claude-haiku-5.5');assert.deepEqual(original,roots());
 assert.deepEqual(campaign.arms.map(a=>a.variant),['baseline','candidate','haiku','candidate','haiku','baseline','haiku','baseline','candidate']);
 for(const root of original)assert.deepEqual(campaign.arms.filter(a=>a.videoId===root.videoId).map(a=>a.title),[root.title,root.title,root.title]);
 assert.throws(()=>createHostedCampaign(original,5.1));assert.throws(()=>createHostedCampaign(original.slice(1),1));
});
test('hosted staging contains exactly one queued synthesis root and analyze job with parameterized source',()=>{
 const campaign=createHostedCampaign(roots(),1),arm=campaign.arms[0];
 const staged=stageHostedArm(campaign,1,'2026-10-12T00:00:00.000Z');
 assert.equal(staged.runId,arm.runId);assert.ok(staged.sql.includes("'queued','synthesis'"));assert.ok(staged.sql.includes('INSERT INTO jobs'));
 assert.ok(staged.sql.includes("'analyze'"));assert.ok(staged.parameters.includes(`analyze:${arm.runId}`));
 assert.ok(!staged.sql.includes('If revenues grow'));assert.ok(staged.parameters.some(x=>typeof x==='string'&&x.includes('If revenues grow')));
 assert.ok(staged.sql.includes('ON CONFLICT'));assert.ok(!staged.sql.includes('UPDATE yi_runs'));
 assert.ok(staged.sql.includes("->'benchmarkExperiment'->>'version'='hosted-source-fixed.v1'"));assert.ok(!staged.sql.includes("->>'task'='source-model-benchmark'"));
 assert.throws(()=>stageHostedArm(campaign,0));assert.throws(()=>stageHostedArm(campaign,10));
 const oldTaskManifest=structuredClone(campaign);oldTaskManifest.arms[0].input.task='source-model-benchmark';assert.throws(()=>stageHostedArm(oldTaskManifest,1),/must omit task/);
});
test('remote summary scopes descendants and raw records while unknown holds prevent a settled total',()=>{
 const campaign=createHostedCampaign(roots(),1),arm=campaign.arms[0];
 const child={id:'child',input:JSON.stringify({task:'research-brief',snapshot:{sourceRunId:arm.runId},benchmarkCampaign:{id:campaign.id,maxUsd:1}}),status:'completed',updated_at:'2026-10-12T00:01:00.000Z',output:'{}'};
 const result=summarizeHostedCampaign(campaign,{runs:[{id:arm.runId,input:arm.input,status:'completed',output:arm.output},child,{id:'foreign',input:{},status:'completed'}],calls:[{id:'call',run_id:'child',stage:'critique',status:'unknown',amount:.2,metrics:'{}'},{id:'foreign-call',run_id:'foreign',status:'completed',amount:99}],responses:[{id:'raw',run_id:'child',payload:'{"raw":"retained"}'}],timings:[{run_id:'child',stage:'critique',execution_ms:1000,queue_ms:30,checkpoint_ms:2,finished_at:'2026-10-12T00:01:00.000Z'}],briefs:[{runId:'child',text:'If revenues grow, upside.'}]});
 assert.equal(result.arms[0].committedUsd,.2);assert.equal(result.arms[0].settledCostUsd,null);assert.equal(result.arms[0].unknownCalls,1);
 assert.equal(result.arms[0].executionSeconds,1);assert.equal(result.raw.calls.length,1);assert.equal(result.raw.responses.length,1);assert.equal(result.raw.briefs.length,1);
 assert.equal(result.qualityVerdict,'review-required');assert.equal(result.arms[1].status,'not-staged');
});
test('remote summary fails closed on changed source and missing campaign inheritance',()=>{
 const campaign=createHostedCampaign(roots(),1),arm=campaign.arms[0];
 const result=summarizeHostedCampaign(campaign,{runs:[{id:arm.runId,input:arm.input,status:'completed',output:{...arm.output,source:{segments:[]}}},{id:'child',input:{task:'research-brief',snapshot:{sourceRunId:arm.runId}},status:'completed',output:{}}]});
 assert.equal(result.arms[0].comparable,false);assert.ok(result.arms[0].issues.some(x=>x.includes('source bytes')));assert.ok(result.arms[0].issues.some(x=>x.includes('campaign marker')));
});
test('reviewable SQL escapes apostrophes backslashes and literal placeholder text without resubstitution',()=>{
 assert.equal(postgresLiteral("Creator's \\ quote"),"E'Creator''s \\\\ quote'");
 assert.equal(renderPostgresSQL('SELECT $1,$2', ["ignore $2; creator's condition",7]),"SELECT E'ignore $2; creator''s condition',7");
 assert.throws(()=>postgresLiteral('bad\u0000text'));assert.throws(()=>renderPostgresSQL('SELECT $3',['a']));
});
test('remote summary retains native Jev decisions without requiring a generative normalized response',()=>{
 const campaign=createHostedCampaign(roots(),1),arm=campaign.arms[0];
 const screen={model:'jev-small',results:[{id:'s1',pFaithful:.999,route:'accept',errorType:'none'}],wallMs:100,costUsd:.0001,error:null};
 const exported={runs:[{id:arm.runId,input:arm.input,status:'completed',output:arm.output},{id:'child',input:{task:'research-brief',snapshot:{sourceRunId:arm.runId},benchmarkCampaign:{id:campaign.id,maxUsd:1}},status:'completed',output:{faithfulAudit:{preScreen:screen}}}],
  calls:[{id:'jev-call',run_id:'child',stage:'prescreen-jev',status:'completed',amount:.0001,metrics:JSON.stringify({provider:'typesafe',model:'jev-small',answered:1})}],
  timings:[{run_id:arm.runId,stage:'synthesis',claimed_at:new Date('2026-10-12T00:00:00.000Z'),finished_at:new Date('2026-10-12T00:00:02.000Z'),execution_ms:1900,queue_ms:100,checkpoint_ms:100},{run_id:'child',stage:'research-audit',claimed_at:'2026-10-12 00:00:03+00',finished_at:'2026-10-12 00:00:04+00',execution_ms:1000,queue_ms:500,checkpoint_ms:0}]};
 const result=summarizeHostedCampaign(campaign,exported);
 assert.equal(result.arms[0].comparable,true);assert.equal(result.arms[0].settledCostUsd,.0001);
 assert.equal(result.arms[0].observedSubmissionToBriefSeconds,4.1);assert.equal(result.raw.timings[0].claimed_at,'2026-10-12T00:00:00.000Z');
 assert.deepEqual(result.raw.runs[1].output.faithfulAudit,{preScreen:screen});
 exported.calls[0]={...exported.calls[0],id:'model-call',stage:'critique-faithful-1',metrics:JSON.stringify({provider:'Anthropic',model:'anthropic/claude-sonnet-5',requestFingerprint:'frozen'})};
 assert.ok(summarizeHostedCampaign(campaign,exported).arms[0].issues.some(x=>x.includes('Missing retained normalized response for model-call')));
});
test('first checked finding uses fenced publication time rather than critique or discovery completion',()=>{
 const campaign=createHostedCampaign(roots(),1),baseline=campaign.arms[0],candidate=campaign.arms[1];
 const child=(arm:typeof baseline)=>({id:`child-${arm.runId}`,input:{task:'research-brief',snapshot:{sourceRunId:arm.runId},benchmarkCampaign:{id:campaign.id,maxUsd:1}},status:'completed',output:{}});
 const timings=[baseline,candidate].flatMap(arm=>[{run_id:arm.runId,stage:'synthesis',claimed_at:'2026-10-12T00:00:00.100Z',finished_at:'2026-10-12T00:00:01.000Z',execution_ms:900,queue_ms:100,checkpoint_ms:0},{run_id:arm.runId,stage:'critique',claimed_at:'2026-10-12T00:00:01.000Z',finished_at:'2026-10-12T00:00:10.000Z',execution_ms:9000,queue_ms:0,checkpoint_ms:0},{run_id:`child-${arm.runId}`,stage:'research-audit',claimed_at:'2026-10-12T00:00:11.000Z',finished_at:'2026-10-12T00:00:30.000Z',execution_ms:19000,queue_ms:0,checkpoint_ms:0}]);
 const baselineRun={id:baseline.runId,input:baseline.input,status:'completed',output:baseline.output};
 const candidateRun={id:candidate.runId,input:candidate.input,status:'completed',output:{...candidate.output,checkedFindingsPublishedAt:'2026-10-12T00:00:02.000Z',checkedFindingsUpdatedAt:'2026-10-12T00:00:05.000Z'}};
 const exported={runs:[baselineRun,child(baseline),candidateRun,child(candidate)],timings};
 let summary=summarizeHostedCampaign(campaign,exported);
 assert.equal(summary.arms[1].firstCheckedSeconds,2);assert.equal(summary.arms[1].firstCheckedTimingBasis,'publication-checkpoint');
 assert.equal(summary.arms[0].firstCheckedSeconds,10);assert.equal(summary.arms[0].firstCheckedTimingBasis,'root-completion');
 assert.equal(summary.sourceAcquisitionIncluded,false);assert.equal(summary.arms[1].observedSubmissionToBriefSeconds,30);
 candidateRun.output.checkedFindingsPublishedAt='2026-10-11T23:59:59.000Z';baselineRun.status='queued';
 summary=summarizeHostedCampaign(campaign,exported);
 assert.equal(summary.arms[1].firstCheckedSeconds,null);assert.equal(summary.arms[1].firstCheckedTimingBasis,'unavailable');
 assert.ok(summary.arms[1].issues.some(x=>x.includes('publication timestamp precedes')));assert.equal(summary.arms[0].firstCheckedSeconds,null);
});
