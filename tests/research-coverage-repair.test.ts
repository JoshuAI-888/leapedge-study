import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchDraft } from '../src/features/youtube-intelligence/research-brief.ts';
import { coverageAdditions } from '../src/server/youtube-intelligence/research-coverage-repair.ts';
import { freshDatabase } from './helpers/db.ts';
import { create, listAttempts } from '../src/server/youtube-intelligence/store.ts';
import { researchStep, researchBriefs } from '../src/server/youtube-intelligence/research-pipeline.ts';
import { teamDefaults } from '../src/features/youtube-intelligence/settings.ts';
import { FakeModelTransport } from '../src/server/youtube-intelligence/transport/fake.ts';
import { injectTransport } from '../src/server/youtube-intelligence/transport/index.ts';
test('supplemental IDs avoid original IDs without rewriting or removing original statements',()=>{
 const sentence={id:'coverage-1',text:'Original holding.',evidenceIds:['c1'],externalIds:[],kind:'holding',horizon:'fundamental',topic:'Company',materiality:2,importanceReason:'Holding',speaker:'unknown',timeMode:'video_date',calculation:null};
 const original=ResearchDraft.parse({sentences:[sentence,{...sentence,id:'coverage-3',text:'Original countercase.'}],mainTopics:['Company'],omissions:[]});
 const snapshot=structuredClone(original);
 const supplement=ResearchDraft.parse({sentences:[{...sentence,id:'duplicate',text:'New condition.',evidenceIds:['c2']},{...sentence,id:'coverage-1',text:'New valuation.',evidenceIds:['c2']}],mainTopics:['Company'],omissions:[]});
 const result=coverageAdditions(original,supplement,['c2']);
 assert.deepEqual(result.sentences.map(s=>s.id),['coverage-2','coverage-4']);
 assert.deepEqual(original,snapshot);
 assert.equal(new Set([...original.sentences,...result.sentences].map(s=>s.id)).size,4);
});
test('a corrected rejected statement can be audited again without duplicating accepted prose or replacing history',()=>{
 const base={id:'bad',text:'The creator illustrates a 5% bond return.',evidenceIds:['k1'],externalIds:[],kind:'education',horizon:'general',topic:'Valuation',materiality:2,importanceReason:'Discount rate',speaker:'unknown',timeMode:'video_date',calculation:null,financialFacts:[{label:'Scenario yield',value:5,currency:null,unit:'percent',scale:'ones',period:null,basis:'not_stated',nature:'scenario',evidenceId:'k1',quote:'incorrect quote'}]};
 const original=ResearchDraft.parse({sentences:[base],mainTopics:['Valuation'],omissions:[]});const before=structuredClone(original);
 const fixed=ResearchDraft.parse({sentences:[{...base,financialFacts:[{...base.financialFacts[0],quote:'Suppose a bond yields 5%.'}]}],mainTopics:['Valuation'],omissions:[]});
 assert.equal(coverageAdditions(original,fixed,['k1']).sentences.length,0,'Accepted text still deduplicates');
 const repaired=coverageAdditions(original,fixed,['k1'],['bad']);assert.equal(repaired.sentences.length,1);assert.notEqual(repaired.sentences[0].id,'bad');assert.deepEqual(original,before);
 assert.equal(coverageAdditions(original,original,['k1'],['bad']).sentences.length,0,'Unchanged failed content is not a new repair');
});
test('source-only atomic repair retains external and current candidates for review without accepting them',()=>{
 const original=ResearchDraft.parse({sentences:[],mainTopics:[],omissions:[]});
 const base={id:'new',text:'The retained source discusses cash.',evidenceIds:['k1'],externalIds:[],kind:'reported_fact',horizon:'general',topic:'Cash',materiality:2,importanceReason:'Cash',speaker:'unknown',timeMode:'video_date'};
 const supplement=ResearchDraft.parse({sentences:[{...base,externalIds:['filing']},{...base,id:'current',timeMode:'current'}],mainTopics:[],omissions:[]});
 const result=coverageAdditions(original,supplement,['k1'],[],{sourceOnly:true});
 assert.equal(result.sentences.length,0);
 assert.equal(result.excluded.length,2);
 assert.deepEqual(supplement.sentences.map(s=>s.id),['new','current']);
});


const base = { externalIds: [], kind: 'creator_view', horizon: 'fundamental', topic: 'Company', materiality: 2, importanceReason: 'Material source clause', speaker: 'unknown', timeMode: 'video_date', calculation: null };
const safe = { ...base, id: 'safe', text: 'The speaker owns shares.', evidenceIds: ['k1'] };
const unsafe = { ...base, id: 'bad', text: 'EPS is USD1.60 and cash is USD9.2 billion.', evidenceIds: ['k2'], financialFacts: [{ label: 'EPS', value: 1.60, currency: 'USD', unit: 'per_share', scale: 'ones', period: null, basis: 'not_stated', nature: 'reported', evidenceId: 'k2', quote: 'EPS was 160.' }] };

