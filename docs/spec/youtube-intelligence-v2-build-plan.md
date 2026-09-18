# YouTube Intelligence v2 — build plan

**Status:** Approved build plan, 17 September 2026. Companion to `youtube-intelligence-v2-spec.md` (revision 4). This document lists every feature needed to deliver the spec, which features are serial and which parallel, the loop each build agent follows, the backend test plan, and the multi-agent delivery strategy.

**Decisions this plan rests on:** all phases 0–4 in scope; Claude agents build with human review at every phase gate; tests reach Postgres through PGlite in-process; delivery runs as a multi-agent Workflow, one phase per spec phase.

**Two deviations from the spec text, for the record:**

- The queue is an own `jobs` table with `FOR UPDATE SKIP LOCKED` behind a `Queue` interface, not pg-boss or Graphile Worker. Both of those need LISTEN/NOTIFY and several connections, which PGlite cannot exercise in CI. Behaviour is the same.
- Product code is built on an integration branch `feat/yti-v2` off `feat/youtube-intelligence`, one branch per lane, PRs into `feat/yti-v2`, gates as PRs the human approves. This docs branch carries documents only.

**Where product code lives:** paths below are relative to the `feat/youtube-intelligence` checkout. Named functions were verified there: `store.ts` `reserve`/`settle`/`claimNext`/`save`; `performance.ts` `scoreCall`/`summarizeScores`; `evidence-selection.ts` `materializeEvidenceRanges`; `contracts.ts` `Claim`; `native-google-core.ts` `createTransport`/`requestFor`/`execute`/`assess`; `transcripts.ts` `managedTranscript`; `channels.ts` `follow`/`pull`/`pullDue`/`backfillChannel`; `briefings.ts` share and digest functions; `evaluations/transcript-accuracy.ts` `scoreAccuracy`; `evaluations/checks.ts` `gradeRun`.

---

## 1. Feature list

Paths are relative to the `feat/youtube-intelligence` checkout. Spec references are section numbers of `youtube-intelligence-v2-spec.md`. IDs are stable; F09 is unused.

### Phase 0 — harness, interfaces, schemas

| ID | Feature | Files (create / change) | Spec |
|---|---|---|---|
| F01 | PGlite test backend: third driver in `database.ts` selected by `YTI_DB=pglite`, keeping `postgresSQL()` so every existing test runs on the Postgres dialect from day one; SQLite stays until F23 | `src/server/youtube-intelligence/database.ts`, `package.json` (devDep `@electric-sql/pglite`), `tests/helpers/db.ts` | 4.7, 9 |
| F02 | Test helpers: route-matched `fetch` stub with call log; fixture DB builder `seedFixture()` (channels, runs, claims, mentions, prices, settlements); frozen-response loader | `tests/helpers/fetch-stub.ts`, `tests/helpers/fixtures.ts`, `tests/fixtures/model/*.json`, `tests/fixtures/db/*.json` | 9 |
| F03 | `ModelTransport` interface; `OpenRouterTransport` extracted from `modelCall`; `FakeModelTransport` replaying frozen responses; `modelCall(run, stage, request)` transport-agnostic with ledger, retain and prompt snapshot above it | `src/server/youtube-intelligence/transport/{types,openrouter,fake,index}.ts`, `pipeline.ts` (`modelCall`) | 4.1 |
| F04 | Metrics registry skeleton: `MetricEntry {id,label,definition,steps,inputs,implementation,settingsUsed}`, `renderHover(id)`, `evaluate(id, db, settings)`; `uiColumns.ts` manifest; CI test asserts `uiColumns ⊆ registry.ids` and evaluates every entry on the fixture DB | `src/features/youtube-intelligence/metrics/registry.ts`, `metrics/ui-columns.ts`, `tests/metrics-registry.test.ts` | 4.11, 8 |
| F05 | Settings schemas: `TeamPreferences`, `AccountPreferences` zod from 6.2/6.3 with defaults and `configHash`; env validation incl. `YTI_HARD_BUDGET_USD_MONTH`; old `Preferences` doc migrated into team + account docs | `src/features/youtube-intelligence/settings.ts`, `research-store.ts` (`Preferences`, `preferences`, `savePreferences`) | 6 |
| F06 | Gold set: `GoldClaim` schema (extends the `AccuracyCase` reviewer/anchor pattern with ticker, stance, conviction, sentiment, span, verified anchor); 50 cases EN+ZH; offline replay through `FakeModelTransport`; report of claim P/R, critic P/R, anchor ≤2 s, sentiment agreement, cost per accepted claim | `evaluations/gold-set/{schema,report}.ts`, `evaluations/gold-set/cases.json`, `scripts/gold-set.ts`, reuse `evaluations/checks.ts` `gradeRun` | 4.9 |
| F07 | *Removed 17 September 2026.* VideoConviction harness was built in phase 0 and then deleted (commit "Remove the VideoConviction benchmark") because no product surface uses the data | — | — |
| F08 | Promotion gate: one command runs F06 for a config hash and writes a dated gate report; thresholds from settings; baseline for the current v5 config committed | `scripts/promotion-gate.ts`, `docs/gates/phase-0-baseline.json` | 4.9, 9 |

### Phase 1 — native transport, pointer evidence, three-call pipeline, retries, standby

| ID | Feature | Files | Spec |
|---|---|---|---|
| F10 | `GoogleNativeTransport` built on `native-google-core.ts` (`createTransport`, `execute`, `classifyError`); `responseSchema` on every request; `mediaResolution: LOW`; `countTokens`; cached price table replaces the per-call catalogue download | `transport/google-native.ts`, `transport/prices.ts`, `native-google-core.ts` (`requestFor` gains schema and resolution params) | 4.1, 5 |
| F11 | Stage routing from `settings.models.<stage>.transport`; `fallbackToOpenRouter`; `requireDifferentFamily` check on critique; `provider.only` and `json_object` removed from the OpenRouter path | `transport/index.ts`, `transport/openrouter.ts`, `pipeline.ts` | 4.1, 6.2 |
| F12 | Pointer evidence: `Claim.evidence[].source_span {start_id,end_id,start_seconds,end_seconds,text_hash}`; extraction `responseSchema` returns ranges; `materializeEvidenceRanges` wired into `step()`; `validateClaim` string match becomes an assertion; `quote_original` derived | `contracts.ts`, `evidence-selection.ts`, `pipeline.ts`, `schemas/extraction.ts` | 4.2 |
| F13 | Mentions: `Mention` zod (ticker, market, stance, sentiment, rationale, span pointer, `is_call`); deterministic sentiment from stance; model sentiment with rationale for non-calls; mention without span rejected | `contracts.ts`, `src/features/youtube-intelligence/sentiment.ts`, `pipeline.ts` | 4.3, 4.13 |
| F14 | Translation stage: one cheap native call over copied spans producing `translation_en`; `text_original` hash asserted unchanged | `pipeline.ts` (stage `translate`), `schemas/translation.ts` | 4.2, 4.19 |
| F15 | Batched critique: one call over all claims and mentions with the transcript from an explicit context cache; chunk only above `processing.chunkAboveTokens`; per-claim loop and `source-repair` removed | `pipeline.ts`, `transport/google-native.ts` (cache create/reuse/delete), `chunking.ts` | 4.3, 5 |
| F16 | Retry policy: attempts keyed `(run, stage, attempt)`; retry 429/5xx/timeout-before-bytes with jitter and `maxRetriesPerStage`; `reserve()` refuses a second *open* attempt instead of any second row | `src/server/youtube-intelligence/retry.ts`, `store.ts` (`reserve`, `settle`), `database.ts` schema (`yi_calls.attempt`) | 4.4 |
| F17 | Realistic reservations: counted input tokens × rate + output cap × rate; reconcile from usage; release on any terminal outcome; unknown outcome held `unknownOutcomeHoldMinutes` then a reconciliation queue processed by `sweep` | `store.ts`, `transport/prices.ts`, `runner.ts`, `src/server/youtube-intelligence/reconcile.ts` | 4.4, 6.2 |
| F18 | Supadata standby: explicit `mode=native\|generate`, batch endpoint, per-vendor circuit breaker (TranscriptAPI 5xx/429/timeout → Supadata for `standbyCooldownMinutes`; 206 never trips it), credit-exhausted stored event and banner payload | `transcripts.ts` (`managedTranscript`), `src/server/youtube-intelligence/circuit-breaker.ts`, `research-store.ts` (`event`) | 4.10 |
| F19 | Prompt v7: pointer output, mentions with sentiment, conviction rubric; seeded into `yi_prompts`; promoted only through F08 | `prompt-versions.json`, `prompts.ts` | 4.2, 10 |
| F20 | Retire `youtubejs.ts`, `additional-transcript-formats.ts` and their tests; `audio-review.ts` demoted to Lab; `provider.only` pin removed; `transport.default` flag keeps the old path selectable for the comparison week | delete `youtubejs.ts`, `additional-transcript-formats.ts`, `tests/youtubejs.test.ts`, `tests/additional-transcripts.test.ts`; `package.json` (drop `youtubei.js`) | 4.10, 12 |
| F21 | Phase-1 gate run: v5 vs v7 on the gold set; standby injection test; report | `tests/standby.test.ts`, `docs/gates/phase-1-<date>.json` | 9 |

### Phase 2 — Postgres-only, relational core, queue, seed

