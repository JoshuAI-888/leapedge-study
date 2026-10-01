# Worker admission and fatal-account validation — 20 September 2026

Scope: optimisation 4 (worker admission/capacity) and 7 (stop untouched chunks after fatal account failures). No production data, worker settings, provider calls or LeapEdge submissions are changed by this validation.

## Worker finding and repair

The previous capacity benchmark used an immediate rolling harness, while the installed worker waited for **all** active promises or its 1.5-second polling timer, then slept another 250 ms. A fast completed slot could therefore sit idle behind a slow sibling. The new worker waits for the first completed slot. Empty queue responses and worker errors retain a 250 ms backoff; shutdown still drains every started stage. Capacity remains controlled by the existing team preference and database queue claim limits. No model, prompt, input, evidence, audit or publication threshold is changed.

A new behavioral test failed against the old all-settled waiting behavior (`false !== true`: admission did not wake while a slow sibling remained running), then passed after the repair. Tests also cover an empty window, polling without cancelling started work, and waking on a rejected sibling without abandoning other work.

## Measurements

### Fatal admission fixture

Command: `node --experimental-strip-types scripts/fatal-admission-benchmark.ts`. Retained raw result: `data/optimization-20260920/fatal-admission.json`.

| Measure | Before: continue admission | After: fatal admission stop |
|---|---:|---:|
| Input items / concurrency | 100 / 3 | 100 / 3 |
| Fixture requests started | 100 | 3 |
| Untouched items, explicitly marked not started | 0 | 97 |
| Successful responses retained | 99 | 2 |
| Fixture duration, seconds | 0.199530 | 0.005819 |
| Paid API spend | $0 | $0 |

The response count changes because 97 items were never requested after item 0 returned typed HTTP 402. Both already-started successful sibling responses were preserved exactly. A separate healthy run processes all 100 items in both modes and compares every output object exactly: identical. This measures unnecessary attempts avoided, **not** dollars saved or live provider latency. Existing code already implemented the stop behavior; this pass validates it rather than claiming it is newly added. Typed HTTP 401/402/403 stop admission; 429 and untyped message strings do not. Started siblings drain before control returns.

### Actual worker admission loop on isolated PostgreSQL

The bounded benchmark completed successfully in separate disposable local PostgreSQL databases; both databases were dropped afterward. The committed `scripts/worker-admission-benchmark.mjs` runs 100 four-stage fixed-delay fixture jobs at the same capacity of 3, comparing the former worker loop with the repaired loop. It requires an explicitly isolated, migrated localhost `yti_perf_` database. The orchestrating local script creates and drops separate databases and does not change production. The output check requires all 100 runs completed and each final checkpoint counter equal to 4. This tests scheduling and checkpoint preservation, not model output quality or provider quotas. It excludes production scheduler sweeps.

| Measure, capacity fixed at 3 | Former worker loop | First-completion refill |
|---|---:|---:|
| 100-job batch duration, seconds | 124.107914 | 36.463460 |
| Manual-priority fixture completion, seconds | 1.923388 | 0.452955 |
| Peak simultaneous stage executions | 3 | 3 |
| Completed runs with all four checkpoints | 100 / 100 | 100 / 100 |
| Paid API spend | $0 | $0 |

Batch duration fell **70.62%** and the prioritized fixture's completion time fell **76.45%** in this single fixed-delay trial. These numbers apply to worker scheduling under the stated fixture, not live model throughput. The earlier capacity-1 versus capacity-3 measurement is a different comparison and must not be combined with this result. Raw results: `data/optimization-20260920/admission-before.json`, `admission-after.json`, and `admission-ab.log`.

Targeted default and PGlite suites each pass eight tests, with the separately gated real PostgreSQL restart test skipped in those commands. The actual PostgreSQL benchmark above verifies 100 completed outputs and four checkpoints per output in each arm; repository-wide verification and the real PostgreSQL restart/lease suite remain the integration owner's release checks.


## Deployment checks

1. Run full repository checks and real PostgreSQL concurrency/restart verification before merging.
2. Drain the Mac worker before replacing its installed source/build. Preserve its database, credentials, processing capacity, queue pause state and rollback copy.
3. Copy the new `scripts/worker.ts` **and** `src/server/youtube-intelligence/worker-admission.ts`; restarting only the web app does not deploy the worker change.
4. Restart the persistent worker; verify revision, fresh heartbeat, configured capacity and no stale running leases. A paused queue should remain paused unless deliberately enabled.
5. Vercel deploys the web/API. It does not run this always-on worker. Verify the Vercel production revision separately; do not equate a successful preview with production deployment.
6. Retain before/after fixture reports. For live output-quality comparison use frozen sources/settings and preserved citations; the scheduling fixture alone cannot establish semantic equivalence of nondeterministic model responses.

## Extraction pipeline integration verification

`tests/fatal-extraction.test.ts` exercises the real worker `processNext` → extraction `step` → `modelCall` ledger path with an injected transport. A typed HTTP 402 from chunk 1 arrives before chunk 0 finishes. The run is saved as failed at synthesis before any draft is applied or published; chunks 2 and 3 have neither a request nor a reservation. Chunk 0 drains and its exact normalized response and $0.02 fixture ledger charge remain retained. After explicit account-repaired stage replay, all four chunks reach the independent critique boundary; chunk 0 still has exactly one request/settled attempt, chunk 1 has one released rejection plus one successful retry, and chunks 2 and 3 each have one call. Original source evidence is unchanged. This is controlled replay verification, not a claim that failed jobs automatically retry. The integration test passes in the default and explicit PGlite invocations; no provider calls or real charges occur.
