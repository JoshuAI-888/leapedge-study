import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { create, get } from "../src/server/youtube-intelligence/store.ts";
import {
  researchStep,
  researchBriefs,
} from "../src/server/youtube-intelligence/research-pipeline.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
const sentence = {
  id: "point",
  text: "The creator holds shares.",
  evidenceIds: ["c1"],
  externalIds: [],
  kind: "holding",
  horizon: "fundamental",
  topic: "Company",
  materiality: 2,
  importanceReason: "Existing position",
  speaker: "unknown",
  timeMode: "video_date",
  calculation: null,
};
for (const efficient of [false, true]) test(`research stages resume paid synthesis and retain original evidence, independent critique and actual cost (efficient=${efficient})`, async () => {
  const db = await freshDatabase();
  const settings = teamDefaults();
  const fake = new FakeModelTransport({
    responses: {
      "synthesis-research-plan": {
        json: { queries: [], coverage: ["Company"] },
        usage: { costUsd: 0.01 },
      },
      "synthesis-research": {
        json: {
          sentences: [
            sentence,
            { ...sentence, id: "invented", evidenceIds: ["missing"] },
          ],
          mainTopics: ["Company"],
          omissions: [],
        },
        usage: { costUsd: 0.02 },
      },
      "critique-research": {
        json: {
          verdicts: [
            {
              id: "point",
              accepted: true,
              reason: "Holding supported.",
              factualStatus: "corroborated",
            },
            ...(!efficient ? [{
              id: "invented",
              accepted: true,
              reason: "Accepted by model but invalid reference.",
              factualStatus: "unverified",
            }] : []),
          ],
          coverageFindings: ["No valuation data supplied."],
        },
        usage: { costUsd: 0.03 },
      },
    },
  });
  const restore = injectTransport(fake);
  try {
    const run = await create(
      "research-video",
      settings.models.extraction.id,
      {
        task: "research-brief",
        efficiencyVersion: efficient ? "evidence-efficiency.v1" : undefined,
        teamPreferencesSnapshot: settings,
        snapshot: {
          sourceRunId: "original",
          title: "Company",
          context: {
            videoPublishedAt: "2026-01-01T00:00:00Z",
            recordedAt: null,
            analysedAt: "2026-09-20T00:00:00Z",
            language: "en",
            videoId: "research-video",
            temporalPolicy:
              "video-date evidence and later updates are separate",
          },
          evidence: [
            {
              id: "c1",
              kind: "creator_call",
              summary: "Holds shares",
              instrument: "Company",
              ticker: null,
              stance: "hold",
              horizon: null,
              conditions: [],
              risks: [],
              levels: [],
              trust: "L1",
              quotes: [
                {
                  startId: "s1",
                  endId: "s1",
                  text: "I hold shares",
                  translation: "",
                  start: 0,
                  end: 4,
                  hash: null,
                },
              ],
            },
          ],
        },
      },
      "test",
    );
    await researchStep(run);
    assert.equal(run.stage, "research-sources");
    run.stage = "metadata";
    await researchStep(run);
    assert.equal(fake.requests.length, 1, "restart reused recorded response");
    await researchStep(run);
    await researchStep(run);
    run.output.retrievals = [{key:"fixture",state:"complete",query:"fixture",timeMode:"video_date",costUsd:0,costBasis:"fixture",note:"fixture",requestedAt:"2026-01-01T00:00:00Z",sources:[{id:"unused",url:"https://sec.gov/fixture",title:"Unused source",text:"UNRELATED_EXTERNAL_SENTINEL",publishedAt:"2025-01-01T00:00:00Z",retrievedAt:"2026-01-01T00:00:00Z",publicationConfirmed:true,dateBasis:"fixture",sourceClass:"primary",hash:"fixture",query:"fixture",timeMode:"video_date",provider:"fixture"}]}];
    await researchStep(run);
    const auditPayload = JSON.stringify(fake.requests[2].user);
    assert.ok(auditPayload.includes("UNRELATED_EXTERNAL_SENTINEL"), "uncited contradictory external evidence remains visible to the critic");
    assert.equal(fake.requests[2].user.some(p => 'text' in p && p.text.includes('"id":"invented"')), !efficient);
    assert.ok(auditPayload.includes("I hold shares"), "all video evidence remains in independent audit");
    assert.equal(run.status, "completed");
    if (efficient) assert.equal(typeof run.output.evidenceIndexHash, "string");
    assert.equal((run.output.auditPayloadMetrics as {evidenceItems:number}).evidenceItems, 1);
    assert.equal(fake.requests.length, 3);
    const [brief] = await researchBriefs();
    assert.equal(brief.sourceRunId, "original");
    assert.equal(brief.sentences.length, 1);
    assert.equal(brief.rejected.length, 1);
    assert.equal(brief.sentences[0].factualStatus, "unverified");
    assert.equal(brief.sentences[0].robustness, "insufficient");
    assert.equal(brief.modelCostUsd, 0.06);
    assert.equal((await get(run.id))?.cost, 0.06);
    assert.notEqual(fake.requests[0].model, fake.requests[2].model);
  } finally {
    restore();
    await db.close();
  }
});