| ID | Feature | Files | Spec |
|---|---|---|---|
| F22 | Migration runner: numbered SQL files, `yi_migrations` table, applied at worker start, by `scripts/migrate.ts`, and by the test DB helper; the `CREATE TABLE IF NOT EXISTS` string removed | `src/server/youtube-intelligence/migrations/0001_baseline.sql`, `migrations/index.ts`, `scripts/migrate.ts`, `database.ts` | 4.7 |
| F23 | Postgres-only `database.ts`: delete `node:sqlite`, `postgresSQL()`, `YTI_DB_PATH`, `scripts/backup.ts`, `scripts/migrate-sqlite.ts`; `$n` placeholders everywhere; drivers `pg.Pool` and PGlite; the global `pg_advisory_xact_lock(78941002)` removed from `transaction()` and replaced at every site (8.3); `json()` and `iso()` readers; type parsers 1700 and 1184 on both drivers; new indexes and constraints in `migrations/0002_locks.sql` | `database.ts`; every file with `?` placeholders (`store.ts`, `research-store.ts`, `channels.ts`, `briefings.ts`, `market.ts`); test headers | 4.7 |
| F22a | Neon topology and fail-fast: pooled `DATABASE_URL` for functions, `DATABASE_URL_UNPOOLED` for `migrate.ts`, `postgres-check.ts`, `export-research.ts`, `restore-research.ts`; `attachDatabasePool(pool)`; pool `max` from `YTI_POOL_MAX`; `initialize()` reads `yi_migrations` and throws when behind; no DDL at runtime; hosted env variables; `"buildCommand": "npm run migrate && next build"` | `database.ts`, `env.ts`, `vercel.json`, `package.json`, `docs/production-and-integration.md` | 4.7 |
| F24 | Relational tables and repositories for `claims`, `mentions`, `evidence_spans`, `transcripts`, `reviews`, `channels`, `instruments`, `jobs`; new tables only; publish stage writes rows; `researchSnapshot()` reads rows; one-off `scripts/migrate-documents.ts` for existing lab data; partition per 8.4 | `migrations/0003_relational.sql`, `src/server/youtube-intelligence/repos/*.ts`, `pipeline.ts` (publish), `research-store.ts` | 8 |
| F24b | Type flips on existing tables: payload and snapshot columns → `jsonb`, `*_at` and `lease_until` → `timestamptz`, `cost`/`amount` → `numeric(12,6)`; applied in production only with `YTI_QUEUE_PAUSED=true` and `yi_runs` drained | `migrations/0005_types.sql`, `scripts/migrate.ts` | 8 |
| F25 | `prices` and `settlements` tables; `prices()` stores bars with `source` and `fetched_at`; settlement sweep writes append-only rows per horizon using `scoreCall`; `record` forward/historical; the `performance` document removed | `migrations/0004_prices_settlements.sql`, `market.ts`, `src/server/youtube-intelligence/settlement.ts`, `performance.ts` | 4.11, 4.12, 8 |
| F17b | Ledger follow-ups: verify `costUsd` is already the settled amount at `pipeline.ts:356` and mark that phase-1 bullet done; `priceTableVersion` stored with each settled call; `rejectedMentions[].kind ∈ extraction\|critic`; `audit-institutional-chinese.ts` ported or deleted with a note | `pipeline.ts` (`modelCall`), `store.ts` | 4.4 |
| F26 | Jobs queue with the cron dispatcher as worker: `jobs` table with `FOR UPDATE SKIP LOCKED`, kinds `analyze`, `settle`, `push-renew`, `batch-poll`, `reconcile`; the **global** running cap enforced inside the claim transaction; one lease token across `jobs` and `yi_runs`; `renew(jobId, token)` before every attempt inside `withRetry`; request-hash replay from the retained response; token-fenced `reserve`/`settle`; takeover flips the previous holder's open attempts to `unknown`; `sweep` becomes a singleton `reconcile` job; `YTI_QUEUE_PAUSED` honoured; `scripts/worker.ts` reduced to a thin local loop over `Queue` | `src/server/youtube-intelligence/queue.ts`, `store.ts`, `runner.ts`, `scripts/worker.ts`, `src/app/api/cron/intelligence/route.ts` | 4.7 |
| F27 | Restart-safe resume: stage checkpoints plus open-attempt rows; a re-claimed run resumes at the checkpoint and never re-reserves a settled attempt | `pipeline.ts` (`step`), `store.ts`, `tests/resume.test.ts` | 4.4, 9 |
| F28 | Channel seed: two source lists (LeapEdge, TrueAlphaData); `seedChannels()` dedupes by channel ID, sets `tier`, `seed_source[]`, `discovery`, `processing`; default selection Tier 1 + LeapEdge top 20; selection saved as versioned config | `src/server/youtube-intelligence/seed/{leapedge,truealpha}.json`, `seed/index.ts`, `channels.ts`, `settings.ts` | 4.15 |
| F29 | Cost projection and budget meter as registry metrics (uploads per month per channel from the last 90 days × measured cost per video; month-to-date vs `budget.monthlyUsd` vs hard ceiling) | `metrics/cost.ts`, `metrics/registry.ts`, `store.ts` (`health`) | 4.15, 6 |
| F30 | API restructure: the 29-case switch replaced by a dispatch table `{action: {schema, handler, mutating}}` per resource module; per-action zod replaces the shared envelope; routes under `/api/youtube-intelligence/*`; old action names kept as aliases for one phase; owner scoping deferred: identity | `src/app/api/youtube-intelligence/*/route.ts`, `src/server/youtube-intelligence/actions/*.ts`, `owner.ts`; delete `src/app/api/intelligence/research/route.ts` at phase-3 gate | 4.18 |
| F06a | Gold-set drafting tool: `scripts/gold-draft.ts --runs runs.json --out gold-draft.json` writes one `status: "pending"` case per completed run, claims and mentions pre-filled, spans from `source_span`, `anchorVerified: false`; validated with `parseGoldSet` | `scripts/gold-draft.ts`, `evaluations/gold-set/schema.ts` | 4.9 |
| F31 | Phase-2 gate run: four-video parallel end to end on PGlite with fake transports; kill-and-resume; seed dedupe; migrations idempotent; `0005` refuses while a run is `running`; a Neon branch checked through the pooled endpoint | `tests/e2e-parallel.test.ts`, `docs/gates/phase-2-<date>.json` | 9 |

### Phase 3a — thin vertical slice: shell, shared components, Today and Analysis

Starts after F24, F24b and F30 merge. Every call on these pages is text-checked; ASR, agreement and L2 arrive in 3b.

| ID | Feature | Files | Spec |
|---|---|---|---|
| F42 | UI shell: module layout with side panel (Today, Channels, Leaderboard, Saved calls, Lab, Settings); `ResearchApp.tsx` split into page components; `/research` and `/` redirect; `ResearchApp.tsx` and `IntelligenceApp.tsx` stay mounted under Lab until 3b | `src/app/youtube-intelligence/layout.tsx` and page routes, `src/features/youtube-intelligence/ui/SidePanel.tsx`, `ui/useResearchData.ts` | 7.1, 7.3 |
| F43 | Shared components: `TrustBadge`, `ConvictionChip`, `Tooltip`, `MetricHeader` (hover from registry + sort), `DataTable`, `BenchmarkSelector`, `PeriodSelector`, `StateChip`; first `.tsx` consumer of `metrics/registry.ts`; dark tokens | `src/features/youtube-intelligence/ui/*.tsx`, `src/app/globals.css` | 7.2, 7.5 |
| F35a | Trust L0–L1: `computeTrustLevel(checks, criticVerdict)` at publish from the deterministic checks and the critic verdict; `trust_basis` jsonb; L2 and L3 render "not yet" | `src/features/youtube-intelligence/trust.ts`, `repos/claims.ts` | 4.6 |
| F38 | Sentiment shift: mentions and distinct creators by sentiment for period P against the prior P with trust filter; drill-down rows | `metrics/sentiment-shift.ts`, `repos/mentions.ts` | 4.13 |
| F38b | Consensus per ticker: `metrics/consensus.ts` groups open calls by stance per ticker into agree / lean / split; reused by F36 | `metrics/consensus.ts`, `metrics/registry.ts`, `repos/claims.ts` | 4.12, 4.13 |
| F44 | Today page: ranked L1 calls, consensus panel, sentiment-shift panel, analyse-now box, needs-review list. The **team document value** `trust.minimumLevelForToday = "text-checked"` until the 3b gate — the schema default at `settings.ts:190` stays `audio-agreed` per spec 6.2, and the 3b gate restores the document value. L0 is never shown | `ui/pages/Today.tsx`, `actions/today.ts` | 7.3 |
| F47 | Analysis page: `Report` and `SourcePlayer` lifted out of `IntelligenceApp.tsx`; trust strip, claim cards by trust then conviction, evidence viewer, play-from, Processing details collapsible; agreement score and context-check line render "not yet" | `ui/pages/Analysis.tsx`, `SourcePlayer.tsx` | 7.4 |
| F49a | Gate 3a: registry CI with every Today and Analysis column mapped; Today renders from the fixture DB; build green; the old `/api/intelligence/research` route deleted; human walk-through recorded | `tests/metrics-registry.test.ts`, `docs/gates/phase-3a-<date>.json` | 9 |

### Phase 3b — ASR, agreement, L2, leaderboard, automation, remaining pages

