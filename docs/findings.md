# Open findings

Things found while building, that are not yet fixed, with who owns each. It
exists because findings were living in workflow output files in an ephemeral
container and in chat messages — neither of which survives a session.

The build-item list (F01–F55) tracks **work planned**. This tracks **problems
found**. A finding leaves this file when it is fixed or when a decision is
recorded against it, not when it is mentioned somewhere.

Status as of 18 September 2026, after phase-2 wave 2a.

---

## Open — code

### 1. `reserve()` and `settle()` are not fenced by the claim token
**Owner:** F26 · **Severity:** high, this is the double-spend hole

Only `save(run, token)` checks the lease token. `reserve(runId, stage, amount,
attempt, perVideoCapUsd)` and `settle(id, amount, metrics)` in `store.ts` take
no token at all, so a worker whose lease has expired — and whose job another
dispatcher has since claimed — can still reserve and settle against it. Both
workers then pay the provider for the same stage.

This is open in the code today and is the reason wave 2b exists as its own
reviewed wave.

### 2. `instrument` documents were never migrated into the `instruments` table
**Owner:** F25 · **Severity:** medium

`0003_relational.sql` created the table. `scripts/migrate-documents.ts` has
branches for channels, transcripts, claims, mentions and evidence spans, and
none for instruments. Found by F24's verifier during the document-kind audit.

Same audit: **31 document kinds** exist, and three of them — `instrument`,
`review`, `prices` — share a name with a table. Anything walking kinds and
tables together needs to keep them apart deliberately.

### 3. Thirteen scripts open the database without `useDirectConnection()`
**Owner:** unassigned · **Severity:** medium, and it is latent until they run
against Neon

`completion-cohort`, `completion-live-events`, `email-smoke`, `evaluate`,
`export-runs`, `prepare-institutional-fixtures`, `queue-coverage-test`,
`run-window`, `save-completion-research`, `save-institutional-research`,
`save-native-google-research`, `seed-evaluation`, `smoke-entity-classification`.

Each imports `store.ts` or `database.ts` and queries without choosing the direct
endpoint. Through Neon's pooled endpoint, session-scoped work — DDL, session
locks, `SET`, temp tables — is **discarded without raising an error**, so such a
script can report success and have changed nothing.

`tests/connection.test.ts` now derives its check from `scripts/`, but only
asserts ordering for scripts that already call `useDirectConnection`. It does
not yet require that every database-touching script calls it, because thirteen
would fail today.

### 4. Two hosted-check scripts call `shareSelection` with the wrong shape
**Owner:** unassigned · **Severity:** low, pre-existing

`scripts/hosted-check.ts:82` and `scripts/completion-hosted-check.ts:82` pass a
filter object; `shareSelection` has required an array of `{runId, claimId}`
since before the API was restructured. Both call sites are annotated saying so.
Fixing it needs a real accepted claim from the deployment under test, which
neither script currently fetches — so it was left rather than guessed at.

### 5. Channel follows and pulls no longer reach the event feed
**Owner:** unassigned · **Severity:** low, but it is a visible behaviour change

F28 stopped writing the `channel` document, which also stopped the matching
`yi_events` row. The generic last-100 event feed in the snapshot therefore no
longer shows follows and pulls. Nothing reads events by the `channel` kind
(only `providerAlert` is read that way), so nothing breaks — but the feed is
quietly less complete than it was.

### 12. The `jobs` table and `repos/jobs.ts` are dead code
**Owner:** F26 · **Severity:** low in itself, but it means the queue is unstarted

`grep -rn 'enqueueJob|repos/jobs' src tests scripts` excluding the file itself
returns zero hits. `0003_relational.sql` created the table and F24 wrote the
repository; nothing — not even a test — calls `enqueueJob`, `listJobs` or
`countJobs`. The cron route still calls the in-memory `sweep()` and
`processWindow()` from `runner.ts` and never touches the table.

### 13. `YTI_QUEUE_PAUSED` is read by nothing, so the documented drain does nothing
**Owner:** F26 · **Severity:** high, because a runbook step silently no-ops

`env.ts:35` declares it. The only reads anywhere are three assertions in
`tests/connection.test.ts`. The dispatcher never consults it.

`deploy.md` step 4.7 tells an operator to set it and redeploy before a
type-changing migration, then wait for the queue to drain. Today that sets a
variable nothing reads, and the worker keeps claiming. The instruction is worse
than no instruction, because it produces confidence.

### 14. `int8` comes back from node-postgres as a string
**Owner:** F29, F24b · **Severity:** medium, and offline tests cannot catch it

`database.ts:66-71` registers type parsers for `numeric` (1700) and `timestamptz`
(1184) only. `int8` is left to node-postgres, which returns it as a **string**.
`COUNT(*)` and `pg_total_relation_size()` are both `int8`.

PGlite returns them as numbers, so `after.bytes - before.bytes` is arithmetic in
every test and string subtraction in production. Existing call sites that wrap
in `Number(...)` are safe; new ones doing arithmetic directly are not.

