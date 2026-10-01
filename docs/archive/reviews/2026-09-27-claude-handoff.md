# YouTube Intelligence — Claude / next-agent handoff

Updated 27 September 2026, Pacific/Auckland. This is a decision and implementation handoff, not a verbatim transcript. It consolidates the conversation available to this agent and today's inspected artifacts. Do not infer missing historical timings or approvals. Read this before acting on older hosting instructions.

## 1. Binding decision: Vercel + Neon + Vercel Workflows

The user's final decision is: **proceed with Vercel, Neon and the Workflow approach**. The immediately preceding cheaper-provider research did NOT authorize a different provider. Do not substitute Queues-only, Render, Railway, Cloudflare or a VPS without a new user decision.

- Existing Vercel project: `youtube-intel`.
- Existing Neon PostgreSQL remains the application database. No database migration to another vendor.
- Replace the Mac production worker with Vercel Workflows, whose bounded steps execute on Vercel Functions. Vercel manages underlying delivery; keep application state, financial evidence and cost ledger in Neon.
- Production must work with the Mac off. Temporary local development/fixture checks were explicitly approved; they do not establish cloud acceptance.
- **Google Cloud migration is cancelled.** Do not act on earlier pending approvals for Google IAM, secrets, source upload or a paid database.
- Current research pipeline stays default. Experimental targeted audit is selectable but cannot become default until measured quality/performance/reliability/UI gates pass and the user approves promotion.
- User requests comprehensive handoff BEFORE more implementation, and commits/pushes at key milestones so Claude can continue if Codex usage runs out.

## 2. Objective and enduring requirements

Build a standalone YouTube investment-research portal with the approved current Finradar visual theme. Complete standalone phases2/3; stop before phase4/Finradar integration. Preserve existing functionality.

The tool should help a sceptical investment analyst/portfolio manager find important new company developments and trustworthy summaries. Priorities:

1. Equal weight to short-term/current catalysts and long-term fundamentals, clearly separated.
2. Video-publication-date analysis, plus a clearly separate current update. Later information must not leak into the historical assessment.
3. General cross-company research/materiality ranking, not a portfolio-specific recommendation engine.
4. Confidence and unresolved gaps visible; a completed job is not a certified research result.
5. Full observability/auditability: original-language transcript, quotations/timestamps, evidence references, rejected statements, model/provider identities, prompts/configuration, retries, raw responses and costs.
6. No improvement by dropping difficult videos, silently truncating long transcripts, hiding partial states or skipping required checks.
7. Target capacity: 1,000 videos/day, bursts of100. This still requires load/latency testing;20 pairs cannot prove it.
8. Fifty human-verified cases were removed from scope, not deferred. Never fabricate a human-reviewed badge.
9. Use retained LeapEdge reports for the current experiment; **no new LeapEdge submissions**. They are comparators, not ground truth.
10. Previous US$25 API cap was removed for bounded comparison work; measure all charges, including failures. No unbounded channel replay. The prepared experiment uses explicit $100 cohort and inherited $5/video guardrails; these are execution bounds, not measured costs or a newly imposed user budget.

## 3. Repository and safe continuation

Repo: `https://github.com/JoshuAI-888/leapedge-study`
Local: `/Users/joshmini/Documents/ChatGPT/Finradar Enhancements/leapedge-study`
Branch: `codex/research-readiness`
Draft PR: https://github.com/JoshuAI-888/leapedge-study/pull/13

Before this handoff checkpoint, last pushed implementation was `7d68113` (experimental targeted audit); previous `e6847e1` recorded funded recoveries and `c8ff37f` guarded financial conventions. This handoff's commit will necessarily have a later SHA: use `git log`, not a guessed hash. Do not claim draftPR merged or cloud deployed.

**User-owned untracked file: do not modify, stage, delete or upload:**
`src/features/youtube-intelligence/ui/ResearchBrief (1).tsx`

