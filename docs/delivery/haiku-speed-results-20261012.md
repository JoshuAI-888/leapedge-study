# Matched research speed and Haiku 5.5 pilot

12 October 2026, Pacific/Auckland. **Keep Google native extraction/synthesis and Sonnet 5 critique as the default.** The five approved speed features are implemented, independently audited, and available behind a frozen opt-in plan. The pilot supports earlier checked findings and cheaper Haiku audit work; it does not support a default switch or claim that complete briefs now beat LeapEdge.

## Recorded results

Nine hosted arms ran on production commit `715748e8b2fda8213f6ea9faaa0287f1ef965b02`, merged in [PR41](https://github.com/JoshuAI-888/leapedge-study/pull/41). Each video used identical retained captions, source hash, as-of date, original title, prompt, Jev settings and source pipeline. All responses were fresh paid requests, with zero automatic retries. Latin order reduces ordering bias; one run per arm remains a small stochastic pilot.

Times below begin at the worker's first claimed processing stage and exclude initial manual queue wake and source acquisition. The baseline first-checked value is its root completion approximation; candidates use the recorded incremental publication checkpoint. Neither is an exact browser-render stopwatch. The five-hour idle browser interruption occurred with no active paid work and is excluded from processing time.

| Video | Variant | First checked, s | Full audited brief, s | Recorded model USD |
|---|---|---:|---:|---:|
| T-Mobile | Baseline, Sonnet 5 | 59.2 | 113.2 | $0.2892 |
| T-Mobile | Optimised, Sonnet 5 | 26.7 | 186.3 | $0.6103 |
| T-Mobile | Optimised, Haiku 5.5 | 27.6 | 153.5 | $0.1989 |
| Planet Labs | Baseline, Sonnet 5 | 36.6 | 78.4 | $0.1786 |
| Planet Labs | Optimised, Sonnet 5 | 19.2 | 106.9 | $0.2608 |
| Planet Labs | Optimised, Haiku 5.5 | 21.9 | 120.8 | $0.1043 |
| Palantir | Baseline, Sonnet 5 | 73.8 | 132.5 | $0.3953 |
| Palantir | Optimised, Sonnet 5 | 27.9 | 215.5 | $0.6788 |
| Palantir | Optimised, Haiku 5.5 | 33.3 | 189.6 | $0.2651 |

Across these three samples, the native candidate reduced mean time to checked findings from 56.5 to 24.6 seconds (56.5%), but increased full completion from 108.0 to 169.5 seconds (56.9%) and mean model cost from $0.2877 to $0.5167 (79.6%). Haiku's candidate mean was 154.6 seconds/$0.1894, saving 63.3% relative to the optimised Sonnet workflow, while still completing later than the baseline. Haiku changed only critic/context models; Gemini extraction/synthesis, translation and Jev remained.

All nine arms completed: 18 root/child runs, 172 settled model calls, US$2.981371471, zero unsettled or unknown calls. Official retained-response, source-byte/hash, experiment marker and stage timing checks passed for every arm. Ledger costs exclude source services, hosting, taxes and invoice reconciliation; they are not an all-in per-video price. The baseline is legacy execution under flags in the same release, with shared quality prerequisites, rather than a pure checkout of the earlier commit.

## Identical-input critic comparison

Six additional calls compared one immutable retained faithful-audit request per video, alternating model order. Prompts, exact draft, original quote context, schema, maximum output and low effort were unchanged. These calls cost US$0.150885900, bringing measured task model spend to **US$3.132257371**, below the US$5 cap, with no unsettled charges.

| Exact audit input | Sonnet seconds / USD | Haiku seconds / USD |
|---|---:|---:|
| T-Mobile | 23.6 / $0.04313 | 24.6 / $0.00377 |
| Planet Labs | 8.9 / $0.01799 | 12.1 / $0.00195 |
| Palantir | 45.6 / $0.07823 | 35.6 / $0.00581 |

Haiku reduced summed critic cost by 91.7%. It was slower on the two smaller requests and faster on Palantir; summed response time fell only 7.3%. Sonnet served through Claude Platform on AWS and Haiku through Azure, so model and serving-provider effects are not separately identified. Haiku generated substantially more output tokens. Both models returned invalid coverage details: Sonnet invented/abridged missing-point quotes on two inputs; Haiku referenced Palantir statement IDs outside the supplied citing subset, although those IDs existed elsewhere in the draft; this does not mean they were globally rejected. The comparison's input identity check passed and its structural quality check failed. These errors are a reason to retain exact quote/ID validation, rather than count model agreement as accuracy.

[Anthropic's release documentation](https://www.anthropic.com/claude-haiku-5-5) confirms the 7 October release and pricing: prompts up to 100k tokens cost $0.10 input/$0.50 output per million, rising to $0.50/$2.50 above that threshold. The model supports effort control; its tokenizer and actual output volume affect realised savings. Haiku remains an optional critic/context model, with current rates, conservative reservations and actual returned-cost settlement.

## Why the final pipeline remains slower

Packed full-source recall cuts input tokens roughly 50–56% and retains the identical source cue union, but increases generated output about 18–26% in these samples. It produces more proposals, larger accepted inventories, more audit context and repair work. Token reduction alone is not latency reduction.

Weighted audit scheduling shortens individual jobs but often duplicates quote/citing context across more batches. Full source coverage, independent review, one source-only repair, its new-atom audit and the separate bottom line remain. Gemini brief synthesis alone took 19.9–43.3 seconds. Metadata/counting preflight summed about 1–2 seconds per arm and overlaps other calls; database replacement is not the main opportunity here.

The Planet Labs native candidate returned no new statements in a bounded repair, yet spent another 8.45 seconds in its slowest coverage-only audit and $0.038066 in that wave. PR42 skips that wave when no new/changed auditable statement exists. It still pays for the attempted generation, retains original audits/rejections and unresolved coverage, and independently checks actual changed atoms. This is measured avoidable work from a retained run, **not a measured post-fix end-to-end gain**.

## Quality and analyst experience

Source review used a frozen rubric of 25 composite material units (70 component checks) across the three videos. All nine judgments and all three phases per arm were hash-locked before model/performance reveal. Completeness counts describe included material; they do not measure factual accuracy. Original captions are the reference, not a human audio or company-filing truth review. The first pack exposed audit reasons before the appendix; later packs moved them, and publication omissions can still reveal treatment. This is a limited blinded machine-assisted review, not a double-blind human study.

The important cross-model problem is preserving useful clauses while withholding unsafe ones. T-Mobile loses parts of personal stance, technical caveats and conditional rerating. Planet Labs needs the adjusted-EBITDA/net-profit distinction, backlog cancellation, dilution per share and the watch/entry distinction. Palantir needs retention persistence/sensitivity, explicit ownership, AI mechanism and sufficient upside conditions without turning them into necessary holding/selling rules. A syntactically correct quote pointer does not prove the paraphrase is faithful.

The initial root extraction is a pre-critic draft, whereas the child synthesis has already consumed accepted root evidence. That child draft is not an all-audits-off workflow. Removing audits can expose reconstructed prices, unsupported EPS/counts and strengthened investment instructions. The right target is fewer repeated statements and better clause coverage with independent review retained.

PR42 corrects observed reading issues without generating new prose: a unique accepted company named in the title leads checked findings; ambiguous/unaccepted primaries retain the original title; short ticker T cannot match T-Mobile. Personal preferences cannot become bare Buy/Sell/Avoid commands. Financial performance stays in Thesis rather than being placed in Valuation merely because it contains a number. Existing accepted downside and monitoring language can populate Countercase and Next checks. Copy and evidence retain the same accepted statements and separate source ranges. No missing stance or next check is invented to fill a section. These reading safeguards also apply to copied notes. The historical detailed Research brief tab retains original text and its audit trail; this update does not retrospectively re-audit those stored documents.

## LeapEdge comparison

Prior fresh submissions produced readiness polling bounds of roughly T-Mobile >35–50s, Planet Labs >38–61s and Palantir >10–48s. The REA capture traced the public client submit/progress/cache signals and its compact summary/idea/quote presentation; `critique.v1` is visible. Its backend model calls, audit depth, source and global cache state remain unknown. The submissions were previously absent from the account, which does not prove a globally cold backend.

Our 19–28s native checked checkpoint is encouraging against that public reading boundary. Our processing numbers exclude source acquisition, while LeapEdge's observed submission interval includes it. The comparison therefore does not establish an end-to-end win, and it must not describe LeapEdge as audit-free. Its fast compact page is useful for triage; our advantage must be trustworthy coverage and explicit source limits, not just longer output.

## Delivered checklist and next work

- [x] Original native providers restored; independent Claude/Jev checks retained.
- [x] Validated preflight cache/single-flight and exact request token-count reuse with timing.
- [x] Bounded overlap of initial critique and recall, deterministic reconciliation and paid-call drainage.
- [x] Evidence-weighted audit planning with exact verdict/coverage ownership.
- [x] Incremental checked findings, revision refresh, H1/H2/H3 hierarchy and accepted-child publication boundary.
- [x] Optional same-model latency/throughput routing, with price ceilings and immutable identities; default route retained because no route pilot justifies promotion.
- [x] Nine matched hosted arms and six identical-input audit calls, every output/cost retained.
- [x] Follow-up empty-repair and reading/attribution regressions; verification and release evidence recorded below.
- [ ] Split compound source propositions into typed atoms **before synthesis**: actor, action, literal/unit/basis/period, condition, opposing clause and exact range. Test partial rejection keeps every supported clause; changed wording still receives independent review.
- [ ] Deduplicate accepted atoms by exact proposition/actor/period/condition identity, retaining all distinct source ranges. Give synthesis compact atom IDs rather than repeated prose and overlapping quote blocks. Prove no qualifier or opposing view disappears.
- [ ] Audit only new/changed atoms, and choose the smallest adequate batch plan by total duplicated quote/citing-context weight. Compare two/four-bin plans on the same draft; do not raise global concurrency or delete coverage targets.
- [ ] Make source coverage a component map linked to accepted published atoms, so stale/global coverage explanations cannot claim both missing and present. Surface ownership, countercase and explicit next tests when source-supported; clearly report genuinely absent material.
- [ ] Re-run the fixed cohort plus more unseen captioned videos under identical boundaries after those changes. Promote only if full latency/cost improve without actor, numeric, condition or coverage regressions. The current pilot does not meet the 60–90s full-brief target or establish the typical $0.15 all-in goal.

The highest-likelihood order is atomise → deduplicate → reduce audit/context repetition → reconcile component coverage → validate. Budget estimates should use retained input/output counts and conservative provider rates; actual gain must come from fewer generated and repeatedly audited tokens, with source fidelity as the acceptance condition.

## Verification and release

PR41 passed both full suites (1193 pass, one existing skip), typecheck, production build, the offline advisory diagnostic, isolated real-Postgres locking/budget/lease checks and desktop/mobile acceptance. Gate status remains advisory-only. PR42 passed both full local suites (1208 pass, zero failures, one existing skip each), 38/38 focused reading checks, 23/23 empty-repair/changed-atom/unknown-payment checks, final typecheck, production build and the offline advisory diagnostic. Desktop acceptance verified the accepted creator stance leads the overview, revenue/cash remain in Thesis, backlog cancellation appears in Countercase, and Copy as note uses the same accepted projection. Mobile content and viewport both measured 390px with no horizontal overflow. All browser checks used retained results in an isolated queue-paused database; no further model charges were incurred. Final-head CI and deployment proof will be recorded when complete.
