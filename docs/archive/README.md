# Archive — v1 evidence trail

Archived 18 September 2026 by `docs/review/delivery-review-20260918.md`.

Everything here is **evidence, not documentation**. It records what was built,
measured and verified between 13 and 16 September 2026, before the v2
specification was written. It is kept because several external claims — LeapEdge
parity, transcript accuracy, provider comparison, deployment acceptance — rest on
these measurements, and a claim whose evidence lives only in git history is a
claim nobody can check.

**Nothing here describes the current code.** For that, read
`docs/spec/youtube-intelligence-v2-spec.md` (revision 3),
`docs/spec/youtube-intelligence-v2-build-plan.md` and
`docs/production-and-integration.md`.

Retired code from the same period is under `scripts/archive/`.

---

## Consumed inputs

Two handoffs that were evaluated and dispositioned in spec section 10. Their
proposals are now either folded into the v2 spec or explicitly declined; neither
is a plan anyone should still be working from.

| File | What it was |
|---|---|
| `handoff-truealphadata.md` | TrueAlphaData study handoff: regeneration, validation and artifact data plan. Its statistics layer — Wilson interval, t, p, FDR-adjusted q, sample gates — was kept and became F36. |
| `handoff-videoconviction.md` | VideoConviction integration handoff with UI mockups. **Removed from the design** by spec revision 3 on 17 September: no product surface used its labels, so it is not a gate, a Lab panel, a seed source or a fixture. |

## v1 acceptance record

| File | What it proves |
|---|---|
| `completion-report.md` | The completion and verification record for the v1 lab. |
| `implementation-checklist.md` | Feature parity and acceptance matrix, 14 September. Carries a dated note: the "Source acquisition" row was superseded by F20, which retired the YouTube.js adapter. |
| `institutional-readiness-20260916.md` | Institutional readiness assessment and its replay evidence. |
| `parity-checkpoint-20260915.md`, `leapedge-side-by-side-20260915.md`, `leapedge-source-disclosure.md`, `leapedge-reference-observations.json`, `leapedge-captionless-result.json` | The LeapEdge comparison: what the reference product does, what this one does, and where they intentionally differ. |
| `human-review-findings-20260915.md`, `human-review-intake-20260915.json`, `reviewed-facts-20260915.json`, `blind-audio-review.html` | The blind human review of extracted claims against audio, and its scored results. |
| `browser-parity-protocol-20260915.md`, `browser-parity-report-20260915.md`, `browser-parity-results-20260915.json` | Fresh-browser parity testing and its reproduction protocol. |

## Provider and transport research

This is the research that produced the v2 transport policy in spec 4.1 and 4.10.
The native-Google evaluation harness that generated much of it was deleted on
18 September; its findings survive here.

| File | What it proves |
|---|---|
| `native-google-findings-white-paper.md` | The detailed findings paper. Linked from `docs/architecture/README.md`. |
| `native-google-ingestion-plan.md`, `native-google-live-assessment.md` | The plan and the live assessment behind F10. |
| `native-google-*-results.json`, `native-google-source-snapshots.json`, `native-google-research-sources.json`, `native-google-script-manifest.json` | Raw results, snapshots and the source register cited by the white paper. |
| `three-provider-repeat-results.json` | 54 requests: six videos, three repetitions, three providers. Historical client-to-cloud timings, not a simultaneous comparison. |
| `transcript-provider-comparison.md`, `transcript-accuracy-benchmark.md`, `transcript-provider-support-draft.md` | Provider comparison and the accuracy benchmark method. |
| `free-caption-benchmark.md`, `free-caption-benchmark.json` | The free-caption benchmark that preceded the TranscriptAPI decision. |
| `bibigpt-live-assessment.md`, `bibigpt-live-results.json` | Authenticated BibiGPT failures. The adapter was retired by F20. |
| `managed-caption-integration.md`, `managed-caption-*.json` | Managed caption failover, cloud benchmark and deployment checks. |
| `benchmark-findings.md`, `benchmark-metrics.json` | The initial model research. |
| `prompt-and-context-design.md`, `prompt-v6-development-results.json`, `v9-results-20260915.json` | Prompt development through v6 and the v9 experiment, which was retained as a recorded failure. |
| `source-selection-findings-20260915.md`, `source-selection-results-20260915.json` | Source-selected evidence testing. |
| `completion-boundary-replay-20260915.json` | Quote-boundary A/B findings. The code that produced this (`evidence-boundaries.ts`) was superseded by F12 pointer evidence and deleted. |

## Superseded tooling notes

These describe tooling that no longer exists in the repository.

| File | Status |
|---|---|
| `promptfoo-isolation.md` | The isolated promptfoo dependency tree was deleted on 18 September; spec revision 3 makes the gold set the only evaluation set. |
| `youtubejs-and-promptfoo.md` | Both subjects retired: YouTube.js by F20, promptfoo as above. |
| `youtube-api-options.md` | Superseded by spec 4.8 and 4.10. |
| `web-pilot-status.md`, `leapedge-study.md`, `finradar-production-plan.md` | Early planning documents, overtaken by the v2 spec. |

## Raw run artifacts

`completion-*`, `institutional-*`, `hosted-*`, `live-*`, `email-*`,
`final-hosted-check.json`, `*-dependency-audit.json` and the twenty-five `.log`
files are the raw console output and JSON results of the 15–16 September
acceptance campaign: test runs, typechecks, builds, deployments, webhook setup
and reconciliation.

They are kept verbatim, unsummarised, because their value is that they were not
edited afterwards. They are not meant to be read end to end; find the one you
need by its date and subject.

---

## What is deliberately *not* here

The gate reports (`docs/gates/`), the phase-0 human-inputs handoff
(`docs/handoff/`), the architecture diagram (`docs/architecture/`), the LeapEdge
workflow audit that still serves as a requirements source (`docs/audit/`), the
operations runbook and the Finradar integration handoff all remain live in
`docs/`. So does the v2 specification and build plan.
