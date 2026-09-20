import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers/db.ts';
import { create } from '../src/server/youtube-intelligence/store.ts';
import { teamDefaults } from '../src/features/youtube-intelligence/settings.ts';
import { FakeModelTransport } from '../src/server/youtube-intelligence/transport/fake.ts';
import { injectTransport } from '../src/server/youtube-intelligence/transport/index.ts';
import { prefetchResearch, retainedPrefetchRetrieval } from '../src/server/youtube-intelligence/research-prefetch.ts';
import { researchBriefs } from '../src/server/youtube-intelligence/research-pipeline.ts';
import { put, doc } from '../src/server/youtube-intelligence/research-store.ts';
import { createHash } from 'node:crypto';

test('experimental prefetch is off by default, never accepts candidates or publishes, and resumes paid planning', async () => {
  const db = await freshDatabase();
  const team = teamDefaults();
  const fake = new FakeModelTransport({ responses: { 'synthesis-research-plan': { json: { queries: [], coverage: ['Company'] }, usage: { costUsd: 0.01 } } } });
  const restore = injectTransport(fake);
  try {
    const run = await create('prefetch-video', team.models.extraction.id, { teamPreferencesSnapshot: team }, team.prompts.version);
    run.output.claims = [{ id: 'c1', passed: false, reasons: [], claim: { thesis_en: 'Holds Company shares', instrument_as_spoken: 'Company', ticker: null, ticker_explicit: false, stance: 'hold', horizon_en: null, conditions_en: [], risks_en: [], levels: [], creator_conviction: 'unspecified', evidence: [{ segment_id: 's1', quote_original: 'I hold Company shares', quote_translation_en: '' }] } }];
    const original = structuredClone(run.output.claims);
    await prefetchResearch(run);
    assert.equal(fake.requestsFor('synthesis-research-plan').length, 0);
    run.input.speculativeResearch = true;
    await prefetchResearch(run);
    assert.equal(fake.requestsFor('synthesis-research-plan').length, 1);
    assert.deepEqual(run.output.claims, original);
    assert.equal((await researchBriefs()).length, 0);
    assert.equal(run.output.researchBriefId, undefined);
    delete run.output.researchPrefetch;
    await prefetchResearch(run);
    assert.equal(fake.requestsFor('synthesis-research-plan').length, 1);
    assert.deepEqual(run.output.claims, original);
    const key = `${run.id}:research-prefetch.v1`;
    const progress = await doc('researchPrefetchProgress', key);
    await put('researchPrefetchProgress', key, { ...progress, state: 'running', stage: 'metadata', output: { researchBaseline: [] } });
    run.input.efficiencyVersion = 'evidence-efficiency.v1';
    run.input.reuseResearchCache = true;
    run.input.processingMode = 'batch';
    run.input.inferenceConfig = { reasoningEffort: 'high', critiqueMaxTokens: 12345 };
    run.input.promptSnapshot = { changed: true };
    run.input.criticModel = 'changed-critic';
    run.input.transcriptionModel = 'changed-transcription';
    await prefetchResearch(run);
    assert.equal((run.output.researchPrefetch as { state: string }).state, 'complete', 'replay uses the original immediate-mode operational inputs');
    assert.equal(fake.requestsFor('synthesis-research-plan').length, 1, 'replaying an interrupted checkpoint reuses paid plan');
  } finally { restore(); await db.close(); }
});

test('exact prefetched unknown retrieval is reusable as uncertainty without another request', async () => {
  const db = await freshDatabase();
  try {
    const identity = { runId: 'donor', query: 'Company revenue', timeMode: 'video_date' as const, cutoff: '2026-09-20T00:00:00Z', primaryDomains: ['sec.gov'] };
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    await put('researchRetrieval', key, { key, state: 'unknown', query: identity.query, timeMode: identity.timeMode, sources: [], costUsd: null, costBasis: 'unknown provider outcome', note: 'Do not rebuy', requestedAt: '2026-09-20T00:00:00Z' });
    const retained = await retainedPrefetchRetrieval(identity);
    assert.equal(retained?.record.state, 'unknown');
    assert.equal(retained?.record.costUsd, 0);
    assert.equal(retained?.donorCostUsd, null);
    assert.equal(await retainedPrefetchRetrieval({ ...identity, cutoff: '2026-09-19T00:00:00Z' }), null);
    assert.equal(await retainedPrefetchRetrieval({ ...identity, primaryDomains: ['other.com'] }), null);
  } finally { await db.close(); }
});

test('invalid provisional evidence remains diagnostic and cannot fail the parent', async () => {
  const db = await freshDatabase();
  try {
    const team = teamDefaults();
    const run = await create('prefetch-invalid', team.models.extraction.id, { speculativeResearch: true, teamPreferencesSnapshot: team }, team.prompts.version);
    const originalStatus = run.status;
    run.output.metadata = { language: 42 };
    await prefetchResearch(run);
    assert.equal(run.status, originalStatus);
    assert.equal((run.output.researchPrefetch as { state: string }).state, 'failed');
    assert.equal((await researchBriefs()).length, 0);
  } finally { await db.close(); }
});

function pendingCandidate() {
  return { id: 'c1', passed: false, reasons: [], claim: { thesis_en: 'Holds Company shares', instrument_as_spoken: 'Company', ticker: null, ticker_explicit: false, stance: 'hold', horizon_en: null, conditions_en: [], risks_en: [], levels: [], creator_conviction: 'unspecified', evidence: [{ segment_id: 's1', quote_original: 'I hold Company shares', quote_translation_en: '' }] } };
}

