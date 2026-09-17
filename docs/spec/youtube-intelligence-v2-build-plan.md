# YouTube Intelligence v2 — build plan

**Status:** Approved build plan, 17 September 2026. Companion to `youtube-intelligence-v2-spec.md` (revision 2). This document lists every feature needed to deliver the spec, which features are serial and which parallel, the loop each build agent follows, the backend test plan, and the multi-agent delivery strategy.

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
| F18 | Supadata standby: explicit `mode=native|generate`, batch endpoint, per-vendor circuit breaker (TranscriptAPI 5xx/429/timeout → Supadata for `standbyCooldownMinutes`; 206 never trips it), credit-exhausted stored event and banner payload | `transcripts.ts` (`managedTranscript`), `src/server/youtube-intelligence/circuit-breaker.ts`, `research-store.ts` (`event`) | 4.10 |
| F19 | Prompt v7: pointer output, mentions with sentiment, conviction rubric; seeded into `yi_prompts`; promoted only through F08 | `prompt-versions.json`, `prompts.ts` | 4.2, 10 |
| F20 | Retire `youtubejs.ts`, `additional-transcript-formats.ts` and their tests; `audio-review.ts` demoted to Lab; `provider.only` pin removed; `transport.default` flag keeps the old path selectable for the comparison week | delete `youtubejs.ts`, `additional-transcript-formats.ts`, `tests/youtubejs.test.ts`, `tests/additional-transcripts.test.ts`; `package.json` (drop `youtubei.js`) | 4.10, 12 |
| F21 | Phase-1 gate run: v5 vs v7 on the gold set; standby injection test; report | `tests/standby.test.ts`, `docs/gates/phase-1-<date>.json` | 9 |

### Phase 2 — Postgres-only, relational core, queue, seed

| ID | Feature | Files | Spec |
|---|---|---|---|
| F22 | Migration runner: numbered SQL files, `yi_migrations` table, applied at worker start, by `scripts/migrate.ts`, and by the test DB helper; the `CREATE TABLE IF NOT EXISTS` string removed | `src/server/youtube-intelligence/migrations/0001_baseline.sql`, `migrations/index.ts`, `scripts/migrate.ts`, `database.ts` | 4.7 |
| F23 | Postgres-only `database.ts`: delete `node:sqlite`, `postgresSQL()`, `YTI_DB_PATH`; `$n` placeholders everywhere; drivers `pg.Pool` and PGlite; the global advisory lock replaced by row locks | `database.ts`; every file with `?` placeholders (`store.ts`, `research-store.ts`, `channels.ts`, `briefings.ts`, `market.ts`); test headers | 4.7 |
| F24 | Relational tables and repositories for `claims`, `mentions`, `evidence_spans`, `transcripts`, `reviews`, `channels`, `shares`; publish stage writes rows; `researchSnapshot()` reads rows; one-off `scripts/migrate-documents.ts` for existing lab data | `migrations/0002_relational.sql`, `src/server/youtube-intelligence/repos/*.ts`, `pipeline.ts` (publish), `research-store.ts` | 8 |
| F25 | `prices` and `settlements` tables; `prices()` stores bars with `source` and `fetched_at`; settlement sweep writes append-only rows per horizon using `scoreCall`; `record` forward/historical; the `performance` document removed | `migrations/0003_prices_settlements.sql`, `market.ts`, `src/server/youtube-intelligence/settlement.ts`, `performance.ts` | 4.11, 4.12, 8 |
| F26 | Postgres queue and always-on worker: `jobs` table with `FOR UPDATE SKIP LOCKED`, kinds `analyze`, `settle`, `push-renew`, `batch-poll`, `reconcile`; `parallelVideos` concurrency; lease fencing kept from `claimNext`/`save`; cron route reduced to health and poll fallback | `src/server/youtube-intelligence/queue.ts`, `store.ts`, `runner.ts`, `scripts/worker.ts`, `src/app/api/cron/intelligence/route.ts` | 4.7 |
| F27 | Restart-safe resume: stage checkpoints plus open-attempt rows; a re-claimed run resumes at the checkpoint and never re-reserves a settled attempt | `pipeline.ts` (`step`), `store.ts`, `tests/resume.test.ts` | 4.4, 9 |
| F28 | Channel seed: two source lists (LeapEdge, TrueAlphaData); `seedChannels()` dedupes by channel ID, sets `tier`, `seed_source[]`, `discovery`, `processing`; default selection Tier 1 + LeapEdge top 20; selection saved as versioned config | `src/server/youtube-intelligence/seed/{leapedge,truealpha}.json`, `seed/index.ts`, `channels.ts`, `settings.ts` | 4.15 |
| F29 | Cost projection and budget meter as registry metrics (uploads per month per channel from the last 90 days × measured cost per video; month-to-date vs `budget.monthlyUsd` vs hard ceiling) | `metrics/cost.ts`, `metrics/registry.ts`, `store.ts` (`health`) | 4.15, 6 |
| F30 | API restructure: the 29-case switch replaced by a dispatch table `{action: {schema, handler, scope}}` per resource module with owner context; routes under `/api/youtube-intelligence/*`; old action names kept as aliases for one phase | `src/app/api/youtube-intelligence/*/route.ts`, `src/server/youtube-intelligence/actions/*.ts`, `owner.ts`; delete `src/app/api/intelligence/research/route.ts` at phase-3 gate | 4.18 |
| F31 | Phase-2 gate run: four-video parallel end to end on PGlite with fake transports; kill-and-resume; seed dedupe; CI on the Postgres dialect | `tests/e2e-parallel.test.ts`, `docs/gates/phase-2-<date>.json` | 9 |

