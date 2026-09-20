import test from "node:test";
import assert from "node:assert/strict";
import { boundedSettled } from "../src/server/youtube-intelligence/bounded-parallel.ts";
test("bounded fanout drains siblings after failure and preserves input order", async () => {
  let active = 0,
    peak = 0;
  const finished: number[] = [];
  const results = await boundedSettled([0, 1, 2, 3, 4], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, n === 0 ? 15 : 2));
    active--;
    finished.push(n);
    if (n === 1) throw Error("failed");
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(finished.length, 5);
  assert.deepEqual(
    results.map((r) => (r.status === "fulfilled" ? r.value : "failed")),
    [0, "failed", 4, 6, 8],
  );
});

test("fatal admission stops unpaid work while retaining started sibling results", async () => {
  const { isFatalAccountError, AdmissionStoppedError } = await import('../src/server/youtube-intelligence/bounded-parallel.ts');
  const { TransportError } = await import('../src/server/youtube-intelligence/transport/types.ts');
  const started: number[] = [];
  const fatal = new TransportError('unknown', 'Billing rejected', 402);
  let release!: () => void;
  const sibling = new Promise<void>(resolve => { release = resolve; });
  const run = boundedSettled([0, 1, 2, 3], 2, async n => {
    started.push(n);
    if (n === 0) { await Promise.resolve(); throw fatal; }
    await sibling;
    return 'retained paid response';
  }, { stopOnError: isFatalAccountError });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  release();
  const results = await run;
  assert.deepEqual(results[0], { status: 'rejected', reason: fatal });
  assert.deepEqual(results[1], { status: 'fulfilled', value: 'retained paid response' });
  for (const result of results.slice(2)) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof AdmissionStoppedError);
      assert.equal(result.reason.cause, fatal);
      assert.match(result.reason.message, /not started.*no paid request/i);
    }
  }
});

test("fatal classifier uses typed account statuses, never generic rate limits or message text", async () => {
  const { isFatalAccountError } = await import('../src/server/youtube-intelligence/bounded-parallel.ts');
  const { TransportError } = await import('../src/server/youtube-intelligence/transport/types.ts');
  for (const status of [401, 402, 403]) assert.equal(isFatalAccountError(new TransportError('unknown', 'blocked', status)), true);
  for (const status of [400, 404, 429, 500, undefined]) assert.equal(isFatalAccountError(new TransportError('unknown', 'billing 402', status)), false);
  assert.equal(isFatalAccountError(Error('HTTP 402')), false);
  assert.equal(isFatalAccountError({ status: 402 }), false);
});

test("default admission continues even after billing failure; configured admission continues after 429", async () => {
  const { isFatalAccountError } = await import('../src/server/youtube-intelligence/bounded-parallel.ts');
  const { TransportError } = await import('../src/server/youtube-intelligence/transport/types.ts');
  for (const [status, configured] of [[402, false], [429, true]] as const) {
    const started: number[] = [];
    const results = await boundedSettled([0, 1, 2], 1, async n => {
      started.push(n);
      if (n === 0) throw new TransportError('unknown', 'provider error', status);
      return n;
    }, configured ? { stopOnError: isFatalAccountError } : {});
    assert.deepEqual(started, [0, 1, 2]);
    assert.deepEqual(results.slice(1), [{ status: 'fulfilled', value: 1 }, { status: 'fulfilled', value: 2 }]);
  }
});
