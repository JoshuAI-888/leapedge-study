import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  withRetry,
  isRetryableTransportError,
  timeoutBeforeAnyBytes,
} from "../src/server/youtube-intelligence/retry.ts";
import { TransportError } from "../src/server/youtube-intelligence/transport/types.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";

/** A timeout that reports how many response bytes had already arrived. */
function timeout(bytes?: number) {
  const error: TransportError & { bytesReceived?: number } = new TransportError(
    "timeout",
    "Provider request timed out.",
  );
  if (bytes !== undefined) error.bytesReceived = bytes;
  return error;
}
/** Deterministic sleep/jitter so backoff is asserted, never waited on. */
function recorder() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    random: () => 0.5,
  };
}

test("withRetry retries rate limits, 5xx and timeouts before any bytes, and stops at maxAttempts", async () => {
  const clock = recorder();
  const errors = [
    new TransportError("rate_limited", "429", 429),
    new TransportError("server", "503", 503),
    timeout(0),
  ];
  let calls = 0;
  const attempts: number[] = [];
  const recovered = await withRetry(
    async (attempt) => {
      attempts.push(attempt);
      calls += 1;
      const error = errors[calls - 1];
      if (error) throw error;
      return "ok";
    },
    {
      maxAttempts: 4,
      baseDelayMs: 100,
      jitterMs: 40,
      sleep: clock.sleep,
      random: clock.random,
    },
  );
  assert.deepEqual(recovered, { result: "ok", attempts: 4 });
  assert.deepEqual(attempts, [1, 2, 3, 4], "fn receives the attempt number");
  assert.deepEqual(
    clock.delays,
    [120, 220, 420],
    "exponential backoff 100/200/400 plus deterministic jitter of 20",
  );

  const stubborn = recorder();
  let tries = 0;
  const onAttempt: { attempt: number; delayMs: number; retryable: boolean }[] =
    [];
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          tries += 1;
          throw new TransportError("rate_limited", "429", 429);
        },
        {
          maxAttempts: 3,
          baseDelayMs: 10,
          jitterMs: 0,
          sleep: stubborn.sleep,
          random: stubborn.random,
          onAttempt: (info) =>
            void onAttempt.push({
              attempt: info.attempt,
              delayMs: info.delayMs,
              retryable: info.previousError !== undefined,
            }),
        },
      ),
    (error: unknown) =>
      error instanceof TransportError &&
      error.kind === "rate_limited" &&
      (error as TransportError & { attempts?: number }).attempts === 3,
  );
  assert.equal(tries, 3, "maxAttempts caps the total number of calls");
  assert.deepEqual(
    onAttempt,
    [
      { attempt: 1, delayMs: 0, retryable: false },
      { attempt: 2, delayMs: 10, retryable: true },
      { attempt: 3, delayMs: 20, retryable: true },
    ],
    "onAttempt sees every attempt, its wait and the error that caused it",
  );
});

test("withRetry never retries unknown failures, non-429 4xx, or a timeout after bytes arrived", async () => {
  const clock = recorder();
  const never = async (error: unknown) => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw error;
          },
          {
            maxAttempts: 4,
            baseDelayMs: 1,
            sleep: clock.sleep,
            random: clock.random,
          },
        ),
      () => true,
    );
    return calls;
  };
  assert.equal(
    await never(new TransportError("unknown", "unknown", undefined)),
    1,
  );
  assert.equal(
    await never(new TransportError("unknown", "bad request", 400)),
    1,
  );
  assert.equal(
    await never(new TransportError("server", "not found", 404)),
    1,
    "a 4xx status is never retried whatever kind the transport assigned",
  );
  assert.equal(
    await never(timeout(2048)),
    1,
    "bytes already arrived: the call may have billed",
  );
  assert.equal(await never(Error("not a transport error")), 1);
  assert.deepEqual(
    clock.delays,
    [],
    "no backoff is waited for a terminal failure",
  );

  assert.equal(
    isRetryableTransportError(new TransportError("rate_limited", "", 429)),
    true,
  );
  assert.equal(
    isRetryableTransportError(new TransportError("server", "", 503)),
    true,
  );
  assert.equal(
    isRetryableTransportError(timeout()),
    true,
    "no byte count means none arrived",
  );
  assert.equal(isRetryableTransportError(timeout(1)), false);
  assert.equal(
    isRetryableTransportError(new TransportError("unknown", "")),
    false,
  );
  assert.equal(timeoutBeforeAnyBytes(timeout(0)), true);
  assert.equal(timeoutBeforeAnyBytes(new TransportError("server", "")), false);

  const custom = recorder();
  let calls = 0;
  const { attempts } = await withRetry(
    async () => {
      calls += 1;
      if (calls < 2) throw Error("transient in this caller's opinion");
      return calls;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 5,
      jitterMs: 0,
      sleep: custom.sleep,
      random: custom.random,
      isRetryable: (error) =>
        error instanceof Error && error.message.includes("transient"),
    },
  );
  assert.equal(
    attempts,
    2,
    "isRetryable overrides the default transport policy",
  );
});

