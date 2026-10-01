import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForWorkerSlot } from '../src/server/youtube-intelligence/worker-admission.ts';

test('a completed slot wakes admission while a slow sibling remains running', async () => {
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  let woke = false;
  const wait = waitForWorkerSlot(new Set([Promise.resolve(), slow]), 1000).then(() => { woke = true; });
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(woke, true, 'must refill the free slot without waiting for slow sibling or polling timer'); }
  finally { release(); await wait; }
});

test('an empty worker window returns and a polling timeout does not cancel started work', async () => {
  await waitForWorkerSlot(new Set());
  let release!: () => void;
  let finished = false;
  const active = new Promise<void>(resolve => { release = resolve; }).then(() => { finished = true; });
  await waitForWorkerSlot(new Set([active]), 5);
  assert.equal(finished, false);
  release();
  await active;
  assert.equal(finished, true);
});

test('a failed slot wakes admission without abandoning its slow sibling', async () => {
  let release!: () => void;
  let finished = false;
  const slow = new Promise<void>(resolve => { release = resolve; }).then(() => { finished = true; });
  await waitForWorkerSlot(new Set([Promise.reject(Error('fixture failure')), slow]));
  assert.equal(finished, false);
  release();
  await slow;
  assert.equal(finished, true);
});