Read:
- `AGENTS.md`
- `docs/delivery/ledger.json` (delivery source of truth; update with each implementation commit)
- `docs/delivery/standalone-scope.json`
- `docs/delivery/standalone-build-loop.md`
- `docs/delivery/targeted-audit-experiment-checklist.md`
- `docs/spec/youtube-intelligence-v2-spec.md` and `youtube-intelligence-v2-build-plan.md`
- `.claude/skills/build-feature/SKILL.md`, and phase-gate skill when evaluating a gate.

Older skill text about Mac hosting, $25 and fifty cases is superseded by the user's later decisions above. Node24, `.ts`/`.tsx` import suffixes, zod boundaries, node:test, no model traffic outside existing transports. Declare new runtime dependency (Workflow SDK) in PR and run dependency audit. No secrets in Git or command output.

## 4. Today's conversation / decision sequence

Earlier supplied context covers repository health/build, UI theme approval,20-case comparison, long-transcript failures, trustworthy investment synthesis, Exa, performance/cost optimisations and billing recovery. Today's relevant sequence:

1. User challenged the audit/repair stage consuming roughly92% of elapsed stage time in three research-only recoveries.
2. User requested a simpler path as an experiment, promotion only after requirements pass, original path retained behind a Settings selection. Requested an agent checklist and intelligent agents without sacrificing quality.
3. Implemented targeted supplemental coverage reuse, frozen pipeline identities, Settings control, explanation page and nonspending evaluation gate; pushed7d68113/draftPR13.
4. User said “all approved pls proceed end to end”. Coordinator interpreted this too broadly as Google Cloud migration approval. Prepared Cloud Run/Cloud SQL packaging, portable paired runner and source-review manifest, checked billing project and enabled APIs/created empty registry. This was preparation, not a deployment.
5. Browser blocked source archive upload, reporting user denied permission. No workaround was attempted. Specific Google IAM/credential-transfer and infrastructure-budget questions remained pending.
6. User asked why Google Cloud was being set up, then explicitly rejected full migration: **Vercel and Neon only**. All Google deployment activity stopped. Those pending Google questions are obsolete.
7. Explained Vercel Workflows + Functions as the hosted replacement for the Mac loop, retaining Neon. Requires bounded steps, not simply uploading an infinite loop.
8. Estimated infrastructure with illustrative assumptions at1,000/day, then researched cheaper options on request. Corrected that estimate for Fluid Compute instance sharing. Research did not change providers.
9. User now explicitly chose **Vercel + Neon + Workflow**, and requested this comprehensive handoff and regular pushes before continuing.

## 5. Implemented targeted-audit experiment

Committed in7d68113:
- `research-pipeline-choice.ts`: current/targeted-experimental identity and version, strict conflicts/malformed rejection, legacy-current fallback.
- Team Settings saves `processing.researchPipeline`, independent of efficiency profile. Reset restores current.
- Admission freezes pipeline/version/configuration. Automatic research inherits source selection; explicit rerun uses saved workspace settings. Historical/queued/running records do not change when preferences change.
- `targeted-coverage-reuse.ts` reuses a prior covered finding only with unchanged evidence, context and accepted-statement dependencies plus complete impact assessment. Changed/new direct citations, missing data and uncertain/partial findings require reassessment.
- Bounded audit retains complete inventory denominator, original job IDs, reuse plans, model traces, broad findings and unresolved gaps.
- Legacy checkpoint hashes remain compatible; behavioural recovery test proves reuse without another paid call.
- Settings dropdown, `/youtube-intelligence/analysis-pipelines`, Analysis processing details and ResearchBrief identity display.
- Malformed historical identity does not break overview; displays unavailable.

Limitations: indirect impact classification still depends on model judgement. Initial targeted audits split short briefs into jobs where current may use one call, so targeted may cost MORE. No measured benefit yet.

## 6. Latest un-deployed checkpoint additions

