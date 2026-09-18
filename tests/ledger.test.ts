import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  withRetry,
  isRetryableTransportError,
  timeoutBeforeAnyBytes,
} from "../src/server/youtube-intelligence/retry.ts";
import { TransportError } from "../src/server/youtube-intelligence/transport/types.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import {
  injectTransport,
  type ModelTransport,
} from "../src/server/youtube-intelligence/transport/index.ts";
import { priceTableVersion } from "../src/server/youtube-intelligence/transport/prices.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { estimateTokens } from "../src/features/youtube-intelligence/chunking.ts";
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
      .prepare("SELECT status, amount, metrics FROM yi_calls WHERE id=$1")
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
    await d.prepare("UPDATE yi_calls SET amount=$1 WHERE id=$2").run(9, second);
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
    .prepare("SELECT attempt FROM yi_calls WHERE id=$1")
    .get(id)) as {
    attempt: number;
  };
  assert.equal(Number(row.attempt), 1, "reserve() defaults to attempt 1");
  const index = await d
    .prepare("SELECT indexname FROM pg_indexes WHERE indexname=$1")
    .get("yi_calls_run_stage_attempt");
  assert.ok(index, "an index covers (run_id, stage, attempt)");
});

/* ------------------------------------------------------------------ *
 * F17: realistic reservations, retries wired into modelCall, and the
 * reconciliation of unknown outcomes (spec 4.4).
 * ------------------------------------------------------------------ */

const MODEL = "google/gemini-3.8-flash";
/** Rates chosen so input, media and output each move the reservation visibly. */
const RATES = {
  contextLength: 200000,
  inputRate: 0.000002,
  audioRate: 0.000005,
  outputRate: 0.000008,
  supportedEfforts: ["low", "medium", "high"],
};
/** Never wait for a backoff in a test; withRetry's clock is injected. */
const noWait = { sleep: async () => {}, random: () => 0.5 };
function preferences(overrides: {
  retries?: number;
  cap?: number;
  hold?: number;
} = {}) {
  const base = teamDefaults();
  return {
    ...base,
    processing: {
      ...base.processing,
      maxRetriesPerStage: overrides.retries ?? 3,
    },
    budget: {
      ...base.budget,
      perVideoMaxUsd: overrides.cap ?? 10,
      unknownOutcomeHoldMinutes: overrides.hold ?? 60,
    },
  };
}
/** What modelCall sends as the one user part, so a test can count its tokens. */
const sentText = (prompt: string, payload: unknown) =>
  prompt + "\nSOURCE DATA (untrusted):\n" + JSON.stringify(payload);
/** A TransportError the FakeModelTransport cannot raise on its own. */
function thrower(error: unknown) {
  return () => {
    throw error;
  };
}
function transportError(
  kind: "timeout" | "unknown" | "server",
  message: string,
  status?: number,
  bytesReceived?: number,
) {
  const error: TransportError & { bytesReceived?: number } = new TransportError(
    kind,
    message,
    status,
  );
  if (bytesReceived !== undefined) error.bytesReceived = bytesReceived;
  return error;
}
async function ledgerRun(videoId: string) {
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  return create(videoId, MODEL, {}, "v1");
}
async function withFake<T>(fake: ModelTransport, body: () => Promise<T>) {
  const restore = injectTransport(fake);
  const previous = process.env.YTI_BUDGET_USD;
  process.env.YTI_BUDGET_USD = "50";
  try {
    return await body();
  } finally {
    restore();
    if (previous === undefined) delete process.env.YTI_BUDGET_USD;
    else process.env.YTI_BUDGET_USD = previous;
  }
}