test('actual critique step overlaps provisional planning and awaits both before returning', { timeout: 10000 }, async () => {
  const db = await freshDatabase();
  const { step } = await import('../src/server/youtube-intelligence/pipeline.ts');
  const { queueResearchBrief } = await import('../src/server/youtube-intelligence/research-pipeline.ts');
  const team = teamDefaults();
  const criticStarted = Promise.withResolvers<void>();
  const planStarted = Promise.withResolvers<void>();
  const criticRelease = Promise.withResolvers<void>();
  const planRelease = Promise.withResolvers<void>();
  const fake = new FakeModelTransport({ responses: {
    critique: async () => { criticStarted.resolve(); await criticRelease.promise; return { json: { verdicts: [{ id: 'c1', verdict: 'reject', reason_en: 'Unsupported candidate' }] } }; },
    'synthesis-research-plan': async () => { planStarted.resolve(); await planRelease.promise; return { json: { queries: [], coverage: ['Company'] } }; },
  } });
  const restore = injectTransport(fake);
  let work: Promise<void> | undefined;
  try {
    const run = await create('overlap-prefetch', team.models.extraction.id, { speculativeResearch: true, teamPreferencesSnapshot: team }, team.prompts.version);
    run.stage = 'critique';
    run.output.claims = [pendingCandidate()];
    run.output.source = { source_kind: 'imported_transcript', language: 'en', segments: [{ id: 's1', text: 'I hold Company shares', start_seconds: 0, end_seconds: 5 }] };
    let completed = false;
    work = step(run).then(() => { completed = true; });
    await Promise.all([criticStarted.promise, planStarted.promise]);
    assert.equal(completed, false, 'both provider calls started before either was released');
    await assert.rejects(queueResearchBrief(run.id), /completed video analysis/);
    criticRelease.resolve();
    const deadline = Date.now() + 3000;
    while (run.stage !== 'publish' && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.equal(run.stage, 'publish', 'critic finished before provisional planning was released');
    assert.equal(completed, false, 'return waits for provisional work after critic finishes');
    planRelease.resolve();
    await work;
    assert.equal(run.stage, 'publish');
    assert.equal((run.output.claims as Array<{ passed: boolean }>)[0].passed, false);
    assert.equal((await researchBriefs()).length, 0);
  } finally {
    criticRelease.resolve(); planRelease.resolve(); await work?.catch(() => undefined);
    restore(); await db.close();
  }
});

test('final brief preserves unresolved donor costs without rebuying exact provisional searches', async () => {
  const db = await freshDatabase();
  const { researchStep } = await import('../src/server/youtube-intelligence/research-pipeline.ts');
  const { stubFetch } = await import('./helpers/fetch-stub.ts');
  const team = teamDefaults();
  const old = process.env.EXA_API_KEY; process.env.EXA_API_KEY = 'fixture';
  const fake = new FakeModelTransport({ responses: { 'synthesis-research-plan': { json: { queries: [{ query: 'Company revenue', reason: 'Material' }], coverage: ['Company'] } }, 'synthesis-research': { json: { sentences: [], mainTopics: [], omissions: ['No accepted assertions in this fixture.'] } } } });
  const restore = injectTransport(fake);
  const stub = stubFetch([{ url: 'https://api.exa.ai/search', responses: [() => { throw Error('unknown historical charge'); }, () => { throw Error('unknown current charge'); }] }]);
  try {
    const source = await create('prefetch-unknown-final', team.models.extraction.id, { speculativeResearch: true, teamPreferencesSnapshot: team }, team.prompts.version);
    source.output.claims = [pendingCandidate()];
    source.output.metadata = { publishedAt: '2026-01-01T00:00:00Z', language: 'en' };
    await prefetchResearch(source);
    assert.equal(stub.log.length, 2);
    const snapshot = await doc('researchPrefetchSnapshot', `${source.id}:research-prefetch.v1`);
    const final = await create('prefetch-final', team.models.extraction.id, { task: 'research-brief', speculativeResearch: true, teamPreferencesSnapshot: team, snapshot }, team.prompts.version);
    final.stage = 'research-sources';
    final.output.researchPlan = { queries: [{ query: 'Company revenue', reason: 'Material' }], coverage: ['Company'] };
    await researchStep(final);
    assert.equal(stub.log.length, 2, 'unknown paid outcome is never automatically rebought by final run');
    const records = final.output.retrievals as Array<{ state: string; costUsd: number }>;
    assert.deepEqual(records.map(r => [r.state, r.costUsd]), [['unknown', 0], ['unknown', 0]]);
    assert.equal((final.output.prefetchReuse as unknown[]).length, 2);
    assert.equal((await db.prepare('SELECT * FROM yi_calls WHERE run_id=$1').all(final.id)).length, 0);
    assert.equal((await researchBriefs()).length, 0);
    await researchStep(final); // sources -> synthesis; no new request
    await researchStep(final); // draft
    await researchStep(final); // audit -> immutable final brief
    assert.equal(final.status, 'completed');
    const [brief] = await researchBriefs();
    assert.equal(brief.unknownExternalCosts, 2, 'zero consumer spend does not erase unresolved donor charges');
    assert.equal(brief.externalCostUsd, 0);
    assert.equal(stub.log.length, 2, 'final synthesis and audit never rebuy unknown searches');
    assert.equal((await db.prepare("SELECT * FROM yi_calls WHERE run_id=$1 AND status='unknown'").all(source.id)).length, 2);
    assert.equal((final.output.prefetchReuse as Array<{ donorCostUsd: number | null }>).every(r => r.donorCostUsd === null), true);

  } finally {
    restore(); stub.restore(); if (old === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = old;
    await db.close();
  }
});
