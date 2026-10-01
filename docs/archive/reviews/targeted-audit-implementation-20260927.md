# Targeted audit experiment implementation

Status: experimental implementation under validation. Current pipeline remains default. No live paired experiment, browser acceptance, cloud deployment, or default promotion has occurred.

## Implemented scope

The experimental path retains source extraction, synthesis and initial full evidence auditing. Supplemental auditing adds a full-inventory impact assessment to new-statement verdicts. Prior covered assessments can be retained only when evidence, original accepted statements, supporting dependencies and shared context remain unchanged. Direct citations from new accepted statements invalidate reuse regardless of the model's impact answer. Missing, partial, unknown and invalid assessments always require reassessment. Unknown impact falls back to full coverage review. Reused assessments remain distinguishable from fresh model attempts and retain their evidence denominator.

This is the first supplemental-audit experiment, not the complete proposed extraction redesign. Small experimental drafts use separate bounded statement and coverage jobs, whereas current small drafts can use one combined job. This may increase cost. Impact judgments can miss indirect relationships; these require explicit source-backed adversarial evaluation. Broad prior coverage findings remain visible rather than being silently cleared.

Settings exposes a separate current/experimental pipeline selection and explanation page. Selection and version freeze at admission; automatic research inherits the source's selection. Explicit newly requested research uses the current saved preference. Existing queued/running/historical records are not rewritten. Malformed recorded identities fail processing closed but display as unavailable rather than breaking the portal. Historical unrecorded identities are labelled legacy, not assigned a supposedly recorded version.

Legacy audit checkpoint hashes omit only the newly defaulted current preference when historically absent. A dedicated regression independently reconstructs the old hash/stage suffix and restores a checkpoint after settlement: one provider invocation, one completed call and $0.001 synthetic charge remain. This is fixture evidence, not live billing verification.

## Evaluation preparation

The new non-spending prepare/freeze/gate CLI requires the original 20 case identities, identical frozen transcripts/external sources/model settings/context, complete admission and cost accounting, artifact reconciliation and source-backed quality review. It cannot invoke providers or change defaults. Both arms must generate fresh drafts/audits; cached/imported checkpoints are not fresh processing.

Known baseline quality failures are evidence to improve, not a reason to reject a corrected candidate. Baseline unknown quality remains blocking. Candidate quality and comparative material coverage must pass. Duplicate pairs cannot produce comparative medians. Thresholds are 30% lower median summed research-stage seconds, 25% lower median research cost, and improved long-video time, subject to all quality/reliability/UI/cloud requirements. Browser visibility and wall time are separate from stage sums. Acquisition/extraction costs are excluded from this research-only experiment and must be reported separately for end-to-end claims.

A passing gate yields only eligible-for-user-review. Explicit user approval is still required before default promotion, and current remains selectable afterward. The removed 50 human-case requirement is not reinstated. No new LeapEdge requests or Finradar integration.

## Verification and remaining work

- Targeted integrated fixture: nine evidence items retained; three legacy supplemental invokes versus two experimental invokes. Not a live speed/cost or quality claim.
- Final full suites: 742 tests, 741 passed, one existing skip, zero failures in each database mode. Typecheck and production build passed. Offline promotion diagnostic remains advisory-only. Logs are retained under ignored data/targeted-audit-20260927.
- Initial full-suite regression found that the direct SQL duplicate-index fixture used pre-admission input rather than the newly frozen stored input. The test now attempts an actual identical admitted record; concurrent create and duplicate-index assertions remain intact.
- Browser preview launch was rejected by automatic approval review because it interpreted the user's cloud-only requirement as excluding a temporary local fixture preview. No preview server was started. Browser acceptance remains pending a permitted test surface.
- Cloud hosting topology/cost decision, cloud runner/admission/export adapter, complete frozen snapshots, paired paid runs and independent source review remain pending. Existing Mac cohort controller must not be reused as cloud acceptance.
- No deployment, merge, promotion, or live paid analysis performed in this implementation.

See [agent checklist](../delivery/targeted-audit-experiment-checklist.md) and [evaluation contract](../../evaluations/targeted-audit/README.md).