test("The ledger admits a second attempt only once the previous one is closed", async () => {
  const d = await freshDatabase();
  const previous = process.env.YTI_BUDGET_USD;
  process.env.YTI_BUDGET_USD = "2";
  try {
    const run = await store.create("ledger-video", "model", {}, "v1");
    const first = await store.reserve(run.id, "synthesis", 0.4);
    await assert.rejects(
      () => store.reserve(run.id, "synthesis", 0.4, 2),
      /uncertain/,
      "an open reservation blocks a second attempt for the same stage",
    );
    await store.settle(first, null, { note: "unknown outcome" });
    await assert.rejects(
      () => store.reserve(run.id, "synthesis", 0.4, 2),
      /uncertain/,
      "an unknown outcome is still open and still blocks",
    );
    await store.settle(first, 0.05, { usage: { prompt_tokens: 10 } });
    const second = await store.reserve(run.id, "synthesis", 0.4, 2);
    assert.notEqual(second, first);
    await store.release(second, "timeout before any bytes");
    const released = (await d
      .prepare("SELECT status, amount, metrics FROM yi_calls WHERE id=?")
      .get(second)) as { status: string; amount: number; metrics: string };
    assert.equal(released.status, "released");
    assert.equal(
      Number(released.amount),
      0,
      "a released reservation holds no money",
    );
    assert.match(
      String(JSON.parse(released.metrics).release.reason),
      /timeout/,
    );
    const third = await store.reserve(run.id, "synthesis", 0.4, 3);
    const attempts = await store.listAttempts(run.id, "synthesis");
    assert.deepEqual(
      attempts.map((a) => [a.attempt, a.status]),
      [
        [1, "completed"],
        [2, "released"],
        [3, "reserved"],
      ],
      "every attempt keeps its own row, keyed by (run, stage, attempt)",
    );
    assert.deepEqual(
      attempts.map((a) => a.id),
      [first, second, third],
    );
    assert.equal(attempts[0]!.amount, 0.05);
    assert.deepEqual(
      (attempts[0]!.metrics as { usage: { prompt_tokens: number } }).usage,
      { prompt_tokens: 10 },
      "settle keeps its signature and its metrics payload",
    );
    // A released row is ignored by the run cost even if it still carried money.
    await d.prepare("UPDATE yi_calls SET amount=? WHERE id=?").run(9, second);
    await store.settle(third, 0.02, {});
    assert.equal(
      Number((await store.get(run.id))!.cost),
      0.07,
      "recomputed run cost is the completed and open rows only",
    );
    const other = await store.reserve(run.id, "critique-0", 0.1);
    assert.equal((await store.listAttempts(run.id, "critique-0")).length, 1);
    await store.release(other, "run abandoned");
    assert.equal(Number((await store.get(run.id))!.cost), 0.07);
    process.env.YTI_BUDGET_USD = "0.1";
    await assert.rejects(
      () => store.reserve(run.id, "transcribe", 1),
      /budget/,
      "the budget cap still refuses a reservation beyond the limit",
    );
  } finally {
    if (previous === undefined) delete process.env.YTI_BUDGET_USD;
    else process.env.YTI_BUDGET_USD = previous;
  }
});

test("The attempt column is indexed and defaults to the first attempt", async () => {
  const d = await freshDatabase();
  const run = await store.create("ledger-index", "model", {}, "v1");
  const id = await store.reserve(run.id, "synthesis", 0.1);
  const row = (await d
    .prepare("SELECT attempt FROM yi_calls WHERE id=?")
    .get(id)) as {
    attempt: number;
  };
  assert.equal(Number(row.attempt), 1, "reserve() defaults to attempt 1");
  const index = await d
    .prepare("SELECT indexname FROM pg_indexes WHERE indexname=?")
    .get("yi_calls_run_stage_attempt");
  assert.ok(index, "an index covers (run_id, stage, attempt)");
});