### Phase 3 — trust, leaderboard, sentiment shift, automation, UI

| ID | Feature | Files | Spec |
|---|---|---|---|
| F32 | Windowed ASR: `nativeGoogleStep` requests fixed `windowSeconds` windows with `videoMetadata` offsets at LOW resolution; `transcripts` rows `kind=asr-window`; `asrPolicy` | `native-google.ts`, `transcripts.ts`, `repos/transcripts.ts` | 4.5, 5 |
| F33 | Agreement scoring: edit-distance core moved from `evaluations/transcript-accuracy.ts` into `agreement.ts`; per-span `agreement_score` and `anchor_error_seconds` on `evidence_spans` | `src/features/youtube-intelligence/agreement.ts`, `evaluations/transcript-accuracy.ts` (imports core), `pipeline.ts` (stage `agree`) | 4.5 |
| F34 | Whisper tie-break: below threshold on a promoted claim, one Supadata `generate`, two-of-three rule, `tie_break_source` | `pipeline.ts`, `transcripts.ts`, `agreement.ts` | 4.10 |
| F35 | Trust ladder: `computeTrustLevel(checks, agreement, reviews)` L0–L3 with `trust_basis`; append-only `reviews` insert signs L3 with the account; level never decreases on recompute | `src/features/youtube-intelligence/trust.ts`, `repos/reviews.ts`, `repos/claims.ts` | 4.6, 4.18 |
| F36 | Leaderboard statistics and boards: `significance.ts` (Wilson, t, p, BH q, gates); `leaderboard.ts` by creator and by ticker (consensus, most reliable creator); benchmark chosen at query time from `prices`; sector ETF map; market filter; "not settleable" label; all as registry metrics | `significance.ts`, `leaderboard.ts`, `metrics/leaderboard.ts` | 4.12 |
| F37 | Changes tab: `boardAsOf(date)` and `diffBoards(a, b)` (rank moves, status crossings, entrants, consensus shifts, "not yet meaningful") | `leaderboard.ts`, `metrics/changes.ts` | 4.12 |
| F38 | Sentiment shift: mentions and distinct creators by sentiment for period P against the prior P with trust filter; drill-down rows | `metrics/sentiment-shift.ts`, `repos/mentions.ts` | 4.13 |
| F39 | Push notifications: PubSubHubbub verify and notify endpoint (HMAC with `YTI_PUSH_CALLBACK_SECRET`), subscribe/renew job, poll fallback via `pullDue` | `src/app/api/youtube-intelligence/push/route.ts`, `src/server/youtube-intelligence/push.ts`, `channels.ts`, `queue.ts` | 4.8 |
| F40 | Batch mode: Google Batch API submit and poll in the native transport; `processing.userSubmitted|channelUploads`; `batch-poll` job; ledger settles on completion | `transport/google-native.ts`, `queue.ts`, `pipeline.ts` | 4.8, 5 |
| F41 | Historical replay: Tier-1 uploads from `channels.historicalReplay.from`; IDs from Supadata channel listing or the uploads playlist; Shorts skipped; batch; `record=historical` | `src/server/youtube-intelligence/replay.ts`, `scripts/replay.ts`, `channels.ts` (`backfillChannel`) | 4.16 |
| F42 | UI shell: module layout with side panel (Today, Channels, Leaderboard, Saved calls, Lab, Settings); `ResearchApp.tsx` split into page components; `/research` redirects | `src/app/youtube-intelligence/layout.tsx` and page routes, `src/features/youtube-intelligence/ui/SidePanel.tsx`, `ui/useResearchData.ts` | 7.1, 7.3 |
| F43 | Shared components: `TrustBadge`, `ConvictionChip`, `Tooltip`, `MetricHeader` (hover from registry + sort), `DataTable`, `BenchmarkSelector`, `PeriodSelector`, `StateChip`; dark tokens | `src/features/youtube-intelligence/ui/*.tsx`, `src/app/globals.css` | 7.2, 7.5 |
| F44 | Today page | `ui/pages/Today.tsx`, `actions/today.ts` | 7.3 |
| F45 | Channels page: seed list with Process checkbox, cost projection before save, "Analyse this one", trust distribution, record vs benchmark | `ui/pages/Channels.tsx`, `actions/channels.ts` | 4.15, 7.2 |
| F46 | Leaderboard page: by ticker, by creator, Changes; benchmark, horizon, market and record selectors; CSV export with registry ids; Methodology page from the registry | `ui/pages/Leaderboard.tsx`, `ui/pages/Methodology.tsx`, `actions/leaderboard.ts` | 4.12, 7.3 |
| F47 | Analysis page: trust strip, claim cards by trust then conviction, evidence viewer, play-from, Processing details | `ui/pages/Analysis.tsx`, `SourcePlayer.tsx` | 7.4 |
| F48 | Saved calls, Lab (prompts, experiments, gold set, cost history, shares, Promote gated), Settings from the schemas with reset-to-team-default | `ui/pages/{Saved,Lab,Settings}.tsx`, `actions/{saved,lab,settings}.ts` | 7.2, 7.3 |
| F49 | Phase-3 gate run: anchor accuracy on gold set; push-to-Today end to end with a fixture hub; registry CI; benchmark change writes nothing; Changes diff equals a hand-computed fixture | `tests/leaderboard.test.ts`, `tests/push.test.ts`, `docs/gates/phase-3-<date>.json` | 9 |

