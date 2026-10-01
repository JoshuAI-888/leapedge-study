import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonManifestSchema, summarizeComparison, comparableTiming } from '../src/features/youtube-intelligence/comparison.ts';
import { readFileSync } from 'node:fs';

test('retained comparison keeps all twenty cases and failures without asserting ground truth', () => {
 const manifest = comparisonManifestSchema.parse(JSON.parse(readFileSync('docs/delivery/comparison-readiness-20260927.json', 'utf8')));
 assert.equal(manifest.cases.length, 20);
 assert.equal(new Set(manifest.cases.map(c => c.videoId)).size, 20);
 assert.ok(manifest.cases.some(c => c.attempts.some(a => a.status === 'failed')));
 assert.ok(manifest.cases.every(c => c.qualityChecks.every(q => q.status === 'unassessed')));
 const summary = summarizeComparison(manifest);
 assert.ok(summary.uniqueRuns < summary.observations);
 assert.ok(summary.failedObservations > 0);
 assert.equal(summary.browserMeasuredCases, 0);
});

test('a cached replay cannot be called a fresh end to end timing comparison', () => {
 assert.equal(comparableTiming({boundary:'retained-transcript-to-terminal',seconds:30,includesQueue:true,includesBrowser:false},{boundary:'ingestion-to-terminal',seconds:90,includesQueue:true,includesBrowser:false}),false);
 assert.equal(comparableTiming({boundary:'unknown',seconds:30,includesQueue:true,includesBrowser:false},{boundary:'unknown',seconds:90,includesQueue:true,includesBrowser:false}),false);
});

test('summary bills a retained call once and refuses conflicting duplicate ledger rows', () => {
 const manifest = comparisonManifestSchema.parse(JSON.parse(readFileSync('docs/delivery/comparison-readiness-20260927.json','utf8')));
 const original = summarizeComparison(manifest).knownLedgerUsd;
 manifest.ledger.push({...manifest.ledger[0]});
 assert.equal(summarizeComparison(manifest).knownLedgerUsd, original);
 manifest.ledger.push({...manifest.ledger[0], amount:999});
 assert.throws(() => summarizeComparison(manifest), /Conflicting ledger/);
});

test('recovered observations do not overwrite earlier failed observations or their paid calls', () => {
 const manifest = comparisonManifestSchema.parse(JSON.parse(readFileSync('docs/delivery/comparison-readiness-20260927.json','utf8')));
 const all=manifest.cases.flatMap(c=>c.attempts);
 const failed=all.filter(a=>a.status==='failed');
 assert.ok(failed.some(a=>all.some(b=>b.runId===a.runId&&b.status==='completed')));
 assert.ok(failed.some(a=>manifest.ledger.some(c=>c.runId===a.runId&&c.status==='completed'&&(c.amount??0)>0)));
 assert.ok(all.filter(a=>a.timing.boundary==='unknown').every(a=>a.timing.seconds===null));
});

test('duplicate video cases fail manifest validation rather than reducing cohort coverage silently', () => {
 const manifest = JSON.parse(readFileSync('docs/delivery/comparison-readiness-20260927.json','utf8'));
 manifest.cases[1].videoId=manifest.cases[0].videoId;
 assert.equal(comparisonManifestSchema.safeParse(manifest).success,false);
});

test('application-rejected model verdicts are not counted as published research',()=>{
 const manifest=comparisonManifestSchema.parse(JSON.parse(readFileSync('docs/delivery/comparison-readiness-20260927.json','utf8')));
 const attempts=manifest.cases.flatMap(c=>c.attempts);
 assert.ok(attempts.some(a=>a.outputKind==='published-research' && a.acceptedSentences!==null && a.modelAcceptedDraftSentences!==null && a.acceptedSentences<a.modelAcceptedDraftSentences));
 assert.ok(attempts.filter(a=>a.outputKind!=='published-research').every(a=>a.acceptedSentences===null));
 assert.ok(attempts.filter(a=>a.outputKind==='published-research').every(a=>a.acceptedSentences===a.outputSummary.length));
 const draft=attempts.find(a=>a.outputKind==='published-research')!;
 draft.outputKind='model-audited-draft';
 assert.equal(comparisonManifestSchema.safeParse(manifest).success,false);
});

test('readiness experiments use retained stage durations rather than overwritten historical creation times',()=>{
 const manifest=comparisonManifestSchema.parse(JSON.parse(readFileSync('docs/delivery/comparison-readiness-20260927.json','utf8')));
 const observations=manifest.cases.flatMap(c=>c.attempts).filter(a=>a.artifact.path.includes('readiness-20260927'));
 assert.ok(observations.some(a=>a.artifact.path.endsWith('live-candidate.json')));
 assert.ok(observations.some(a=>a.artifact.path.endsWith('candidate-g-session-2.json')));
 for(const a of observations.filter(a=>a.timing.seconds!==null)){
  assert.equal(a.timing.boundary,'recorded-stage-execution');assert.equal(a.timing.includesQueue,false);assert.equal(a.timing.includesBrowser,false);
 }
 const failed=observations.find(a=>a.runId==='bae7c03b-35a1-4a85-8795-55b4a555f689');assert.ok(failed);assert.equal(failed.status,'failed');assert.equal(failed.acceptedSentences,null);assert.ok((failed.cost.settledUsd??0)>0);
 assert.equal(comparableTiming({boundary:'recorded-stage-execution',seconds:30,includesQueue:false,includesBrowser:false},{boundary:'retained-transcript-to-terminal',seconds:30,includesQueue:false,includesBrowser:false}),false);
});