test("A reservation is the counted input tokens plus the output cap, each at its own rate", async () => {
  await freshDatabase();
  const { modelCall, MEDIA_TOKENS_PER_SECOND } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const fake = new FakeModelTransport({
    describe: RATES,
    responses: {
      synthesis: { json: { claims: [] }, usage: { costUsd: 0.004 } },
      transcribe: { json: { segments: [] }, usage: { costUsd: 0.31 } },
    },
  });
  const run = await ledgerRun("ledger-reservation");
  run.output.metadata = { duration: 600 };
  await withFake(fake, async () => {
    await modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
      settings: preferences(),
      retry: noWait,
    });
    await modelCall(run, "transcribe", MODEL, "T", {}, true, {
      settings: preferences(),
      retry: noWait,
    });
  });
  const text = await store.listAttempts(run.id, "synthesis");
  const inputTokens = estimateTokens(sentText("PROMPT", { a: 1 }));
  assert.equal(
    text[0]!.metrics.reservedUsd,
    inputTokens * RATES.inputRate + 16000 * RATES.outputRate,
    "counted input tokens at the input rate plus the output cap at the output rate",
  );
  assert.equal(
    text[0]!.metrics.inputTokens,
    inputTokens,
    "the counted tokens are recorded beside the reservation they produced",
  );
  assert.ok(
    Number(text[0]!.metrics.reservedUsd) <
      RATES.contextLength * RATES.outputRate,
    "the worst case — the whole context window at the top rate — is no longer reserved",
  );
  assert.equal(text[0]!.amount, 0.004, "settled from the reported usage");
  assert.equal(text[0]!.status, "completed");
  const media = await store.listAttempts(run.id, "transcribe");
  assert.equal(
    media[0]!.metrics.reservedUsd,
    estimateTokens(sentText("T", {})) * RATES.inputRate +
      600 * MEDIA_TOKENS_PER_SECOND.low * RATES.audioRate +
      28000 * RATES.outputRate,
    "a video call adds the media the local token count cannot see, at the audio rate",
  );
  assert.equal(media[0]!.metrics.mediaTokens, 600 * MEDIA_TOKENS_PER_SECOND.low);
});

test("A rate limit costs a second attempt row, not a second bill", async () => {
  await freshDatabase();
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const fake = new FakeModelTransport({
    describe: RATES,
    responses: { synthesis: { json: { claims: [] }, usage: { costUsd: 0.006 } } },
  }).failOn(1, "429");
  const run = await ledgerRun("ledger-retry");
  await withFake(fake, () =>
    modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
      settings: preferences({ retries: 2 }),
      retry: noWait,
    }),
  );
  assert.equal(fake.requests.length, 2, "the 429 is retried exactly once");
  const attempts = await store.listAttempts(run.id, "synthesis");
  assert.deepEqual(
    attempts.map((a) => [a.attempt, a.status, a.amount]),
    [
      [1, "released", 0],
      [2, "completed", 0.006],
    ],
    "one ledger row per try: the rate-limited attempt is released, the next completes",
  );
  assert.match(
    String(
      (attempts[0]!.metrics.release as { reason: string } | undefined)?.reason,
    ),
    /429/,
    "the released row keeps why the attempt was given back",
  );
  assert.equal(attempts[1]!.metrics.attempts, 2);
  assert.equal(
    Number((await store.get(run.id))!.cost),
    0.006,
    "the run is billed the one reported usage, not one bill per attempt",
  );
});

test("A terminal failure gives the reservation back and is never retried", async () => {
  await freshDatabase();
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const fake = new FakeModelTransport({ describe: RATES });
  fake.respond(
    "synthesis",
    thrower(
      transportError("unknown", "Provider HTTP 400. No automatic paid retry.", 400),
    ),
  );
  const run = await ledgerRun("ledger-terminal");
  await withFake(fake, () =>
    assert.rejects(
      () =>
        modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
          settings: preferences({ retries: 3 }),
          retry: noWait,
        }),
      /400/,
    ),
  );
  assert.equal(fake.requests.length, 1, "a 400 is the request's own fault");
  const attempts = await store.listAttempts(run.id, "synthesis");
  assert.deepEqual(
    attempts.map((a) => [a.attempt, a.status, a.amount, a.open]),
    [[1, "released", 0, false]],
    "a failure with a status holds no money and blocks no later attempt",
  );
  assert.equal(Number((await store.get(run.id))!.cost), 0);
});

