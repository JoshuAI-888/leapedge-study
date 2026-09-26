# Candidate live quality review — incomplete

Candidate implementation: `ddf1006`. Evidence source: the atomic export `data/readiness-20260927/live-candidate.json`. This is an interim source-backed review, not a cohort quality pass. The candidate is still running; no production promotion is implied. No new LeapEdge calls are made for this review.

## Review criteria fixed before inspecting completed briefs

The following known material details come from retained exact source segments in `data/prod-resume-20260920/results.json`. Candidate source identity must match before comparing outcomes. A missing point is a coverage finding; a rejected false statement can be correct behavior, but should not also erase independent safe details.

| Video | Exact source anchors | Required distinction |
|---|---|---|
| AI / `M1FJ5dNiBEs` | `s00208–s00215`: “One of my favorite opportunities is Credo in the under the 170s” and “one of my favorites in forms of valuations.” | Preserve conditional valuation/entry context; a holdings-only mention is incomplete. |
| Podcast / `ZfOQoh82JTo` | `s00633–s00637`: 19 times operating cash flow; `s00643–s00654`: difficulty identifying sustainable advantage; `s00658–s00663`: really low starting price and high expected growth; `s00664`: “I don't have any of these.” | Preserve valuation, moat countercase, entry qualification and disclosed lack of holdings together. |
| Podcast / `ZfOQoh82JTo` | `s01605–s01608`: “I'm not short Open Door, but if I would ... cover going to the IPO”; `s01610`: “psychologically short.” | A hypothetical cover instruction is not an actual short position or trade. |
| Options / `1WNowIoNgtg` | `s00752–s00755`: downside scenario around 155; `s00760–s00767`: November 20, 175 put, 16 premium; `s00783–s00798`: 165 strike, inconsistent 1.85/12 premium and claimed 153 breakeven. | Preserve date/strike and educational strategy independently of contradictory arithmetic. 155 is a downside scenario, not an attributed creator invalidation rule. Do not silently correct a conflicting source quote. |
| Mandarin / `SPIRV9UjNYU` | `asr-0-46`: recording/market close September 17; `asr-1-36`: BOJ decision September 18. | Distinguish the dates rather than force all observations onto upload date. |

The saved LeapEdge reports are comparison references, not ground truth. Original report hashes and summaries are in `docs/delivery/comparison-readiness-20260927.json`; the final published candidate sentences, not model audit acceptance alone, determine what users actually receive.

## Snapshot observations

Initial inspected snapshot contained a completed Mandarin extraction and an in-progress research audit, with no final briefs. Draft content is not assessed as published output. Recorded settled model amount at that snapshot was US$0.1737855; this is interim, excludes unpriced transcript credits and must not be treated as the final cohort cost.

## First completed candidate: Mandarin macro/AI video

Snapshot reviewed while cohort state was `running`; research run `0634c0ea-8407-4f0d-8b6d-8c16ae1a0de7`, source run `dfe6bcdd-aba0-4392-992e-78def8299a8f`. Retained final brief contains **18 published sentences**, one rejected supplement sentence. Eight published sentences are exact duplicates of earlier published sentences. This is a **promotion-blocking usability and materiality regression**; publication count must not be interpreted as improved coverage.

| Finding | Published / rejected evidence | Assessment |
|---|---|---|
| Duplicate supplement | `coverage-1` duplicates `s-1`; similarly 2, 3, 4, 5, 6, 8 and 9. `coverage-7` duplicates `s-7` but alone was rejected for duplication. | Supplement echoed all nine original points and added one new point. Independent audit caught one duplicate but accepted eight. Preserve raw supplement in audit history; deterministic text/evidence deduplication must keep originals and prevent duplicate publication. |
| Date distinction preserved | `s-3` and `s-7` explicitly say September 17; `s-5` explicitly says September 18. | Known chronology issue improved in this brief, consistent with `asr-0-46` and `asr-1-36`. No whole-cohort quality inference. |
| Source fidelity of market figures | `s-7` matches evidence `k6`, source `asr-1-48–asr-1-62`: “17日标普500反弹1%，收在7,600，纳斯达克涨1.7%，与此同时，10年期美债回落到4.93%”. | The creator said 4.93%. The summary preserves that source assertion rather than silently replacing it. |
| External dispute now inspectable | `s-7` disputed; source `web-d4b4006fb1-2`, Federal Reserve H.15 release September 18. Exact retained row: `\| 10-year \| 4.96 \| 4.97 \| 5.00 \| 5.01 \| 4.94 \|`, under columns ending September 17, 2026. | The 4.94% constant-maturity figure is traceable. However, the creator's generic ten-year yield does not identify a constant-maturity series or observation convention. A one-basis-point discrepancy is evidence requiring reconciliation, not established proof that the creator's market observation was false. The audit explanation/omission saying “actual” overstates comparability. |
| Additional useful context | `coverage-10` adds focus on identifying quality companies and allowing time for business growth. | Potential coverage improvement, but one added point does not justify eight duplicates. |
| Confidence | Seventeen sentences unverified, one disputed; no corroborated/partial labels. | Correctly avoids pretending the source narrative has broad external corroboration. This is not independent verification of its economic facts. |

