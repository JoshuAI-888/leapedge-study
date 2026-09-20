# Evidence efficiency build and measurement

Status: implemented in PR #11; final release verification in progress. Production promotion is recorded separately in the delivery ledger.

User-authorized order: (1) reusable evidence, (2) focused audits, (5) selective translation, then (3) overlapping research, (4) worker admission tuning, (6) version/date-aware caching, (7) fatal-account fail-fast. Finradar integration and new LeapEdge submissions remain excluded.

## Baseline and controls

Baseline repository a949a8e; installed production pipeline 7b609a2. Historical four-video recovery cost $1.54788125 is observational, not a controlled baseline. Frozen retained inputs: SPIRV9UjNYU, M1FJ5dNiBEs, ZfOQoh82JTo, 1WNowIoNgtg. Start with paired translation/final-audit stages on identical frozen source, draft, external retrievals and model settings at concurrency one. Isolated PGlite database; live providers; no caption acquisition or new LeapEdge requests. Record all paid calls including failures. Stage measurements do not establish ingestion-to-display gains or daily capacity.

Measure actual API cost, input/output tokens, stage wall time, payload bytes, skipped and unique translations, evidence hashes, per-sentence audit decisions, missing/unsupported content and confidence/date handling. Follow with whole-pipeline evaluation before production promotion. The four known regressions are source-review checks, not human-certified ground truth: Credo under-170 preference, Dutch Bros competitive context, options expiry/strike/position state, and original Mandarin evidence.

## Quality constraints

Preserve original source and quote hashes, exact numeric/option terms, all accepted video evidence, independent model critique, full transcript analysis context, existing recall checks and video-date/current separation. Dictionary encoding is used only when smaller; a larger index is retained for provenance but not sent. Focused final audit keeps all video evidence and all eligible external text and full baseline history, including uncited counterevidence. No fabricated human verification or comparator-as-truth claims.

Optimised research payloads are opt-in with `efficiencyVersion: evidence-efficiency.v1` until controlled quality review. English `asr-en` recognition and exact-span translation deduplication have deterministic regression coverage. Cross-run caching must have version/config/date/freshness keys and zero new cost on hits. Fatal account errors stop untouched work while draining already-started paid calls.

Acceptance: required repository checks, source-backed output comparison, browser evidence drill-down and desktop/mobile checks. If quality degrades, retain baseline behavior; do not promote for latency alone. Targets are hypotheses, never measured results: 25% lower model cost and 30% lower final latency.


## Results and release decision

The initial combined translation/audit experiment is **superseded**: an audit
payload reduction removed uncited external text and was rejected during review.
Its claimed combined savings are not release evidence. Full external and baseline
context have been restored. Exact English translation skipping remains valid:
the options and long-podcast translation stages fell from 16.27s and 26.87s to
under 0.01s each, with original English evidence unchanged. Mandarin still runs
translation and retains original Chinese quotations.

The raw four-video full candidate measured 414.809s → 345.194s and
$1.462623 → $1.337095 across extraction-to-brief processing. These are observations
before the final coverage repair, not the final release's proven end-to-end gains.
Live search and model variation, and sequential baseline history, limit causal
attribution. See [the source-backed comparison](optimization-full-quality-20260920.md).

Four separate brief-only followups cost $0.50987525. Reviewed company mentions now
reach the final brief with immutable source spans, restoring Credo's under-170s
preference and Nvidia's portfolio context. Dutch Bros' moat concern is explicit.
A deterministic check withholds an inconsistent options breakeven even when the
model critic accepts it; strategy and expiry remain. Raw model outputs and the
withheld sentence remain auditable. These followup times are not spliced into the
raw full-run timings. No new LeapEdge or caption requests were made.

The 100-job PostgreSQL fixture at capacity three completed in 36.154s versus
73.079s at capacity one (50.5% lower), while the interactive request remained below
0.5s. This is a queue fixture, not live-provider daily capacity certification.

The conservative rollout preserves independent critique and all eligible
counterevidence. Research overlap is implemented and tested but remains off:
its additional planning and potentially unused searches have no measured live
net benefit yet. Retrieval caching uses exact version/query/date/domain keys and
original freshness timestamps; no broad cache hit-rate or spend reduction is
claimed from this cohort. Fatal-account admission drains paid siblings before
stopping untouched chunks.

## Browser acceptance

Final candidate production build on isolated port 3021, using retained live
benchmark outputs and a separate PostgreSQL database. Desktop theme and equal
horizon layout inspected. Mobile 390×844 measured scrollWidth 390; navigation,
horizon filtering, evidence drawer, surrounding transcript/hash, Escape/focus
restoration, transcript search and timestamp target verified with Chrome control.
English evidence correctly says it is already English. Current updates remain
separate and disclose when no eligible dated corroboration was established.

Screenshots are retained under ignored `data/optimization-20260920/`:
`desktop-final.png`, `mobile-final.png`, `mobile-evidence-final.png`.
Browser-extension warnings and the transient embedded-player origin warning
were observed; a zero-console-warning claim is not made. Video timestamp link
and loading state were verified; playback reliability is separate from evidence
fidelity.

Remaining limits: four source-reviewed videos do not prove universal quality
parity. Some entry-price qualifications and no-position disclosures are fuller
in evidence drill-down than in the condensed brief. Factual external
corroboration remains unavailable for this sample. No human-verified accuracy
badge, broad cost target, or 1,000-video/day capacity claim is made.


Final local checks: 484 tests passed and one skipped in each database mode;
TypeScript, production build, real PostgreSQL integrity checks and the offline
advisory diagnostic passed. Confirmed model/search spend for the paired stage
runs, paired full runs and four followups totals **$3.895488925**. The initial
sandbox-denied followup attempt is retained separately with an unconfirmed local
reservation, not counted as a provider charge. No additional captions or
LeapEdge analyses were purchased.
