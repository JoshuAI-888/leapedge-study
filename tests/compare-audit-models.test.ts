import test from 'node:test';
import assert from 'node:assert/strict';
import { auditInputHash, auditResponseHash, compareAuditModels } from '../scripts/compare-audit-models.ts';

function fixture() {
  const request = { videoId: '_mEvVWGfmjU', sourceHash: 'source-frozen', hash: 'original-trace', stage: 'critique-faithful-1',
    prompt: 'Keep the condition and attribution.', payload: { sentences: [{ id: 's1', text: 'If this occurs, the creator sees upside.', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', quotes: [{ text: 'If this occurs, I see upside.' }] }], assessEvidenceIds: ['e1'], otherSentencesCitingAssessedEvidence: [] },
    responseSchema: { type: 'object' }, maxOutputTokens: 16000, reasoningEffort: 'low' };
  const output = { verdicts: [{ id: 's1', accepted: true, reason: 'Condition retained.' }], evidenceCoverage: [{ evidenceId: 'e1', status: 'covered', sentenceIds: ['s1'], missingPoints: [], reason: 'All points retained.' }] };
  const result = (requestedModel: string) => ({ videoId: request.videoId, requestHash: request.hash, auditInputHash: auditInputHash(request), requestedModel, runId: requestedModel,
    rawResponse: { text: JSON.stringify(output), usage: { inputTokens: 1000, outputTokens: 100, costUsd: .003 }, model: requestedModel, provider: 'Anthropic', finishReason: 'stop', raw: { choices: [output] } },
    responseWallMs: 1000, calls: [{ id: requestedModel, stage: request.stage, status: 'completed', amount: .003, metrics: { requestFingerprint: 'fingerprint-'+requestedModel, seconds: 1 } }] });
  return { requests: [request], results: [result('anthropic/claude-sonnet-5'), result('anthropic/claude-haiku-5.5')] };
}

test('matched retained audit outputs report performance but leave semantic quality for review', () => {
  const r=compareAuditModels(fixture());
  assert.equal(r.comparable, true);
  assert.equal(r.qualityVerdict, 'review-required');
  assert.equal(r.videos[0].disagreements.length, 0);
  assert.equal(r.videos[0].arms.haiku.acceptedCount, 1);
  assert.equal(r.videos[0].arms.haiku.settledCostUsd, .003);
});
test('retained response integrity survives boundary object-key ordering but rejects changed values',()=>{
  const f=fixture();
  const result=f.results[1] as typeof f.results[1]&{rawResponseHash:string};
  result.rawResponseHash=auditResponseHash(result.rawResponse);
  assert.equal(compareAuditModels(f).comparable,true);
  result.rawResponse.text+=' ';
  assert.ok(compareAuditModels(f).invalidReasons.some(x=>x.includes('response hash differs')));
});
test('changed immutable input and unknown billed usage cannot appear as a matched saving', () => {
  const f=fixture();f.results[1].auditInputHash='changed';f.results[1].rawResponse.usage.costUsd=null as unknown as number;
  f.results[1].calls[0].status='unknown';
  const r=compareAuditModels(f);
  assert.equal(r.comparable,false);
  assert.equal(r.videos[0].improvement,null);
  assert.equal(r.videos[0].arms.haiku.unknownCalls,1);
  assert.equal(r.videos[0].arms.haiku.settledCostUsd,null);
});
test('fabricated missing-point quote and foreign or duplicate targets fail structural acceptance', () => {
  const f=fixture();const raw=JSON.parse(f.results[1].rawResponse.text);
  raw.verdicts.push({...raw.verdicts[0]});raw.verdicts.push({id:'foreign',accepted:true,reason:'Wrong target'});
  raw.evidenceCoverage[0]={...raw.evidenceCoverage[0],status:'partial',missingPoints:[{point:'Invented source',quote:'Buy immediately'}]};
  f.results[1].rawResponse.text=JSON.stringify(raw);
  const r=compareAuditModels(f);
  assert.equal(r.qualityVerdict,'failed');
  assert.ok(r.videos[0].arms.haiku.issues.some(x=>x.includes('unanchored quote')));
  assert.ok(r.videos[0].arms.haiku.issues.some(x=>x.includes('foreign verdict')));
  assert.ok(r.videos[0].arms.haiku.issues.some(x=>x.includes('single verdict')));
});
test('agreement never certifies accuracy and a rejection difference is explicitly retained', () => {
  const f=fixture();const raw=JSON.parse(f.results[1].rawResponse.text);raw.verdicts[0].accepted=false;raw.verdicts[0].reason='Condition strengthened';
  raw.evidenceCoverage[0]={...raw.evidenceCoverage[0],status:'missing',sentenceIds:[],reason:'Withheld'};
  f.results[1].rawResponse.text=JSON.stringify(raw);
  const r=compareAuditModels(f);
  assert.equal(r.qualityVerdict,'review-required');assert.equal(r.videos[0].disagreements.length,2);
  assert.equal(r.videos[0].arms.haiku.acceptedCount,0);
});
test('absent raw retained response and served model substitution invalidate measurement', () => {
  const f=fixture();delete (f.results[1].rawResponse as {raw?:unknown}).raw;f.results[1].rawResponse.model='anthropic/claude-opus-5.5';
  const r=compareAuditModels(f);
  assert.equal(r.comparable,false);
  assert.ok(r.invalidReasons.some(x=>x.includes('Served model')));
  assert.ok(r.invalidReasons.some(x=>x.includes('Raw provider')));
});
test('duplicate model arms cannot supply an apparently matched comparison', () => {
  const f=fixture();f.results.push(f.results[1]);
  const r=compareAuditModels(f);
  assert.equal(r.comparable,false);assert.ok(r.invalidReasons.some(x=>x.includes('single Haiku')));
});
test('withheld sentence cannot count as covered evidence and incomplete paid output fails quality', () => {
  const f=fixture();const raw=JSON.parse(f.results[1].rawResponse.text);raw.verdicts[0].accepted=false;
  f.results[1].rawResponse.text=JSON.stringify(raw);f.results[1].rawResponse.finishReason='length';
  const r=compareAuditModels(f);
  assert.equal(r.qualityVerdict,'failed');
  assert.ok(r.videos[0].arms.haiku.issues.some(x=>x.includes('Incomplete')));
  assert.ok(r.videos[0].arms.haiku.issues.some(x=>x.includes('rejected citing')));
});
