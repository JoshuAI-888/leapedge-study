import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { researchEvidenceInventory, researchEvidenceInventoryWithDiagnostics } from '../src/server/youtube-intelligence/research-evidence-inventory.ts';
import type { Run } from '../src/features/youtube-intelligence/contracts.ts';
const quote = 'On September 17, 2026 I prefer NetworkCo below 170, while ComputeCo benefits from demand.';
function fixture(): Run {
  return { id: 'r', videoId: 'v', url: 'https://youtube.com/watch?v=v', model: 'fixture', promptVersion: 'fixture', title: 'Companies', status: 'completed', stage: 'complete', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', error: null, input: {}, cost: 0, output: {
    source: { source_kind: 'captions', language: 'en', segments: [{ id: 's1', text: quote, start_seconds: 463, end_seconds: 472 }] },
    mentions: ['NetworkCo', 'ComputeCo'].map((instrument_as_spoken) => ({ instrument_as_spoken, ticker: null, market: 'unknown', stance: 'watch', sentiment: 'bullish', rationale_en: `${instrument_as_spoken} is discussed favourably by the creator.`, is_call: false, claim_id: null, source_span: { start_id: 's1', end_id: 's1', start_seconds: 463, end_seconds: 472, text_hash: createHash('sha256').update(quote).digest('hex'), translation_en: 'An existing English reading.' } })),
    mentionChecks: { 'NetworkCo:s1:s1': true, 'ComputeCo:s1:s1': true },
  } } as Run;
}
test('accepted company mentions remain attributed research context with exact original provenance', () => {
  const run = fixture();
  (run.output.mentionChecks as Record<string, unknown>).unrelated = 'invalid-check';
  const before = structuredClone(run);
  const evidence = researchEvidenceInventory(run);
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map(e => e.id), ['m1', 'm2']);
  for (const item of evidence) {
    assert.equal(item.kind, 'research_context'); assert.equal(item.trust, 'L1');
    assert.equal(item.stance, 'watch'); assert.equal(item.horizon, null);
    assert.match(item.summary, /^Creator commentary:/);
    assert.deepEqual(item.quotes[0], { startId: 's1', endId: 's1', text: quote, translation: 'An existing English reading.', start: 463, end: 472, hash: createHash('sha256').update(quote).digest('hex') });
  }
  assert.deepEqual(run, before, 'inventory never mutates acceptance or claims');
});
test('rejected, ungraded, call-linked and malformed mentions cannot add accepted research context', () => {
  const run = fixture();
  run.output.mentionChecks = { 'NetworkCo:s1:s1': false };
  assert.equal(researchEvidenceInventory(run).length, 0);
  const mentions = run.output.mentions as Array<Record<string, unknown>>;
  run.output.mentionChecks = { 'NetworkCo:s1:s1': true, 'ComputeCo:s1:s1': true };
  mentions[0].is_call = true; mentions[1].rationale_en = '';
  const result = researchEvidenceInventoryWithDiagnostics(run);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.omissions.length, 1);
});
test('changed hashes or timestamps omit only corrupted mentions and retain an audit diagnostic', () => {
  const run = fixture();
  const mentions = run.output.mentions as Array<{ source_span: { text_hash: string; start_seconds: number } }>;
  mentions[0].source_span.text_hash = 'a'.repeat(64);
  const result = researchEvidenceInventoryWithDiagnostics(run);
  assert.deepEqual(result.evidence.map(e => e.id), ['m2']);
  assert.match(result.omissions[0].reason, /hash/i);
  mentions[1].source_span.start_seconds = 464;
  assert.equal(researchEvidenceInventory(run).length, 0);
});