| ID | Feature | Files | Spec |
|---|---|---|---|
| F32 | Windowed ASR: `nativeGoogleStep` requests fixed `windowSeconds` windows with `videoMetadata` offsets at LOW resolution; `transcripts` rows `kind=asr-window`; `asrPolicy` | `native-google.ts`, `transcripts.ts`, `repos/transcripts.ts` | 4.5, 5 |
| F33 | Agreement scoring: edit-distance core moved from `evaluations/transcript-accuracy.ts` into `agreement.ts`; per-span `agreement_score` and `anchor_error_seconds` on `evidence_spans` | `src/features/youtube-intelligence/agreement.ts`, `evaluations/transcript-accuracy.ts` (imports core), `pipeline.ts` (stage `agree`) | 4.5 |
| F34 | Whisper tie-break: below threshold on a promoted claim, one Supadata `generate`, two-of-three rule, `tie_break_source` | `pipeline.ts`, `transcripts.ts`, `agreement.ts` | 4.10 |
| F35b | Trust L2: agreement and anchor error promote a claim to L2; level never decreases on recompute. L3 signing and the append-only `reviews` writer are *deferred: identity* | `src/features/youtube-intelligence/trust.ts`, `repos/claims.ts` | 4.6, 4.18 |
| F36 | Leaderboard statistics and boards: `significance.ts` (Wilson, t, p, BH q, gates); `leaderboard.ts` by creator and by ticker (consensus reused from F38b, most reliable creator); benchmark chosen at query time from `prices`; sector ETF map; market filter; "not settleable" label; all as registry metrics | `significance.ts`, `leaderboard.ts`, `metrics/leaderboard.ts` | 4.12 |
| F37 | Changes tab: `boardAsOf(date)` and `diffBoards(a, b)` (rank moves, status crossings, entrants, consensus shifts, "not yet meaningful") | `leaderboard.ts`, `metrics/changes.ts` | 4.12 |
| F39 | Push notifications: PubSubHubbub verify and notify endpoint (HMAC with `YTI_PUSH_CALLBACK_SECRET`), subscribe/renew job, poll fallback via `pullDue` | `src/app/api/youtube-intelligence/push/route.ts`, `src/server/youtube-intelligence/push.ts`, `channels.ts`, `queue.ts` | 4.8 |
| F40 | Batch mode: Google Batch API submit and poll in the native transport; `processing.userSubmitted\|channelUploads`; `batch-poll` job; ledger settles on completion | `transport/google-native.ts`, `queue.ts`, `pipeline.ts` | 4.8, 5 |
| F41 | Historical replay: Tier-1 uploads from `channels.historicalReplay.from`; IDs from Supadata channel listing or the uploads playlist; Shorts skipped; batch; `record=historical` | `src/server/youtube-intelligence/replay.ts`, `scripts/replay.ts`, `channels.ts` (`backfillChannel`) | 4.16 |
| F45 | Channels page: seed list with Process checkbox, cost projection before save, "Analyse this one", trust distribution, record vs benchmark | `ui/pages/Channels.tsx`, `actions/channels.ts` | 4.15, 7.2 |
| F46 | Leaderboard page: by ticker, by creator, Changes; benchmark, horizon, market and record selectors; CSV export with registry ids; Methodology page from the registry | `ui/pages/Leaderboard.tsx`, `ui/pages/Methodology.tsx`, `actions/leaderboard.ts` | 4.12, 7.3 |
| F48 | `migrations/0006_saved_calls.sql`; saved calls, Lab (prompts, experiments, gold set, cost history, shares, Promote gated), Settings from the schemas with reset-to-team-default | `ui/pages/{Saved,Lab,Settings}.tsx`, `actions/{saved,lab,settings}.ts` | 7.2, 7.3 |
| F49b | Gate 3b: anchor accuracy on gold set; push-to-Today end to end with a fixture hub; registry CI; benchmark change writes nothing; Changes diff equals a hand-computed fixture; `EXPLAIN` on the board queries against a Neon branch at realistic volume; `trust.minimumLevelForToday` restored to `audio-agreed` | `tests/leaderboard.test.ts`, `tests/push.test.ts`, `docs/gates/phase-3b-<date>.json` | 9 |

### Phase 4 — context, Finradar, corpus, sharing, digest

| ID | Feature | Files | Spec |
|---|---|---|---|
| F50 | Context check: deterministic source gathering (FMP news with `from`/`to`, filings and earnings ≤90 days, prices, optional Exa), date validation, OpenRouter summary under `responseSchema`, citation-id validation with one retry, `context_checks` rows, "since then" at settlement | `src/server/youtube-intelligence/context-check.ts`, `market.ts` (`news`, `filings`), `migrations/0007_context_checks.sql`, `settlement.ts`, `pipeline.ts` | 4.14 |
| F51 | Finradar `youtube` observation: `briefing_observations` rows from the sentiment shift per edition; adapter emitting the `briefing-read-v1` item shape, built only after the current contract file is supplied | `src/server/youtube-intelligence/briefing-observation.ts`, `briefings.ts` (`buildBriefing`), `migrations/0008_briefing_observations.sql` | 4.17 |
| F52 | File Search corpus: transcripts uploaded on publish; cross-video question returning cited spans; `retentionDays` | `src/server/youtube-intelligence/corpus.ts`, `transport/google-native.ts`, `ui/pages/Corpus.tsx` | 5 |
| F53 | Sharing: indefinite until revoked, optional expiry, immutable snapshot, `created_by`; share page. *Deferred until Finradar identity.* | `briefings.ts` (`shareBriefing`, `readShare`, `revokeShare`), `repos/shares.ts`, `src/app/share/[token]/page.tsx` | 4.18 |
| F54 | Digest per account: deliver to Finradar briefing and/or email. *Deferred until Finradar identity.* | `briefings.ts` (`digestDue`, `prepareScheduledDigest`), `email.ts` | 6.3 |
| F55 | Phase-4 gate run: 50-call context sample all inside window; edition renders the observation; corpus question cites spans | `tests/context-check.test.ts`, `docs/gates/phase-4-<date>.json` | 9 |

---

## 2. Dependency map and lanes

| ID | Prerequisites | | ID | Prerequisites |
|---|---|---|---|---|
| F01 | — | | F29 | F04, F25, F28 |
| F02 | F01 | | F30 | F05, F24 |
| F03 | F02 | | F31 | F26, F27, F28 |
| F04 | F02 | | F32 | F10, F24 |
| F05 | F01 | | F33 | F32 |
| F06 | F03 | | F34 | F18, F33 |
| F06a | F06 | | F35a | F24, F30 |
| F07 | — (removed) | | F35b | F33, F35a |
| F08 | F06 | | F36 | F25, F35b, F04 |
| F10 | F03 | | F37 | F36 |
| F11 | F05, F10 | | F38 | F13, F24, F04 |
| F12 | F03 | | F38b | F24 |
| F13 | F12 | | F39 | F26 |
| F14 | F12 | | F40 | F10, F26 |
| F15 | F10, F12 | | F41 | F40, F28 |
| F16 | F03 | | F42 | F30 |
| F17 | F16, F10 | | F43 | F04, F42 |
| F17b | F23 | | F44 | F43, F35a, F38, F38b |
| F18 | F02 | | F45 | F43, F29 |
| F19 | F12, F13 | | F46 | F43, F36, F37 |
| F20 | F11, F15 | | F47 | F43, F35a |
| F21 | F08, F11–F19 | | F48 | F43, F08 |
| F22 | F01 | | F49a | F42–F44, F47, F35a, F38, F38b |
| F22a | F23 | | F49b | F32–F41, F45, F46, F48 |
| F23 | F22 | | F50 | F25, F11 |
| F24 | F23, F12, F13 | | F51 | F38, F24 |
| F24b | F24, F25 | | F52 | F10, F24 |
| F25 | F26 | | F53 | F24 — deferred: identity |
| F26 | F17b, F23 | | F54 | F05, F53 — deferred: identity |
| F27 | F26, F16 | | F55 | F50–F52 |
| F28 | F24 | | | |

**Critical path (strictly serial):** F01 → F02 → F03 → F12 → F13 → F22 → F23 → F22a → F24 → F24b → F30 → F43 → F44 → F49a → F32 → F33 → F35b → F36 → F46 → F49b → F50 → F55.

**Lanes per phase** (items within a lane are serial; lanes run in parallel):

| Phase | Lane | Items | Note |
|---|---|---|---|
| 0 | infra (blocking) | F01 → F02 → F03 | Nothing else starts until F03 merges |
| 0 | registry | F04 | |
| 0 | settings | F05 | |
| 0 | gold | F06 → F08 | |
| 1 | transport | F10 → F11 → F15 → F20 | |
| 1 | evidence | F12 → F13 → F14 → F19 | F15 needs F12 |
| 1 | ledger | F16 → F17 | F17 needs F10 |
| 1 | standby | F18 | independent |
| 1 | gate | F21 | |
| 2 | data (blocking) | F22 → F23 → F22a → F24, then F24b once F25 has merged | Owns `database.ts`, `migrations/*`, `repos/*`, `research-store.ts` reads, `env.ts`, `vercel.json`, `package.json`, runbook |
| 2 | ledger | F17b → F26 → F27 | Starts after F23; owns `store.ts`, `pipeline.ts` (`modelCall`, `withRetry`), `runner.ts`, `queue.ts`, `scripts/worker.ts`, cron route |
| 2 | prices | F25 | Starts after F26; owns `market.ts`, `performance.ts`, `settlement.ts`, `metrics/context.ts`, `0004` |
| 2 | seed | F28 → F29 | Starts after F24; owns `seed/*`, `channels.ts`, `metrics/cost.ts` |
| 2 | api | F30 | Starts after F24; owns `actions/*`, new routes |
| 2 | eval | F06a | Any time; owns `scripts/gold-draft.ts` |
| 2 | gate | F31 | |
| 3a | slice | F42 → F43 → F35a → F38 → F38b → F44, F47 | Starts after F24, F24b and F30 merge; F44 and F47 in parallel after F38b |
| 3a | gate | F49a | |
| 3b | asr | F32 → F33 → F34 → F35b | |
| 3b | board | F36 → F37 | After F25 and F35b; F36 reuses F38b |
| 3b | automation | F39, F40 → F41 | |
| 3b | ui-pages | F45, F46, F48 | Three agents, one page each; F48 deletes the two old apps |
| 3b | gate | F49b | |
| 4 | context, finradar, corpus | F50; F51; F52 | three parallel lanes; the sharing lane (F53 → F54) is deferred: identity |
| 4 | gate | F55 | |

---

## 3. Build loop

**Per item (agent):**

1. Read the spec section on the item and the files listed; read the existing test covering the touched module.
2. Write failing tests first in `tests/<area>.test.ts` (node:test, `assert/strict`; DB via `tests/helpers/db.ts`; HTTP via `tests/helpers/fetch-stub.ts`; models via `FakeModelTransport`).
3. Implement, following conventions: `.ts` import suffixes, zod at every boundary, no new runtime dependency without listing it in the PR.
4. Run until green:
   ```
   npm test
   npm run typecheck
   npm run build
   node --experimental-strip-types --test tests/metrics-registry.test.ts     # when registry, columns or UI tables changed
   node --experimental-strip-types scripts/promotion-gate.ts --offline       # when prompts, schemas, transport or extraction changed
   ```