Evaluation/source review:
- `evaluations/targeted-audit/paired-runner.ts`
- `evaluations/targeted-audit/paired-artifacts.ts`
- `scripts/targeted-audit-paired.ts`
- `source-review-manifest.json`, `source-review-notes.md`
- `shared-source-reconciliation-design.md`
- Dedicated tests; gate and README scope updated.

Runner prepares all20 original donors and40 alternating arms. Imports identical source rows, retained research plans/retrievals/baselines; starts fresh at research-synthesis, with no reused drafts/audits. Explicit measurement scope: **fresh-draft-audit-from-frozen-retrieval**. Acquisition, extraction, planning and search are excluded; do not call this ingestion-to-display acceleration.

It uses deterministic transactional admission, a controller advisory lock, frozen implementation/input hashes, retained response replay, unknown-outcome stops, and complete exported call/response records. Export rejects mutated snapshots, wrong pipeline/video admission and orphan costs. Quality/browser/cloud reviews remain unknown until supplied with evidence; it never authorizes automatic default change.

Current CLI was prepared for a generic cloud/Cloud Run controller. **It is not a Vercel Workflow implementation.** Adapt scheduling and durable exports before cloud use. Do not execute a180-minute monolithic script inside one Vercel Function. Preserve the protocol and hashes across the adaptation.

Source review contains20 cases,18 focused defect checks and60 exact transcript windows with IDs, offsets, timestamps, text and hashes. Fifty-eight are outside retained inventory quotation spans; two use documented fallback. Reviews are pending, not passes.

## 7. Critical source-quality finding — do not lose this

Research synthesis/audit receives `input.snapshot` evidence/evidenceIndex and context/baseline, **not every original transcript segment**. Full transcript imported for references does not mean the model saw it.

- Case14 IDIQ qualifier is absent from historical evidence inventory; unchanged-inventory research experiment cannot honestly claim that omission recovered.
- Existing upstream recall ran, but incomplete: long video46/46 windows processed,14 assessed; case14 nine/nine processed,two assessed. Processing windows is not semantic completeness.
- Long video693/1692 segments outside inventory quotations; case12 414/1335; case18 460/1030. These counts alone are NOT material-omission counts.
- Do not silently enrich only experimental inputs. Shared source reconciliation must be a separately versioned equal-input treatment with its own cost, then frozen for BOTH arms.
- Proposed design only in `shared-source-reconciliation-design.md`: bounded source-to-proposition/qualifier reconciliation with original spans, unresolved/exclusion accounting, deterministic merging. Not implemented or paid-tested.

UI explanation now explicitly distinguishes extraction/full-transcript availability from inventory-only research audits. The earlier screenshot wording was corrected in code after visual inspection; updated built text still needs fresh browser evidence.

## 8. Evidence and measured historical results

Reports:
- `docs/reviews/readiness-recovery-results-20260927.md`
- `docs/reviews/targeted-audit-implementation-20260927.md`
- `docs/reviews/targeted-audit-input-readiness-20260927.md`
- `docs/delivery/live-comparison-20-20260920.json` and `.md`

Three research-only recoveries (NOT full end-to-end times):

| Video | Total stage seconds | Audit seconds | Recorded USD | Coverage |
|---|---:|---:|---:|---|
| ZfOQoh82JTo (long) |855.533|798.680|3.1338965|partial37/101|
| M1FJ5dNiBEs |296.425|255.337|1.027745|partial32/37|
| iBMZc7zs_Ew |765.995|711.667|3.0532125|partial39/92|

Summed research1917.954s, audit1765.684s =92.1%. This ratio is summed stage time, not necessarily wall-clock share with parallelism.
H3 spend$7.214854; H8$9.5620965; separate H19 audit$0.210954; combined$16.9879045. Operational recovery is not quality acceptance. Keep original failed/partial attempts.

Known checks include gold/silver relation reversal, Banyan severe-correction misstatement, CAGR/ownership/mixed-speaker association, scenario margins, IDIQ qualification and option roles/expiry. Inspect original passages; do not treat LeapEdge agreement as verification. No complete retained LeapEdge long-video report is available.

