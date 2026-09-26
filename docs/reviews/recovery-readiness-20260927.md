# Evidence-preserving audit recovery and source coverage — 27 September 2026

## Problem and implementation

The former `continueAfterAuditFailure` marked the first unanswered item as rejected and requeued the run. A missing critic answer also became a rejection reason, allowing publication without a verdict. Neither behaviour established unsupported evidence.

Recovery now preserves claims, key points, source text and successful verdicts. Missing answers leave the stage at critique with an explicit failure, an unresolved ID list and no invented rejection reason. Already obtained claim/mention verdicts survive later chunk failures. An explicit retry admits only unanswered evidence under a separately identifiable paid stage (`critique[-chunk-N]-repair-N`), at most twice. Duplicate clicks serialize on the failed run. Any reserved or unknown provider call blocks recovery before the new identity is created; no reservation is released automatically. Original responses, ledger charges and fingerprints remain unchanged. Recovery history records the previous failure and attempt number. Every repair still uses existing model, budget, schema and independent-critic gates.

This is bounded recovery, not a promise that a provider will eventually return every answer. Exhaustion stays failed. Existing completed historical results are not rewritten. No new provider requests were made during implementation.

## Long-source completeness

Extraction validates that every original source segment occurs unchanged in the retained extraction plan before provider work starts. An omitted or changed segment stops processing. `extractionCoverage` exposes total and processed chunks, source/planned segment counts and empty chunks. Its semantic completeness is explicitly `not_established`: consuming every segment cannot prove every material company, qualification or countercase was extracted.

Existing native windowed ASR already checkpoints windows independently, subdivides invalid windows, re-listens to unresolved gaps and records inspected silence separately from speech coverage. The legacy windowed source path retains absolute timestamps and holds insufficient coverage for review. Those gates were retained and tested, not replaced with optimistic completion labels. Live long-video ASR acceptance remains pending; fixtures cannot certify provider transcription quality.

## Verification

Red tests reproduced the dropped-evidence recovery, missing-verdict publication and omitted-plan problems before implementation. The focused suite of critique, fatal extraction, native ASR and legacy windowed source passed 22 tests. Additional edge checks cover duplicate recovery clicks, two-retry exhaustion, open reservation blocking and a second paid stage containing only the unanswered item. Full integrated build/check results belong to the parent release record. Database concurrency fixture uses PGlite; real PostgreSQL concurrency checks remain necessary for deployment acceptance.

## Deployment topology inspection (read only)

The release checklist explicitly distinguishes the Mac's local `yti_live` database from Vercel's Neon environment. The installed Mac runtime path is `~/Library/Application Support/YouTube Intelligence`; loopback web port 3019, database port 57484; login services are `com.joshuai.yti.web`, `com.joshuai.yti.worker` and `com.joshuai.yti.postgres`. Runtime `DATABASE_URL` and migration `DATABASE_URL_UNPOOLED` must select the same environment for web and worker; editing environment files does not affect running services until restart.

For a Mac-primary acceptance, test submission, worker heartbeat, persisted result and evidence view through the local app. For Vercel-primary operation, a worker must explicitly target that same Neon database and matching revision, after pause/drain and migration checks; do not copy local data or switch database credentials as an implicit release step. `YTI_QUEUE_PAUSED`, capacity, provider credentials and budgets must be inspected in that environment before a bounded canary. No runtime, credentials, database endpoints or queue settings were changed by this lane.

## Material-context recall follow-up

The supplementary extraction prompt now asks for missing material research key points and mentions, including valuation conditions, moat constraints, countercases, no-position qualifications and hypothetical versus actual holdings. It explicitly separates that context from actionable claims. A Dutch Bros valuation/moat fixture first failed against the former call-only prompt, then passed with one neutral key point retaining the no-position quote; the candidate stays unaccepted and returns to independent critique. This does not establish model recall or quality on live videos.

## Prepared evaluation cohort

`docs/reviews/readiness-cohort-20260927.json` accounts for all 20 original cases. Private `data/readiness-20260927/prepare-cohort.mjs` reproducibly selects the latest completed retained source analysis, excludes brief tasks, and checks source contracts. `frozen-cohort.json` retains exact source inputs; the committed manifest records source/input/artifact hashes and acquisition limitations. The long podcast `ZfOQoh82JTo` is a caption replay, not a test of long-video ASR acquisition.

Private `run-cohort.mjs` adapts the earlier benchmark with exclusive output creation, full-cohort source hash checks, implementation file hashes, per-case failure retention, all paid ledger rows, open holds and retained documents exported atomically after each stage. It requires explicit `--live`, root/input/output/revision, `--variant after --treatment sequential`. It has only been syntax-checked; no paid run was executed by this lane. Its in-memory isolation is deliberately not a production queue test and is not automatically resumable after process loss; root should keep the process alive and reconcile any interrupted provider request before restarting. Timings exclude ingestion, queue and browser rendering. Baseline histories are empty and as-of times remain frozen for reproducibility; live retrieval responses can still vary.
