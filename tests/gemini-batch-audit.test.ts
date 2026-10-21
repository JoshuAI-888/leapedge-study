import test from 'node:test';
import assert from 'node:assert/strict';
import { auditItems } from '../scripts/gemini-batch-audit.ts';
test('independent experiment critique quotes exact frozen source and refuses invented range IDs', () => {
    const source = { source_kind: 'fixture', segments: [{ id: 's1', text: 'If growth persists, the scenario may hold.', start_seconds: 0, end_seconds: 3 }] };
    const value = { claims: [{ thesis_en: 'Growth is guaranteed.', evidence_ranges: [{ start_id: 's1', end_id: 's1' }] }], key_points: [] };
    const p = auditItems(value, source);
    assert.equal(p.evidence[0].quotes[0].text, 'If growth persists, the scenario may hold.');
    assert.equal(p.sentences[0].text, 'Growth is guaranteed.');
    assert.throws(() => auditItems({ ...value, claims: [{ ...value.claims[0], evidence_ranges: [{ start_id: 'invented', end_id: 'invented' }] }] }, source));
});
