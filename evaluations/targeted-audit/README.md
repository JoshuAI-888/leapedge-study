# Targeted audit experiment contract

The preparation and gate commands do not spend. The separate
`scripts/targeted-audit-paired.ts run --live` command is a cloud-only paired runner
that can make paid model calls under an explicit frozen budget.
It never changes application defaults. Even a fully satisfied report returns
`eligible-for-user-review` with `defaultChangeAuthorized: false`.
The current audit pipeline remains the default. The legacy offline promotion
gate cannot satisfy this experiment.

## Prepare, freeze, evaluate

From the repository root (Node 24):

```sh
node --experimental-strip-types scripts/targeted-audit-experiment.ts prepare --out /tmp/targeted-preparation.json
node --experimental-strip-types scripts/targeted-audit-experiment.ts freeze --input /path/experiment.json --out /path/frozen-plan.json
node --experimental-strip-types scripts/targeted-audit-experiment.ts gate --input /path/experiment.json --artifact-root /path/artifacts --out /path/gate.json
```

Output files are created exclusively; existing evidence is never overwritten.
`prepare` reads the retained original 20-case cohort. All source snapshots and
implementation identities remain explicitly unset. It is not runnable evidence.
`freeze` requires no admissions or measurements yet. Fill its `frozenPlan` pointer
with the resulting file's **byte SHA256** before admitting work. Keep this file
immutable in cloud artifact storage and record its hash on each admission.
The gate checks the frozen payload matches the supplied cases and thresholds.
Operational immutability and admission timestamp enforcement belong to the cloud
runner; this script alone cannot prove a plan was recorded before execution.

## Boundary contracts

`experiment.ts` exports the strict zod schema and canonical `digest` helper.
Artifact hashes are SHA256 of original bytes, while `inputSha256` is the canonical
`digest` of its entire frozen case object. Every case freezes full transcript,
external sources, date cutoff, model settings, shared context and review-section
manifest. Pipeline references point to immutable implementation manifests.
`sourceCohort` points to the retained original 20-case report; the gate rejects
substituted videos by reconciling its IDs with the frozen cases.
Both arms must use identical case inputs and model settings. Switching models
requires a separate experiment. Record the complete implementation and relevant
configuration in each arm's manifest, not just a friendly pipeline label.

Each case has exactly one aggregated `current` and one aggregated `targeted`
observation. Each observation retains **all** its admitted attempt IDs in order,
not just the final successful attempt. The admission registry records each attempt's
outcome. An extra recovery is an additional admitted attempt, not a replacement.
Each attempt must contribute stage timing. Include every paid or failed call in
`costs`, including retries; zero-cost released calls should still be represented.
Unknown charges stay null/unsettled and block acceptance. A call ID cannot occur
twice. Copies of the same ledger snapshot are not additional spend.

The cloud export adapter must produce:

- A global admission registry artifact `{ admissions: [...] }`, linked by
  `admissionsArtifact`, covering every admitted attempt including failed ones.

- A ledger JSON artifact with `{ costs: [...] }` exactly matching the observation.
  Preserve provider tokens, stage, attempt, failed-call charges and settled status.
- A trace JSON artifact with the observation's `videoId`, `arm`, `inputSha256`,
  `pipelineSha256`, `frozenPlanSha256`, `measurementKind`, `scope`, ordered `attemptIds`, `stages`,
  `wallSeconds`, `firstUsefulSeconds`, `finalVisibleSeconds`, and that pair's
  complete `admissions` subset. CLI reconciles these with the report.
- An output artifact for the published brief plus retained rejected candidates,
  findings, transcript references and versioned run settings.
- Source-backed review artifacts for every required quality check, linked in
  `quality`. Review specific quotes, conditions, financial units, original
  holdings/actions and previously unselected transcript sections. Report the
  exact source spans and affected output statement IDs. Inventory coverage and
  LeapEdge agreement alone cannot support a passed review.
- Separate acceptance artifacts for provider failure/restart/duplicate-charge
  tests, desktop/mobile interaction and screenshots, and a fully cloud deployment.
  Local browser results cannot substitute for cloud acceptance.

Review `status` values are `passed`, `failed`, or `unknown`. Baseline quality
checks must have evidence and a known passed/failed status: a known baseline
critical error or omission does not disqualify a candidate that corrects it.
The candidate must pass every source-backed quality check, including explicit
`noMaterialCoverageRegression` against the baseline; aggregate acceptance
checks describe the candidate and comparative evidence, not a requirement that
the historical baseline had no defects. Both arms still require completed,
fully observed processing, no silent truncation and no false completion.
Missing checks, unknown baseline or candidate quality, absent evidence, missing
pairs, partial/failed execution outcomes and unsettled costs block acceptance. A model's own confidence is not a review.
**Artifact integrity and reconciliation do not independently establish the truth
of observations or reviewer conclusions.** A person or independent agent must
review the linked evidence; this does not reinstate the removed 50-case exercise.

## Predeclared accounting

Time threshold: `1 - median(targeted summed research-stage seconds) /
median(current summed research-stage seconds) >= 0.30`, plus improved summed
stage time for every designated long video. Cost uses the analogous median
formula with a 0.25 threshold and all retries/failures. Every one of 20 pairs
must exist exactly once; duplicate observations suppress comparative medians
rather than silently selecting the first. Failed and partial execution cases
stay visible and cannot pass. Per-case
values, first-attempt outcomes, all attempts, stages, charges and known cost
totals are returned, so medians cannot hide individual regressions.

Wall duration, first-useful and final-visible latency are **separate fields**.
Do not substitute stage sums for wall time when stages overlap. Measure browser
visibility from the same admission clock; first-useful output must be labelled
provisional until audited. A browser loading an already completed report is not
processing latency.

