# Migrations

Numbered SQL files, `NNNN_name.sql`, applied in version order by `run.ts`. The
runner records each file in `yi_migrations` (`version`, `name`, `applied_at`,
`checksum`) inside the same transaction that applies it, so a failed file leaves
nothing behind and the next run retries exactly that file. An applied file that
is edited afterwards fails the checksum check by version: add a new migration
instead of changing an old one.

Apply them with `npm run migrate`, which connects through
`DATABASE_URL_UNPOOLED`, the direct Neon endpoint, because it holds a
session-level advisory lock for the whole run. Tests apply the same files
through PGlite, so every migration is exercised offline before it reaches
Postgres. A database that already carries the baseline schema but no
`yi_migrations` row is stamped at version 1 rather than re-running `0001`.

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
applied with the queue paused and drained. Never alongside other work. Vercel has
no release phase: the build migrates while the previous deployment is still
serving and its in-flight workers are still writing, so a rewrite of a live
column has to happen when nothing is writing to it.

## Version skew

Code newer than the schema must fail fast: a deployment that expects a column the
database does not have stops rather than serving partial results. A schema newer
than the code is allowed and is the normal state during a deploy, which is why
migrations only ever add.
