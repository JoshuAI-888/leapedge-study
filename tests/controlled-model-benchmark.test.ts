import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPairs, benchmarkBudgetCeiling, controlledInput, drivePausedRun } from '../scripts/benchmark-controlled-models.ts';
import { TeamPreferences } from '../src/features/youtube-intelligence/settings.ts';

test('audit selection is fixed largest batch per video and alternates six sequential arms',()=>{
 const traces=['a','b','c'].flatMap((runId,i)=>[1,2].map(n=>({runId,stage:`critique-faithful-${n}`,model:'anthropic/claude-sonnet-5',prompt:'Keep conditions',payload:{content:'x'.repeat(n)},responseSchema:{type:'object'},maxOutputTokens:16000,reasoningEffort:'low',settings:TeamPreferences.parse({}),hash:`${i}-${n}`})));
 const pairs=auditPairs(traces,{a:{videoId:'_mEvVWGfmjU',sourceHash:'a-source'},b:{videoId:'Mepjkm_0ns4',sourceHash:'b-source'},c:{videoId:'fSx-Ho8mi18',sourceHash:'c-source'}});
 assert.equal(pairs.length,6);assert.ok(pairs.every(x=>x.request.stage==='critique-faithful-2'));
 assert.deepEqual(pairs.map(x=>x.model),['anthropic/claude-sonnet-5','anthropic/claude-haiku-5.5','anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5','anthropic/claude-sonnet-5','anthropic/claude-haiku-5.5']);
});
test('fresh candidate flags and Haiku change only critic and context model while baseline cannot inherit prior treatment',()=>{
 const original={task:'old-task',teamPreferencesSnapshot:TeamPreferences.parse({}),auditedExecutionPlan:{version:'audited-speed.v1'},publicationSafeguardsVersion:'atomic-publication.v1',efficiencyVersion:'evidence-efficiency.v1',speculativeResearch:true};
 const baseline=controlledInput(original,'baseline'),candidate=controlledInput(original,'candidate'),haiku=controlledInput(original,'haiku');
 assert.equal(baseline.auditedExecutionPlan,undefined);assert.equal(baseline.publicationSafeguardsVersion,undefined);assert.equal(baseline.speculativeResearch,false);
 assert.equal(candidate.publicationSafeguardsVersion,'atomic-publication.v1');assert.equal(candidate.task,'source-model-benchmark');
 const before=TeamPreferences.parse(candidate.teamPreferencesSnapshot),after=TeamPreferences.parse(haiku.teamPreferencesSnapshot);
 assert.deepEqual(before.models.extraction,after.models.extraction);assert.deepEqual(before.models.translation,after.models.translation);
 assert.equal(after.models.critique.id,'anthropic/claude-haiku-5.5');assert.equal(after.models.context.id,'anthropic/claude-haiku-5.5');
 assert.equal(after.processing.maxRetriesPerStage,0);assert.equal(before.processing.maxRetriesPerStage,0);
 assert.equal(original.speculativeResearch,true);
});
test('comparison budget tightens current lifetime ceiling and refuses invalid or greater-than-five remaining budgets',()=>{
 assert.equal(benchmarkBudgetCeiling(undefined,20,.75),20.75);assert.equal(benchmarkBudgetCeiling(20.25,20,.75),20.25);
 assert.throws(()=>benchmarkBudgetCeiling(undefined,20,5.01));assert.throws(()=>benchmarkBudgetCeiling(19,20,.5));
});
test('direct driver persists paused checkpoints and retains failed work without another step',async()=>{
 const run={stage:'synthesis',status:'paused',output:{},error:null};const persisted:string[]=[];let steps=0;
 const outcome=await drivePausedRun(run,{step:async r=>{steps++;r.stage='critique';throw Error('Unknown paid outcome');},save:async r=>{persisted.push(r.status);},checkpoint:async()=>{}},3);
 assert.equal(steps,1);assert.equal(outcome.status,'failed');assert.equal(persisted.at(-1),'failed');assert.equal(outcome.timings.length,1);
});
test('direct driver keeps database paused between successful steps and marks only terminal completion',async()=>{
 const run={stage:'synthesis',status:'paused',output:{},error:null};const persisted:string[]=[];let steps=0;
 await drivePausedRun(run,{step:async r=>{if(++steps===1)r.stage='critique';else{r.stage='complete';r.status='completed';}},save:async r=>{persisted.push(r.status);},checkpoint:async()=>{}},3);
 assert.deepEqual(persisted,['paused','completed']);
});
