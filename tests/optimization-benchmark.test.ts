import test from 'node:test';
import assert from 'node:assert/strict';
import { compareExports } from '../scripts/optimization-benchmark.ts';

function fixture(seconds = 10) {
  return {
    benchmark: { controls: { concurrency: 3, models: 'frozen', researchAsOf: '2026-09-20', cache: 'cold' }, revision: 'a' },
    manifest: [{ videoId: 'video', runId: 'r', queuedAt: '2026-09-20T00:00:00Z' }],
    runs: [{ id: 'r', videoId: 'video', model: 'frozen-model', input: { inferenceConfig: 'fixed' }, status: 'completed', updatedAt: `2026-09-20T00:00:${seconds}Z`, output: { sourceHash: 'abc', source: [{ text: 'frozen' }] } }, { id: 'b', videoId: 'video', status: 'completed', updatedAt: `2026-09-20T00:00:${seconds + 2}Z`, output: { sourceHash: 'abc', source: [{ text: 'frozen' }] } }],
    calls: [{ run_id: 'r', stage: 'extract', status: 'completed', amount: 0.1, metrics: JSON.stringify({ tokens: { inputTokens: 100, outputTokens: 20 } }) }],
    timings: [{ run_id: 'r', stage: 'extract', execution_ms: 1000, queue_ms: 500, checkpoint_ms: 20 }],
    briefs: [{ sourceRunId: 'r', runId: 'b', videoId: 'video', createdAt: `2026-09-20T00:00:${seconds + 1}Z`, sentences: [{ id: 's', text: 'Supported claim', evidenceIds: ['e'], externalIds: [], factualStatus: 'unverified' }], evidence: [{ id: 'e' }], external: [], omissions: [], coverageFindings: [] }],
  };
}
test('reports paired stage, tokens, cost and timing without declaring count-based quality', () => {
  const result = compareExports(fixture(20), fixture(10));
  assert.equal(result.comparable, true);
  assert.equal(result.videos[0].improvement?.finalBriefSeconds, 10);
  assert.equal(result.videos[0].after.stages.extract.executionSeconds, 1);
  assert.equal(result.videos[0].after.inputTokens, 100);
  assert.equal(result.qualityVerdict, 'review-required');
});
test('changed transcript or concurrency invalidates gains', () => {
  const after = fixture(); after.runs[0].output.sourceHash = 'different'; after.benchmark.controls.concurrency = 4;
  const result = compareExports(fixture(), after);
  assert.equal(result.comparable, false); assert.equal(result.videos[0].improvement, null);
  assert.match(result.invalidReasons.join(' '), /controls|source/i);
});
test('legacy exports remain diagnostic and missing metadata is never assumed equivalent', () => {
  const before: Record<string, unknown> = fixture(); delete before.benchmark;
  assert.equal(compareExports(before, fixture()).comparable, false);
});
test('broken citations and missing same-video cases block quality acceptance', () => {
  const after = fixture(); after.briefs[0].sentences[0].evidenceIds = ['missing'];
  const report = compareExports(fixture(), after);
  assert.equal(report.qualityVerdict, 'failed');
  assert.equal(report.videos[0].after.quality.brokenCitations.length, 1);
  assert.equal(compareExports(fixture(), { ...after, manifest: [] }).comparable, false);
});
test('malformed numeric metrics are rejected at boundary', () => {
  const after = fixture(); after.calls[0].amount = Number.NaN;
  assert.throws(() => compareExports(fixture(), after));
});

test('search costs recorded in ledger and brief are counted once', () => {
  const after = fixture();
  after.calls.push({ run_id: 'b', stage: 'external-search-x', status: 'completed', amount: 0.007, metrics: '{}' });
  Object.assign(after.briefs[0], { externalCostUsd: 0.007 });
  const row = compareExports(after, after).videos[0].after;
  assert.equal(row.costUsd, 0.10700000000000001);
  assert.equal(row.missingTokenCalls, 0);
});

test('final brief clock uses completed child run, not draft creation; corroborated is counted', () => {
  const data = fixture(20);
  data.briefs[0].createdAt = '2026-09-20T00:00:01Z';
  data.briefs[0].sentences[0].factualStatus = 'corroborated';
  const report = compareExports(data, data);
  assert.equal(report.videos[0].after.finalBriefSeconds, 22);
  assert.equal(report.videos[0].after.quality.externallyVerified, 1);
});

test('live benchmark refuses to import a runtime or spend without explicit --live', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [
    'scripts/optimization-live-benchmark.mjs',
    '--root', '/definitely-not-a-runtime', '--input', '/missing-input.json',
    '--output', '/missing-output.json', '--revision', 'test', '--variant', 'after',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required: --live/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|ENOENT/);
});

test('live benchmark refuses to overwrite an export before runtime or credential access', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'yti-benchmark-'));
  const output = join(dir, 'retained.json');
  writeFileSync(output, 'retained evidence');
  try {
    const result = spawnSync(process.execPath, [
      'scripts/optimization-live-benchmark.mjs', '--live',
      '--root', '/definitely-not-a-runtime', '--input', '/missing-input.json',
      '--output', output, '--revision', 'test', '--variant', 'after',
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to overwrite/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|ENOENT/);
    assert.equal(readFileSync(output, 'utf8'), 'retained evidence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
