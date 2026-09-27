# Retained 20-case comparison readiness

Generated 2026-09-27T03:27:57.076Z. This is an offline provenance inventory, not a quality or performance pass.

`node --experimental-strip-types scripts/comparison-readiness.ts --validate` validates the committed artifact without private inputs. Run without the flag to rebuild from the explicit private artifact allowlist. Missing inputs fail the export.

- LeapEdge is a retained comparator, not ground truth. No new provider or LeapEdge calls were made.
- Attempt rows are retained run observations; the same run may appear in several snapshots. Earlier failures remain visible. Unique-call ledger totals avoid double billing repeated snapshots.
- Known ledger cost is not complete total spend: transcript credits, missing provider billing and unexported calls cannot be priced from these artifacts. Historical recorded prices are mixed across releases; this is not a consistent-price repricing.
- Published research counts/text come only from retained final brief records. Model-audited drafts are separately labelled and may contain sentences rejected by application validation; they are not published accepted output.
- Each duration ends at that run observation, not an entire parent-and-research-child flow. Extraction run timing excludes its separate research child. Recovery/research exports without a controlled start boundary retain null timing, even when creation timestamps exist.
- Unknown recovery boundaries have null duration. Created-to-updated duration includes queue where shown, excludes browser display and may include retries. Research-only and extraction replay are not fresh ingestion measurements.
- LeapEdge duration remains null because report timing boundaries were not captured consistently; no speedup ratio is asserted.
- Recorded-stage-execution is the sum of retained sequential stage durations for that run; it excludes acquisition, queue, inter-stage persistence and browser display. It is not URL-to-result latency. Failed stages and paid retry costs remain visible. Readiness candidate A uses retained stage durations only because its historical createdAt was overwritten; no elapsed wall-clock claim is made.
- Candidate H contains two distinct treatments: three research-only reruns using imported processed G evidence, and eight frozen-transcript source-plus-research replays. Imported completed source rows are provenance, not new extraction attempts; they are omitted from attempt rows and their historical source costs/times are not charged to H. Research rows retain exact original source ID, source-output hash and historical analysis cutoff in cost scope. Never combine these treatments into a single latency or speed-gain claim.
- An ended controller may be finished or cleanly paused; paused failures and open holds remain visible rather than blocking the comparison export. An actively running snapshot is not exported as a completed evaluation.
- Candidate G account-blocked HTTP 402 attempts remain in the historical denominator. H reruns do not replace them. Published output counts do not establish quality equivalence; all retained LeapEdge timings remain unknown.
- All quality checks are unassessed: existing prose assessments are historical findings, not a new pass. Original and latest outputs require source-backed review.
- Artifacts are explicit retained exports only; this is not an inventory of every database call ever made. Model/settings/input and output hashes allow configuration/provenance checks without publishing private raw transcripts.

## Inventory

```json
{
  "cases": 20,
  "observations": 257,
  "uniqueRuns": 230,
  "failedObservations": 34,
  "reviewObservations": 3,
  "knownLedgerUsd": 53.92658694999998,
  "unsettledCalls": 0,
  "browserMeasuredCases": 0,
  "retainedLeapedgeReports": 20,
  "missingLeapedgeTiming": 20
}
```

| Case | Video | Observations | Failed observations | LeapEdge |
|---|---|---:|---:|---|
| 1 | SPIRV9UjNYU | 27 | 2 | ready |
| 2 | J_VpfkM74Wk | 14 | 3 | ready |
| 3 | 9nb3fp76Rz0 | 12 | 1 | ready |
| 4 | 3u24qyWjSVM | 10 | 0 | ready |
| 5 | M1FJ5dNiBEs | 17 | 3 | ready |
| 6 | LF7fgz1HAFs | 13 | 0 | ready |
| 7 | U32FPvvBaNI | 11 | 2 | ready |
| 8 | jPy5aDhMsMY | 9 | 1 | ready |
| 9 | elD62rk5Ijo | 9 | 1 | ready |
| 10 | zYeJZu1hkdM | 10 | 1 | ready |
| 11 | ZfOQoh82JTo | 19 | 4 | stopped |
| 12 | iBMZc7zs_Ew | 12 | 3 | ready |
| 13 | tUR0w-LDSbU | 10 | 1 | ready |
| 14 | DuIyF_34ReI | 10 | 1 | ready |
| 15 | QEwLInO3iZY | 10 | 1 | ready |
| 16 | IjYr5acuBT4 | 11 | 2 | ready |
| 17 | pWnu1C8I6Xw | 10 | 1 | ready |
| 18 | 1WNowIoNgtg | 18 | 3 | ready |
| 19 | vrTbCxUzRw4 | 13 | 2 | ready |
| 20 | Dy_0RtmAt1U | 12 | 2 | ready |

## Before claiming improvement

Review the six per-case quality checks against retained transcripts and LeapEdge outputs. Run matched cold ingestion, transcript replay and warm-cache trials separately. Retain failed attempts and retries; measure first useful result and audited visible result separately. Never compare the sum of provider call durations with browser elapsed time. Historical observed deficiencies are recorded in operational-quality-20260920.md and adversarial-readiness-20260927.md; no checklist is automatically passed by a completed execution.