All20 donor source hashes matched. Nineteen nonempty external snapshots contain260 completed retrievals/780 text records; case15 explicitly empty query plan. All audioVerified=false. Cases2/3 timestamp coverage83.4%/87.5%, incomplete/unknown. Eighteen donors have source-recall warnings. September26/27 retrieval does not establish that web content existed at video date.

## 9. Verification status and limits

Before latest checkpoint:
-7d68113 full default/PGlite suites:742 total,741passed,1existing skip,0fail each; typecheck/build passed.
-Expanded cloud/evaluation work full suites:773 total,772passed,1existing skip,0fail each;234.530s/235.486s. Logs `data/targeted-audit-20260927/cloud-full-default.log` and `cloud-full-pglite.log`.
-Typecheck and production build passed (`cloud-typecheck.log`, `cloud-build.log`).
-Offline promotion diagnostic passed as **advisory-only**, not a semantic gate. Historical fifty-case diagnostic remains nonbinding.
-47 targeted cloud/runner/source/locking/conventions tests passed, zero skips; cloud lane25 checks passed; evaluation lane35 passed.
-Full-suite evidence predates removal of cancelled Google wake hook and final handoff documentation. Record subsequent targeted checks separately; do not misstate exact revision tested.
-No new runtime dependency in this checkpoint. Actual Linux image build did not run.

Browser in isolated fixture PostgreSQL workspace on3031:
- Experimental selector saved, reload retained selection; Current saved/restored; reset returned selector to Current; discard restored saved config.
- Explanation desktop screenshot and390×844 mobile screenshot inspected. Actual mobile innerWidth390, document scrollWidth375: no measured horizontal overflow.
- Screenshots: `data/targeted-audit-20260927/pipelines-desktop.png`, `pipelines-mobile.png`.
- Run identity, evidence drill-down, partial/failure states and full portal matrix are NOT newly accepted by these limited checks.
- Original PGlite production fixture preview3030 failed `h.instantiateWasm is not a function`; switched isolated fixture test DB to PostgreSQL. Do not label PGlite browser runtime fixed.

## 10. Private/local material: not backed up by Git push

`data/` is ignored. Claude on the same Mac can read it; a clean cloud clone cannot. Preserve without publishing raw credentials or private records.

- `data/readiness-20260927/frozen-cohort.json`
- Candidate donors: `candidate-g-session-2.json`, `candidate-h-session-1.json`, `candidate-h-remaining8-session-2.json`, `candidate-h19-audit-recovery-session-1.json` under same directory.
- `data/targeted-audit-20260927/`: logs, screenshots and upload manifest.
- `/private/tmp/targeted-cloud-preflight-v2-bundle.json` and `/private/tmp/targeted-cloud-preflight-v2-evaluation`: PRE-FINAL preflight,20cases/40arms, no spending. Later source edits invalidate frozen implementation identity. Regenerate after Vercel implementation; do not run stale bundle.
- Old preflight canonical bundle SHA `11354ac3e9c150c1ac66f9b67dc2f5558de92526afca62d496a6d07a31513484`; frozen-plan byte SHA `79563e7c14dff7cd4ea4caf355933087b74919d9cf41895041a04d4db72dfdfc`.
- Existing private runtime environment is under `/Users/joshmini/Library/Application Support/YouTube Intelligence/.env.live`. Never print/copy into docs/Git. A temporary Exa credential appeared earlier in conversation; do not reproduce it. Inspect available variable NAMES only, use authorized scoped secret handling.
- `/private/tmp/yti-targeted-browser.mjs`: isolated local preview bootstrap,3031, provider keys stripped, queue paused, fixture mode. Session14033 was active; discover actual PID/port before stopping. Historical3019 and3028 may belong to earlier work; do not kill indiscriminately.

## 11. Cancelled Google preparation — preserved only for provenance