for (const outcome of ['empty', 'duplicate', 'unchanged-rejected', 'disallowed-external', 'unknown-paid-outcome'] as const) {
  test(`bounded source-only repair with no new assertion preserves original audits and skips second coverage audit (${outcome})`, async () => {
    const database = await freshDatabase();
    const settings = teamDefaults();
    settings.processing.bottomLine = false;
    settings.faithfulnessPreScreen.enabled = false;
    const proposals = outcome === 'empty' || outcome === 'unknown-paid-outcome' ? []
      : outcome === 'duplicate' ? [{ ...safe, id: 'proposal' }]
      : outcome === 'unchanged-rejected' ? [{ ...unsafe, id: 'proposal' }]
      : [{ ...base, id: 'proposal', text: 'New unsupported current update.', evidenceIds: ['k2'], externalIds: ['outside'], timeMode: 'current' }];
    const fake = new FakeModelTransport({ responses: {
      'critique-faithful-1': { json: { verdicts: [
        { id: 'safe', accepted: true, reason: 'Original holding supported.' },
        { id: 'bad', accepted: true, reason: 'Model accepted compound candidate.' },
      ], evidenceCoverage: [
        { evidenceId: 'k1', status: 'covered', sentenceIds: ['safe'], missingPoints: [], reason: 'Holding represented.' },
        { evidenceId: 'k2', status: 'covered', sentenceIds: ['bad'], missingPoints: [], reason: 'Candidate appears complete.' },
      ] }, usage: { costUsd: .01 } },
      'synthesis-research-coverage': { json: { sentences: proposals, mainTopics: ['Company'], omissions: ['No source-supported correction found; the original EPS gap remains unresolved.'] }, usage: { costUsd: .02 } },
    } });
    if (outcome === 'unknown-paid-outcome') fake.failOn(2, 'unknown');
    const restore = injectTransport(fake);
    try {
      const run = await create('empty-repair-fixture', settings.models.extraction.id, {
        task: 'research-brief', webResearch: false, researchPipeline: 'faithful', researchPipelineVersion: 'faithful-v1', publicationSafeguardsVersion: 'atomic-publication.v1', teamPreferencesSnapshot: settings,
        snapshot: { sourceRunId: 'source', title: 'Source-only repair', context: { videoPublishedAt: null, recordedAt: null, analysedAt: '2026-10-12T00:00:00Z', language: 'en', videoId: 'empty-repair-fixture', temporalPolicy: 'video-date evidence and later updates are separate' },
          evidence: [['k1', 'I own shares.'], ['k2', 'EPS was 160. Cash is USD9.2 billion.']].map(([id, text]) => ({ id, kind: 'research_context', summary: text, instrument: 'Company', ticker: null, stance: 'neutral', horizon: null, conditions: [], risks: [], levels: [], trust: 'L1', quotes: [{ startId: id, endId: id, text, translation: '', start: 0, end: 4, hash: null }] })),
        },
      }, 'test');
      run.stage = 'research-audit';
      run.output.researchBaseline = [];
      run.output.researchDraft = { sentences: [safe, unsafe], mainTopics: ['Company'], omissions: [] };
      const rawOriginal = structuredClone(run.output.researchDraft);
      const original = ResearchDraft.parse(run.output.researchDraft);
      await researchStep(run);
      assert.equal(run.stage, 'complete', 'No new assertion must not enqueue another coverage-only audit');
      assert.equal(run.status, outcome === 'unknown-paid-outcome' ? 'needs_review' : 'completed');
      assert.equal(run.output.coverageRepairNoAdditions, true);
      assert.deepEqual(run.output.researchDraft, rawOriginal, 'Original draft stays byte-equivalent');
      const trace = run.output.coverageRepair as { originalDraft: unknown; originalAudit: unknown; excludedAdditions: unknown[] };
      assert.deepEqual(trace.originalDraft, original);
      assert.deepEqual(run.output.researchAudit, trace.originalAudit, 'Original independent verdicts and coverage findings remain unchanged');
      assert.equal(trace.excludedAdditions.length, outcome === 'empty' || outcome === 'unknown-paid-outcome' ? 0 : 1);
      const [brief] = await researchBriefs();
      assert.deepEqual(brief.sentences.map(s => s.id), ['safe']);
      assert.equal(brief.sentences[0].auditReason, 'Original holding supported.');
      assert.equal(brief.rejected[0].sentence.id, 'bad');
      assert.equal(brief.evidenceCoverage?.find(c => c.evidenceId === 'k2')?.status, 'missing', 'A rejected original is never promoted by an empty supplement');
      assert.ok(brief.omissions.some(note => note.includes('Unresolved gaps remain')));
      if (outcome !== 'unknown-paid-outcome') assert.ok(brief.omissions.some(note => note.includes('original EPS gap remains unresolved')));
      assert.equal((run.output.researchReadiness as { status: string }).status, 'partial');
      assert.equal(brief.modelCostUsd, outcome === 'unknown-paid-outcome' ? .01 : .03, 'Include completed generation charges; unknown reservations remain separate');
      if (outcome === 'unknown-paid-outcome') {
        const attempts = await listAttempts(run.id, 'synthesis-research-coverage');
        assert.equal(attempts.length, 1, 'Unknown paid outcome must not be repeated');
        assert.equal(attempts[0].status, 'unknown');
        assert.equal(attempts[0].open, true, 'Reservation stays open for explicit reconciliation');
        assert.ok(attempts[0].amount > 0, 'Unknown spend stays conservatively reserved');
        assert.match(String(run.output.coverageRepairError), /unknown/i);
        assert.ok(brief.omissions.some(note => /Coverage repair failed/.test(note)));
      }
      assert.equal(fake.requestsFor('synthesis-research-coverage').length, 1);
      assert.equal(fake.requests.some(request => request.stage.startsWith('critique-faithful-coverage') || request.stage === 'prescreen-jev-coverage'), false);
      assert.equal(fake.requests.length, 2, 'Only original audit and bounded proposal generation');
    } finally {
      restore();
      await database.close();
    }
  });
}