### Phase 4 — context, Finradar, corpus, sharing, digest

| ID | Feature | Files | Spec |
|---|---|---|---|
| F50 | Context check: deterministic source gathering (FMP news with `from`/`to`, filings and earnings ≤90 days, prices, optional Exa), date validation, OpenRouter summary under `responseSchema`, citation-id validation with one retry, `context_checks` rows, "since then" at settlement | `src/server/youtube-intelligence/context-check.ts`, `market.ts` (`news`, `filings`), `migrations/0004_context_checks.sql`, `settlement.ts`, `pipeline.ts` | 4.14 |
| F51 | Finradar `youtube` observation: `briefing_observations` rows from the sentiment shift per edition; adapter emitting the `briefing-read-v1` item shape, built only after the current contract file is supplied | `src/server/youtube-intelligence/briefing-observation.ts`, `briefings.ts` (`buildBriefing`), `migrations/0005_briefing_observations.sql` | 4.17 |
| F52 | File Search corpus: transcripts uploaded on publish; cross-video question returning cited spans; `retentionDays` | `src/server/youtube-intelligence/corpus.ts`, `transport/google-native.ts`, `ui/pages/Corpus.tsx` | 5 |
| F53 | Sharing: indefinite until revoked, optional expiry, immutable snapshot, `created_by`; share page | `briefings.ts` (`shareBriefing`, `readShare`, `revokeShare`), `repos/shares.ts`, `src/app/share/[token]/page.tsx` | 4.18 |
| F54 | Digest per account: deliver to Finradar briefing and/or email | `briefings.ts` (`digestDue`, `prepareScheduledDigest`), `email.ts` | 6.3 |
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
| F07 | — (removed) | | F35 | F33, F24 |
| F08 | F06 | | F36 | F25, F35, F04 |
| F10 | F03 | | F37 | F36 |
| F11 | F05, F10 | | F38 | F13, F24, F04 |
| F12 | F03 | | F39 | F26 |
| F13 | F12 | | F40 | F10, F26 |
| F14 | F12 | | F41 | F40, F28 |
| F15 | F10, F12 | | F42 | F30 |
| F16 | F03 | | F43 | F04, F42 |
| F17 | F16, F10 | | F44 | F43, F35, F38 |
| F18 | F02 | | F45 | F43, F29 |
| F19 | F12, F13 | | F46 | F43, F36, F37 |
| F20 | F11, F15 | | F47 | F43, F35 |
| F21 | F08, F11–F19 | | F48 | F43, F08 |
| F22 | F01 | | F49 | F32–F48 |
| F23 | F22 | | F50 | F25, F11 |
| F24 | F23, F12, F13 | | F51 | F38, F24 |
| F25 | F23 | | F52 | F10, F24 |
| F26 | F23 | | F53 | F24 |
| F27 | F26, F16 | | F54 | F05, F53 |
| F28 | F24 | | F55 | F50–F54 |