Google project `leapedgestudy` under the research account had billing enabled already. Coordinator enabled Run, Artifact Registry, Cloud Build, SQL Admin, Secret Manager and Scheduler APIs; created empty registry `yti-images` in `us-central1`. No new database, runtime application, service-account grants, credential transfers or model jobs were completed. Source upload was denied. Do not retry it.

Prepared files: rootDockerfile/.dockerignore/.gcloudignore, `deploy/cloud/*`, unused `cloud-worker-launcher.ts`, cloud tests. They are disabled preparation, NOT the deployment plan. Post-admission Google launcher hook has been removed. Retain this fact in reviews; remove/archive obsolete files in a separate tidy checkpoint when safe, rather than accidentally deploying them. Do not delete existing Google project or billing account; it may serve existing Gemini/API usage.

## 12. Cost discussion — assumptions, not a quote

User asked costs, then broader cheaper options, then selected Workflows anyway. At30,000videos/month,40steps/video,10minutes total function lifetime at2GB and20active CPU seconds/video, earlier model suggested$300–400/month infrastructure including an assumed1CU always-onNeon. It was not measured and not a minimum. Fluid Compute concurrency can share memory; DB average size/dutycycle unknown.

Official prices checked27September:
- Vercel Pro$20/month with$20usage credit (do not double-charge existing subscription).
- Workflow events$0.02/1,000; typical successfulstep3events. Data written$0.50/GB; retained$0.50/GB-month. Queues and Functions billed separately. Pro workflow retention7days: preserve long-term audit trail in Neon, not just Vercel logs.
- US Vercel Fluid activeCPU$0.128/hour, memory$0.0106/GB-hour. Actual regional rates vary.
- Neon Launch$0.106/CU-hour, storage$0.35/GB-month; actual account/Marketplace plan must be checked.
- Provider spend likely dominates: saving$0.05/video at30,000/month saves$1,500. Gemini batch advertises50% discounted rates but has slower turnaround; not automatic choice for interactive requests.

Sources: https://vercel.com/docs/workflows/pricing ; https://vercel.com/docs/functions/usage-and-pricing ; https://vercel.com/docs/queues/pricing ; https://neon.com/pricing ; https://ai.google.dev/gemini-api/docs/pricing . Reverify when implementing; libraries/prices change.

Research alternatives only: Render$25/2GBworker, Railway usage-based, Cloudflare Workflows, DigitalOceanVPS, Trigger.dev and AWSLambda. **None selected/authorized to deploy.** Queues-only was suggested as cheaper, but user's subsequent explicit Workflows choice supersedes it.

## 13. Next steps — ordered build and release checklist

### A. Preserve handoff first
- [ ] Commit/push this document and current reviewed implementation; verify remote SHA. Keep PR13 draft, update description/status. Exclude user-owned UI backup and all secrets/private run data.
- [ ] Link this document from AGENTS/ledger; prominently supersede Google and historical Mac instructions.

### B. Implement Vercel Workflow adapter
- [ ] Read installed-version Workflow/Next documentation; pin reviewed dependency and record it in PR. Do not copy outdated skill snippets blindly.
- [ ] Inspect current admission, processNext/researchStep, queue/fencing/call ledger, provider duration and database contracts. Define workflow run IDs mapped to existing analysis IDs.
- [ ] Write behavioural tests first: admission crash boundary, duplicate delivery, checkpoint resume, unknown provider outcome, timeout, cancellation/pause, frozen settings/version, delayed batch poll.
- [ ] Dispatch after committed admission with durable reconciliation for commit-success/dispatch-failure. No network inside DB transactions; no detached fire-and-forget task as durability guarantee.
- [ ] One bounded processing unit per step. Break long audit loops into existing checkpointed jobs; source windows and provider polling resumable. Preserve all original transcript segments and inventory denominator.
- [ ] Keep large bodies/evidence in Neon; pass stable IDs/hashes to Workflow. Preserve long-term traces/costs independently of platform retention.
- [ ] Constrain concurrency in shared durable state. Respect provider quotas; do not equate platform max concurrency with approved paid workload.
- [ ] Automatic platform retries must NOT repeat uncertain billable requests. Preserve reservation/response-ledger reconciliation; completion/cost reconciliation must survive a process ending between provider receipt and database persistence.
- [ ] Co-locate Vercel execution/Workflow state with Neon where supported; use correct pooled vs direct DB endpoints and bounded pools. Add authenticated recovery/cron path.
- [ ] Deploy preview and verify environment/access boundaries without downloading production secrets unnecessarily. Preserve existing HTTPS callback routes and authentication.