### 15. `summarizeScores` reports 0 rather than absent for the fields F25 must not store
**Owner:** F25 · **Severity:** medium

`registry.ts:115` feeds settlements through `summarizeScores`. Run against rows
that lack `spy`, `excess` and `beatsSpy`, it returns `meanSpy`, `meanExcess` and
`beatsSpyRate` as **0** — a plausible-looking number, not a missing value. So
F25 can satisfy "do not store excess return" and still surface zeros that read
as real.

### 16. `settlement` is a document kind and `settlements` will be a table
**Owner:** F25 · **Severity:** low

A fourth name collision beyond the three F24's audit found:
`metrics/context.ts:57` reads `docs<unknown>("settlement")`, and F25's migration
creates a `settlements` table.

### 17. A `date` column round-trips differently under PGlite and node-postgres
**Owner:** F25 · **Severity:** medium, and it is invisible offline

Under PGlite a `date` returns as a `Date` at UTC midnight and reads back
correctly. Under node-postgres — the production path — pg-types builds the Date
in **local** time, so a session date can shift a day either side of midnight
depending on where the function runs. Session dates should be stored as text
with a `CHECK`, not as `date`.

### 18. `tests/backup.test.ts` fails in both directions
**Owner:** whoever adds the next table · **Severity:** low, a sequencing trap

The test asserts both that every created table is covered and that every covered
table exists. So adding a name to `BACKUP_TABLES` **before** the migration that
creates it fails the phantom check. Add the migration and the list entry in the
same commit.

---

## Open — documentation

### 6. The phase-1 conformance report claims a driver that no longer exists
**Owner:** F31 · **Severity:** low, but it is a false claim in the gate history

`docs/gates/phase-1-conformance.md:25` reads "Tests: 197 of 197 on the SQLite
driver and on PGlite". SQLite was removed in F23. The same file lists two F17b
follow-ups as open; both are done. F31's report corrects the record rather than
leaving it.

### 7. `deploy.md` Part 7 predates the version-2 backup format
**Owner:** unassigned · **Severity:** low

`export-research.ts` now writes `version: 2` and covers the relational tables;
`restore-research.ts` still restores a version-1 file, treating the newer tables
as empty. Part 7's restore instructions do not mention either.

---

## Owed by a person

### 8. The real channel lists
**Blocks:** seeding anything real

`seed/leapedge.json` and `seed/truealpha.json` ship as placeholders and say so.
The real LeapEdge list (about 47 channels) and TrueAlphaData Tier 1 (about 20)
were not available to the build, and channel IDs are not guessable — inventing
them would seed rows pointing at the wrong creators.

`scripts/seed-channels.ts --production` refuses while either file is marked
`placeholder: true`. Replacing the JSON needs no code change and no test change.

### 9. Rotate the Neon database password
**Severity:** high

A live `neondb_owner` connection string was pasted into a session transcript on
18 September 2026. Neon console → Roles → reset. The host does not change, so
`YTI_PRODUCTION_DB_HOST` is unaffected.

### 10. Vercel and Neon setup, `deploy.md` steps 4.1–4.7
Steps 4.1–4.5 before the phase-2 PR merges; 4.6 before the phase-2 gate is
binding; 4.7's pause-and-drain sequence before the `0005` type migration
reaches production. `vercel-setup.md` is the short version of 4.1–4.6.

### 11. Gold set, run exports, frozen responses
Gates 0 and 1 stay **advisory** until the gold set, the v5 and v7 run exports and
the frozen responses arrive. Unrelated to phase 2.

---

## Deferred by decision

| Item | Until | Why |
|---|---|---|
| Owner scoping on the API (F30 R5) | Finradar identity exists | there are no user accounts yet; a per-account filter would be filtering by a constant |
| Deleting the old `/api/intelligence/research` route | the phase-3a gate | two front ends still call it; F30 keeps it as an alias |
| Sharing indefinite until revoked (F53), digest per account (F54) | identity | same reason |

---

## Resolved, recorded because the class recurs

**Tests that could not fail.** Six so far, each found by deleting the mechanism
and watching the suite stay green: `FOR UPDATE SKIP LOCKED` in `claimNext`; the
transcripts projection; span reconciliation on republish; the `processing` gate
and the `followed_at` cut-off in `pullDue`; the `nothing` action schema. All six
were written in good faith and read convincingly.

Mutation testing is now a standing step in every verify brief, and it has caught
a real defect in each of the last three waves.

**A guard that never fired.** `assertIsolatedDatabase` compared the pooled host
against the direct one, which on Neon differ by the `-pooler` infix and are never
equal. It was tested for refusing bad input and never for firing on a realistic
pair. Both sides now normalise through one exported `cluster()`.

**A region asserted as a literal.** Seven sentences across three documents said
the Neon region "must be `iad1`". The real invariant was always co-location; the
database is in `ap-southeast-2` and the functions are now pinned to `syd1`.