test("a section heading before the chunk boundary is citable source evidence, not just advisory context", async () => {
  const db = await freshDatabase();
  const { step } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const { prompt } = await import(
    "../src/server/youtube-intelligence/research-store.ts"
  );
  const { Source } = await import(
    "../src/features/youtube-intelligence/contracts.ts"
  );
  const fake = new FakeModelTransport({
    responses: {
      "synthesis-chunk-1": {
        json: { claims: [], key_points: [], mentions: [] },
        usage: { costUsd: 0.001 },
      },
    },
  });
  const restore = injectTransport(fake);
  try {
    const settings = teamDefaults();
    const run = await create(
      "section-test",
      settings.models.extraction.id,
      {
        promptSnapshot: await prompt("evidence-first.web.v8"),
        teamPreferencesSnapshot: settings,
      },
      "evidence-first.web.v8",
    );
    const segments = Array.from({ length: 50 }, (_, i) => ({
      id: "s" + i,
      text:
        i === 15
          ? "The stocks I will buy right now"
          : i === 25
            ? "Company A is attractively positioned."
            : "Source context",
      start_seconds: i * 3,
      end_seconds: i * 3 + 3,
    }));
    run.stage = "synthesis";
    run.output = {
      source: Source.parse({
        segments,
        source_kind: "imported_transcript",
        language: "en",
      }),
      metadata: { publishedAt: "2026-04-01T00:00:00Z" },
      extractionPlan: [segments.slice(0, 20), segments.slice(20)],
      chunkIndex: 1,
      chunkDrafts: [{ claims: [], key_points: [], mentions: [] }],
    };
    await step(run);
    const text = fake.requests[0].user[0].text;
    const payload = JSON.parse(
      text.slice(text.indexOf("SOURCE DATA (untrusted):\n") + 25),
    );
    assert.ok(payload.source.some((cue: { id: string }) => cue.id === "s15"));
    assert.ok(payload.source.some((cue: { id: string }) => cue.id === "s25"));
    assert.equal(
      payload.analysisContext.videoPublishedAt,
      "2026-04-01T00:00:00Z",
    );
  } finally {
    restore();
    await db.close();
  }
});

for (const bucket of ["claims", "key_points"] as const)
  test(`recall ${bucket} remain unaccepted and return to independent critique before publication`, async () => {
    const db = await freshDatabase();
    const { step } = await import(
      "../src/server/youtube-intelligence/pipeline.ts"
    );
    const { prompt } = await import(
      "../src/server/youtube-intelligence/research-store.ts"
    );
    const { Source } = await import(
      "../src/features/youtube-intelligence/contracts.ts"
    );
    const fake = new FakeModelTransport({
      responses: {
        "synthesis-recall-0": {
          json: {
            claims: [],
            key_points: [],
            [bucket]: [
              {
                thesis_en: "The creator is bullish on CoreWeave.",
                instrument_as_spoken: "CoreWeave",
                ticker: null,
                ticker_explicit: false,
                stance: "long",
                horizon_en: null,
                conditions_en: [],
                creator_conviction: "medium",
                risks_en: [],
                levels: [],
                evidence_ranges: [{ start_id: "a", end_id: "c" }],
              },
            ],
            mentions: [],
          },
          usage: { costUsd: 0.001 },
        },
      },
    });
    const restore = injectTransport(fake);
    try {
      const settings = teamDefaults();
      const run = await create(
        "recall-test",
        settings.models.extraction.id,
        {
          promptSnapshot: await prompt("evidence-first.web.v8"),
          teamPreferencesSnapshot: settings,
        },
        "evidence-first.web.v8",
      );
      run.stage = "publish";
      run.output = {
        source: Source.parse({
          source_kind: "imported_transcript",
          language: "en",
          segments: [
            {
              id: "a",
              text: "CoreWeave is one of my favorites. I am",
              start_seconds: 0,
              end_seconds: 3,
            },
            {
              id: "b",
              text: "bullish on CoreWeave.",
              start_seconds: 3,
              end_seconds: 6,
            },
            {
              id: "c",
              text: "It has active power and dilution risks.",
              start_seconds: 6,
              end_seconds: 9,
            },
          ],
        }),
        claims: [],
        keyPoints: [],
        mentions: [],
      };
      await step(run);
      assert.equal(run.output.recallChecked, true);
      assert.notEqual(run.status, "completed");
      assert.ok(["translate", "critique"].includes(run.stage));
      const claims = run.output[
        bucket === "claims" ? "claims" : "keyPoints"
      ] as { passed: boolean; reasons: string[] }[];
      assert.equal(claims.length, 1);
      assert.equal(claims[0].passed, false);
      assert.deepEqual(claims[0].reasons, []);
    } finally {
      restore();
      await db.close();
    }
  });