5. Self-review against the item's done criteria and the invariants in section 4; check touched files against lane ownership.
6. Open a PR `feat/yti-v2/<lane>` → `feat/yti-v2` titled `F##: <feature>`, body: spec section, tests added, commands run, deviations. Verification agents run; a finding is closed only by a test; the human merges.

**Per phase gate (orchestrator + human):**

1. All lane PRs of the phase merged; CI green on `.github/workflows/verify.yml` extended with `YTI_DB=pglite`, the registry test and `promotion-gate.ts --offline`.
2. Gate commands, artefact written to `docs/gates/phase-N-<date>.json`:
   ```
   npm test && npm run typecheck && npm run build
   node --experimental-strip-types scripts/promotion-gate.ts --offline --out docs/gates/phase-N-<date>.json
   node --experimental-strip-types --test tests/e2e-parallel.test.ts tests/resume.test.ts             # phase 2
   node --experimental-strip-types --test tests/leaderboard.test.ts tests/push.test.ts tests/metrics-registry.test.ts   # phase 3
   node --experimental-strip-types --test tests/context-check.test.ts                                  # phase 4
   ```
   Live checks needing keys (phase 1 cost comparison, phase 3 anchor accuracy on real audio, phase 4 real FMP window) are run by the human with `node --env-file=.env …` and the JSON committed next to the offline artefact.
3. A spec-conformance agent compares the artefact with the "Gate to exit" row of spec section 9 and writes `docs/gates/phase-N-<date>.md`.
4. The human approves the gate PR; the next phase's lanes open only after that. Rollback is the phase flag in `settings.ts`.

---

## 4. Backend test plan

**Infrastructure first (F01–F03, F06–F08):**

| Piece | File | Contract |
|---|---|---|
| PGlite backend | `tests/helpers/db.ts` `freshDatabase()` | Sets `YTI_DB=pglite`, resets module state via `database.close()`, applies schema or migrations; one isolated instance per test file |
| Fixture builder | `tests/helpers/fixtures.ts` `seedFixture(spec)` | Deterministic ids; channels, runs, claims, mentions, prices, settlements from `tests/fixtures/db/*.json` |
| fetch stub | `tests/helpers/fetch-stub.ts` `stubFetch(routes)` | Route-matched `Response`s, call log, restore in `finally`; replaces the ad-hoc `globalThis.fetch =` blocks |
| Fake transport | `transport/fake.ts` | Replays `tests/fixtures/model/<stage>-<hash>.json`; records requests; injects 429/5xx/timeout/unknown |
| Frozen responses | `tests/fixtures/model/` | Captured once with live keys by the human via `scripts/freeze-responses.ts`; re-captured only on approved prompt changes |
| Registry CI | `tests/metrics-registry.test.ts` | Every entry evaluates on the fixture DB; `uiColumns ⊆ registry.ids`; hover text and steps non-empty |
| Gate commands | `scripts/gold-set.ts`, `scripts/promotion-gate.ts` | `--offline` needs no keys (CI); `--live` needs keys |
| CI | `.github/workflows/verify.yml` | Add `YTI_DB=pglite`, the registry test and `promotion-gate.ts --offline` |

**Per-feature tests:**

| Test file | Covers | Cases |
|---|---|---|
| `tests/transport.test.ts` | F03, F10, F11 | Both transports serialise the same request; `responseSchema` present; routing per settings; fallback only when enabled; same-family critic rejected |
| `tests/evidence-pointer.test.ts` | F12, F14 | Range copy equals source text; hash stable; unknown, reversed or over-long ranges rejected; translation cannot change `text_original`; legacy quote path only asserts |
| `tests/mentions.test.ts` | F13, F38 | Stance→sentiment table; non-call mention needs rationale and span; missing span rejected; shift counts for P=7/14/30 against the fixture |
| `tests/critique.test.ts` | F15 | One call per run regardless of claim count; cache created once, reused, deleted; chunking only above threshold |
| `tests/ledger.test.ts` | F16, F17 | Retry on 429/503/timeout-before-bytes only; attempt rows; reservation formula; reconcile to usage; release on failure; unknown → hold → reconcile; `perVideoMaxUsd` stops the run |
| `tests/standby.test.ts` | F18 | 503 trips the breaker for 15 min; 206 does not; `mode=auto` never sent; 202 poll; credit-exhausted event stored |
| `tests/migrations.test.ts` | F22, F23 | Idempotent and ordered; grep test that no `?` placeholders remain and `postgresSQL` is gone |
| `tests/repos.test.ts` | F24, F25 | Publish writes claims, mentions, spans, transcripts; reviews and settlements reject UPDATE/DELETE; prices carry `source` and `fetched_at` |
| `tests/queue.test.ts`, `tests/resume.test.ts`, `tests/e2e-parallel.test.ts` | F26, F27, F31 | Each job handed out once; stale lease re-claimed; kill after stage N resumes at N+1 with no new reservation; four fixture videos complete concurrently |
| `tests/seed.test.ts` | F28, F29 | Dedupe keeps all `seed_source`; default selection; projection = uploads × cost; projection above budget flags, never blocks |
| `tests/actions.test.ts` | F30 | Every action has a zod schema; unknown action 400; owner scoping on reads and writes |
| `tests/asr-agreement.test.ts` | F32–F35b | Windows cover duration with offsets; agreement on fixtures; two-of-three tie-break; trust from inputs; L3 only via signed review |
| `tests/significance.test.ts`, `tests/leaderboard.test.ts` | F36, F37 | Wilson, t, p, BH against known values; benchmark switch changes output with zero writes; market filter; "not settleable"; `diffBoards` equals a hand-computed fixture |
| `tests/push.test.ts`, `tests/batch.test.ts`, `tests/replay.test.ts` | F39–F41 | Hub challenge echo; bad HMAC rejected; notify enqueues a batch job; batch poll settles the ledger; replay skips Shorts and labels historical |
| `tests/context-check.test.ts` | F50 | Sources outside the window dropped before the prompt; unknown citation → one retry → "no dated sources"; since-then window at settlement |
| `tests/briefing-observation.test.ts`, `tests/sharing.test.ts`, `tests/digest.test.ts` | F51, F53, F54 | Observation shape; edition immutable; revoke and expiry; digest per account |

**System invariants** (`tests/invariants.test.ts`, seeded random sequences over the fake transport and fixture DB):

1. Retries never double-spend: settled cost per (run, stage) equals one reconciled amount for any outcome sequence.
2. Excess is never stored: no `excess*` column in any migration; a benchmark change alters output while every table's row count and checksum stay the same.
3. Every UI column maps to a registry id.
4. Trust is monotonic: a superset of evidence never lowers `trust_level`; only an append to `reviews` reaches L3.
5. `settlements`, `reviews`, `transcripts` are append-only.
6. Every `context_checks.sources[].date` lies inside its window.
7. Every mention and claim evidence row resolves to a span whose copied text hash matches the transcript segment.
8. No `reserved` row older than the hold window exists without a `reconcile` job.

---

## 5. Multi-agent delivery strategy

**Lanes (one agent per lane; a lane owns its files; changes outside go as a PR to the owning lane):**

| Lane | Items | Owns | Prompt outline | Done when |
|---|---|---|---|---|
| infra | F01–F03 | `database.ts`, `transport/*`, `tests/helpers/*`, `tests/fixtures/*`, `verify.yml` | Add PGlite backend and helpers; extract the OpenRouter HTTP from `modelCall`; add the fake transport; keep every existing test green on PGlite | All tests pass on PGlite in CI; `pipeline.ts` no longer calls `fetch` |
| registry | F04, F29, F36–F38 | `metrics/*`, `significance.ts`, `leaderboard.ts` | One registry entry per figure; pure functions over rows; CI test | Registry test green; hover text reviewed |
| settings | F05, F30 | `settings.ts`, `actions/*`, `owner.ts`, new API routes | Schemas from spec 6; dispatch table replaces the switch; owner scoping | Old route deleted; `tests/actions.test.ts` green |
| eval | F06–F08, F19, F21 | `evaluations/gold-set/*`, `scripts/{gold-set,promotion-gate}.ts`, `prompt-versions.json` | The gold-set harness and the gate command; freeze the v5 baseline | Baseline committed; gate runs offline |
| pipeline | F10–F15, F20, F32–F35b | `pipeline.ts`, `contracts.ts`, `evidence-selection.ts`, `sentiment.ts`, `agreement.ts`, `trust.ts`, `native-google*.ts`, `schemas/*` | Three-call pipeline with pointer evidence, mentions and batched critique; then windowed ASR and trust | Gold-set P/R ≥ baseline offline; zero structural rejections |
| ledger | F16, F17, F26, F27 | `store.ts`, `retry.ts`, `reconcile.ts`, `queue.ts`, `runner.ts`, `scripts/worker.ts`, cron route | Idempotent attempts, realistic reservations, SKIP LOCKED queue, resume | Invariants 1 and 8 green; resume test green |
| sources | F18, F34 adapter, F39–F41 | `transcripts.ts`, `circuit-breaker.ts`, `push.ts`, `replay.ts`, `channels.ts` | Supadata standby, breaker, push hub, batch, replay | Standby and push tests green |
| data | F22–F25, F28, F53 | `migrations/*`, `repos/*`, `market.ts`, `settlement.ts`, `seed/*`, `research-store.ts` | Migrations, relational tables, prices and settlements, seed | Repos tests green; no `yi_documents` reads on decision surfaces |
| ui-shell | F42, F43 | `src/app/youtube-intelligence/*`, `ui/*.tsx`, `globals.css` | Side-panel shell and shared components; split `ResearchApp.tsx` | Every page renders with fixture data; no inline tabs remain |
| ui-today, ui-channels, ui-leaderboard, ui-analysis, ui-lab-settings | F44–F48 | `ui/pages/<Page>.tsx`, `actions/<page>.ts` | Build the page from its mockup with shared components; every column from the registry | Registry test includes the page's columns; build green |
| context | F50–F52, F54 | `context-check.ts`, `briefing-observation.ts`, `corpus.ts`, `briefings.ts`, `email.ts` | Dated sources, validation, summary; Finradar observation; File Search | Invariant 6; edition test green |