Both arms generate fresh drafts and audits using frozen retained sources.
Imported acquisition/extraction is excluded from this **research-only** metric.
End-to-end cloud acquisition-to-display needs a separate benchmark and must
include source costs. Cached or imported checkpoint recoveries may be recorded
but cannot pass as fresh observations. A 20-pair experiment does not prove
1,000/day throughput or burst-100 capacity.

## Still required before paid execution

1. Approve cloud topology/costs and deploy the cloud runner and shared database.
2. Export complete retained sources and review sections; freeze the actual
   implementation manifests and the identical model/context/source snapshots.
3. Deploy and verify the new cloud paired runner below. Its admission registry,
   frozen source import and raw ledger/trace export are implemented, with local
   fixture tests; real cloud concurrency/restart acceptance remains required.
   `scripts/run-cohort-durable.mjs` remains unchanged and is not invoked.
4. Alternate arm admission order, measure real trace and browser events, verify
   no hidden truncation, and reconcile provider billing including failures.
5. Review source-backed quality independently; retain all20 outcomes and costs.
6. Run the gate, inspect its evidence, and obtain explicit user approval before
   any default promotion. Preserve legacy selection and rollback.


## Portable cloud paired runner

Freeze after code and review-manifest changes are complete; changing any packaged
implementation file invalidates resume and requires a new explicit experiment.
Preparation reads only the retained frozen/G/H donors, validates all20 original
transcript hashes and analysis cutoffs, and creates a portable bundle without
credentials. By default it uses the first donor's model settings for both arms;
`--settings` allows an explicit common configuration. `--max-usd` freezes the
bounded cohort budget. The existing per-video budget is preserved.

```sh
node --experimental-strip-types scripts/targeted-audit-paired.ts prepare --id targeted_cloud_v1 --max-usd 100 --out /path/bundle.json
node --experimental-strip-types scripts/targeted-audit-paired.ts prepare-evaluation --bundle /path/bundle.json --dir /path/NEW-evaluation-dir
```

`prepare-evaluation` freezes actual `source-review-manifest.json` sections after
checking each donor transcript hash and research-run ID. Quality remains unknown.
Copy the bundle and evaluation directory to a read-only cloud volume. Package
all listed implementation files byte-for-byte; the user-owned untracked
`ResearchBrief (1).tsx` and dotfiles are excluded. Symlinked implementation files
are rejected. The runner has no Mac filesystem paths.

Cloud execution requires `DATABASE_URL_UNPOOLED` (or direct `DATABASE_URL`) for
a dedicated migrated `yti_experiment_*` PostgreSQL database, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, and a cloud job/service identity (`CLOUD_RUN_JOB`, `K_SERVICE`
or explicitly `YTI_CLOUD_EXECUTION=true`). Cloud SQL sockets under `/cloudsql/`
are supported; local TCP and arbitrary Unix sockets are rejected. Migration is
a separate provisioning step, not a production database action by this runner.

```sh
node --experimental-strip-types scripts/targeted-audit-paired.ts run --live --bundle /bundle/bundle.json --evaluation-dir /bundle/evaluation --out /results/session-1.json --max-minutes 180
# Resume the same immutable bundle/database; use a NEW output name:
node --experimental-strip-types scripts/targeted-audit-paired.ts run --live --resume --bundle /bundle/bundle.json --evaluation-dir /bundle/evaluation --out /results/session-2.json --max-minutes 180
```

The cloud job must mount a durable writable results volume or upload its output.
The database is the durable authority: source/research admission is transactional,
IDs deterministic, completed/failed attempts never silently replaced, both arms
alternate order, and one controller holds a direct-connection advisory lock.
There are no background queue jobs from this admission path. Every call remains
in the provider ledger and response store. Unsettled outcomes stop execution;
reconcile them before resume. Normalized-response replay in the existing model
transport prevents a second payment for a durably received identical response.
A lost stage checkpoint yields unknown timing after replay, **not invented zero
or a claimed speed gain**. Test this on real cloud PostgreSQL before acceptance.

Fresh work starts at `research-synthesis`. Original source acquisition,
extraction, search planning and external retrievals are imported identically and
excluded from both arms' measured time/cost. The scope label is
`fresh-draft-audit-from-frozen-retrieval`; mixed-scope comparisons fail. No Exa,
YouTube or transcript keys are required, and those keys are removed from the
runner environment as a second guard against live acquisition/search.

**Full-transcript limitation:** the entire transcript is imported for drill-down,
but the existing research model receives retained evidence/inventory quotations,
not every transcript segment. Both arms share that limitation. The known case14
IDIQ qualifier is absent from its retained inventory and remains a blocking
omission unless shared input preparation or the production pipeline is explicitly
improved and re-frozen. Do not claim full-transcript semantic coverage from this
experiment or relabel an omitted fact as fixed by withholding prose.

After downloading retained results, export into the SAME frozen evaluation
folder (a writable copy is fine). Every export uses a unique suffix:

```sh
node --experimental-strip-types scripts/targeted-audit-paired.ts export --bundle /path/bundle.json --results /path/session-1.json --dir /path/evaluation --suffix session-1
node --experimental-strip-types scripts/targeted-audit-experiment.ts gate --input /path/evaluation/session-1-experiment.json --artifact-root /path/evaluation
```

Export verifies actual run identities, frozen inputs, models, retrievals,
registered attempts and all costs; orphan costs/attempts are errors, not discarded.
Raw artifacts retain failures, provider retries and interruptions. Exported
quality, cloud/UI acceptance and browser-visible latency remain **unknown** until
independently measured and reviewed. Server completion is not browser display.
Do not mark the gate passed solely because40 executions completed.
