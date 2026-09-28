/** No providers: measure admission and drained outputs under a typed account failure. */
import assert from 'node:assert/strict';
import { boundedSettled, isFatalAccountError, AdmissionStoppedError } from '../src/server/youtube-intelligence/bounded-parallel.ts';
import { TransportError } from '../src/server/youtube-intelligence/transport/types.ts';

async function measure(enabled: boolean, fatal: boolean) {
  const started: number[] = [], finished: number[] = [];
  const began = performance.now();
  const results = await boundedSettled(Array.from({ length: 100 }, (_, n) => n), 3, async n => {
    started.push(n);
    await new Promise(resolve => setTimeout(resolve, n === 0 ? 2 : 5));
    finished.push(n);
    if (fatal && n === 0) throw new TransportError('unknown', 'Fixture account rejected', 402);
    return { item: n, evidence: `exact source span ${n}`, hash: `fixture-hash-${n}` };
  }, enabled ? { stopOnError: isFatalAccountError } : {});
  assert.deepEqual([...finished].sort((a,b) => a-b), [...started].sort((a,b) => a-b));
  return {
    seconds: (performance.now() - began) / 1000,
    requestsStarted: started.length,
    untouched: results.filter(r => r.status === 'rejected' && r.reason instanceof AdmissionStoppedError).length,
    retainedOutputs: results.filter(r => r.status === 'fulfilled').map(r => r.value),
  };
}
const before = await measure(false, true), after = await measure(true, true);
assert.equal(before.requestsStarted, 100);
assert.equal(after.requestsStarted, 3);
assert.equal(after.untouched, 97);
assert.deepEqual(after.retainedOutputs, before.retainedOutputs.slice(0, 2));
const healthyBefore = await measure(false, false), healthyAfter = await measure(true, false);
assert.deepEqual(healthyAfter.retainedOutputs, healthyBefore.retainedOutputs);
console.log(JSON.stringify({
  fixtureOnly: true, paidApiSpend: 0, inputItems: 100, concurrency: 3,
  before, after, avoidedRequests: before.requestsStarted - after.requestsStarted,
  healthyOutputsIdentical: true,
  healthyBeforeSeconds: healthyBefore.seconds, healthyAfterSeconds: healthyAfter.seconds,
}, null, 2));