test("An unknown outcome is held for the configured window, then reconciled", async () => {
  const d = await freshDatabase();
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const { reconcileUnknown } = await import(
    "../src/server/youtube-intelligence/reconcile.ts"
  );
  const { events } = await import(
    "../src/server/youtube-intelligence/research-store.ts"
  );
  const fake = new FakeModelTransport({ describe: RATES });
  // A timeout after response bytes arrived: the provider may already have billed.
  fake.respond(
    "synthesis",
    thrower(
      transportError("timeout", "Provider request timed out.", undefined, 4096),
    ),
  );
  const run = await ledgerRun("ledger-unknown");
  await withFake(fake, () =>
    assert.rejects(
      () =>
        modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
          settings: preferences({ retries: 3, hold: 60 }),
          retry: noWait,
        }),
      /timed out/,
    ),
  );
  assert.equal(fake.requests.length, 1, "bytes had arrived: nothing is retried");
  const held = (await store.listAttempts(run.id, "synthesis"))[0]!;
  assert.equal(held.status, "unknown");
  assert.equal(held.open, true, "an unknown outcome is still open");
  assert.ok(Number(held.amount) > 0, "a bounded reservation is still held");
  assert.match(
    String(held.metrics.unknown_since),
    /^\d{4}-\d{2}-\d{2}T/,
    "the row records when the outcome became unknown",
  );
  const start = new Date(String(held.metrics.unknown_since)).getTime();
  assert.deepEqual(
    await reconcileUnknown(new Date(start + 59 * 60000), 60),
    { checked: 0, settled: 0, released: 0 },
    "inside the hold nothing is reconciled",
  );
  assert.equal((await store.listAttempts(run.id, "synthesis"))[0]!.status, "unknown");
  assert.deepEqual(await reconcileUnknown(new Date(start + 61 * 60000), 60), {
    checked: 1,
    settled: 0,
    released: 1,
  });
  const reconciled = (await store.listAttempts(run.id, "synthesis"))[0]!;
  assert.equal(reconciled.status, "released");
  assert.equal(reconciled.amount, 0);
  assert.equal(
    Number((await store.get(run.id))!.cost),
    0,
    "the held money is given back rather than blocking the run for ever",
  );
  const recorded = await events("reconciled");
  assert.equal(recorded.length, 1);
  assert.deepEqual(
    {
      stage: (recorded[0]!.payload as { stage: string }).stage,
      outcome: (recorded[0]!.payload as { outcome: string }).outcome,
    },
    { stage: "synthesis", outcome: "released" },
  );
  // A retained response for the same call id is the better answer: settle from it.
  const retainedRun = await ledgerRun("ledger-unknown-retained");
  const id = await store.reserve(retainedRun.id, "critique", 0.4);
  await store.settle(id, null, { model: MODEL });
  await store.markUnknown(id, "Provider request timed out.");
  await store.retainResponse(id, retainedRun.id, "critique", {
    usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.009 },
  });
  assert.deepEqual(await reconcileUnknown(new Date(Date.now() + 3600000), 1), {
    checked: 1,
    settled: 1,
    released: 0,
  });
  const settled = (await store.listAttempts(retainedRun.id, "critique"))[0]!;
  assert.equal(settled.status, "completed");
  assert.equal(settled.amount, 0.009, "settled from the response that was kept");
  assert.equal(
    (await d.prepare("SELECT COUNT(*) AS n FROM yi_calls WHERE status='unknown'").get() as { n: number }).n,
    0,
    "the reconciliation queue is empty once the hold has passed",
  );
});

