# Adversarial readiness review — 27 September 2026

## Verdict

The project is a functioning research prototype, not yet a dependable investment decision-support release. Infrastructure improvements are real, but completion, quality acceptance and comparable performance are not the same thing. The latest release does not establish output-quality parity or a fresh URL-to-visible-result improvement against the retained twenty-video LeapEdge cohort.

Scope: read-only implementation/history review at main `aac52af`, retained experiment and comparison reports, and offline adversarial checks. No new provider or LeapEdge requests, runtime changes, or browser acceptance claims. An existing untracked `ResearchBrief (1).tsx` was left untouched. Deployment evidence cited below is from September 20, not a September 27 health check.

## Findings, highest priority first

### 1. Recovery can remove evidence to get past a failure

`research-store.ts:819–858`, exposed through `actions/runs.ts:73`, implements `continueAfterAuditFailure`: it drops the first unanswered claim/key point and requeues a failed batched critique. The error need not identify that point as the cause. The mutation and reason are retained, so this is not invisible in the trace, but it is an invalid default strategy for recovering completeness. This predates the latest performance release. No current UI caller or evidence that the latest experiment invoked it was found.

Replace with bounded repair of missing verdict IDs or a smaller audit batch, preserving successful verdicts, original attempts, charges and unresolved items. Unrecoverable items must produce a partial/review-required outcome, not evidence-based rejection. A provider or parsing failure is not a negative judgment about the underlying claim.

### 2. Completed does not mean materially complete

`research-pipeline.ts:396–487` records deterministic rejections, skips the semantic call when every sentence fails preflight, stores the resulting brief and marks the run completed. `ResearchDraft` permits zero sentences. `coverageFindings` are stored but do not block publication or create a separate completeness state. Withholding unsupported prose is appropriate; representing the remainder as an adequately completed research result is not established.

Offline reproduction: `validateBrief` accepts an empty draft with a material omission. Code inspection establishes the unconditional completion path; this review did not execute that whole path against a production database.

Add separate execution, evidence, coverage and research-readiness states. Zero trades can be a valid outcome; zero accepted research and unexplained missing material cannot silently be a usable result. Require a company/topic coverage inventory with every material item either represented, explicitly unresolved, or excluded with a source-backed reason. Reconcile safe clauses separately when one bad clause causes rejection of a compound sentence.

### 3. Confidence labels can overstate external support

`research-brief.ts:373–375` accepts the critic's factual label when any cited eligible primary source exists. Eligibility is checked; explicit claim-to-source entailment is not structurally required. Offline reproduction retained `partial` for an unrelated primary source even when the supplied critic reason explicitly said the assertion was unsupported. The retained live LVMH case exhibits the same class of failure.

Require assertion-level support mappings with exact external passages, dates, units and the specific supported clauses. Distinguish supports, contradicts, unrelated and insufficient. Label partial only when a named subset is supported and show the remainder. Split compound assertions. Retain independent semantic checking; passage matching alone cannot prove entailment. Creator opinion, source fidelity, factual corroboration and investment-thesis robustness remain separate dimensions.

### 4. Speed evidence is insufficient for the release claim users need

The latest live comparison uses four retained transcripts, one trial per arm, starts at extraction, sets queue timing to zero, and excludes ingestion and browser paint. Both operational arms use evidence efficiency and cache reuse; it primarily tests overlap, not Standard versus the deployed Efficient default. The baseline includes candidate dirty code. One baseline brief failed; that duration is not a completed-time comparator. All these qualifications are documented, but they prevent release-level speed/parity conclusions.

The 100-job improvement (124.11→36.46 seconds) is a fixed-delay worker fixture. The 20→1 search reduction is an identical-query fixture. Both demonstrate mechanisms, not live workload savings. The original twenty-video cohort delivered 13/20 local reports versus 19/20 LeapEdge reports; later fixes and four-video recoveries must not be described as a current twenty-video completion score.

Build a versioned twenty-case manifest joining original attempts, recoveries, transcript hashes, model/prompt/profile settings, final briefs and retained LeapEdge captures. Count every attempted case. Preserve failed attempts and total retry cost. Separate fresh ingestion, retained-source replay and warm-cache cohorts. Measure submission→first useful result→audited result→browser display, with queue/provider/checkpoint durations and p50/p95. Use repeated paired trials to expose variance. Do not compare historical polling bounds to backend stage times as if they were equivalent. Missing LeapEdge detail is not zero or a local pass.

### 5. Long-form and external research remain shallow in important places

Retained reviews identify missing Dutch Bros moat/entry qualifications, Credo valuation preferences and Opendoor hypothetical/no-position context. A repaired follow-up is not proof those facts survive later independent runs. The recovered long podcast used newly available captions with 99.87% timed coverage rather than earlier ASR at 86.1%; this is not solely an optimisation gain. Timed coverage also does not establish semantic completeness.