**Critical path (strictly serial):** F01 → F02 → F03 → F12 → F13 → F22 → F23 → F24 → F32 → F33 → F35 → F36 → F46 → F49 → F50 → F55.

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
| 2 | data (blocking) | F22 → F23 → F24 | F25 and F26 start after F23 |
| 2 | prices | F25 | |
| 2 | queue | F26 → F27 | |
| 2 | seed | F28 → F29 | |
| 2 | api | F30 | after F24 |
| 2 | gate | F31 | |
| 3 | asr | F32 → F33 → F34 → F35 | |
| 3 | board | F36 → F37, F38 | after F25, F35 |
| 3 | automation | F39, F40 → F41 | |
| 3 | ui-shell | F42 → F43 | starts when F30 merges |
| 3 | ui-pages | F44, F45, F46, F47, F48 | five agents, one page each, after F43 |
| 3 | gate | F49 | |
| 4 | context, finradar, corpus, sharing | F50; F51; F52; F53 → F54 | four parallel lanes |
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
| `tests/asr-agreement.test.ts` | F32–F35 | Windows cover duration with offsets; agreement on fixtures; two-of-three tie-break; trust from inputs; L3 only via signed review |
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
| pipeline | F10–F15, F20, F32–F35 | `pipeline.ts`, `contracts.ts`, `evidence-selection.ts`, `sentiment.ts`, `agreement.ts`, `trust.ts`, `native-google*.ts`, `schemas/*` | Three-call pipeline with pointer evidence, mentions and batched critique; then windowed ASR and trust | Gold-set P/R ≥ baseline offline; zero structural rejections |
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

## 7. Neon and Vercel topology (amendment, 17 September 2026)

