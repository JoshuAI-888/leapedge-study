import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareStages, stageMarkdown } from '../scripts/optimization-stage-report.ts';
function fixture(accepted = true, seconds = 10) { return { variant: 'before', scope: 'stage only', concurrency: 1,
  timings: [{ videoId: 'v', stage: 'research-audit', seconds, sourceHash: createHash('sha256').update(JSON.stringify([{ text: 'source' }])).digest('hex'), error: null }],
  runs: [{ id: 'r', videoId: 'v', model: 'model', promptVersion: 'v1', input: { task: 'research-brief', snapshot: { evidence: [] } }, output: { source: [{ text: 'source' }], researchDraft: { sentences: [{ id: 's', text: 'claim' }] }, researchAudit: { verdicts: [{ id: 's', accepted, reason: accepted ? 'source supports' : 'unsupported', factualStatus: 'unverified' }] } } }],
  calls: [{ run_id: 'r', status: 'completed', amount: .1, metrics: JSON.stringify({ tokens: { inputTokens: 100, outputTokens: 10 } }) }], briefs: [] }; }
test('stage report compares frozen drafts and surfaces changed verdict with both reasons', () => {
  const r = compareStages(fixture(), fixture(false, 5));
  assert.equal(r.comparable, true); assert.equal(r.rows[0].savedSeconds, 5);
  assert.equal(r.rows[0].verdictChanges[0].before?.reason, 'source supports');
  assert.equal(r.rows[0].verdictChanges[0].after?.reason, 'unsupported');
  assert.match(stageMarkdown(r), /not ingestion-to-display/);
});
test('changed drafts or source disallow paired gains', () => {
  const after = fixture(); after.runs[0].output.researchDraft.sentences[0].text = 'different';
  const r = compareStages(fixture(), after);
  assert.equal(r.comparable, false); assert.equal(r.rows[0].savedSeconds, null);
});

test('retrieval changes invalidate final-audit timing comparisons', () => {
  const after = fixture(); Object.assign(after.runs[0].output, { retrievals: [{ text: 'different research' }] });
  assert.equal(compareStages(fixture(), after).comparable, false);
});
