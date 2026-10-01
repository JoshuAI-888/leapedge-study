# Open findings — 1 October 2026

Defects and loose ends found by reading the code, not by a feature plan. Each was
checked against `main` at `a988881`. The 18 September register this replaces, and
the deploy runbook written before launch, are kept on the branch
`archive/architecture-review-20260918`. Everything else from them is fixed on
`main` or no longer applies.

## Closed by this change

| Finding | What was wrong | Fix |
|---|---|---|
| Spend after a lost lease | `reserve()` took no lease token. A worker whose job lease lapsed mid-stage could still start a paid call after another worker had taken the run over. Ownership was checked only at the checkpoint after the call. | `processNext` runs every stage and handler under `holdingLease()`. Inside its transaction, `reserve()` calls `assertLeaseHeld()` and refuses with `Stale worker lease.` once the lease is gone. `settle()` is deliberately not fenced: a call already made cost what it cost. Tests: `tests/queue.test.ts`. |
| Benchmark figures counted missing values as zero | `summarizeScores` averaged a missing SPY or excess return as 0 and counted it in `beatsSpyRate`'s denominator. That pulled the figures toward a plausible zero. | Rows without a benchmark return are left out of those three figures. Each figure is `null` when no row has one. Test: `tests/research.test.ts`. |
| `int8` was a string live and a number in tests | node-postgres returned `count(*)` and BIGINT columns as strings, while PGlite returns numbers. Arithmetic that passed tests could go wrong in production. | One INT8 parser, shared by both drivers. It returns a number while the value is exact, and a BigInt beyond that. Test: `tests/connection.test.ts`. |
| Drain steps told you the pause flag was unread | `queue.ts` honours `YTI_QUEUE_PAUSED`, but `production-and-integration.md` said nothing read it and told you to disable the cron instead. | Doc corrected. |
| Ledger entries that were already merged | `cloudProcessing`, `newsReview`, `timing`, `pipelineV3` and `cleanup` (PR #14), and `jevPreScreen20260930` (PR #22), still said `in-review`. | Marked `merged`, with their PR numbers. |

## Still open

| # | Finding | Severity | Notes |
|---|---|---|---|
| 1 | A failed lease renewal is ignored, and losing the lease does not abort the provider call already in flight. | Low | `runner.ts` discards `renewJob`'s result. Spending is now fenced at `reserve()`, so the cost is at most the one call already started. The checkpoint then discards that call's result as a stale lease. Aborting it would need an `AbortSignal` threaded through each transport. |
| 2 | `instrument` documents are not migrated to the `instruments` table. | Low | Only tickers that appear in claims get filled, through the price refresh in `leaderboard.ts`. |
| 3 | `tests/connection.test.ts` checks that `useDirectConnection()` comes before the first top-level await, but not that a maintenance script calls it at all. | Low | `scripts/export-runs.ts` and other newer scripts don't call it. They mostly read. |
| 4 | The `leapedge`-mode metric context reads `yi_documents` of kind `settlement`, which nothing writes any more. | Info | No production code calls `loadMetricContext`. Product boards read the `settlements` table through `loadBoardSnapshot`. The registry's source label `yi_documents (kind = settlement)` describes only this Lab path. |

## Owed by a person

- **Rotate the Neon `neondb_owner` password.** It was exposed in a session transcript on 18 September, and the same database is still the live one. Rotating it doesn't change the host.
- **Set `GEMINI_API_KEY` and `EXA_API_KEY` on the `youtube-intelligence` Vercel project** (`current-state.md`).
- **Delete the duplicate `youtube-intel` project.**
- **`seed/leapedge.json` is still `placeholder: true`**, so `scripts/seed-channels.ts --production` refuses to run. Supply the list or decide to drop it.

## Branches

- `claude/gracious-allen-iunize` (PR #27, the workspace load fix) is current with `main` and merges cleanly.
- `codex/analysis-performance` is byte-identical to `main`'s PR #10, so it can be deleted.
