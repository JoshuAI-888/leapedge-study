# Reproduction and reconciliation

Node24.18.0, pinned `@google/genai`2.22.0, TypeScript6.0.3 and Zod4.5.4. Baseline `32a65994dcdd31f1e2caf1e86db2afaa75549c7b`; implementation and evidence are under draft PR46. No new dependencies or migrations. Run commands from the repository root. Default experiment/report planning is offline; none of the commands below starts a scheduler or changes production settings.

## Keyless checks

```sh
npm ci --ignore-scripts
node --experimental-strip-types --test tests/batch.test.ts tests/gemini-batch-*.test.ts
npm test
YTI_DB=pglite npm test
npm run typecheck
npm run build
node --experimental-strip-types scripts/promotion-gate.ts --offline
npm audit --omit=dev
node --experimental-strip-types scripts/gemini-batch-experiment.ts
```

The offline promotion diagnostic reports `advisory-only`, binding.total 0. It measures no independent accuracy and cannot justify promotion. UI/browser acceptance is not claimed: no interface was changed and there was no reviewed live publication to inspect.

Use **fresh isolated local Postgres databases** for the three existing/new reliability commands, migrate each first, and never point them at production. The checks intentionally create test holds, contention and expired leases; those are separate from the live experiment ledger.

```sh
# Configure DATABASE_URL and DATABASE_URL_UNPOOLED to the same isolated local DB.
# Preserve current lower budget limits. No provider key is needed for these checks.
YTI_ISOLATED_DB=true node --experimental-strip-types scripts/migrate.ts
YTI_ISOLATED_DB=true node --experimental-strip-types scripts/postgres-check.ts
# Use another fresh migrated database for each following command:
YTI_ISOLATED_DB=true node --experimental-strip-types scripts/audited-postgres-check.ts
YTI_ISOLATED_DB=true node --experimental-strip-types scripts/gemini-batch-postgres-check.ts
```

The last command kills a child worker after **mocked** provider acceptance, verifies a reclaimed lease on a different connection/process, rejects the stale owner, refuses uncertain resubmission, and admits one intent from eight concurrent submissions. It never contacts Google. PGlite checks are additional coverage, not proof of these production SQL locking semantics.

## Frozen sources

The private source file used here was the saved12 October source-atoms campaign, available locally outside this checkout. It contains three public-video caption sources, original prompt snapshots, settings, metadata and hashes. Raw source/request/response exports stay in ignored `data/`; do not commit them. `corpus-plan.json` lists the exact video, source and prompt identities. `digest` means SHA256 over JSON.stringify of the parsed value; documentation hashes cover retrieved Markdown.

```sh
node --experimental-strip-types scripts/gemini-batch-experiment.ts \
  --action prepare --input /path/to/saved-campaign.json \
  --output data/gemini-batch/corpus.json
node --experimental-strip-types scripts/gemini-batch-experiment.ts \
  --corpus data/gemini-batch/corpus.json
```

Prepare refuses to overwrite its destination. Keep the same campaign ID across every arm/audit so the normal billing ledger enforces the shared $5 cap. Do not generate a new campaign or recreate the DB to bypass existing commitments. Inputs not available to another checkout must be supplied by the data owner with matching hashes; deterministic tests still run without them. No fabricated captions or independent references are substituted.

## Explicit live arms

Live writes require `--live`, `YTI_ISOLATED_DB=true`, a persistent localhost database pair, a credential from a trusted local environment file, current budget headroom and a new exclusive manifest path. The driver pauses the queue and disables email/cron **in its process**, retains existing lower limits, uses the current ledger plus a campaign marker, and caps an arm at$0.50 or the lower configured amount. A source hash mismatch or conservative maximum above the cap fails before generation. No production configuration is updated.

For this completed campaign the local Postgres data directory is `data/gemini-batch-postgres`, port55439, DB `gemini_batch`. Start it if needed with `pg_ctl -D data/gemini-batch-postgres -l data/gemini-batch/postgres.log -o '-h 127.0.0.1 -p 55439' start`; do not initialize it again. Its manually driven test runs are parked and their automatic analysis jobs disabled in one transaction, so a normal worker cannot claim them. Existing campaign jobs were fenced the same way before backup; the local server was then stopped. Credentials are not stored there or in committed artifacts. Load them from the trusted file when provider access is needed. The older source environment/database was not modified.

