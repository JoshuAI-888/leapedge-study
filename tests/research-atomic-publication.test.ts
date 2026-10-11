import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers/db.ts';
import { create } from '../src/server/youtube-intelligence/store.ts';
import { researchStep, researchBriefs } from '../src/server/youtube-intelligence/research-pipeline.ts';
import { teamDefaults } from '../src/features/youtube-intelligence/settings.ts';
import { ResearchDraft } from '../src/features/youtube-intelligence/research-brief.ts';
import { FakeModelTransport } from '../src/server/youtube-intelligence/transport/fake.ts';
import { injectTransport } from '../src/server/youtube-intelligence/transport/index.ts';
const base={externalIds:[],kind:'creator_view',horizon:'fundamental',topic:'Company',materiality:2,importanceReason:'Material source clause',speaker:'unknown',timeMode:'video_date',calculation:null};
const safe={...base,id:'safe',text:'The speaker owns shares.',evidenceIds:['k1']};
const unsafe={...base,id:'bad',text:'EPS is USD1.60 and cash is USD9.2 billion.',evidenceIds:['k2'],financialFacts:[{label:'EPS',value:1.60,currency:'USD',unit:'per_share',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'k2',quote:'EPS was 160.'}]};
const repair={...base,id:'repair',text:'Cash is USD9.2 billion; the precise EPS decimal is unresolved in the captions.',evidenceIds:['k2']};

for(const outcome of ['accepted','rejected','unavailable'] as const) test(`new faithful run preserves accepted originals and independently audits one bounded atomic repair (${outcome})`,async()=>{
 const database=await freshDatabase();
 const settings=teamDefaults();
 const fake=new FakeModelTransport({responses:{
  'critique-faithful-1':{json:{verdicts:[{id:'safe',accepted:true,reason:'Original holding supported.'},{id:'bad',accepted:true,reason:'Model accepted compound candidate.'}],evidenceCoverage:[{evidenceId:'k1',status:'covered',sentenceIds:['safe'],missingPoints:[],reason:'Holding represented.'},{evidenceId:'k2',status:'covered',sentenceIds:['bad'],missingPoints:[],reason:'Candidate appears complete.'}]},usage:{costUsd:.01}},
  'synthesis-research-coverage':{json:{sentences:[repair],mainTopics:['Company'],omissions:[]},usage:{costUsd:.02}},
  'critique-faithful-coverage-1':{json:{verdicts:[{id:'coverage-1',accepted:outcome==='accepted',reason:'Independent review of narrower cash clause and uncertainty.'}],evidenceCoverage:[{evidenceId:'k2',status:'partial',sentenceIds:['coverage-1'],missingPoints:[{point:'Precise EPS remains unresolved',quote:'EPS was 160.'}],reason:'Cash represented; no EPS decimal reconstruction.'}]},usage:{costUsd:.03}},
 }}); const restore=injectTransport(fake);
 if(outcome==='unavailable')fake.failOn(3,'unknown');
 try {
  const run=await create('atomic-fixture',settings.models.extraction.id,{task:'research-brief',webResearch:false,researchPipeline:'faithful',researchPipelineVersion:'faithful-v1',publicationSafeguardsVersion:'atomic-publication.v1',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'source',title:'Atomic source',context:{videoPublishedAt:null,recordedAt:null,analysedAt:'2026-10-12T00:00:00Z',language:'en',videoId:'atomic-fixture',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[['k1','I own shares.'],['k2','EPS was 160. Cash is USD9.2 billion.']].map(([id,text])=>({id,kind:'research_context',summary:text,instrument:'Company',ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{startId:id,endId:id,text,translation:'',start:0,end:4,hash:null}]}))}},'test');
  run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[safe,unsafe],mainTopics:['Company'],omissions:[]};
  const original=ResearchDraft.parse(run.output.researchDraft);
  await researchStep(run);
  assert.equal(run.stage,'research-audit','Withheld compound clause should get one bounded source-only candidate pass');
  assert.deepEqual((run.output.coverageRepair as {originalDraft:unknown}).originalDraft,original);
  await researchStep(run);
  const [brief]=await researchBriefs();
  assert.deepEqual(brief.sentences.map(s=>s.id),outcome==='accepted'?['safe','coverage-1']:['safe']);
  assert.equal(brief.sentences[0].auditReason,'Original holding supported.');
  assert.equal(brief.rejected[0].sentence.id,'bad');
  assert.equal(brief.evidenceCoverage?.find(c=>c.evidenceId==='k2')?.status,outcome==='accepted'?'partial':'missing');
  assert.equal(fake.requestsFor('synthesis-research-coverage').length,1);
  assert.equal(fake.requestsFor('critique-faithful-coverage-1').length,1);
  if(outcome==='unavailable')assert.equal(run.status,'needs_review');
 }finally{restore();await database.close();}
});