### C. Verify cloud-only reliability and UX
- [ ] All five repo checks: `npm test`; `YTI_DB=pglite npm test`; `npm run typecheck`; `npm run build`; offline promotion diagnostic.
- [ ] Dependency audit after Workflow addition; real PostgreSQL multi-process fencing/concurrency tests (PGlite alone insufficient).
- [ ] Cloud submit reaches Neon and completes with Mac worker stopped/disabled. Prove workflow continuation, restart, provider failures and no duplicate settlement/paid calls. Keep unknown outcomes visible.
- [ ] Desktop/mobile browser matrix: settings/persistence/reset, Today progress, Channels, Leaderboard, Saved, Lab, Analysis, source timestamp drilldown, partial/failed/retry states. Screenshots must be actual inspected UI.
- [ ] Record first-useful and final-visible time, queue delay, provider/stage durations, actual costs. Cloud execution success is not semantic quality.

### D. Paired targeted-audit evaluation
- [ ] Regenerate frozen20-case bundle and implementation manifest after adapter stabilises; all inputs/models/cutoffs equal. Original40-arm retained-inventory experiment stays separate from source-enrichment treatment.
- [ ] Adapt portable runner to bounded Workflow dispatch/checkpoint/export; use isolated Neon benchmark data/branch. Never run the monolithic cloud CLI inside oneFunction.
- [ ] Execute bounded paid pairs, alternate arm order, retain every attempt/failure/cost. No new LeapEdge calls. Unknown billing outcomes stop admissions until reconciled.
- [ ] Review known defects + predefined source windows, exact financial relations/units/conditions, point-in-time separation and long-video omissions. Case14 cannot pass by ignoring source gap.
- [ ] Report percase and aggregate results. Missing/failed pairs cannot disappear from performance denominator.
- [ ] Targets: >=30% lower median freshdraft/audit stage time, improved longvideo time, >=25% lower researchdraft/auditcost including repairs/retries; zero critical candidateerrors, no material coverage regression, known omissions recovered, preserved auditability/UI/cloudreliability.
- [ ] If any gate fails, keep Currentdefault and report why. Promotion requires explicit userapproval after evidence. Original path stays selectable afterward.

### E. Operational scale and release
- [ ] Separate100-video burst test with bounded provider spend, queue latency, fair admission, connection/memory limits, failure recovery and cost alerts. No capacity claim from20pairs.
- [ ] Validate migration/release/rollback checklist and actual production revision. Do not unpause old backlog or enable unlimited channel replay as a sideeffect.
- [ ] Push at each verified milestone; retain draftPR until release acceptance. User previously authorized push/merge, but do not merge unfinished/failed acceptance or silently promote experimentaldefault.

## 14. Suggested first Claude prompt

“Read AGENTS.md, docs/delivery/ledger.json and docs/handoffs/2026-09-27-claude-handoff.md. Continue the Vercel + Neon + Vercel Workflows cloud worker implementation with current audit default preserved. Google migration is cancelled; do not act on old Google approvals. Preserve user-owned ResearchBrief (1).tsx and private artifacts. Inspect git/remote and actual test state first, implement bounded durable steps with existing paid-call safeguards, verify preview/cloud/browser recovery, and push each verified milestone. Do not claim performance/quality gains until matched20-case evaluation and source-backed gates pass.”
