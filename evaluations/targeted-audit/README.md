# Targeted audit experiment contract

This is a non-spending preparation and evidence gate, **not a cloud cohort runner**.
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
3. Add cloud admission registry, source import and model-call export adapter.
   `scripts/run-cohort-durable.mjs` uses a Mac cluster and live retrieval; it is
   not suitable unchanged and is deliberately not invoked here.
4. Alternate arm admission order, measure real trace and browser events, verify
   no hidden truncation, and reconcile provider billing including failures.
5. Review source-backed quality independently; retain all20 outcomes and costs.
6. Run the gate, inspect its evidence, and obtain explicit user approval before
   any default promotion. Preserve legacy selection and rollback.
