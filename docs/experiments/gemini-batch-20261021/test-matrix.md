# Test coverage and limits

| Required behavior | Evidence |
|---|---|
| Create/retrieve; durable idempotence; discounted matching response | `tests/batch.test.ts` original happy path; three live text jobs |
| Input/model/window/cache validation | New batch admission regression; new model metadata evidence |
| One request versus multiple grouped | Original two-independent-item test proves two one-item jobs; `gemini-batch-sdk.test.ts` proves1/3 keyed SDK serialization. Grouped production settlement/live throughput not implemented or claimed. |
| Missing/duplicate/out-of-order keys | Original wrong-key/terminal and unrelated-first tests; new duplicate-key regression |
| Mixed success/failure | New independent-item partial-success test. Current job cardinality is one; no multi-item production claim. |
| Disconnect just after submit; no duplicate charges | Original uncertain-submission test; real Postgres killed-worker acceptance simulation and eight concurrent admissions |
| Crash/lease recovery/stale ownership | New real separate-process check; existing queue/resume/e2e tests; existing audited Postgres check |
| Temporary polling failure | New repeated temporary-read test; original worker pending/resume test |
| Failed/cancelled/expired terminal state | Original terminal-state test; new expired-job hold test |
| Bad/missing usage, reasoning cost, cached input | New undefined/empty/partial/negative usage and replay regressions; existing transport price/reasoning fixtures; real Planet cache usage |
| Budget exhaustion | New cumulative/per-video batch denial; existing campaign/monthly/ledger tests; real campaign contention/unknown-hold check |
| Malformed provider response/JSON; invalid timestamps | New malformed-envelope unknown hold; existing model-json/transport replay JSON gates; windowed-asr/source timing and density tests |
| Unsupported/inaccessible media | Live B400; existing inaccessible-window needs-review tests; per-item mocked provider error |
| Source/prompt/model/version preservation | Batch fingerprint/raw model-version fixture; experiment manifests and pair-hash rejection; existing run-config/source/evidence tests |
| Independent critique/publication | Existing family tests, numeric/attribution/semantic/source-range, atomic repair and publication tests; live401 prevents claiming a reviewed result |
| Invented decimal / attributed forecast / reversed dependencies / guidance / conditions | Existing research numeric, attribution, retained-basis, support/publication and semantic-basis fixtures; captured Planet guidance diagnostic fixture |
| Synchronous regression | Both full repository suites, native/transport/model-call/resume checks, three live media and three text controls |

The original five batch tests passed before repair. Each implemented gap had an observed failing test before the change: incomplete usage, replay state, admission, rejection diagnostics, malformed response, pure policy media gate, report comparison and experiment/audit helpers. Red/green logs are summarized in the verification artifact; logs and private raw outputs are not claims of independent accuracy.

No paid disconnect, cancellation, expiry, quota exhaustion, saturation, grouped job or invalid-output fault was deliberately injected into a live provider. Such cases use deterministic provider stubs and real Postgres where locking matters. Final review also added an isolation regression: a paused run alone was claimable, so experiment run creation now atomically disables its automatic analysis job; the real Postgres check covers that boundary. No browser/UI evidence is fabricated; this PR changes server safety and experiment tooling only. The offline legacy promotion diagnostic has zero binding measurements. Full command outcomes/counts are recorded in `results/verification.json` after final verification.