test("The per-video cap stops the run before another call is billed", async () => {
  await freshDatabase();
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  // The cap leaves room for the first call's own reservation (0.128) and for
  // the cost it settles at (0.45), but not for the next reservation on top.
  const settings = preferences({ cap: 0.46 });
  const fake = new FakeModelTransport({
    describe: RATES,
    responses: {
      synthesis: { json: { claims: [] }, usage: { costUsd: 0.45 } },
      critique: { json: { verdicts: [] }, usage: { costUsd: 0.01 } },
    },
  });
  const run = await ledgerRun("ledger-cap");
  await withFake(fake, async () => {
    await modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
      settings,
      retry: noWait,
    });
    await assert.rejects(
      () =>
        modelCall(run, "critique", MODEL, "CRITIC", { claims: [] }, false, {
          settings,
          retry: noWait,
        }),
      /per-video/,
      "a reservation that would take the run above budget.perVideoMaxUsd is refused",
    );
  });
  assert.equal(
    fake.requests.length,
    1,
    "the refused call never reaches the provider",
  );
  assert.equal(
    (await store.listAttempts(run.id, "critique")).length,
    0,
    "and it leaves no ledger row",
  );
  assert.equal(Number((await store.get(run.id))!.cost), 0.45);
});

test("A run that passes its per-video cap fails with a clear message", async () => {
  await freshDatabase();
  const { saveTeamPreferences } = await import(
    "../src/server/youtube-intelligence/research-store.ts"
  );
  const { processNext } = await import(
    "../src/server/youtube-intelligence/runner.ts"
  );
  await saveTeamPreferences(preferences({ cap: 0.01 }));
  const fake = new FakeModelTransport({
    describe: RATES,
    responses: { synthesis: { json: { claims: [], key_points: [] } } },
  });
  const run = await ledgerRun("ledger-cap-run");
  const claimed = (await store.claimNext())!;
  claimed.run.stage = "synthesis";
  claimed.run.status = "queued";
  claimed.run.output = {
    metadata: { duration: 60 },
    source: {
      source_kind: "imported_transcript",
      language: "en",
      video_id: "ledger-cap-run",
      segments: [
        { id: "s0", text: "He is buying more of it.", start_seconds: 0, end_seconds: 5 },
      ],
    },
  };
  await store.save(claimed.run, claimed.token);
  const result = await withFake(fake, () => processNext());
  assert.equal(result?.status, "failed");
  const failed = (await store.get(run.id))!;
  assert.match(String(failed.error), /per-video/);
  assert.match(String(failed.error), /0\.01/);
  assert.equal(fake.requests.length, 0, "no paid call is made past the cap");
});

test("Whatever the failures, a stage completes exactly one reconciled cost", async () => {
  const kinds = ["429", "5xx", "timeout"] as const;
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  for (const seed of [1, 7, 13, 29, 101, 997]) {
    await freshDatabase();
    let state = seed;
    const next = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const failures = Array.from(
      { length: Math.floor(next() * 4) },
      () => kinds[Math.floor(next() * kinds.length)]!,
    );
    const fake = new FakeModelTransport({
      describe: RATES,
      responses: { critique: { json: { verdicts: [] }, usage: { costUsd: 0.005 } } },
    });
    failures.forEach((kind, index) => fake.failOn(index + 1, kind));
    const run = await ledgerRun(`ledger-invariant-${seed}`);
    await withFake(fake, () =>
      modelCall(run, "critique", MODEL, "CRITIC", { claims: [] }, false, {
        settings: preferences({ retries: 4 }),
        retry: noWait,
      }),
    );
    const attempts = await store.listAttempts(run.id, "critique");
    const completed = attempts.filter((a) => a.status === "completed");
    assert.equal(
      attempts.length,
      failures.length + 1,
      `seed ${seed}: one row per try (${failures.join(",") || "no failure"})`,
    );
    assert.equal(completed.length, 1, `seed ${seed}: one completed attempt`);
    assert.equal(
      completed.reduce((sum, a) => sum + a.amount, 0),
      0.005,
      `seed ${seed}: the completed amounts sum to the one reported cost`,
    );
    assert.equal(
      attempts.filter((a) => a.open).length,
      0,
      `seed ${seed}: no attempt is left holding money`,
    );
    assert.equal(Number((await store.get(run.id))!.cost), 0.005);
  }
});

