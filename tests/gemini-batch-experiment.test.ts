import test from 'node:test';
import assert from 'node:assert/strict';
import { experimentRouting, mediaChargeBound } from '../scripts/gemini-batch-experiment.ts';
test('experiment routing requires explicit asynchronous eligibility and preserves manual immediacy', () => {
    assert.equal(experimentRouting({ origin: 'manual', batchEnabled: true, prerequisites: true }), 'immediate');
    assert.equal(experimentRouting({ origin: 'channel', batchEnabled: false, prerequisites: true }), 'immediate');
    assert.equal(experimentRouting({ origin: 'channel', batchEnabled: true, prerequisites: false }), 'immediate');
    assert.equal(experimentRouting({ origin: 'channel', batchEnabled: true, prerequisites: true }), 'batch');
    assert.equal(experimentRouting({ origin: 'historical', batchEnabled: true, prerequisites: true }), 'batch');
});
test('media bound includes whole-video high-resolution allowance and output rather than advertised clip savings', () => {
    assert.equal(mediaChargeBound(346, 2048), 0.08553);
    assert.throws(() => mediaChargeBound(-1, 2048));
    assert.throws(() => mediaChargeBound(346, 0));
});
test('hybrid experiment blocks media batching until the exact media workload is verified', () => {
    assert.equal(experimentRouting({ origin: 'historical', batchEnabled: true, prerequisites: true, requiresMedia: true, batchMediaVerified: false }), 'immediate');
    assert.equal(experimentRouting({ origin: 'historical', batchEnabled: true, prerequisites: true, requiresMedia: true, batchMediaVerified: true }), 'batch');
});
test('captured live guidance reconstruction remains unresolved by the existing publication numeric gate', async () => {
    const { readFileSync } = await import('node:fs');
    const { FinancialFact } = await import('../src/features/youtube-intelligence/research-brief.ts');
    const { sourceNumericCheck } = await import('../src/features/youtube-intelligence/research-numeric-check.ts');
    const fixture = JSON.parse(readFileSync('docs/experiments/gemini-batch-20261021/results/quality-regressions.json', 'utf8'));
    const fact = FinancialFact.parse({ label: 'Revenue guidance lower endpoint', value: 101, currency: 'USD', unit: 'total', scale: 'millions', period: null, basis: 'not_stated', nature: 'forecast', evidenceId: 'guidance', quote: fixture.sourceQuote });
    assert.equal(sourceNumericCheck(fact, [fixture.sourceQuote]).status, 'unresolved');
});

test('manually driven experiment arms cannot be claimed by an automatic worker',async()=>{
 const {freshDatabase}=await import('./helpers/db.ts');const {claimJob}=await import('../src/server/youtube-intelligence/queue.ts');
 const {createParkedExperimentRun}=await import('../scripts/gemini-batch-experiment.ts');
 const db=await freshDatabase();
 try{const run=await createParkedExperimentRun('experiment-fixture','fixture',{task:'gemini-batch-experiment'},'v1');assert.equal(run.status,'paused');assert.equal(await claimJob(),null);}finally{await db.close();}
});
