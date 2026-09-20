import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers/db.ts';
import { Source } from '../src/features/youtube-intelligence/contracts.ts';
import * as store from '../src/server/youtube-intelligence/store.ts';
import { step } from '../src/server/youtube-intelligence/pipeline.ts';
import { processNext } from '../src/server/youtube-intelligence/runner.ts';
import { FakeModelTransport } from '../src/server/youtube-intelligence/transport/fake.ts';
import { injectTransport } from '../src/server/youtube-intelligence/transport/index.ts';
import { TransportError } from '../src/server/youtube-intelligence/transport/types.ts';

test('later fatal extraction sibling stops publication, drains paid success, and replay never repurchases it', async () => {
  const db = await freshDatabase();
  const source = Source.parse({ source_kind: 'imported_transcript', segments: Array.from({ length: 4 }, (_, n) => ({
    id: `s${n}`, text: `Exact retained evidence ${n}.`, start_seconds: n * 10, end_seconds: n * 10 + 9,
  })) });
  const snapshot = { id: 'fatal.fixture.v1', rationale: 'Fatal extraction fixture', transcribe: 'transcribe', extraction: 'extract', synthesis: 'summarise', critique: 'audit' };
  const run = await store.create('fatal-sibling', 'google/gemini-3.8-flash', { promptSnapshot: snapshot }, snapshot.id);
  const output = { source, metadata: { duration: 40 }, extractionPlan: source.segments.map(s => [s]) };
  await db.prepare("UPDATE yi_runs SET stage='synthesis', output=$1 WHERE id=$2").run(JSON.stringify(output), run.id);
  let signalFatal!: () => void;
  const fatalReached = new Promise<void>(resolve => { signalFatal = resolve; });
  const reply = { json: { claims: [], key_points: [] }, usage: { inputTokens: 10, outputTokens: 10, costUsd: 0.02 } };
  const fake = new FakeModelTransport({ responses: {
    'synthesis-chunk-0': async () => {
      await fatalReached;
      // Wait for the later sibling's terminal ledger transition, then let its
      // rejection propagate through modelCall and the admission controller.
      const deadline = Date.now() + 5000;
      while ((await store.listAttempts(run.id, 'synthesis-chunk-1'))[0]?.status !== 'released') {
        if (Date.now() > deadline) throw Error('Fatal sibling did not settle');
        await new Promise(resolve => setImmediate(resolve));
      }
      await new Promise(resolve => setImmediate(resolve));
      return reply;
    },
    'synthesis-chunk-1': () => { signalFatal(); throw new TransportError('unknown', 'Fixture billing rejection', 402); },
    'synthesis-chunk-2': reply,
    'synthesis-chunk-3': reply,
  } });
  const restore = injectTransport(fake);
  try {
    const result = await processNext();
    assert.equal(result?.status, 'failed');
    const failed = (await store.get(run.id))!;
    assert.equal(failed.status, 'failed');
    assert.match(failed.error!, /Fixture billing rejection/);
    assert.equal(failed.stage, 'synthesis');
    assert.equal(failed.output.chunkDrafts, undefined, 'do not apply the successful first sibling when a later sibling is fatal');
    assert.equal(failed.output.claims, undefined);
    assert.equal(failed.output.brief, undefined);
    assert.deepEqual(fake.requests.map(r => r.stage).sort(), ['synthesis-chunk-0', 'synthesis-chunk-1']);
    const paid = await store.listAttempts(run.id, 'synthesis-chunk-0');
    assert.equal(paid.length, 1);
    assert.equal(paid[0].status, 'completed');
    assert.equal(paid[0].amount, 0.02);
    const retained = await store.retainedResponse(`${paid[0].id}:normalized`) as { text: string };
    assert.deepEqual(JSON.parse(retained.text), reply.json);
    assert.equal((await store.listAttempts(run.id, 'synthesis-chunk-1'))[0].status, 'released');
    for (const n of [2,3]) assert.equal((await store.listAttempts(run.id, `synthesis-chunk-${n}`)).length, 0);

    // Explicit resumed stage execution after account repair, not automatic retry of a failed job.
    fake.respond('synthesis-chunk-1', reply);
    failed.status = 'running';
    failed.error = null;
    for (let i = 0; i < 4; i++) await step(failed);
    assert.equal(failed.stage, 'critique');
    assert.equal(failed.output.chunkIndex, 4);
    assert.deepEqual(failed.output.source, source);
    assert.equal(fake.requestsFor('synthesis-chunk-0').length, 1, 'already settled sibling never called again');
    assert.equal((await store.listAttempts(run.id, 'synthesis-chunk-0')).length, 1);
    assert.equal(fake.requestsFor('synthesis-chunk-1').length, 2, 'one rejected attempt and one post-repair attempt');
    for (const n of [2,3]) assert.equal(fake.requestsFor(`synthesis-chunk-${n}`).length, 1);
    assert.equal(fake.requestsFor('critique').length, 0, 'publication still requires the independent audit');
  } finally { restore(); await db.close(); }
});