**Integration order:** infra → registry ∥ settings ∥ eval → phase-0 gate → pipeline ∥ ledger ∥ sources → phase-1 gate → data → queue ∥ seed ∥ api → phase-2 gate → asr ∥ board ∥ automation ∥ ui-shell → five ui-page agents → phase-3 gate → context ∥ finradar ∥ corpus ∥ sharing → phase-4 gate.

**Verification agents on every PR:** code review (correctness, conventions, no `fetch` outside transports and adapters, no unlisted dependency); security review (owner scoping on every action, HMAC on push, share token hashing, env never logged, parameterised SQL, schema output still zod-parsed); spec conformance (item vs spec section, registry coverage, invariants, deviations recorded).

**Workflow mapping:** one Workflow phase per spec phase; each phase = fan out lanes → verify PRs → run gate and write artefact → human approval. Human approval is required at every phase gate; on any PR adding a runtime dependency, changing `prompt-versions.json`, `migrations/*` or settings defaults, or deleting files; on the queue implementation choice (F26); and on freezing live responses or committing gate JSON produced with keys.

---

## 6. Build risks

| Risk | Mitigation |
|---|---|
| PGlite is single-connection, so SKIP LOCKED and advisory locks cannot prove concurrency | Logic tests on PGlite; `scripts/postgres-check.ts` extended and run by the human against a real Postgres before the phase-2 gate; plain Postgres 16 SQL only |
| pg-boss and Graphile Worker need LISTEN/NOTIFY | Own `jobs` table behind a `Queue` interface (approval item) |
| node:test has no mocking framework and no `.tsx` DOM tests | Helpers replace mocks; UI tested through pure view-model functions and `npm run build` |
| Splitting `ResearchApp.tsx` while five page agents work | ui-shell lands first with empty pages and shared components; one file per page agent; the old file deleted only at the phase-3 gate |
| Replacing the action switch breaks the UI mid-phase | Dispatch table keeps old action names as aliases for one phase |
| Prompt promotion without live keys in CI | CI runs offline on frozen responses; live gate runs are human-executed and committed |
| `--experimental-strip-types` cannot strip enums, namespaces or parameter properties | Grep test in `tests/conventions.test.ts` |
| Placeholder migration across every query | One mechanical PR by the data lane with a grep test; other lanes rebase after it |
| Next 16 conventions | Agents read `node_modules/next/dist/docs/` per `AGENTS.md` before touching `src/app` |
| `briefing-read-v1` contract absent from this repo | F51 starts only after the human supplies the current contract file |
| Gold set needs 50 human-verified claims | Human task from phase 0 day one; the harness accepts partial sets flagged "n < 50, advisory" |

---

---

## 7. Neon and Vercel topology (amendment, 17 September 2026; corrected 18 September 2026)

The plan above was written provider-neutral: `DATABASE_URL` and "Postgres". The deployment is Vercel functions against a Neon project in the same region — `syd1` and `ap-southeast-2` as configured — and Neon's pooler, autosuspend and branching change several items. Nothing in phases 0–1 is affected. This section is the binding version wherever it differs from sections 1–6.

### 7.1 What already works and must not be "fixed"

| Concern | Verdict |
|---|---|
| TLS | `database.ts` rewrites `sslmode=require` to `verify-full`; `pg-connection-string` 2.14 maps that to `rejectUnauthorized: true` against the system CA, and Neon serves publicly-issued certificates. Correct as written. Neon's `channel_binding` parameter is ignored by `pg` and harmless |
| Prepared statements | The code never uses named or SQL-level `PREPARE`; node-postgres uses protocol-level prepared statements, which Neon's transaction-mode pooler supports |
| Schema-init lock | `pg_advisory_xact_lock` is transaction-scoped. Only *session*-level advisory locks are unavailable through the pooler, so this call is safe today. F23 still removes it, for the reason in the next row |
| Queue design | `FOR UPDATE SKIP LOCKED` is fully supported through the pooler. The decision to avoid pg-boss and Graphile Worker is now doubly correct: `LISTEN`/`NOTIFY` is not available on a pooled Neon endpoint at all |
| Global transaction lock | **Corrected.** The advisory lock is not confined to schema init: `database.transaction()` takes `pg_advisory_xact_lock(78941002)` on **every** transaction (`database.ts:231-232`), so every write in every invocation serialises on one lock. That, not the init call, is the throughput ceiling. It is removed for throughput and not for compatibility: F23 drops it from `transaction()` and gives each of the twenty `transaction(` call sites that relied on it an explicit replacement (section 8.3) |

### 7.2 Connection topology (new; F22a owns it)

Two connection roles, not one. Neon's own Vercel integration already publishes both names, so we adopt them rather than invent our own.

| Variable | Endpoint | Used by | Why |
|---|---|---|---|
| `DATABASE_URL` | pooled (`-pooler` host) | Next.js functions, cron route | Thousands of short-lived serverless clients; a direct endpoint would exhaust `max_connections` |
| `DATABASE_URL_UNPOOLED` | direct | `scripts/migrate.ts`, `scripts/postgres-check.ts`, `export-research.ts`, `restore-research.ts` | DDL, session advisory locks, `SET search_path`, temporary tables and `pg_dump` are all unavailable in transaction pooling mode |

Required with it:

- `attachDatabasePool(pool)` from `@vercel/functions` immediately after the pool is constructed. `maxDuration = 800` implies Fluid Compute, where a suspended invocation otherwise keeps idle `pg` clients — and therefore Neon connections — alive. This is the one new runtime dependency phase 2 adds; it is a first-party Vercel package.
- Pool `max` from `YTI_POOL_MAX` (default 4) rather than the hard-coded `max: 3`, and **not** from `processing.parallelVideos`: `parallelVideos` lives in a document that is read *through* the pool, so it cannot size the pool that fetches it.
- Lease derived from `timeoutMs` and renewed **before every attempt** inside `withRetry`, with `lease = timeoutMs × 1.5`. Transports time out at 240 s per attempt (`google-native.ts:225`, `openrouter.ts:105`) and `withRetry` allows `maxRetriesPerStage + 1` attempts (default 4, cap 10; `pipeline.ts:336`), so one `modelCall` can run about sixteen minutes and a multi-chunk critique longer — no fixed lease survives that.
- One `json(value)` reader and one `iso(value)` reader at the row boundary, with the repositories the only readers of row JSON.
- Type parsers on **both** drivers: `pg.types.setTypeParser(1700)` → number and 1184 → ISO string; PGlite `parsers: {1700, 1184}`. PGlite's default number parser covers OIDs 21, 23, 26, 700, 701 only, so `numeric` arrives as a string there too.
- `pool.on("error")` classified rather than logged: Neon suspends idle computes and recycles pooler connections, so a dropped connection is a normal, retryable event. The worker must reconnect and re-poll; a run whose transaction was cut stays leased until `lease_until` expires and is re-claimed, which F27 already guarantees.
- Region check before the phase-2 gate: the functions and the Neon project must be in the same region. `vercel.json` pins the function region, so the check is that the pinned value matches the Neon project's. The pipeline issues many small queries per stage, so a cross-region pairing multiplies every round trip. `docs/finradar-production-plan.md` flagged this and it was never verified. Recorded beside it, the **Postgres major version**: the branch used for checks and the production project must match the major that PGlite ships, since PGlite 0.5 ships Postgres 17 and the tests prove the dialect only if the two agree.

### 7.3 Migrations on Vercel (amends F22)

F22 said migrations are applied "at worker start, by `scripts/migrate.ts`, and by the test DB helper". That leaves the web deployment unmigrated: Vercel has no release phase, and after F26 the only worker is the cron inside that same deployment, so there is no worker start-up to hook. Corrected:

