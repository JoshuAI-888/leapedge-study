# Operational efficiency validation — 20 September 2026

## Release decision

Deploy worker admission, cache identity hardening, fatal-account admission validation and the profile selector. **Keep speculative overlap disabled by default.** The live comparison did not establish quality parity. Settings offers Deployment default, Standard, Efficient (recommended), and Research overlap (experimental); the linked information page explains behavior and tradeoffs. Profile changes affect new admissions only; frozen flags and paid request identities remain unchanged for queued work.

Features 3, 4, 6 and 7 are implemented. This pass fixed a real worker refill bottleneck, hardened cache donors, and removed duplicate speculative planning only when the final accepted evidence (including quotations, apart from trust advancement), model/settings, dates, baseline and instructions match exactly. Changed/rejected evidence falls back to final planning. Provisional research cannot publish or change source acceptance.

## Measurements

| Test | Before | After | Interpretation |
|---|---:|---:|---|
| 100 four-stage fixture jobs, real PostgreSQL, capacity 3 in both arms | 124.11s | 36.46s | 70.6% shorter worker batch; all 100 results and four checkpoints preserved |
| Manual-priority job in that fixture | 1.92s | 0.45s | 76.5% shorter; not a live-provider latency claim |
| 20 identical eligible research requests | 20 provider calls / $0.140 simulated charge | 1 call / $0.007 simulated charge | 95% fewer requests; source text/hash/date/trust identical; real fleet hit rate unmeasured |
| 100 candidate chunks after typed fatal account error | 100 attempted | 3 started, 97 untouched | Both started successful siblings retained; actual pipeline replay never repurchased the settled sibling |

### Live frozen-source comparison

Same four retained transcripts, model settings and original analysis cutoff; no captions or LeapEdge calls. Begins at extraction, includes independent critique, recall, research and final audit. Excludes ingestion, worker queue and browser paint. One trial each; live model/search variation and concurrent local checks limit causal attribution. Baseline worktree was 9b6a85e plus candidate uncommitted code with overlap off; overlap ran f5060f3 with explicit overlap on. The subsequently added profile selector does not change those explicit flags. Empty frozen brief history in both arms.

| Video | Sequential seconds | Overlap seconds | Sequential US$ | Overlap US$ | Result |
|---|---:|---:|---:|---:|---|
| `1WNowIoNgtg` | 106.31 | 93.99 | 0.47391 | 0.36787 | Both completed |
| `ZfOQoh82JTo` | 125.81 | 122.70 | 0.57240 | 0.58658 | Both completed |
| `M1FJ5dNiBEs` | 79.15 | 55.01 | 0.21443 | 0.19661 | Baseline audit failed; overlap completed (not a completed-time comparison) |
| `SPIRV9UjNYU` | 70.84 | 89.62 | 0.20629 | 0.25798 | Both completed |

Options and AI reused one provisional plan and four exact searches each, without a consumer charge. Podcast and Mandarin replanned because final accepted context changed; speculative work added cost there. The long podcast was only slightly faster, while Mandarin was slower and more expensive. No aggregate all-success speedup or quality-parity claim is justified.

Confirmed model/search experiment spend: **US$2.87606825** including the failed baseline audit. No unsettled ledger rows remained. All four original transcripts are byte-equivalent under canonical comparison in both arms.

Full stage breakdowns are in [the metrics](operational-metrics-20260920.json). Raw runs, requests, ledger rows and timings remain in ignored `data/operational-efficiency-20260920/` (`live-sequential.json`, `live-sequential-mandarin.json`, `live-overlap.json`). No experimental output was imported into production or used to rewrite historical results.

## Quality constraints and findings

See [source-backed quality review](operational-quality-20260920.md). Baseline produced three briefs and withheld the AI brief because its final audit was incomplete. Overlap produced four. Completion is not proof of improved reliability or quality from one trial.

The options validator withheld the inconsistent breakeven, but an accepted invalidation sentence overstates the creator's source and broad downside coverage weakened. The podcast falsely labelled an LVMH sentence partially corroborated despite its audit explanation saying the cited document did not substantiate the multiples. Dutch Bros coverage weakened; Opendoor and Credo valuation qualifications remained omitted. Mandarin preserved the checked numbers and improved the September 17/18 chronology. These are reasons to hold overlap off, not to weaken critique or silently certify summaries. Existing baseline limitations are explicitly separated from observed differences; model variation prevents blaming scheduling alone.

## Verification and deployment

495 tests passed and one skipped in **each** database mode; typecheck, production build and real PostgreSQL integrity checks passed. Offline diagnostic remains advisory. HTTP checks against an isolated database verified all four profile values save/reload, invalid values reject without changing the setting, and the Settings/information-page routes return 200. Actual extraction/worker integration proves fatal-account drain, no publication and no duplicate settled sibling payment after explicit recovery.

Desktop/mobile visual and browser interaction checks are **deferred at the user's request** while away from the Mac. Automatic review rejected inspection after Chrome navigation appeared stuck on an unrelated search page. HTTP/API checks are not substituted for visual inspection. Resume this acceptance step when the user is home.

Deployment follows [the release checklist](../delivery/release-checklist.md). User explicitly approved Vercel Production `YTI_EFFICIENCY_PROFILE=conservative`; it was added without downloading secrets. Mac preflight confirms 14 retained runs, no unfinished runs or active leases, and a paused queue. Final merge, Mac installation and Vercel production revision/health are recorded below when verified. The Mac uses local PostgreSQL; Vercel uses a different Neon database. Web READY does not certify a worker for Vercel jobs. No Finradar integration or 1,000-video/day certification.