The brief's own coverage finding warns that duplicate sentences “represent the same underlying claims” and should be resolved to avoid double-counting materiality. The publication gate nevertheless emitted them. This finding was sent to the root agent immediately, recommending pausing additional cohort cost until deterministic deduplication is fixed.

At this snapshot, settled ledger amount was **US$0.40357175**. The research run's coverage supplement cost US$0.02603475 and its additional audit US$0.10185; these are included, not added again. The accounting field is called `settledModelUsd`, but the exported call ledger includes Exa `external-search-*` rows, so it must be presented as **settled ledger cost**, not pure model cost. Final cohort totals are still pending.

The remaining known-detail checks (Credo, Dutch Bros, Opendoor and Palantir) have no completed candidate brief in the inspected snapshot and remain unassessed.

## Second completed attempt: Nscale / Anthropic financing video

Video `J_VpfkM74Wk`, research run `52a9bb45-9368-4a72-9e97-d400ef22fb80`, failed at research-audit with `Coverage supplement exceeds bounded repair size; original draft retained.` Seventeen original sentences had independent accepted verdicts and no missing audit IDs. No final research brief was published. This is a **promotion-blocking reliability regression**: failure of optional additional coverage suppresses otherwise available audited work.

Examples retained in the original audit include the contract delivery-versus-prepayment distinction (`s2`, evidence `k1`), lack of binding financing commitments (`s3`, `k1`), financing transmission scenario (`s10`, `k7/k11`), hypothetical revenue/valuation downside (`s11`, `k7/k11`), and Nebius/CoreWeave balance-sheet comparisons (`s14/s15`, `k9`). All remain externally unverified; model acceptance is not publication or independent factual confirmation. The audit explicitly notes that no eligible external sources were supplied.

Recommended behavior: preserve the original validated research as visibly partial when a bounded supplement is malformed, oversized or unavailable. Keep its missing-evidence list and the raw failed supplement trace. Avoid silently truncating unique new points to force a pass. An oversized response dominated by exact duplicates should first be diagnosed as duplicate echo; genuine unresolved coverage remains a disclosed gap.

Snapshot settled ledger cost after this failure was US$0.80191425; the cohort was still running. Neither this total nor the first snapshot total should be added to another snapshot—the amounts are cumulative.

## Safe stop/resume tooling proposal — not implemented here

The running harness uses an in-memory database and writes an atomic export before and after each stage. That protects the previous complete export, but a forced exit during a provider call can lose reservations/responses written since the preceding export. The current process therefore cannot be treated as safely resumable merely because a JSON file exists.

Before another substantial live cohort:

1. Use a dedicated persistent PGlite directory or isolated Postgres database per benchmark, with an exclusive run lock. Preserve the database until accounting is reconciled and evidence archived.
2. Handle SIGINT/SIGTERM as a stop request. Stop admitting new stages/cases, let already-started provider calls settle, checkpoint the current stage, atomically export, and mark `paused` with the reason. Do not use immediate process exit or promise cancellation as a presumed refund.
3. Resume only with an explicit command referencing the same run ID, durable database, frozen cohort hash, model/settings/request identities and implementation hash. A code change creates a new recovery/treatment record rather than silently extending the original speed trial.
4. Retain statuses for not-started, running, completed, failed and review-required cases. Never create a new run for a completed stage with a reusable paid response; unresolved provider outcomes require reconciliation before rebilling.
5. Save wall-clock trial start/end separately from frozen video/context time. Emit per-stage execution, queue, retry and pause time. The present harness overwrites source run creation time with the frozen historical date, so creation-to-update duration is not live benchmark elapsed time.
6. Report settled **ledger** cost, separating model calls and `external-search-*` calls; show unknown holds, unpriced transcript credits and recovery costs separately. Do not add cumulative snapshots or charge a cache consumer for its donor's paid request again.
7. Add failure injection tests for stop during a call, stop between response and checkpoint, restart after checkpoint, and mismatched resume settings. Verify no repeated charge and no forgotten failed case before using the controller for live spend.