```sh
# Existing credentials/limits are supplied by a trusted --env-file; no key literal.
# Set both DATABASE_URL* to the isolated local experiment database before running.
node --env-file=/path/to/trusted.env --experimental-strip-types \
  scripts/gemini-batch-experiment.ts --action run --live \
  --corpus data/gemini-batch/corpus.json --kind text --mode immediate \
  --video Mepjkm_0ns4 --output data/gemini-batch/new-control.json
# Text Batch uses --mode batch and a different exclusive manifest.
# Media uses --kind media, always static 0–30s in this harness.
```

Those are reproduction examples, **not instructions to repeat this campaign's rejected media request or spend beyond remaining authorization**. B was stopped on HTTP400 and no file-upload workaround was authorized. Existing manifests must never be deleted to re-enable paid work. If a run crashes, inspect the manifest/run/attempt/provider identity; `submitting` or `uncertain` is not retry permission. SDK retries are one attempt. A credential/quota failure stops that branch.

## Poll or export existing work, with no new paid submission

```sh
node --env-file=/path/to/trusted.env --experimental-strip-types \
  scripts/gemini-batch-experiment.ts --action poll --live \
  --output data/gemini-batch/C-planet-batch.json
# Analogous manifests: C-tmobile-batch.json and C-palantir-batch.json.
node --experimental-strip-types scripts/gemini-batch-experiment.ts \
  --action export --live --output data/gemini-batch/C-planet-batch.json
```

`poll` calls only get on the persisted provider name and validates retained output. `export` reads only the existing ledger. Neither calls submit/model generation. Poll once per bounded invocation, do independent work, and back off; do not wait indefinitely. All three text jobs completed in this campaign, with no open live holds. Their durable names remain:

- Planet: `batches/ioet55114ol9q3lkbtokocb23spq9pw4hceq`
- T-Mobile: `batches/1nxo41htcserzdnlay6yehfeyotzkuldafne`
- Palantir: `batches/wa8tv06u82xpdv1wv82kvo5blmbplrfzpv8u`

A missing provider name requires read-only list/display-name reconciliation by an operator before attaching a confirmed identity to the existing intent; the harness intentionally cannot invent that association. Uncertain charges remain reserved and generic synchronous reconciliation excludes them. Cancel/delete require a separate deliberate operation; neither is used here. Preserve intent, raw/normalized outputs, source/prompt/model identity and unknown commitments during rollback.

Independent diagnostic audit uses existing faithful instructions/schema, cross-family check and billing ledger:

```sh
node --env-file=/path/to/trusted.env --experimental-strip-types \
  scripts/gemini-batch-audit.ts --live --corpus data/gemini-batch/corpus.json \
  --input data/gemini-batch/C-planet-immediate.json \
  --output data/gemini-batch/new-audit.json
```

The executed attempt stopped401 because the independent critic key expired. Do not rerun without restoring that prerequisite and accounting for remaining spend. It is a diagnostic critique of extracted clauses, not the entire publication pipeline or a human review.

## Export metrics

```sh
node --experimental-strip-types scripts/gemini-batch-report.ts \
  --input data/gemini-batch --corpus data/gemini-batch/corpus.json \
  --output docs/experiments/gemini-batch-20261021/results/benchmark.json
# Optional historical attribution uses private saved call/run exports:
# --historical-calls /path/to/ours-final-calls.json
# --historical-runs /path/to/ours-final-export.json
```

Exporter writes JSON and CSV, rejects incomparable paired source/prompt/schema/payload/model hashes, separates commitments and token-price estimates, and labels historical/scaling calculations. Missing inputs/usage/accuracy are null, never zero cost or verified accuracy. Full local ledger backup should remain ignored/private; saved summaries are enough for review but not permission to drop provider receipts or source evidence.
