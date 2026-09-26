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

## Post-candidate adversarial mention fixes

Review of candidate `ddf1006` found that supplementary mention-only output was parsed but discarded, and that a changed stance/rationale at an already accepted instrument/span could inherit the old acceptance. Both are fixed in the subsequent revision: recall materializes non-call mentions, retained audit acceptance requires a hash of the entire mention, and replacing a mention invalidates its coarse downstream acceptance flag. Mention-only recall returns to independent critique. Exact previous verdicts remain reusable only for unchanged content; historical coarse-only acceptance is not sufficient for a newly resumed critique.

Two focused regressions failed on the candidate and passed after the fixes. The 15-test critique/material-recall suite and typecheck passed. These changes are separate from the already running candidate; its results must keep the candidate revision and cannot be relabelled as verification of the later fix.

## Optional coverage audit failure handling

A failed optional supplementary audit now preserves the independently audited original brief and leaves added statements explicitly unaudited/rejected for display, with exact failure diagnostics, unresolved IDs and `needs_review` status. Malformed output, missing/ambiguous IDs and unknown provider outcomes do not trigger another paid supplemental audit. Unambiguous supplemental verdicts are retained when only some IDs are missing. Unknown reservations and all paid responses remain in their original ledger records; no release or refund is inferred. A malformed mandatory original audit still throws and creates no published brief.

Supplemental IDs now deterministically skip IDs already used by the original draft, so model-selected original identifiers cannot turn an optional addition into a failure that hides audited research. Original statements and identifiers remain unchanged. Coverage overflow stays in the repair trace, not the published accepted set.

Regression evidence includes red→green malformed/missing/unknown optional audit failures, preservation of a valid partial supplement, the mandatory-original failure guard, and original-ID collision avoidance. No paid providers were used in these checks.

## Candidate B measurement-comparability correction

Candidate B first Mandarin brief removed exact sentence duplication (18→9 sentences; 8→0 duplicate texts), but still published `disputed`/`contradicts` for 4.93% traded Treasury yield versus H.15 4.94%, despite explicitly stating observation conventions were unconfirmed. This observation is retained as a scoped failure in `readiness-candidate-b-quality-20260927.md/json`; code changes do not retroactively pass that paid result.

Added structured external comparison fields: metric, period, units, observationBasis and reason. Unknown/mismatched measurement cannot establish either contradiction **or support**. Numerical comparisons require every dimension matched; qualitative dimensions may explicitly be not applicable, but metric must match. Exact assertion-substring and primary-source quote mapping remain mandatory. Potential conflicting/supporting passages stay attached; no evidence is deleted to improve the label. A matched contradiction still takes precedence over partial support. Unconfirmed conflict becomes unverified/insufficient, with a visible reason. Original audits and model responses remain retained.

New model-call JSON schemas require the comparison object and all five fields. The stored-artifact schema separately defaults missing legacy comparison metadata to unknown. Shared `externalComparisonEstablished` also governs UI labels; absence cannot manufacture historical corroboration or fragility. Published omissions are deduplicated while the raw model draft remains unchanged.

Validation: first three yield/legacy/comparison-dimension tests reproduced the disputed-label bug before implementation; a fourth numerical-support test reproduced false corroboration before the symmetric fix. Final focused suite: 57/57 research-brief, research-pipeline and research-presentation tests passed, including Standard/Efficient × matched/unknown persisted audit cases, required response-schema field assertions, true-conflict preservation, missing-reason rejection, exact-quote failures, old artifact parsing, raw-draft immutability and omission uniqueness. Typecheck passed. No paid calls or runtime changes were made for this correction. Root performs full integrated suites/build before candidate C.

## Vistra/Bloom source omission correction

Source-backed replay inspection of candidate A `pWnu1C8I6Xw` reproduced zero recall windows even though the retained transcript at 80.64–91.08 seconds says the creator does not generally love the sector and Bloom Energy is one of their core holdings. The Bloom high-conviction claim was rejected (including a truncated cited range ending before “holdings”); adjacent Vistra citations covered the cash-flow trigger. The recall expression matched neither “one of my core holdings” nor “not a sector that I absolutely love.” In addition, the recall payload listed rejected theses without indicating their rejection, while instructing the model not to repeat existing evidence.

Added narrow core-holding/sector-reluctance signals across caption boundaries. The payload now explicitly distinguishes accepted from rejected inventory and includes rejection reasons. The recall instruction permits a narrower, complete, source-supported neutral holding/context candidate after a rejected trade/overconviction claim. It never promotes the original rejected claim. Every new item remains unaccepted and returns to independent critique. Recomputing selection on the actual retained candidate changes zero windows to one (`s00016`–`s00046`) containing Bloom and the complete holding passage; this proves selection, not live model recovery or full semantic recall.

An exact-cue regression failed before the change and passes afterward. A fake-transport integration test verifies rejected-claim immutability, rejection metadata in the recall payload, complete holding quote, lower-conviction neutral context and mandatory independent audit. No paid call was used to establish this behavior. Whole-source processed coverage and retained-inventory coverage still cannot prove semantic completeness; candidate C must explicitly check Bloom/sector reluctance against original source.