The plan above was written provider-neutral: `DATABASE_URL` and "Postgres". The deployment is Vercel functions in `iad1` against a Neon project, and Neon's pooler, autosuspend and branching change several items. Nothing in phases 0–1 is affected. This section is the binding version wherever it differs from sections 1–6.

### 7.1 What already works and must not be "fixed"

| Concern | Verdict |
|---|---|
| TLS | `database.ts` rewrites `sslmode=require` to `verify-full`; `pg-connection-string` 2.14 maps that to `rejectUnauthorized: true` against the system CA, and Neon serves publicly-issued certificates. Correct as written. Neon's `channel_binding` parameter is ignored by `pg` and harmless |
| Prepared statements | The code never uses named or SQL-level `PREPARE`; node-postgres uses protocol-level prepared statements, which Neon's transaction-mode pooler supports |
| Schema-init lock | `pg_advisory_xact_lock` is transaction-scoped. Only *session*-level advisory locks are unavailable through the pooler, so this call is safe today. F23 still removes it, for the reason already given |
| Queue design | `FOR UPDATE SKIP LOCKED` is fully supported through the pooler. The decision to avoid pg-boss and Graphile Worker is now doubly correct: `LISTEN`/`NOTIFY` is not available on a pooled Neon endpoint at all |

### 7.2 Connection topology (new; F23 owns it)

Two connection roles, not one. Neon's own Vercel integration already publishes both names, so we adopt them rather than invent our own.

| Variable | Endpoint | Used by | Why |
|---|---|---|---|
| `DATABASE_URL` | pooled (`-pooler` host) | Next.js functions, cron route | Thousands of short-lived serverless clients; a direct endpoint would exhaust `max_connections` |
| `DATABASE_URL_UNPOOLED` | direct | migration runner, the worker, `scripts/postgres-check.ts`, `scripts/backup.ts` | DDL, session advisory locks, `SET search_path`, temporary tables and `pg_dump` are all unavailable in transaction pooling mode |

Required with it:

- `attachDatabasePool(pool)` from `@vercel/functions` immediately after the pool is constructed. `maxDuration = 800` implies Fluid Compute, where a suspended invocation otherwise keeps idle `pg` clients — and therefore Neon connections — alive. This is the one new runtime dependency phase 2 adds; it is a first-party Vercel package.
- Pool size derived from `processing.parallelVideos` rather than the hard-coded `max: 3`, with the worker sized separately from the functions.
- `pool.on("error")` classified rather than logged: Neon suspends idle computes and recycles pooler connections, so a dropped connection is a normal, retryable event. The worker must reconnect and re-poll; a run whose transaction was cut stays leased until `lease_until` expires and is re-claimed, which F27 already guarantees.
- Region check before the phase-2 gate: functions run in `iad1`, and the Neon project must be in the same region. The pipeline issues many small queries per stage, so a cross-region pairing multiplies every round trip. `docs/finradar-production-plan.md` flagged this and it was never verified.

### 7.3 Migrations on Vercel (amends F22)

F22 said migrations are applied "at worker start, by `scripts/migrate.ts`, and by the test DB helper". That leaves the web deployment unmigrated: Vercel has no release phase, and after F26 the worker may not be on Vercel at all. Corrected:

