# Migrations

Numbered SQL files, `NNNN_name.sql` — four digits, an underscore, then a
lower-case name of letters, digits, underscores and dashes — applied in version
order by `run.ts`. The runner records each file in `yi_migrations` (`version`,
`name`, `applied_at`, `checksum`) inside the same transaction that applies it, so
a failed file leaves nothing behind and the next run retries exactly that file. An applied file that
is edited afterwards fails the checksum check by version: add a new migration
instead of changing an old one.

Apply them with `npm run migrate`, which connects through
`DATABASE_URL_UNPOOLED`, the direct Neon endpoint, because it holds a
session-level advisory lock for the whole run. Tests apply the same files
through PGlite, so every migration is exercised offline before it reaches
Postgres.

No serving code migrates and no serving code creates a table: not a running
instance, not `scripts/worker.ts`, not `scripts/postgres-check.ts`. Migrations
are applied by `npm run migrate` alone. Today that is run by hand; F22a wires it
into the Vercel build command, so a deploy migrates before its new functions go
live. A new database — a fresh Neon project, a restored backup, a new branch —
has to be migrated with `npm run migrate` against its direct endpoint before any
of them can use it, and every later migration has to be applied the same way.

A database that already carries the baseline schema but no `yi_migrations` row is
stamped at version 1 rather than re-running `0001`. The stamp trusts the presence
of `yi_runs` alone, so a database built by an older deployment that is missing
something `0001` declares keeps missing it, version 1 now being recorded as
applied: check a database restored or branched from an older schema against
`0001_baseline.sql` before migrating it.

A preview deployment refuses to migrate the production database: with
`VERCEL_ENV=preview` the runner compares the host of `DATABASE_URL_UNPOOLED`
against `YTI_PRODUCTION_DB_HOST` and stops when they match, or when
`YTI_PRODUCTION_DB_HOST` is unset and the production host therefore cannot be
ruled out. Only hosts are compared, and neither value is ever printed.

## Expand and contract

A migration only adds. New columns and tables arrive first, deployed code starts
writing them, and only once no deployed code reads the old column or table does a
later migration drop it. Nothing is renamed in place: add, backfill, switch the
readers, then drop.

## Type changes

A type change to an existing column ships in its own migration, alone, and is
applied with the queue paused and drained. Never alongside other work.

The reason is that nothing fences the old code off while the migration runs.
Vercel has no release phase: whether the migration is run by hand or by the
build command, the previous deployment is still serving and its in-flight
workers are still writing when the column changes underneath them. So a rewrite
of a live column has to happen at a moment when nothing is writing to it, which
is what `YTI_QUEUE_PAUSED=true` and a drained `yi_runs` buy.

## Version skew

Code newer than the schema must fail fast: a deployment that expects a column the
database does not have stops rather than serving partial results. A schema newer
than the code is allowed and is the normal state during a deploy, which is why
migrations only ever add. The runner follows the same rule: a version recorded as
applied with no file in this checkout is reported and skipped when it is newer
than every file here, and is an error only when it is older — which means the
file was deleted or renamed after being applied.