1. Migrations run in the Vercel **build command** (`npm run migrate && next build`), against `DATABASE_URL_UNPOOLED`, holding a session advisory lock so concurrent builds serialise. This is Neon's own documented pattern for the integration.
2. A **preview guard** in `migrate.ts`: it refuses to run when `VERCEL_ENV=preview` and the host of the unpooled URL equals `YTI_PRODUCTION_DB_HOST`. That variable is set in **all** environments, and its value is the host of the production `DATABASE_URL_UNPOOLED` — which lacks the `-pooler` infix, so the comparison is against the direct host. Without the guard, one preview build with a misconfigured branch migrates production.
3. **Precondition:** the Neon integration must be enabled, and `DATABASE_URL_UNPOOLED` and `YTI_PRODUCTION_DB_HOST` set, **before F22a merges**. Afterwards every deploy fails at build for want of `DATABASE_URL_UNPOOLED`.
4. Each migration file runs inside one transaction. Any statement that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`) is marked in the file and run outside it; at current data volumes a plain `CREATE INDEX` is acceptable and preferred.
5. The application **fails fast** instead of self-healing: `initialize()` reads `yi_migrations` and throws `Schema version N required, M applied` when the applied version is behind the version the code expects. No function creates or alters a table. This replaces the `CREATE TABLE IF NOT EXISTS` bootstrap that currently runs on every cold start. Fail-fast is **one-directional**: code newer than the schema throws, schema newer than code is allowed — which is what makes the next rule safe.
6. **Expand and contract.** The build migrates before the new functions are live, so old code runs against the new schema for minutes. Additive migrations therefore ship freely. **A type change to an existing column ships in its own migration (`0005`) and is applied with the queue paused and drained:** `YTI_QUEUE_PAUSED=true`, zero `running` runs, and `migrate.ts` refuses `0005` while any run is `running`. Changing `payload` to `jsonb` or `lease_until` to `timestamptz` in the same deploy as other work breaks the running code mid-step.
7. A Neon branch is taken immediately before the first migration against production, as the rollback path; the PITR retention window is recorded in the gate artefact. This is instant and copy-on-write, and supersedes a file export as the pre-migration snapshot.
8. Preview deployments: **decided — the Neon–Vercel integration with one branch per preview** (`preview/<git-branch>`, auto-deleted with the git branch), so each preview build migrates a throwaway copy of its own. `YTI_PREVIEW_READ_ONLY=true` stays set on previews as spend protection, no longer as the only protection.

### 7.4 Column types (amends F22, F24, F25)

The v1 schema stores timestamps as ISO `TEXT` in five places, money as `DOUBLE PRECISION`, and lease deadlines as epoch `BIGINT`. Phase 2 rewrites every table anyway, so it is the only cheap moment to fix this; after F24 writes real rows a type change costs a rewriting migration.

- `timestamptz` for every instant. The leaderboard windows, the sentiment-shift period comparison and the settlement horizons are all date arithmetic over ranges, which text defeats.
- `numeric(12,6)` for USD amounts (ledger, reservations, settlements, cost per claim) and `numeric` for prices. Float money in a product whose gate threshold is "cost per accepted claim ≤ US$0.25" is indefensible.
- `jsonb`, not `TEXT`, for payloads and for `output`, which removes the `payload::jsonb` cast that `postgresSQL()` currently rewrites.
- `lease_until` becomes `timestamptz`; the epoch-millisecond comparison disappears with it.

The types are only half of it; the **drivers' return shapes** are the other half, and the amendment was wrong about them. `pg` returns `jsonb` as an object, so the 14 `JSON.parse(String(row.col))` sites break, and `parseMetrics` silently returns `{}` for a non-string (`store.ts:335-345`) — hence one `json(value)` reader that accepts either a string or an object. `pg` returns `numeric` as a string, and so does PGlite, whose default number parser covers OIDs 21, 23, 26, 700, 701 only — hence the 1700 parser registered on both drivers, and money summed in SQL rather than in JavaScript. Both drivers return `timestamptz` as a JS `Date`, and `convert()` does `String(r.created_at)` (`store.ts:17-18`), which yields a non-ISO string and silently breaks `.slice(0,10)` in `trends.ts:17`, in `market.ts:165` (which feeds `scoreCall`'s entry date) and in three components — hence 1184 → ISO string on both drivers, the `iso(value)` reader at the boundary, and a grep gate on `String(r.*_at)` outside the helpers. Finally `claimNext` passes `Date.now()` into `lease_until<$1` and `save` writes `lease_until=0` (`store.ts:101`), so F23 rewrites the lease SQL for `timestamptz` in the same pass.

### 7.5 Worker hosting (decides F26)

**Decided: the Vercel cron is the worker.** Each per-minute invocation claims jobs up to a **global** running cap and steps them concurrently within its own window. There is no separate host, and spec 4.7's "always-on host with pg-boss or Graphile Worker" is replaced. Vercel Queues (beta) was considered and rejected: at-least-once push callbacks, nothing testable on PGlite, and none of the lease and resume semantics we need.

Four things make that safe, and F26 delivers all of them.

- **The cap is global, enforced inside the claim transaction.** `processWindow` is sequential for 90 s (`runner.ts:49-58`) and Vercel does not suppress overlapping ticks, so a per-invocation `parallelVideos` would multiply by roughly thirteen. Instead `n = parallelVideos − count(jobs WHERE kind='analyze' AND status='running' AND lease_until > now())`, claimed in one `FOR UPDATE SKIP LOCKED` statement under `pg_try_advisory_xact_lock(<queue key>)`; an invocation that claims nothing exits at once.
- **Settle-then-die cannot double-spend.** `claimNext` leases 600 s (`store.ts:101`), `maxDuration` is 800 s, `reserve()` blocks only while an attempt is `reserved` or `unknown` (`store.ts:126,151`), and `settle` commits inside `modelCall` (`pipeline.ts:356`) while the run itself only advances at `save()` after the whole `step()` (`runner.ts:22`). So A can settle, be killed before `save`, and B re-claim at the same stage, find only a `completed` attempt, reserve and pay again. Closed by request-hash replay from the retained response, token-fenced `reserve` and `settle`, and takeover flipping the previous holder's open attempts to `unknown`; F27's kill matrix covers the gap between `settle` and `save` explicitly.
- **Deadlines are handed to the work, not hoped for.** Each job gets an `AbortSignal` that fires at the invocation deadline, so it releases or marks itself unknown before the platform kills it; the dispatcher stops claiming once the remaining window is under `timeoutMs + 30 s`.
- **No filesystem control files, no reliance on SIGTERM.** The existing `scripts/worker.ts` signals through `data/worker.pid` and `data/worker.stop`, which does not survive an ephemeral or read-only filesystem; it becomes a thin local loop over the same `Queue`. Connection loss stays retryable, and `YTI_QUEUE_PAUSED` is honoured by the dispatcher.

A separate host remains an option behind the same `Queue` interface, should the per-minute window ever prove too short.

### 7.6 Gates (amends F31, F49a and F49b)

PGlite is single-connection, so it can prove queue *logic* and nothing about contention or pooled-mode behaviour. Before the phase-2 gate, `scripts/postgres-check.ts` runs against **a Neon branch through the pooled endpoint** — the configuration production actually uses — and is extended to assert the pooled-mode behaviour explicitly. The wording matters: through a transaction-mode pooler these statements **succeed but are not honoured across transactions**, which is the dangerous shape, so the check asserts the observable consequence rather than an error. A second client's `pg_try_advisory_lock(k)` returns **true** while the first client believes it holds `k`; a temporary table created in one transaction is **absent** in the next; `SET search_path` does not persist across transactions. Alongside them: `SKIP LOCKED` hands each job to exactly one of N concurrent claimants, N concurrent `claim()` calls never exceed the global running cap, the type parsers return numbers and ISO strings, `attachDatabasePool` is present, and the region and Postgres major version are recorded. The phase-3 gate adds an `EXPLAIN` check for each leaderboard and sentiment-shift query against a Neon branch seeded at realistic volume, since those are the queries that will dominate Neon compute time.

### 7.7 Storage and compute cost (amends F29)

F29 projects model spend only. Windowed ASR (F32) stores a transcript and a window row per video, F24 adds a span row per claim evidence item, F25 adds a settlement row per horizon per call, and F50 adds a context check per claim; Neon bills storage and compute-hours on top of the model bill. F29 gains a stored-bytes and row-growth metric alongside the model projection, and the registry entry states plainly that the Neon line is not in the model budget. A compute queried every minute never scales to zero, so Neon compute-hours are a **fixed monthly line**, not a burst cost, and the metric states it as such. Backup is not the existing script: `scripts/backup.ts` is SQLite-only and is deleted in F23 together with `scripts/migrate-sqlite.ts`. The Postgres backup path is `export-research.ts` plus `restore-research.ts`, with a Neon branch taken before each production migration as the rollback; the runbook is updated to match. Related rule for F24 and F32: transcript and ASR-window tables are never selected with `SELECT *` from list queries — projections only — so megabytes of text do not cross the pooler for a table view.

### 7.8 Risk table additions

| Risk | Mitigation |
|---|---|
| Pooled and direct endpoints have different capabilities, and one variable cannot serve both | Two variables with defined roles (7.2); `postgres-check.ts` asserts the pooled constraints (7.6) |
| Fluid Compute suspends invocations holding idle pool clients | `attachDatabasePool` from `@vercel/functions` (7.2) |
| Vercel has no release phase, so a deploy can run ahead of its schema | Migrations in the build command against the unpooled URL; the app fails fast on a version mismatch rather than creating tables (7.3) |
| Neon autosuspend drops idle connections under a long-lived worker | Connection loss classified as retryable; lease expiry re-claims the run (7.2, F27) |
| Neon compute in a different region from the functions multiplies per-query latency | `vercel.json` pins `regions`, a test asserts it stays pinned, and the pairing plus the Postgres major version are verified and recorded before the phase-2 gate (7.2) |
| An attempt settles and the invocation dies before `save`, so a re-claim pays the provider twice | Request-hash replay from the retained response, token-fenced `reserve`/`settle`, takeover to `unknown`; F27 kills between `settle` and `save` and asserts one settled amount (7.5) |
| Vercel does not suppress overlapping cron invocations, so a per-invocation cap multiplies by the number of live ticks | The running cap is global and enforced inside the claim transaction; an invocation that claims nothing exits at once (7.5) |
| A type change to an existing column lands while the previous deployment is still serving requests | Type flips ship alone in `0005`, applied with `YTI_QUEUE_PAUSED=true` and zero running runs, `migrate.ts` refusing otherwise; fail-fast is one-directional so schema-ahead-of-code is safe (7.3, 7.4) |

---

## 8. Phase 2–4 plan, revised (18 September 2026)

Section 7 corrects the Neon amendment; this section replaces the phase 2–4 content of sections 1–6 wherever it differs, following a full re-read of the spec, the phase-1 conformance report, a read-only exploration of the data layer, the UI and API and the operational scripts, and an adversarial pass that found four blocking design errors in the first cron-as-worker draft. Four decisions frame it. **Worker host:** the Vercel cron is the worker, each per-minute invocation claiming jobs up to a global running cap and stepping them concurrently; no separate host. **Previews:** the Neon–Vercel integration with one branch per preview, the build migrating that branch, `YTI_PREVIEW_READ_ONLY=true` kept as spend protection. **Identity:** wait for Finradar identity — owner scoping (F30), L3 signing (F35), the sharing rework (F53) and the per-account digest (F54) are deferred, and viewer settings persist to the existing single `DEFAULT_ACCOUNT` document. **Sequencing:** thin vertical slice first — phase 3 splits into 3a (shell, shared components, Today and Analysis over text-checked calls) and 3b (ASR, agreement, L2, leaderboard, automation, the remaining pages).

Phases 0 and 1 are built, verified and merged (`147ce70`): 19 of 53 items, 197 tests on both drivers, typecheck and build clean. Their gates stay advisory until the human inputs in 8.9 arrive.

### 8.1 Phase-2 items

| Lane / order | ID | Item | Requirements (additions from this review in bold) |
|---|---|---|---|
| data 1 | F22 | Migration runner | Numbered SQL under `src/server/youtube-intelligence/migrations/`; `yi_migrations(version, name, applied_at, checksum)`; `scripts/migrate.ts` requires `DATABASE_URL_UNPOOLED` (PGlite in tests), session advisory lock, one transaction per file, **preview guard (7.3)**; `0001_baseline.sql` = today's nine tables with `IF NOT EXISTS`, **stamped version 1 on an existing database**; `tests/helpers/db.ts` runs the migrator; **PGlite `initialize()` migrates before the version check**; README states the expand/contract rule and the pause-and-drain rule for type changes |
| data 2 | F23 | Postgres-only `database.ts` | Delete `node:sqlite`, `postgresSQL()`, `YTI_DB_PATH`, `scripts/backup.ts`, `scripts/migrate-sqlite.ts`; `$n` everywhere; **remove `pg_advisory_xact_lock(78941002)` from `transaction()` and replace at every site (8.3)**; `json(value)` and `iso(value)` readers; `parseMetrics` uses `json()`; **type parsers for 1700 → number and 1184 → ISO on both drivers**; `create` dedupe by partial unique index and `ON CONFLICT DO NOTHING`; `reserve` by the open-attempt rule; `settle` cost update scoped to the run (all three below). Grep gate: no `node:sqlite`, `postgresSQL`, `?` placeholders, `78941002`, `JSON.parse(String(`, `String(r.*_at)` outside the helpers |
| data 3 | F22a | Neon topology and fail-fast | `DATABASE_URL` (pooled) for functions; `DATABASE_URL_UNPOOLED` for `migrate.ts`, `postgres-check.ts`, `export-research.ts`, `restore-research.ts`. `@vercel/functions` + `attachDatabasePool(pool)`. **Pool `max` from `YTI_POOL_MAX` (default 4) — not from `parallelVideos`, which lives in a document read through the pool.** `initialize()` reads `yi_migrations`, throws `Schema version N required, M applied` when behind; no DDL at runtime. `pool.on("error")` classified retryable. `env.ts` adds `DATABASE_URL_UNPOOLED`, `YTI_PRODUCTION_DB_HOST`, `YTI_POOL_MAX`, `YTI_QUEUE_PAUSED` and the hosted keys as optional — `CRON_SECRET`, `YTI_ACCESS_TOKEN`, `YTI_APP_ORIGIN`, `YTI_PREVIEW_READ_ONLY`, `YTI_EMAIL_TO`, `YTI_EMAIL_FROM`, `YTI_EMAIL_SEND_ENABLED`, `RESEND_WEBHOOK_SECRET`, `YTI_BUDGET_USD`, `YTI_TRANSCRIPT_CREDIT_BUDGET` — with `missingRequiredHosted()` reported by name on `/api/intelligence/status`. `vercel.json` `"buildCommand": "npm run migrate && next build"`; `package.json` `"migrate"`. Runbook updated. **Precondition: the human has enabled the Neon integration and set `DATABASE_URL_UNPOOLED` and `YTI_PRODUCTION_DB_HOST` (all environments) before this merges** |
| data 4 | F24 | Relational tables and repositories | `0003_relational.sql` **creates new tables only**: `channels`, `claims`, `mentions`, `evidence_spans`, `transcripts`, `reviews` (no writer until identity), `instruments`, `jobs`. Types `timestamptz`, `numeric(12,6)` USD, `jsonb`. `repos/*.ts` are the only readers and writers; publish writes rows; `researchSnapshot()` reads rows for claims, mentions and channels; `claims.trust_level` stores `L0–L3`. `scripts/migrate-documents.ts` moves `channel`, `managedCaption` (→ `transcripts kind=caption`) and completed runs' claims and mentions once, idempotently. Partition 8.4. No `SELECT *` on transcript tables in list queries |
| data 5 | F24b | Type flips on existing tables | **`0005_types.sql`** (numbered after F25's `0004`): `yi_documents.payload`, `yi_runs.input/output`, `yi_calls.metrics`, `yi_responses.payload`, `yi_events.payload`, `yi_prompts.payload`, `yi_discoveries.payload`, `yi_shares.snapshot` → `jsonb`; `*_at` and `lease_until` → `timestamptz`; `cost` and `amount` → `numeric(12,6)`. Readers already accept both shapes (F23). **Applied in production only with `YTI_QUEUE_PAUSED=true` and `yi_runs` drained** — a runbook step, asserted by `migrate.ts` refusing `0005` while any run is `running` |
| ledger 1 | F17b | Ledger follow-ups | Verify `costUsd` is already the settled amount at `pipeline.ts:356` (mark the phase-1 bullet done rather than redoing it); `priceTableVersion` stored with each settled call; `rejectedMentions[].kind ∈ extraction\|critic`; `audit-institutional-chinese.ts` ported or deleted with a note. Edits `pipeline.ts modelCall` and `store.ts` — hence first in the lane |
| ledger 2 | F26 | Jobs queue with the cron dispatcher as worker | `jobs(id, kind, payload jsonb, status, run_at, lease_until timestamptz, lease_token, attempts, last_error, created_at)`; kinds `analyze, settle, push-renew, batch-poll, reconcile`; **`claim()` enforces the global cap in one statement**; **one token across `jobs` and `yi_runs`** — the claim transaction writes the job token into `yi_runs.lease_token` and `save`, `reserve`, `settle` and `renew` all fence on it; **`renew(jobId, token)` called before every attempt inside `withRetry`, lease = `timeoutMs × 1.5`**; **request-hash replay**: `modelCall` hashes the request and, before reserving, looks for a `completed` attempt with the same `(run_id, stage, request_hash)` and a retained response (`yi_responses` keyed by call id, `store.ts:444`), replaying `retainedResponse()` instead of calling the provider; **`reserve` and `settle` take the token**; **takeover flips the previous holder's `reserved` rows to `unknown`** for `reconcile`; dispatcher `processWindow(maxDuration − 60 s)`, stops claiming when the remaining window is `< timeoutMs + 30 s`, an `AbortSignal` per job at the deadline, exits when it claims nothing; `sweep` → singleton `reconcile` job; `scripts/worker.ts` = thin local loop over `Queue`, no `data/` files; `health.workerOnline` window from the cron cadence; `YTI_QUEUE_PAUSED` honoured by the dispatcher |
| ledger 3 | F27 | Restart-safe resume | Tests on PGlite with a fake transport: kill **between `settle` and `save`** → resume replays, zero new provider calls, one settled amount; kill mid-attempt → lease expiry → takeover → `unknown` → reconcile; a stale holder's `save` and `settle` rejected by the token; kill after each real checkpoint (`pipeline.ts:775`, `:870`, the critique pending filter) resumes without a new reservation |
| prices 1 (after F26) | F25 | Prices and settlements | `0004_prices_settlements.sql`: `prices(ticker, date, adjusted_close, source, fetched_at)` replaces the `prices` and `priceSnapshot` documents; `instruments` from `instrument`; `settlements` append-only per horizon per `record` **storing entry and exit only**; `settlement.ts` = pure entry/exit selection; benchmark arithmetic at query time; the `settle` job kind (from F26) runs the sweep; `metrics/context.ts` reads the table; `performance` documents deleted. `scoreCall` splits into stored entry/exit selection and query-time benchmark arithmetic from `prices` for the viewer's benchmark, and the hard-coded SPY assertion (`performance.ts:47,116-122`) is dropped. Forward record: settlements key on `claims` rows whose run was first observed after the channel's follow date; the frozen `forwardObservation` copy stays a Lab document and is not the scoring input |
| seed 1 (after F24) | F28 | Channel seed | Writes `channels` rows. Seed lists LeapEdge 47 + TrueAlphaData ~20 |
| seed 2 | F29 | Cost projection and budget meter | Plus the Neon storage and row-growth metric (7.7) |
| api 1 (after F24) | F30 | API restructure | Dispatch table `{action: {schema, handler, mutating}}` per resource module; per-action zod replaces the shared envelope (`route.ts:55-57`); aliases for one phase; `guard()` unchanged; **no owner scoping**; routes under `/api/youtube-intelligence/*`; the old route deleted at the 3a gate |
| eval 1 | F06a | Gold-set drafting tool | `scripts/gold-draft.ts --runs runs.json --out gold-draft.json`: one `status: "pending"` case per completed run, claims and mentions pre-filled, spans from `source_span`, `anchorVerified: false`; validates with `parseGoldSet` (`evaluations/gold-set/schema.ts:143`) |
| gate | F31 | Phase-2 gate | PGlite: four fixture videos in parallel end to end; the F27 kill matrix; seed dedupe; migrations idempotent; `0005` refuses while a run is `running`. **Neon branch through the pooled endpoint** (human runs, JSON committed): N concurrent `claim()` hand out each job once and never exceed the cap; a second client's `pg_try_advisory_lock(k)` returns true while the first believes it holds `k`; a temp table is absent in the next transaction; `SET search_path` does not persist; type parsers return numbers and ISO strings; `attachDatabasePool` present; region recorded. Conformance report against spec 9 row 2 |

Gaps this closes, for the record: `yi_documents` left implicit by F24 (8.4); the `settlement` kind having no production writer though `metrics/context.ts:57` reads it, and `performance` documents computed on demand at `market.ts:207`; `sweep()` relying on the global lock for its lease atomicity (`runner.ts:27-32`); `processWindow` being sequential for 90 s (`runner.ts:49-58`) with overlapping ticks unsuppressed; the phase-1 open items being unowned; nothing drafting gold cases; `env.ts` modelling one connection string and none of the hosted variables; `create()` deduping on the full `input` JSON (`store.ts:60-84`), which holds prompt snapshots up to 30 KB and is unindexable — replaced by a partial unique index on `(video_id, model, prompt_version, md5(input::text)) WHERE status IN ('queued','running')` with `ON CONFLICT DO NOTHING` then a re-select, the md5 taken over canonical text because `jsonb` equality is key-order-insensitive and would change dedupe semantics; `reserve()` being unable to "lock the `(run_id, stage)` row" when no row yet exists — replaced by a partial unique index `yi_calls(run_id, stage) WHERE status IN ('reserved','unknown')`, a per-run cap via `SELECT … FROM yi_runs WHERE id=$1 FOR UPDATE`, and the all-runs budget check under `pg_advisory_xact_lock(<budget key>)` held for milliseconds; two lease models with no rule; `settle()` running `UPDATE yi_runs SET cost=…` over every run on every call (`store.ts:232-236`); and PGlite bootstrap versus fail-fast, where `initialize()`'s PGlite path applies migrations before the version check. Vercel Queues (beta) was rejected and recorded.

### 8.2 Lanes and file ownership

| Lane | Serial items | Owns |
|---|---|---|
| data (blocking) | F22 → F23 → F22a → F24, then F24b once F25 has merged | `database.ts`, `migrations/*`, `repos/*`, `research-store.ts` reads, `env.ts`, `vercel.json`, `package.json`, runbook |
| ledger | F17b → F26 → F27 (start after F23) | `store.ts`, `pipeline.ts` (`modelCall`, `withRetry`), `runner.ts`, `queue.ts`, `scripts/worker.ts`, cron route |
| prices | F25 (start after F26) | `market.ts`, `performance.ts`, `settlement.ts`, `metrics/context.ts`, `0004` |
| seed | F28 → F29 (start after F24) | `seed/*`, `channels.ts`, `metrics/cost.ts` |
| api | F30 (start after F24) | `actions/*`, new routes |
| eval | F06a (any time) | `scripts/gold-draft.ts` |

### 8.2a Migration numbers (binding; no item picks its own)

Numbers drifted once already: the plan as first written gave F24 `0002`, which F23 then took for its indexes, and double-booked `0004` between F24b and F50. One table owns the allocation.

| Number | File | Item | Phase |
|---|---|---|---|
| 0001 | `0001_baseline.sql` | F22 | 2 (merged) |
| 0002 | `0002_locks.sql` | F23 | 2 (merged) |
| 0003 | `0003_relational.sql` | F24 | 2 |
| 0004 | `0004_prices_settlements.sql` | F25 | 2 |
| 0005 | `0005_types.sql` | F24b | 2 |
| 0006 | `0006_saved_calls.sql` | F48 | 3b |
| 0007 | `0007_context_checks.sql` | F50 | 4 |
| 0008 | `0008_briefing_observations.sql` | F51 | 4 |

**Merge order.** A migration merges only once every lower-numbered migration has merged. The runner applies unapplied files in version order, but it does not re-order them against a database that already skipped one: a higher migration referencing a table a lower one creates would simply fail. This is why F24b (`0005`) follows F25 (`0004`) rather than sitting next to F24 in the data lane, and it is the reason 8.2's data lane reads "F24, then F24b once F25 has merged".

Two related properties the runner already has, from F22: a version recorded as applied whose file is missing is an error only when a **higher**-numbered file is present (a deleted or renamed migration); with nothing higher on disk the database is simply ahead of the checkout, which is reported and skipped so `npm run migrate` still works during a rollback. And an applied file that is edited afterwards is rejected by its checksum.

### 8.3 Replacements for the global transaction lock (binding for F23)

| Site | Replacement |
|---|---|
| `store.ts create` dedupe | partial unique index + `ON CONFLICT DO NOTHING` |
| `store.ts claimNext` | `FOR UPDATE SKIP LOCKED` (moves into `queue.ts` in F26) |
| `store.ts reserve` | partial unique index on open attempts; `FOR UPDATE` on the run row; budget check under `pg_advisory_xact_lock(<budget key>)` |
| `store.ts markUnknown`, `release` | `FOR UPDATE` on the call row |
| `store.ts settle` | scoped `UPDATE yi_runs … WHERE id=$1` |
| `runner.ts sweep` | singleton `reconcile` job, via a partial unique index on `jobs(kind) WHERE status IN ('pending','running')`, enqueued by the dispatcher each tick |
| `research-store.ts seed()` prompt insert | `ON CONFLICT DO NOTHING` on `yi_prompts` |
| `research-store.ts forwardObservation` | insert-if-absent (`ON CONFLICT DO NOTHING`), never upsert — the forward freeze must not be overwritten |
| `experiments.ts finishExperiments` | `FOR UPDATE` on the experiment row |
| `transcripts.ts pace()` | `pg_advisory_xact_lock(hash(provider))` around the read-modify-write |
| `transcripts.ts` admission (`:331`) | `FOR UPDATE` on the attempt row + unique constraint on `(provider, mode, video_id, lang)` |
| `webhooks.ts`, `email.ts` delivery read-then-put | `FOR UPDATE` on the document row; ignore an event older than `eventAt` |

### 8.4 `yi_documents` partition (binding for F24)

| Becomes a table | Stays a document (Lab, config, cache) | Deleted |
|---|---|---|
| `channel` → `channels`; `managedCaption` → `transcripts`; completed runs' claims and mentions → `claims`, `mentions`, `evidence_spans`; `instrument`, `prices`, `priceSnapshot` → `instruments`, `prices` (F25); `settlement` (fixture-only) → `settlements` (F25); `idea` → `saved_calls` (3b, F48) | `teamPreferences`, `accountPreferences`, `preferences` (legacy; migrated then deleted), `experiment`, `evaluation`, `comparison`, `review` (Lab), `improvement`, `reference`, `audioReview`, `transcriptAccuracy`, `captionBenchmark`, `researchWhitePaper`, `managedCaptionAttempt`, `captionRate`, `captionProviderNotice`, `supadataBatch`, `circuitBreaker`, `channelCandidate`, `channelSearch`, `entity`, `entitySuggestion`, `entityMerge`, `watchlist`, `forwardObservation`, `publication`, `briefing`, `delivery`, `emailEvent` | `performance` (F25), `scheduler` (F26), `test` |

### 8.5 Deferred until Finradar identity

F30 owner scoping; F35 L3 signing and the `reviews` writer; F53 sharing rework; F54 per-account digest. Those rows are marked "deferred: identity" in sections 1 and 2. Viewer settings persist to the existing single `DEFAULT_ACCOUNT` document until identity lands.

### 8.6 Phase 3a — thin vertical slice

Starts after F24, F24b and F30 merge.

| ID | Item | Notes |
|---|---|---|
| F42 | UI shell | `src/app/youtube-intelligence/layout.tsx`, side panel; `/research` and `/` redirect; `ResearchApp.tsx` and `IntelligenceApp.tsx` stay mounted under Lab until 3b |
| F43 | Shared components | `TrustBadge`, `ConvictionChip`, `Tooltip`, `MetricHeader` (hover from `renderHover`), `DataTable`, `StateChip`, `BenchmarkSelector`, `PeriodSelector`; first `.tsx` consumer of `metrics/registry.ts`; dark tokens exist |
| F35a | Trust L0–L1 | From the deterministic checks plus the critic verdict at publish; `trust_basis` jsonb; L2 and L3 render "not yet" |
| F38 | Sentiment shift | Query over `mentions` for P against the prior P with a trust filter; registry entries; drill-down |
| F38b | Consensus per ticker | `metrics/consensus.ts`: open calls by stance → agree / lean / split; reused by F36 |
| F44 | Today | Ranked L1 calls, consensus panel, sentiment-shift panel, analyse-now box, needs-review list. **Team document value** `trust.minimumLevelForToday = "text-checked"` until the 3b gate; the **schema default** at `settings.ts:190` stays `audio-agreed` per spec 6.2, and the 3b gate restores the document value. L0 is never shown (spec 4.6) |
| F47 | Analysis | Lift `Report` and `SourcePlayer` from `IntelligenceApp.tsx` into `ui/pages/Analysis.tsx`; trust strip; cards by trust then conviction; evidence viewer; play-from; agreement score and context-check line render "not yet"; Processing details collapsible |
| F49a | Gate 3a | Registry CI with every Today and Analysis column mapped; Today renders from the fixture DB; build green; the old `/api/intelligence/research` route deleted; human walk-through recorded |

### 8.7 Phase 3b

Serial: F32 → F33 → F34 → F35b (L2) → F36 (reuses F38b) → F37 → F39 → F40 → F41 → F45 → F46 → F48 (deletes the two old apps) → F49b.

| Gate 3b criterion | Requirement |
|---|---|
| Anchor accuracy | ≥95% of L2 anchors within 2 s on the gold set |
| Push to Today | end to end with a fixture hub |
| Benchmark change | writes nothing |
| Changes diff | equals the hand-computed fixture |
| Board queries | `EXPLAIN` against a Neon branch seeded at realistic volume |
| `trust.minimumLevelForToday` | restored to `audio-agreed` |

### 8.8 Phase 4

Serial: F50 → F51 → F52 → F55. F51 starts only once the current `briefing-read-v1` contract file is supplied. F53 and F54 are deferred: identity.

### 8.9 Human inputs and one-time setup

| # | Input | Note |
|---|---|---|
| A | `gold-cases.json` — 50 verified gold cases | F06a drafts them for review; the harness accepts a partial set flagged "n < 50, advisory" |
| B | `runs.json` under v5 per gold video | Gate 0–1 binding |
| C | Frozen responses | Captured once with live keys via `scripts/freeze-responses.ts` |
| D | `runs.json` under v7 per gold video | Gate 1 binding |

Nothing in phases 2–4 waits on A–D; gates 0 and 1 stay advisory until they arrive.

One-time, **before F22a merges**: enable the Neon integration on the `youtube-intelligence` Vercel project with per-preview branches; set `DATABASE_URL_UNPOOLED` (from the integration) and `YTI_PRODUCTION_DB_HOST` in all environments; confirm the Neon region matches the region pinned in `vercel.json` and record the Postgres major version; link the Vercel project to GitHub with production branch `main`.

Before the phase-2 production deploy, in order: take a Neon branch; set `YTI_QUEUE_PAUSED=true`; wait for zero `running` runs; deploy; unpause.