1. Migrations run in the Vercel **build command** (`npm run migrate && next build`), against `DATABASE_URL_UNPOOLED`, holding a session advisory lock so concurrent builds serialise. This is Neon's own documented pattern for the integration.
2. Each migration file runs inside one transaction. Any statement that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`) is marked in the file and run outside it; at current data volumes a plain `CREATE INDEX` is acceptable and preferred.
3. The application **fails fast** instead of self-healing: `initialize()` reads `yi_migrations` and throws if the applied version is behind the version the code expects. No function creates or alters a table. This replaces the `CREATE TABLE IF NOT EXISTS` bootstrap that currently runs on every cold start.
4. A Neon branch is taken immediately before the first migration against production, as the rollback path; the PITR retention window is recorded in the gate artefact. This is instant and copy-on-write, and supersedes a file export as the pre-migration snapshot.
5. Preview deployments: enable the Neon integration's per-preview branch (`preview/<git-branch>`, auto-deleted with the git branch), so the build migrates a throwaway copy. Until that is enabled, previews point at production and are protected only by `YTI_PREVIEW_READ_ONLY`, which must then be set on every preview environment. **Open decision.**

### 7.4 Column types (amends F22, F24, F25)

The v1 schema stores timestamps as ISO `TEXT` in five places, money as `DOUBLE PRECISION`, and lease deadlines as epoch `BIGINT`. Phase 2 rewrites every table anyway, so it is the only cheap moment to fix this; after F24 writes real rows a type change costs a rewriting migration.

- `timestamptz` for every instant. The leaderboard windows, the sentiment-shift period comparison and the settlement horizons are all date arithmetic over ranges, which text defeats.
- `numeric(12,6)` for USD amounts (ledger, reservations, settlements, cost per claim) and `numeric` for prices. Float money in a product whose gate threshold is "cost per accepted claim ≤ US$0.25" is indefensible.
- `jsonb`, not `TEXT`, for payloads and for `output`, which removes the `payload::jsonb` cast that `postgresSQL()` currently rewrites.
- `lease_until` becomes `timestamptz`; the epoch-millisecond comparison disappears with it.

### 7.5 Worker hosting (amends F26)

Neon does not resolve this; it only constrains it. Whatever host is chosen, F26 must deliver: the unpooled connection string, connection loss treated as retryable, SIGTERM handling that finishes or releases the leased job, and no filesystem control files — the existing `scripts/worker.ts` signals through `data/worker.pid` and `data/worker.stop`, which does not survive an ephemeral or read-only filesystem. The Vercel cron keeps the health and poll-fallback role. A cron-only deployment cannot honour `parallelVideos` beyond what one 800-second invocation completes. **Open decision.**

### 7.6 Gates (amends F31 and F49)

PGlite is single-connection, so it can prove queue *logic* and nothing about contention or pooled-mode behaviour. Before the phase-2 gate, `scripts/postgres-check.ts` runs against **a Neon branch through the pooled endpoint** — the configuration production actually uses — and is extended to assert the pooled-mode constraints explicitly: a session advisory lock fails, a temporary table fails, `SET search_path` does not persist across transactions, and `SKIP LOCKED` hands each job to exactly one of N concurrent claimants. The phase-3 gate adds an `EXPLAIN` check for each leaderboard and sentiment-shift query against a Neon branch seeded at realistic volume, since those are the queries that will dominate Neon compute time.

### 7.7 Storage and compute cost (amends F29)

F29 projects model spend only. Windowed ASR (F32) stores a transcript and a window row per video, F24 adds a span row per claim evidence item, F25 adds a settlement row per horizon per call, and F50 adds a context check per claim; Neon bills storage and compute-hours on top of the model bill. F29 gains a stored-bytes and row-growth metric alongside the model projection, and the registry entry states plainly that the Neon line is not in the model budget. Related rule for F24 and F32: transcript and ASR-window tables are never selected with `SELECT *` from list queries — projections only — so megabytes of text do not cross the pooler for a table view.

### 7.8 Risk table additions

| Risk | Mitigation |
|---|---|
| Pooled and direct endpoints have different capabilities, and one variable cannot serve both | Two variables with defined roles (7.2); `postgres-check.ts` asserts the pooled constraints (7.6) |
| Fluid Compute suspends invocations holding idle pool clients | `attachDatabasePool` from `@vercel/functions` (7.2) |
| Vercel has no release phase, so a deploy can run ahead of its schema | Migrations in the build command against the unpooled URL; the app fails fast on a version mismatch rather than creating tables (7.3) |
| Neon autosuspend drops idle connections under a long-lived worker | Connection loss classified as retryable; lease expiry re-claims the run (7.2, F27) |
| Neon compute in a different region from `iad1` multiplies per-query latency | Region verified and recorded before the phase-2 gate (7.2) |