test("research searches overlap with bounded fanout and replay retained siblings after a lost checkpoint", async () => {
  const db = await freshDatabase();
  const { stubFetch, json } = await import('./helpers/fetch-stub.ts');
  const priorKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'fixture';
  let active = 0, peak = 0;
  const stub = stubFetch([{url: 'https://api.exa.ai/search', respond: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return json({costDollars: {total: 0.007}, results: []});
  }}]);
  try {
    const run = await create('parallel-search', 'fixture', {
      task: 'research-brief', teamPreferencesSnapshot: teamDefaults(),
      snapshot: {sourceRunId: 'source', title: 'Search test', evidence: [], context: {
        videoPublishedAt: '2026-01-01T00:00:00Z', recordedAt: null,
        analysedAt: '2026-09-20T00:00:00Z', language: 'en', videoId: 'parallel-search',
        temporalPolicy: 'video-date evidence and later updates are separate',
      }},
    }, 'fixture');
    run.stage = 'research-sources';
    run.output.researchPlan = {queries: [{query: 'Company revenue', reason: 'Material'}, {query: 'Company margins', reason: 'Material'}], coverage: []};
    await researchStep(run);
    assert.equal(peak, 2);
    assert.equal(stub.log.length, 4);
    const records = structuredClone(run.output.retrievals);
    delete run.output.retrievals;
    await researchStep(run);
    assert.equal(stub.log.length, 4, 'no repurchase after checkpoint loss');
    assert.deepEqual(run.output.retrievals, records);
    await researchStep(run);
    assert.equal(run.stage, 'research-synthesis');
  } finally {
    stub.restore();
    if (priorKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = priorKey;
    await db.close();
  }
});

