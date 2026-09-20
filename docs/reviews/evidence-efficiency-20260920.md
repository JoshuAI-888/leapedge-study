# Evidence efficiency build and measurement

Status: implementation and controlled measurements in progress. Production is not promoted.

User-authorized order: (1) reusable evidence, (2) focused audits, (5) selective translation, then (3) overlapping research, (4) worker admission tuning, (6) version/date-aware caching, (7) fatal-account fail-fast. Finradar integration and new LeapEdge submissions remain excluded.

## Baseline and controls

Baseline repository a949a8e; installed production pipeline 7b609a2. Historical four-video recovery cost $1.54788125 is observational, not a controlled baseline. Frozen retained inputs: SPIRV9UjNYU, M1FJ5dNiBEs, ZfOQoh82JTo, 1WNowIoNgtg. Start with paired translation/final-audit stages on identical frozen source, draft, external retrievals and model settings at concurrency one. Isolated PGlite database; live providers; no caption acquisition or new LeapEdge requests. Record all paid calls including failures. Stage measurements do not establish ingestion-to-display gains or daily capacity.

Measure actual API cost, input/output tokens, stage wall time, payload bytes, skipped and unique translations, evidence hashes, per-sentence audit decisions, missing/unsupported content and confidence/date handling. Follow with whole-pipeline evaluation before production promotion. The four known regressions are source-review checks, not human-certified ground truth: Credo under-170 preference, Dutch Bros competitive context, options expiry/strike/position state, and original Mandarin evidence.

## Quality constraints

Preserve original source and quote hashes, exact numeric/option terms, all accepted video evidence, independent model critique, full transcript analysis context, existing recall checks and video-date/current separation. Dictionary encoding is used only when smaller; a larger index is retained for provenance but not sent. Focused final audit keeps all video evidence and every cited external/novelty document. Uncited external inventory remains visible. No fabricated human verification or comparator-as-truth claims.

Optimised research payloads are opt-in with `efficiencyVersion: evidence-efficiency.v1` until controlled quality review. English `asr-en` recognition and exact-span translation deduplication have deterministic regression coverage. Cross-run caching must have version/config/date/freshness keys and zero new cost on hits. Fatal account errors stop untouched work while draining already-started paid calls.

Acceptance: required repository checks, source-backed output comparison, browser evidence drill-down and desktop/mobile checks. If quality degrades, retain baseline behavior; do not promote for latency alone. Targets are hypotheses, never measured results: 25% lower model cost and 30% lower final latency.