No backend or running-data changes were made for this review.

## Third case: Chinese market/portfolio video

Video `9nb3fp76Rz0`, final research run `8cb67f37-bff2-4b7a-92e8-93e3c1e6a65c`: ten published sentences, no rejected sentences, all externally unverified. No exact duplicate publication was found in this brief.

Selected source checks:

- `s7–s8` retain both the Dell bullish momentum context and the creator's decision not to buy. Evidence `c1`, `asr-2-8–asr-2-26`, explicitly says target 640, backlog 950亿 (95 billion), S&P 100 inclusion replacing Nike, then “但是我既没钱买也不敢买呀” (no money to buy and unwilling/afraid to buy). It is not turned into a new purchase recommendation.
- `s5` attributes the Microsoft 12-to-38 GW/2032 projection to Bloomberg external analysis. Evidence `k6`, `asr-1-93–asr-1-112`, explicitly says Microsoft's official response has not endorsed the projection and it is external analysis. The candidate's attribution is appropriately qualified, though explicitly repeating “not company guidance” would improve clarity.
- `s9–s10` preserve disclosed existing holdings and floating losses; `k7`, `asr-2-27–asr-2-48`, supports IBM -509, Micron -436, CRCL more than -100, 1,830 day gain, 197,000 equity, and combined Tesla/Google 120,000. Currency remains unstated and is flagged as an ambiguity rather than invented as USD.

These selected fidelity checks are satisfactory. They do not validate the external financial facts, which remain unverified. The report's gaps disclose missing independent RBC/Bloomberg confirmation and unknown currency. Cumulative settled ledger cost at this inspection was US$1.3162385 across the running cohort, not this video's isolated cost.

## Additional completed source checks: cases 4–6

The companion `readiness-live-quality-20260927.json` now retains all **20 cases** and seven criteria per case, including unassessed entries. “Pass” applies only to its stated selected check; no case is certified. At this snapshot five final briefs exist, six cases have selected findings (including the failed Nscale case), and cumulative settled ledger cost is US$2.49395675.

### NaNa July market video — `3u24qyWjSVM`

Research run `41f41a4c-104f-4015-b833-ce02a7aa0191` publishes 18 sentences. **Material financial translation error:** `s-6` says Kioxia announced a “1-for-3 stock split.” Evidence `m1`, source `s00006–s00010`, explicitly says “1股拆3股”: one old share becomes three new shares, conventionally **3-for-1**. The final phrase reverses a forward split into reverse-split notation. Both extraction fidelity and independent audit allowed it. This must be corrected before promotion; use explicit old-share/new-share counts when ratio conventions are ambiguous.

Selected positive checks: the VOO-first/QQQ-secondary instruction in `s-11` matches `c2/s00119`; risk diversification away from concentrated memory positions in `s-10` matches `c4/s00163–s00171`; Coinbase's conditional entry/support 141 and stop 140 in `s-17` matches `c5/s00254–s00261`. No exact duplicate sentences occur. All claims stay externally unverified. These observations do not resolve the stock-split failure or certify the remaining facts.

### AI infrastructure — `M1FJ5dNiBEs`

Research run `240da5cd-72df-4c78-862e-c838370905d2` publishes 14 sentences. **Known coverage regression improved:** `s-8` explicitly says Credo under 170 is a favorite valuation opportunity, matching `m3/s00209–s00215`. The valuation condition no longer disappears into a holdings-only summary. All sentences remain unverified; no false corroboration or exact duplicate publication was found in this limited check. Full external numerical verification remains unassessed.

### CoreWeave/Nebius pricing — `LF7fgz1HAFs`

Research run `94e5391e-293b-407e-9e41-0bee720e538f` publishes nine sentences. Selected contract-economics checks retain company attribution, contract duration and payback distinctions: `s-2` matches `k2/s00065–s00078` (Nebius typical 20 million per MW, sub-two-year payback; short-term above 40 million per MW, approximately one year); `s-4` matches `k3/s00184–s00189` (CoreWeave three-to-six-month contracts around 40 million per MW). `s-5` preserves the creator's bullish CoreWeave rationale from `k9/s00151–s00178`, including 43 billion market cap and more than one GW active power. All remain unverified and no exact duplicate publication was found. This is source fidelity, not independent confirmation of the economics.

## Remaining cohort acceptance

Dutch Bros moat/entry and Opendoor hypothetical-position checks, Palantir options expiry/strike/attribution, and all not-yet-published cases remain unassessed in the denominator. A corrected treatment must be identified separately from this failed candidate; existing paid outcomes and failures cannot be replaced or silently dropped from the comparison.
