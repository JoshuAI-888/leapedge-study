# Targeted audit experiment — agent execution checklist

Authority: user approved implementation on 27 September 2026. This is an experiment, not permission to change the default. Owner: coordinating agent. Draft PR: 13.

## Non-negotiable goals

- [x] Current repeated-audit implementation remains intact, selectable and the default.
- [x] Experimental targeted audit is an explicit separate pipeline choice, independent of efficiency profiles.
- [x] Freeze pipeline/version/settings per run; changing preferences affects new runs only. Historical and running outputs are immutable.
- [ ] Preserve full-source processing, original quotes/timestamps, uncertainty, rejected candidates, provider traces, attempts and total costs.
- [ ] Preserve equal short/long horizons, general cross-company materiality, video-date analysis and separate current updates.
- [ ] Do not improve apparent quality by removing difficult cases, hiding gaps, truncating transcripts or treating completion as acceptance.
- [ ] Preserve all UI functionality and approved Finradar theme; do not modify the user's untracked ResearchBrief (1).tsx.
- [ ] Production must be entirely cloud-hosted; local development checks are not cloud acceptance. No cloud purchases/provisioning until topology and costs are approved.
- [ ] No new LeapEdge requests. Use retained reports as comparators, never ground truth. Fifty human-verified cases remain removed; no Finradar integration.

## Agent lanes and handoffs

1. Pipeline agent: bounded-research-audit.ts, research-pipeline.ts, new targeted-audit helpers and dedicated pipeline tests. Coordinate settings contract before integration; no UI/ledger edits.
2. Evaluation agent: new experiment schemas, paired measurement/gate scripts and dedicated tests. No paid calls or live changes; no pipeline/UI edits.
3. UI/settings agent: pipeline preference schema, settings control, explanatory page and run identity display, dedicated settings/UI tests. Coordinate admission snapshot with pipeline owner.
4. Coordinator: ledger, integration/admission gaps, adversarial review, full verification, browser evidence, bounded evaluation and release reporting.

Every agent reads AGENTS.md and applicable skill/spec, writes behavioural tests first, reports exact files/tests/limitations, and checks this document before handoff. No agent changes defaults, deploys, runs paid cohorts, removes legacy code or claims quality parity.

## Build and correctness

- [x] Record baseline revision and preserve current path regression behaviour.
- [x] Write failing tests for targeted selection, unchanged coverage reuse, changed/rejected dependencies, unknown coverage, malformed responses and checkpoint recovery.
- [x] Implement targeted repair with explicit dependency accounting. Reuse prior coverage only when evidence, accepted sentence dependencies and relevant context are unchanged; unknown dependencies require reassessment.
- [x] Retain complete evidence denominator and unresolved findings. Missing/unknown answers never become covered through reuse.
- [x] All new model boundaries use zod and existing transport/ledger; no duplicate payment on resume.
- [x] Persist user selection; show experimental status, tradeoffs and per-run identity; invalid values rejected; reset restores current path.
- [x] Run targeted tests, then npm test, YTI_DB=pglite npm test, typecheck, build and offline promotion diagnostic (advisory only).
- [ ] Inspect desktop/mobile settings save/reload/reset, explanation page, run identity, evidence drill-down and failure/partial states. Record actual screenshots and interactions.

## Paired evaluation protocol — freeze before paid calls

- [ ] Freeze 20 video IDs, transcripts, external-source snapshots, date cutoffs, model settings and implementation hashes.
- [ ] Fresh drafts/audits on both arms; distinguish exact caches and imported source costs from fresh work. Alternate arm order where practical.
- [ ] Report every case, first-attempt outcome, retries, failed costs, missing outputs, stage seconds, wall seconds, first-useful/final-visible latency and call/token counts. Never compute speed only over convenient successful cases.
- [ ] Source-backed review of known critical failures plus previously unselected transcript sections; inventory counts alone are not recall scores.
- [ ] Explicitly inspect reversed relations, conditional/hypothetical quantities, holdings vs recommendations, metric/period/unit association, missing qualifications, ambiguity and long-video completeness.
- [ ] Exercise provider failure/restart/recovery separately; no duplicate charges. Cloud acceptance and 1,000/day capacity remain separate from a 20-video quality comparison.

## Promotion gates — all required, no automatic default change

- [ ] Zero unresolved critical errors in evaluated final outputs; all known critical failure cases corrected.
- [ ] No material coverage regression; known important omissions recovered. Partial/failed outcomes remain in denominator.
- [ ] Attribution, numerical semantics, point-in-time context, horizons and evidence drill-down preserved.
- [ ] No silent truncation, false completion or duplicate billing in tested recoveries.
- [ ] At least 30% lower median research-processing time and improved long-video time, using predeclared paired accounting. Report unsuccessful pairs explicitly; incomplete cohort cannot pass.
- [ ] At least 25% lower median research cost including repairs/retries/failures; report totals and per-case regressions too.
- [ ] Desktop/mobile acceptance and fully cloud deployment acceptance complete.
- [ ] Publish evidence and obtain user approval before default promotion. Maintain legacy choice and operational rollback afterward.

Status: experimental implementation complete under validation; both full suites passed (741 pass,1 existing skip each), typecheck/build passed; offline gate advisory only. Browser, paid paired comparison and cloud acceptance pending. No default promotion. Checked implementation items do not certify live semantic quality.
