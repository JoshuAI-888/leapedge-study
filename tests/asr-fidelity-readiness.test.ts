import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers/db.ts';
import { create } from '../src/server/youtube-intelligence/store.ts';
import { step } from '../src/server/youtube-intelligence/pipeline.ts';
import { windowedAsrStep } from '../src/server/youtube-intelligence/windowed-asr.ts';
import { ensureResearchBrief, researchStep, researchBriefs } from '../src/server/youtube-intelligence/research-pipeline.ts';
import { teamDefaults } from '../src/features/youtube-intelligence/settings.ts';
import { researchReadiness } from '../src/features/youtube-intelligence/research-readiness.ts';
import { FakeModelTransport } from '../src/server/youtube-intelligence/transport/fake.ts';
import { injectTransport } from '../src/server/youtube-intelligence/transport/index.ts';

test('completed window acquisition preserves fidelity warning through published source omissions and partial readiness', async () => {
 const db=await freshDatabase();
 const settings=teamDefaults();
 const source=await create('abcdefghijk','fixture',{teamPreferencesSnapshot:settings},'test');
 source.stage='asr-source'; source.status='running';
 source.output={metadata:{duration:4},limitations:['Existing source limitation']};
 await windowedAsrStep(source,settings,true,async()=>({language:'en',segments:[{text:'The creator holds shares.',start_seconds:0,end_seconds:4}]}));
 assert.equal(source.stage,'synthesis','Usable transcription remains available');
 const limitations=source.output.limitations as string[];
 assert.ok(limitations.some(x=>/wording and timestamps remain unverified/i.test(x)));
 assert.ok(limitations.includes('Existing source limitation'));
 const raw=JSON.stringify(source.output.source);
 await windowedAsrStep(source,settings,true,async()=>{throw Error('Finalization must not repurchase');});
 assert.deepEqual(source.output.limitations,limitations,'Finalization is idempotent');
 assert.equal(JSON.stringify(source.output.source),raw,'No retiming or rewriting');
 source.output.keyPoints=[{id:'c1',passed:true,reasons:[],trust:'L1',claim:{thesis_en:'The creator holds shares.',instrument_as_spoken:'Company',evidence:[{segment_id:'asr-0-0',quote_original:'The creator holds shares.'}]}}];
 source.input.promptSnapshot={temporalResearch:true};source.output.recallChecked=true;source.stage='publish';
 await step(source,settings);
 assert.equal(source.status,'completed');
 assert.ok((source.output.limitations as string[]).some(x=>/wording and timestamps remain unverified/i.test(x)), 'Real source publication must preserve acquisition warning');
 assert.ok((source.output.limitations as string[]).includes('Existing source limitation'));
 const publishedLimitations=structuredClone(source.output.limitations);source.stage='publish';await step(source,settings);
 assert.deepEqual(source.output.limitations,publishedLimitations,'Republishing must not duplicate warnings');
 const run=await ensureResearchBrief(source); assert.ok(run);
 const snapshot=run.input.snapshot as {inventoryOmissions:{id:string;reason:string}[]};
 assert.ok(snapshot.inventoryOmissions.some(x=>/wording and timestamps remain unverified/i.test(x.reason)));
 const point={id:'point',text:'The creator holds shares.',evidenceIds:['c1'],externalIds:[],kind:'holding',horizon:'fundamental',topic:'Company',materiality:2,importanceReason:'Position',speaker:'unknown',timeMode:'video_date',calculation:null};
 run.stage='research-audit'; run.output.researchBaseline=[];run.output.retrievals=[];run.output.researchDraft={sentences:[point],mainTopics:['Company'],omissions:[]};
 const restore=injectTransport(new FakeModelTransport({responses:{'critique-research':{json:{verdicts:[{id:'point',accepted:true,reason:'Supported',factualStatus:'unverified'}],evidenceCoverage:[{evidenceId:"c1",status:"covered",sentenceIds:["point"],missingPoints:[],reason:"The single source holding proposition is represented."}],coverageFindings:[]},usage:{costUsd:.01}}}}));
 try {
  await researchStep(run);
  const [brief]=await researchBriefs();assert.equal(brief.sentences.length,1);
  assert.ok(brief.omissions.some(x=>/wording and timestamps remain unverified/i.test(x)));
  assert.equal(researchReadiness(brief).status,'partial');
  assert.ok(researchReadiness(brief).issues.some(x=>/wording and timestamps remain unverified/i.test(x)));
 } finally {restore();await db.close();}
});