test('missing company coverage gets one additive repair, preserving the original draft and paid replay', async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const evidence=(id:string,instrument:string)=>({id,kind:'research_context',summary:`${instrument} condition`,instrument,ticker:null,stance:'neutral',horizon:null,conditions:['Entry only below stated level'],risks:[],levels:[],trust:'L1',quotes:[{startId:id,endId:id,text:`${instrument} condition`,translation:'',start:0,end:4,hash:null}]});
 const extra={...sentence,id:'extra',topic:'Credo',evidenceIds:['c2'],text:'Credo condition'};
 const fake=new FakeModelTransport({responses:{
 'critique-research':{json:{verdicts:[{id:'point',accepted:true,reason:'Supported',factualStatus:'unverified'}],coverageFindings:['Credo missing']},usage:{costUsd:.01}},
 'synthesis-research-coverage':{json:{sentences:[...Array.from({length:17},(_,i)=>({...sentence,id:`echo-${i}`})),extra,{...extra,id:'duplicate-extra'}],mainTopics:['Credo'],omissions:[]},usage:{costUsd:.02}},
 'critique-research-coverage':{json:{verdicts:[{id:'point',accepted:false,reason:'Unsolicited reversal must not remove original',factualStatus:'unverified'},{id:'coverage-1',accepted:true,reason:'Supported',factualStatus:'unverified'}],coverageFindings:[]},usage:{costUsd:.03}},
 }});const restore=injectTransport(fake);
 try{
 const run=await create('coverage-video',settings.models.extraction.id,{task:'research-brief',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'original',title:'Company and Credo',context:{videoPublishedAt:'2026-01-01T00:00:00Z',recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'coverage-video',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[evidence('c1','Company'),evidence('c2','Credo')]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[sentence],mainTopics:['Company'],omissions:[]};
 await researchStep(run);assert.equal(run.stage,'research-audit');assert.ok(run.output.coverageRepair);assert.equal((run.output.researchDraft as {sentences:unknown[]}).sentences.length,2);assert.equal((run.output.coverageRepair as {excludedAdditions:unknown[]}).excludedAdditions.length,18);
 await researchStep(run);assert.equal(run.status,'completed');
 const [brief]=await researchBriefs();assert.equal(brief.sentences.length,2);assert.equal(brief.sentences[0].text,sentence.text);assert.equal(brief.sentences[0].auditReason,'Supported');assert.equal(brief.modelCostUsd,.06);
 const {docs}=await import('../src/server/youtube-intelligence/research-store.ts');
 const requests=await docs<{stage:string;payload:{draft:{sentences:{id:string}[]}}}>('researchRequest');
 assert.deepEqual(requests.find(r=>r.stage==='critique-research-coverage')!.payload.draft.sentences.map(s=>s.id),['coverage-1']);
 }finally{restore();await db.close();}
});
test('optional repair failure retains accepted research with explicit review status', async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const evidence=(id:string,instrument:string)=>({id,kind:'research_context',summary:`${instrument} condition`,instrument,ticker:null,stance:'neutral',horizon:null,conditions:['Entry only below stated level'],risks:[],levels:[],trust:'L1',quotes:[{startId:id,endId:id,text:`${instrument} condition`,translation:'',start:0,end:4,hash:null}]});
 const extra={...sentence,id:'extra',topic:'Credo',evidenceIds:['c2'],text:'Credo condition'};
 const fake=new FakeModelTransport({responses:{
 'critique-research':{json:{verdicts:[{id:'point',accepted:true,reason:'Supported',factualStatus:'unverified'}],coverageFindings:['Credo missing']},usage:{costUsd:.01}},
 'synthesis-research-coverage':{json:{invalid:'malformed supplement'},usage:{costUsd:.02}},
 'critique-research-coverage':{json:{verdicts:[{id:'point',accepted:false,reason:'Unsolicited reversal must not remove original',factualStatus:'unverified'},{id:'coverage-1',accepted:true,reason:'Supported',factualStatus:'unverified'}],coverageFindings:[]},usage:{costUsd:.03}},
 }});const restore=injectTransport(fake);
 try{
 const run=await create('coverage-video',settings.models.extraction.id,{task:'research-brief',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'original',title:'Company and Credo',context:{videoPublishedAt:'2026-01-01T00:00:00Z',recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'coverage-video',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[evidence('c1','Company'),evidence('c2','Credo')]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[sentence],mainTopics:['Company'],omissions:[]};
 await researchStep(run);assert.equal(run.stage,'research-audit');assert.ok(run.output.coverageRepair);assert.equal((run.output.researchDraft as {sentences:unknown[]}).sentences.length,1);assert.ok(run.output.coverageRepairError);
 await researchStep(run);assert.equal(run.status,'needs_review');
 const [brief]=await researchBriefs();assert.equal(brief.sentences.length,1);assert.ok(brief.omissions.some(x=>x.includes('Coverage repair failed')));assert.equal(brief.sentences[0].text,sentence.text);assert.equal(brief.sentences[0].auditReason,'Supported');assert.equal(brief.modelCostUsd,.03);
 const {docs}=await import('../src/server/youtube-intelligence/research-store.ts');
 const requests=await docs<{stage:string;payload:{draft:{sentences:{id:string}[]}}}>('researchRequest');
 assert.equal(requests.some(r=>r.stage==='critique-research-coverage'),false);
 }finally{restore();await db.close();}
});

test('all-invalid brief is retained for review and never marked completed',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();const restore=injectTransport(new FakeModelTransport());
 try{
 const run=await create('empty-brief',settings.models.extraction.id,{task:'research-brief',efficiencyVersion:'evidence-efficiency.v1',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'source',title:'No usable research',context:{videoPublishedAt:null,recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'empty-brief',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[{...sentence,evidenceIds:['missing']}],mainTopics:['Company'],omissions:[]};
 await researchStep(run);assert.equal(run.status,'needs_review');assert.equal((run.output.researchReadiness as {status:string}).status,'review_required');
 const [brief]=await researchBriefs();assert.equal(brief.rejected.length,1);assert.equal(brief.sentences.length,0);
 }finally{restore();await db.close();}
});

for (const mode of ['malformed', 'missing', 'unknown', 'partial'] as const) test(`optional supplemental audit ${mode} preserves original audited research and unresolved additions`, async()=>{
 const db=await freshDatabase();const settings=teamDefaults();settings.processing.maxRetriesPerStage=0;
 const evidence=(id:string,instrument:string)=>({id,kind:'research_context',summary:`${instrument} condition`,instrument,ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{startId:id,endId:id,text:`${instrument} condition`,translation:'',start:0,end:4,hash:null}]});
 const extra={...sentence,id:'extra',topic:'Credo',evidenceIds:['c2'],text:'Credo condition'};
 const {TransportError}=await import('../src/server/youtube-intelligence/transport/types.ts');
 const fake=new FakeModelTransport({responses:{
  'critique-research':{json:{verdicts:[{id:'point',accepted:true,reason:'Original independently supported',factualStatus:'unverified'}],coverageFindings:['Credo missing']},usage:{costUsd:.01}},
  'synthesis-research-coverage':{json:{sentences:mode==='partial'?[extra,{...extra,id:'second',text:'Another Credo condition'}]:[extra],mainTopics:['Credo'],omissions:[]},usage:{costUsd:.02}},
  'critique-research-coverage':mode==='unknown' ? ()=>{throw new TransportError('unknown','Fixture connection interrupted after submission');} : {json:mode==='partial'?{verdicts:[{id:'coverage-1',accepted:true,reason:'Supplement supported',factualStatus:'unverified'}],coverageFindings:[]}:mode==='missing'?{verdicts:[],coverageFindings:[]}:{malformed:true},usage:{costUsd:.03}},
 }});const restore=injectTransport(fake);
 try{
 const run=await create('optional-audit',settings.models.extraction.id,{task:'research-brief',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'original',title:'Company and Credo',context:{videoPublishedAt:'2026-01-01T00:00:00Z',recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'optional-audit',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[evidence('c1','Company'),evidence('c2','Credo')]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[sentence],mainTopics:['Company'],omissions:[]};
 await researchStep(run);await researchStep(run);
 assert.equal(run.status,'needs_review');assert.equal(run.stage,'complete');
 const [brief]=await researchBriefs();assert.equal(brief.sentences.length,mode==='partial'?2:1);assert.equal(brief.sentences[0].auditReason,'Original independently supported');
 assert.equal(brief.rejected.length,1);assert.match(brief.rejected[0].reasons.join(' '),/audit|verdict/i);
 assert.deepEqual(run.output.unresolvedResearchAuditIds,[mode==='partial'?'coverage-2':'coverage-1']);assert.ok(run.output.coverageRepairError);
 assert.equal(fake.requestsFor('critique-research-coverage').length,1);assert.equal(fake.requestsFor('critique-research-coverage-repair').length,0);
 const calls=await db.prepare('SELECT status,amount FROM yi_calls WHERE run_id=$1').all(run.id) as {status:string;amount:number}[];
 assert.equal(calls.filter(c=>c.status==='unknown').length,mode==='unknown'?1:0);
 assert.ok(brief.omissions.some(x=>/supplemental audit/i.test(x)));
 }finally{restore();await db.close();}
});

test('mandatory original audit failure never publishes unaudited original research',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const fake=new FakeModelTransport({responses:{'critique-research':{json:{malformed:true},usage:{costUsd:.01}}}});const restore=injectTransport(fake);
 try{
 const run=await create('mandatory-audit',settings.models.extraction.id,{task:'research-brief',teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'original',title:'Company',context:{videoPublishedAt:null,recordedAt:null,analysedAt:'2026-09-20T00:00:00Z',language:'en',videoId:'mandatory-audit',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[{id:'c1',kind:'research_context',summary:'Company holding',instrument:'Company',ticker:null,stance:'hold',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{startId:'a',endId:'a',text:'The creator holds shares.',translation:'',start:0,end:4,hash:null}]}]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[sentence],mainTopics:['Company'],omissions:[]};
 await assert.rejects(researchStep(run));assert.equal((await researchBriefs()).length,0);assert.equal(run.stage,'research-audit');assert.equal(run.output.researchBriefId,undefined);
 }finally{restore();await db.close();}
});

for (const efficient of [false, true]) test(`published brief retains deterministic ambiguous split warning and partial readiness (efficient=${efficient})`, async () => {
  const db = await freshDatabase();
  const settings = teamDefaults();
  const quote = '公司拆股比例是1比3。';
  const point = { ...sentence, text: 'The company announced a 1-for-3 stock split.', kind: 'reported_fact' };
  const fake = new FakeModelTransport({ responses: {
    'critique-research': { json: { verdicts: [{ id: 'point', accepted: true, reason: 'Model accepted the ratio.', factualStatus: 'unverified' }], coverageFindings: [] }, usage: { costUsd: 0.01 } },
  } });
  const restore = injectTransport(fake);
  try {
    const run = await create('ambiguous-split', settings.models.extraction.id, {
      task: 'research-brief', efficiencyVersion: efficient ? 'evidence-efficiency.v1' : undefined,
      teamPreferencesSnapshot: settings,
      snapshot: { sourceRunId: 'original', title: 'Company split', context: {
        videoPublishedAt: '2026-01-01T00:00:00Z', recordedAt: null, analysedAt: '2026-09-27T00:00:00Z', language: 'zh', videoId: 'ambiguous-split', temporalPolicy: 'video-date evidence and later updates are separate',
      }, evidence: [{ id: 'c1', kind: 'research_context', summary: 'Company split', instrument: 'Company', ticker: null, stance: 'neutral', horizon: null, conditions: [], risks: [], levels: [], trust: 'L1', quotes: [{ startId: 'a', endId: 'a', text: quote, translation: '', start: 0, end: 4, hash: null }] }] },
    }, 'test');
    run.stage = 'research-audit';
    run.output.researchBaseline = [];
    run.output.researchDraft = { sentences: [point], mainTopics: ['Company'], omissions: [] };
    await researchStep(run);
    const [brief] = await researchBriefs();
    assert.ok(brief, 'The audited brief is actually persisted');
    assert.ok(brief.omissions.some(note => /stock-split ratio direction remains unresolved/i.test(note)), 'Deterministic validation warning survives publication composition');
    assert.equal((run.output.researchReadiness as { status: string }).status, 'partial');
    const { researchReadiness } = await import('../src/features/youtube-intelligence/research-readiness.ts');
    assert.equal(researchReadiness(brief).status, 'partial');
    assert.equal(brief.sentences[0].text, point.text, 'Ambiguity does not invent corrected prose');
    assert.equal(brief.evidence[0].quotes[0].text, quote);
    assert.deepEqual((run.output.researchDraft as { omissions: string[] }).omissions, [], 'Retained model draft stays original');
    assert.equal(fake.requests.length, 1);
  } finally { restore(); await db.close(); }
});

for (const efficient of [false, true]) for (const basis of ["unknown", "matched"] as const) test(`published yield comparison retains evidence, enforces comparison and deduplicates omissions (efficient=${efficient}, basis=${basis})`, async () => {
 const db=await freshDatabase();const settings=teamDefaults();
 const text='The 10-year Treasury yield pulled back to 4.93%.';
 const point={...sentence,text,externalIds:['yield'],kind:'reported_fact'};
 const comparison={metric:'matched',period:'matched',units:'matched',observationBasis:basis,reason:basis==='matched'?'Same dated constant-maturity closing observation in both passages.':'Intraday traded yield versus constant-maturity daily observation; matching basis not established.'};
 const verdict={id:'point',accepted:true,reason:'Possible convention mismatch, not conclusively a contradiction.',factualStatus:'disputed',robustness:'fragile',robustnessReason:'One basis point discrepancy.',externalSupport:[{externalId:'yield',assertion:text,quote:'10-year constant maturity yield: 4.94%.',relationship:'contradicts',comparability:comparison,reason:'The observation convention may differ.'}]};
 const original=JSON.stringify(verdict);
 const fake=new FakeModelTransport({responses:{'critique-research':{json:{verdicts:[verdict],coverageFindings:[]},usage:{costUsd:.01}}}});const restore=injectTransport(fake);
 try{
 const run=await create('yield-comparison',settings.models.extraction.id,{task:'research-brief',efficiencyVersion:efficient?'evidence-efficiency.v1':undefined,teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'original',title:'Treasury yields',context:{videoPublishedAt:'2026-01-01T00:00:00Z',recordedAt:null,analysedAt:'2026-09-27T00:00:00Z',language:'en',videoId:'yield-comparison',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[{id:'c1',kind:'research_context',summary:text,instrument:'Treasury',ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{startId:'a',endId:'a',text,translation:'',start:0,end:4,hash:null}]}]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[point],mainTopics:['Company'],omissions:['Observation time unknown.','Observation time unknown.']};
 run.output.retrievals=[{key:'yield-fixture',state:'complete',query:'fixture',timeMode:'video_date',costUsd:0,costBasis:'fixture',note:'fixture',requestedAt:'2026-01-01T00:00:00Z',sources:[{id:'yield',url:'https://federalreserve.gov/fixture',title:'Yield fixture',text:'10-year constant maturity yield: 4.94%.',publishedAt:'2025-12-31T00:00:00Z',retrievedAt:'2026-01-01T00:00:00Z',publicationConfirmed:true,dateBasis:'fixture',sourceClass:'primary',hash:'fixture',query:'fixture',timeMode:'video_date',provider:'fixture'}]}];
 await researchStep(run);const [brief]=await researchBriefs();
 assert.equal(brief.sentences.length,1);assert.equal(brief.sentences[0].text,text);assert.equal(brief.sentences[0].factualStatus,basis==='matched'?'disputed':'unverified');assert.equal(brief.sentences[0].robustness,basis==='matched'?'fragile':'insufficient');
 assert.equal(brief.sentences[0].externalSupport?.[0].comparability.observationBasis,basis);assert.equal(brief.external[0].text,'10-year constant maturity yield: 4.94%.');
 assert.deepEqual(brief.omissions,['Observation time unknown.']);
 assert.deepEqual((run.output.researchDraft as {omissions:string[]}).omissions,['Observation time unknown.','Observation time unknown.']);
 assert.equal(JSON.stringify(verdict),original);assert.equal(fake.requests.length,1);
 assert.match(JSON.stringify(fake.requests[0]),/different measurement is not a contradiction/i);
 const {factualSupportLabel,thesisRobustnessLabel}=await import('../src/features/youtube-intelligence/research-presentation.ts');
 if(basis==='unknown'){assert.doesNotMatch(factualSupportLabel(brief.sentences[0]),/^Disputed/);assert.doesNotMatch(thesisRobustnessLabel(brief.sentences[0]),/Fragil/);}else{assert.match(factualSupportLabel(brief.sentences[0]),/^Disputed/);assert.match(thesisRobustnessLabel(brief.sentences[0]),/Fragil/);}
 const schema=fake.requests[0].responseSchema as {properties:{verdicts:{items:{properties:{externalSupport:{items:{required:string[];properties:{comparability:{required:string[]}}}}}}}}};
 assert.ok(schema.properties.verdicts.items.properties.externalSupport.items.required.includes('comparability'));
 assert.deepEqual([...schema.properties.verdicts.items.properties.externalSupport.items.properties.comparability.required].sort(),['metric','observationBasis','period','reason','units']);
 const schemaText=JSON.stringify(fake.requests[0].responseSchema);for(const field of ['comparability','metric','period','units','observationBasis','not_applicable','mismatched']) assert.ok(schemaText.includes(field),`Response schema requests ${field}`);
 }finally{restore();await db.close();}
});

test('rejected Bloom holding is disclosed to recall and narrower sector context still requires independent audit',async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const {step}=await import('../src/server/youtube-intelligence/pipeline.ts');const {prompt}=await import('../src/server/youtube-intelligence/research-store.ts');const {Source}=await import('../src/features/youtube-intelligence/contracts.ts');
 const candidate={thesis_en:'Bloom Energy is a core holding, an exception to the creator’s general reluctance toward the energy sector.',instrument_as_spoken:'Bloom Energy',ticker:null,ticker_explicit:false,stance:'hold',horizon_en:null,conditions_en:[],creator_conviction:'low',risks_en:['Creator does not generally love this sector.'],levels:[],evidence_ranges:[{start_id:'a',end_id:'d'}]};
 const fake=new FakeModelTransport({responses:{'synthesis-recall-0':{json:{claims:[],key_points:[candidate],mentions:[]},usage:{costUsd:.001}}}});const restore=injectTransport(fake);
 try{
 const run=await create('bloom-recall',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');run.stage='publish';
 const rejected={id:'c1',passed:false,reasons:['High conviction unsupported for passive holding.'],claim:{...candidate,evidence_ranges:undefined,evidence:[{segment_id:'a',end_segment_id:'c',quote_original:'not a sector that I absolutely love beyond Bloom Energy, which is one of my core',quote_translation_en:''}],creator_conviction:'high'}};
 run.output={source:Source.parse({source_kind:'imported_transcript',language:'en',segment_separator:' ',segments:[{id:'a',text:'Ultimately, not a sector',start_seconds:80.64,end_seconds:85.28},{id:'b',text:'that I absolutely love beyond Bloom',start_seconds:83.08,end_seconds:86.64},{id:'c',text:'Energy, which is one of my core',start_seconds:85.28,end_seconds:88.84},{id:'d',text:'holdings, but the macro tailwind',start_seconds:86.64,end_seconds:91.08}]}),claims:[rejected],keyPoints:[],mentions:[]};
 const retained=JSON.stringify(rejected);await step(run);
 assert.equal(run.output.recallWindowCount,1);assert.equal(JSON.stringify((run.output.claims as unknown[])[0]),retained);assert.notEqual(run.status,'completed');assert.ok(['translate','critique'].includes(run.stage));
 const points=run.output.keyPoints as {passed:boolean;claim:{creator_conviction:string;evidence:{quote_original:string}[]}}[];
 assert.equal(points.length,1);assert.equal(points[0].passed,false);assert.equal(points[0].claim.creator_conviction,'low');assert.match(points[0].claim.evidence[0].quote_original,/core holdings/);
 const request=fake.requests[0].user[0].text;const payload=JSON.parse(request.slice(request.indexOf('SOURCE DATA (untrusted):\n')+25));
 assert.equal(payload.existing[0].accepted,false);assert.deepEqual(payload.existing[0].auditReasons,rejected.reasons);assert.match(JSON.stringify(fake.requests[0]),/Rejected candidates are not covered evidence/);
 }finally{restore();await db.close();}
});

for(const efficient of [false,true]) test(`publication normalizes anchored bps while retaining raw typed draft and audit (efficient=${efficient})`,async()=>{
 const db=await freshDatabase();const settings=teamDefaults();
 const quote='美联储已经加息了25个基点';const fact={label:'Rate hike',value:25,currency:null,unit:'percentage_points',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote};
 const point={...sentence,text:'The Fed raised rates by 25 basis points.',kind:'reported_fact',financialFacts:[fact]};
 const verdict={id:'point',accepted:true,reason:'Source prose is faithful.',factualStatus:'unverified'};
 const fake=new FakeModelTransport({responses:{'critique-research':{json:{verdicts:[verdict],coverageFindings:[]},usage:{costUsd:.01}}}});const restore=injectTransport(fake);
 try{
 const run=await create('unit-normalization',settings.models.extraction.id,{task:'research-brief',efficiencyVersion:efficient?'evidence-efficiency.v1':undefined,teamPreferencesSnapshot:settings,snapshot:{sourceRunId:'original',title:'Rate hike',context:{videoPublishedAt:null,recordedAt:null,analysedAt:'2026-09-27T00:00:00Z',language:'zh',videoId:'unit-normalization',temporalPolicy:'video-date evidence and later updates are separate'},evidence:[{id:'c1',kind:'research_context',summary:point.text,instrument:null,ticker:null,stance:'neutral',horizon:null,conditions:[],risks:[],levels:[],trust:'L1',quotes:[{startId:'a',endId:'a',text:quote,translation:'',start:0,end:4,hash:null}]}]}},'test');
 run.stage='research-audit';run.output.researchBaseline=[];run.output.researchDraft={sentences:[point],mainTopics:['Company'],omissions:[]};const original=JSON.stringify(run.output.researchDraft);
 await researchStep(run);const [brief]=await researchBriefs();assert.equal(brief.sentences[0].text,point.text);assert.equal(brief.sentences[0].financialFacts[0].unit,'basis_points');assert.equal(brief.sentences[0].financialFactChecks?.[0].original.unit,'percentage_points');assert.equal(brief.sentences[0].financialFactChecks?.[0].fact?.unit,'basis_points');assert.match(brief.omissions.join(' '),/unit corrected/);assert.equal(JSON.stringify(run.output.researchDraft),original);assert.equal(fake.requests.length,1);assert.equal(verdict.reason,'Source prose is faithful.');
 assert.match(JSON.stringify(fake.requests[0]),/25 basis points = 0.25 percentage points/);
 }finally{restore();await db.close();}
});