Research planning selects at most two factual claims (`research-pipeline.ts:283`), the brief caps main topics at eight, and normalisation slices excess topic names. The supplementary recall pass (`research-brief.ts:732`) selects windows using English/Chinese action or stance expressions; it is not an exhaustive check for omitted valuation, moat or macroeconomic reasoning. These limits constrain multi-company research; they are not necessarily new regressions. Preserve an unbounded/paginated coverage inventory and produce a bounded executive summary from it. Verify material assertions by risk/importance, rather than a universal two-claim cap. Benchmark the actual long-ASR fallback separately from caption success. Persist chapter/chunk coverage, unresolved gaps and targeted retry state.

### 6. UI makes crucial limitations too easy to miss

`ResearchBrief.tsx:596–628` places omissions, coverage findings, retrieval notes and withheld material in a collapsed details block. The overview maps available briefs to completed and filters empty sentence sets. Drill-down is valuable but does not replace a prominent warning at the point of decision.

Lead with material new information, tactical/fundamental implications, source date and a visible readiness/coverage statement. Show unresolved material gaps and conflicting evidence before minor details. Distinguish historical thesis from a separately timestamped current update, and do not imply freshness merely because an old source was retrieved now. Offer evidence → exact quote → surrounding transcript → timestamp navigation, preserving audit history. Add a comparison workspace showing covered/missing/disputed items alongside retained LeapEdge references and per-case time/cost boundaries.

### 7. Deployment and scale are not proven end to end

Last verified Mac worker uses local PostgreSQL; Vercel uses separate Neon. Web READY and a local heartbeat do not prove that a job submitted through Vercel will be processed. The queue was paused; profile UI browser acceptance and authenticated Vercel smoke were pending. Complete an authenticated URL submission through the intended web/database/worker path, including restart/recovery and visible result. Keep Finradar integration out of scope.

For 1,000 videos/day and bursts of 100, demonstrate provider quotas, weighted admission for long jobs, per-provider concurrency, retry backoff, deduplication and sustained throughput. Measure database/API payload growth and UI refresh cost before adding capacity. A single Mac is an interim host with sleep/network/restart availability constraints.

## Legitimate optimisations to retain

- Skip translation only for evidence already reliably identified as English; preserve mixed/unknown-language checks.
- Encode exact evidence without losing quotes, dates or identity.
- Reject structurally invalid statements before paid semantic review, while preserving gaps and a partial outcome.
- Reuse exact eligible retrievals with original provenance and freshness; measure actual eligible hit rate.
- Refill free worker slots promptly without altering analysis.
- Stop untouched work on fatal account/auth errors, drain started work, and retain a failed resumable outcome. This is failure containment, not a successful fast analysis.

Keep speculative overlap experimental until a matched quality gate passes. Do not remove existing functionality or historical output to simplify evaluation.

## Delivery order and proposed acceptance

1. **Restore trustworthy evaluation first:** canonical twenty-case manifest, immutable outputs, failure-inclusive cost/time accounting, explicit measurement boundaries. Replace advisory-only quality promotion with regression checks using existing transcripts and retained LeapEdge references; the removed fifty-human-verified requirement stays removed.
2. **Close correctness blockers:** replace drop-on-recovery, enforce assertion support, reconcile material coverage, repair missing verdicts within a bounded retry policy, preserve long-source coverage. Add regression cases for the observed failures before changing prompts.
3. **Expose readiness and comparison:** prominent partial/review states, separate confidence dimensions, company/topic coverage, side-by-side comparison and evidence navigation. Preserve Finradar styling. Validate desktop/mobile, keyboard, persistence, failed-run recovery and empty/partial cases using browser control.
4. **Measure and optimise the complete deployed path:** authenticate and submit through the chosen production topology; benchmark Standard versus Efficient with cold and warm caches separately. Then tune payloads, concurrency and provider routing against bottlenecks. Repeat the long-video failure path and a 100-job burst.

Suggested release criteria, subject to user agreement: every one of the twenty cases accounted for; no known material attribution/arithmetic/corroboration-label regression; all material omissions surfaced; zero unearned complete/ready outcomes in injected failures; original evidence and paid attempts retained; current candidate completion and usable-result rates reported separately; comparative p50/p95 and total cost shown only with equivalent work and quality acceptance. A small cohort cannot certify population accuracy or p95 capacity under daily load. Latency targets should be set separately for short-captioned and long/ASR videos after the honest baseline.

## Verification performed

28 focused existing tests passed (research brief, efficiency flags, worker admission, selective translation, evidence index). Two offline adversarial probes reproduced the confidence and empty-draft gaps above despite those passes. No live calls or runtime/UI changes. This is an audit, not implementation or a new production health certification.

Evidence: `operational-efficiency-20260920.md`, `operational-quality-20260920.md`, `evidence-efficiency-20260920.md`, `production-resume-20260920.md`, and `../delivery/live-comparison-20-20260920.md`. Detailed existing measurements remain in their linked JSON files. User clarification requested on the triggering behaviour and the intended boundary between research support and actionable recommendations; recommendations above assume general investment research support pending that answer.