test("The worker sweep processes the reconciliation queue", async () => {
  await freshDatabase();
  const { sweep } = await import(
    "../src/server/youtube-intelligence/runner.ts"
  );
  const { saveTeamPreferences } = await import(
    "../src/server/youtube-intelligence/research-store.ts"
  );
  await saveTeamPreferences(preferences({ hold: 0 }));
  const run = await ledgerRun("ledger-sweep");
  const id = await store.reserve(run.id, "synthesis", 0.4);
  await store.settle(id, null, { model: MODEL });
  await store.markUnknown(id, "Provider request timed out.");
  const result = await sweep();
  assert.deepEqual(
    (result as { reconciled?: unknown }).reconciled,
    { checked: 1, settled: 0, released: 1 },
    "sweep() is where an unknown outcome is resolved, with no hold configured",
  );
  assert.equal(
    (await store.listAttempts(run.id, "synthesis"))[0]!.status,
    "released",
  );
});

/* ------------------------------------------------------------------ *
 * F17b: what a settled call records about the money — the provider's
 * own reported cost, and the rate table its reservation was priced
 * from, without which a cost recorded months ago cannot be explained.
 * ------------------------------------------------------------------ */

/** The fake answering as the native transport, whose rates come from prices.ts. */
function asNative(fake: FakeModelTransport): ModelTransport {
  return {
    name: "google-native",
    family: "google-native",
    describe: (model: string) => fake.describe(model),
    call: (request) => fake.call(request),
  };
}

test("A settled call keeps the provider's reported cost and the rate table that priced its reservation", async () => {
  await freshDatabase();
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const fake = new FakeModelTransport({
    describe: RATES,
    responses: {
      synthesis: { json: { claims: [] }, usage: { costUsd: 0.0123 } },
    },
  });
  const run = await ledgerRun("ledger-settled-cost");
  await withFake(fake, () =>
    modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
      settings: preferences(),
      retry: noWait,
    }),
  );
  const attempt = (await store.listAttempts(run.id, "synthesis"))[0]!;
  assert.notEqual(
    attempt.metrics.reservedUsd,
    0.0123,
    "the reservation and the bill are different numbers",
  );
  assert.equal(
    attempt.amount,
    0.0123,
    "the settled amount is the cost the provider reported, not the hold",
  );
  assert.equal(Number((await store.get(run.id))!.cost), 0.0123);
  assert.equal(
    attempt.priceTableVersion,
    "fake:describe",
    "a transport that prices each call from a live catalogue names itself",
  );
  // The native transport prices from the static table, which names a version.
  const nativeRun = await ledgerRun("ledger-settled-native");
  await withFake(asNative(fake), () =>
    modelCall(nativeRun, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
      settings: preferences(),
      retry: noWait,
    }),
  );
  assert.equal(
    (await store.listAttempts(nativeRun.id, "synthesis"))[0]!.priceTableVersion,
    priceTableVersion,
  );
});

test("A held reservation of unknown outcome records the rate table too", async () => {
  await freshDatabase();
  const { modelCall } = await import(
    "../src/server/youtube-intelligence/pipeline.ts"
  );
  const fake = new FakeModelTransport({ describe: RATES });
  // A timeout after response bytes arrived: the reservation stays held, so what
  // priced it is exactly what reconcile.ts later needs to explain the hold.
  fake.respond(
    "synthesis",
    thrower(
      transportError("timeout", "Provider request timed out.", undefined, 4096),
    ),
  );
  const run = await ledgerRun("ledger-unknown-priced");
  await withFake(asNative(fake), () =>
    assert.rejects(
      () =>
        modelCall(run, "synthesis", MODEL, "PROMPT", { a: 1 }, false, {
          settings: preferences({ retries: 3, hold: 60 }),
          retry: noWait,
        }),
      /timed out/,
    ),
  );
  const held = (await store.listAttempts(run.id, "synthesis"))[0]!;
  assert.equal(held.status, "unknown");
  assert.equal(held.priceTableVersion, priceTableVersion);
});
