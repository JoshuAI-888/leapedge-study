# Durable benchmark controller — isolated database verification complete

`scripts/run-cohort-durable.mjs` is separate from the currently running in-memory candidate. It has now been exercised against isolated local PostgreSQL with fake transport and blocked fetch; no paid provider was contacted. Importing its helper functions performs no network, database or provider activity.

Start explicitly with Node 24:

```sh
node --experimental-strip-types scripts/run-cohort-durable.mjs --live --id candidate_b --input data/readiness-20260927/frozen-cohort.json --output data/readiness-20260927/candidate-b-session-1.json --runtime-env '/Users/joshmini/Library/Application Support/YouTube Intelligence/.env.live' --max-usd 25
```

This command can incur paid usage; it is documentation, not evidence of execution. A new database is created only under the validated prefix `yti_perf_readiness_` on the existing 127.0.0.1 cluster. It never processes the production database. The user-supplied cost ceiling is installed as the dedicated database's monthly/per-video reservation limits.

SIGINT or SIGTERM requests a pause after the current stage settles and checkpoints; it does not cancel already-started provider work. Resume with identical code, input, settings, identifier and cost ceiling, `--resume`, and a **new** output path. The controller rejects changed identity, concurrent controllers, unknown/reserved calls requiring reconciliation, and attempts to overwrite old evidence. A code change needs a new experiment rather than silently modifying the old timing trial.

Durable state includes all case statuses, run IDs, settings/source/code hashes, sessions, failures, stage timing, paid responses and ledgers. Admission recovery searches stable benchmark tags before creating a run, including completed runs. Original economic context is frozen in a temporary runtime view; durable run creation timestamps remain actual wall-clock time. External search, model calls and total settled ledger charges are separated. The cumulative snapshot is never a delta to add to another snapshot.

Verification completed: three pure helper tests (identity mismatch, database naming, separate accounting), syntax check, repository typecheck, and four isolated PostgreSQL scenarios using `scripts/check-durable-benchmark.mjs`:

- Interruption after admission but before storing the case/run mapping: resume finds the existing tagged run.
- Interruption after a fake paid response but before the stage checkpoint: resume reuses the retained response.
- SIGTERM at a completed checkpoint: pause, close database connection, and explicit resume.
- SIGTERM while a fake model call is in flight: drain its response and checkpoint before pausing, then resume.

Every scenario finished with one source run and exactly one synthesis call. Original recovery flags were stripped. The research snapshot retained the frozen January 3 analysis cutoff while durable run creation timestamps remained September 26 wall-clock time. Fixture research intentionally contains no usable final sentences and correctly ends `needs_review`; finishing a controller is not a research-quality pass. Actual provider spend was **US$0**; the recorded US$0.06 per scenario is synthetic fixture ledger cost. Evidence: `durable-benchmark-validation-20260927.json`; private exports under `data/readiness-20260927/durable-check-4/`.

The interruption hooks simulate crash boundaries and close/reopen database connections; they do not prove operating-system SIGKILL behavior during PostgreSQL commit. Unknown paid outcomes remain deliberately blocked for reconciliation. This verification does not establish live-provider throughput or paid-provider cancellation behavior.
