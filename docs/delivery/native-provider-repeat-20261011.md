# Original provider repeat and next implementation checklist

11 October 2026. The user requested restoring the original providers, repeating
the same videos, separating comparable processing from additional audits, and
planning token and quality improvements for a time-poor investment analyst.

## Delivered configuration and bounded repeat

The live workspace now uses Google native for Gemini 3.8 Flash extraction and
synthesis, Google native for Gemini 3.1 Flash Lite translation, and OpenRouter
for Claude Sonnet 5 independent critique and context. Audio remains native
Google; Jev remains enabled as previously saved. Seven saved fields changed:
the default transport, four text-stage transports and two Claude model aliases.
Prompts, models, audit controls, source policy, pipeline, profiles and budget
were preserved. Product defaults restore this same mix; Cheaper Inference
remains selectable. No schema migration or Supabase login was needed.

Three new paid app reruns completed, with all audits enabled: 49 settled calls,
US$0.951700502 combined, zero unknown outcomes or new open holds. No extra
LeapEdge credits were consumed; its prior fresh first-submission captures were
reused. Replaying its already analyzed videos would introduce a cached control.

| Video | First extracted data before critique | Checked root, original providers | Checked root, prior CI | Full brief, original providers | Full brief, prior CI | LeapEdge observed ready interval |
|---|---:|---:|---:|---:|---:|---|
| T-Mobile | 27.200s | 76.118s | 174.110s | 140.848s | 281.410s | >35.049 to ≤50.327s |
| Planet Labs | 12.453s | 37.809s | 99.298s | 85.015s | 228.445s | >37.890 to ≤61.232s |
| Palantir | 15.095s | 77.468s | 219.001s | 181.026s | Partial, needs review at532.303s | >10.262 to ≤48.250s |

The first-extraction times are actual completed checkpoints, including source
acquisition, before critique, recall and child brief generation. They measure
structured extracted data, not a polished analyst page. The child drafts were
ready at100.405/67.352/132.233s from root creation, before their final audits,
but after earlier root audits and recall. These are distinct boundaries.
There was no live all-audits-off pipeline run; subtracting audits from a full
workflow would not prove that counterfactual's timing or output quality.

Planet Labs and Palantir have identical retained source hashes between provider
runs. T-Mobile changed from Google windowed ASR to newly available captions:
source/ASR fell from54.062 to9.583s, so its change is confounded. Caption source
retrieval also benefited from repeated-source conditions for Planet Labs.
Every repeat's model stages made new settled calls; application retained-response
replay is not the explanation. Upstream caches and provider queue conditions
are not controlled. Three stochastic samples do not establish causal provider
performance, population accuracy or p95 latency.

Original-provider checked roots were56.3%,61.9%,64.6% faster in these observations.
Claude root critique worker time fell78.818→20.556s,42.711→9.000s and
112.581→21.557s. Initial extraction also shortened, but child synthesis,
recall and final audit still add material work. Native child synthesis took
23.919/29.277/54.445s; audit/publication took40.384/17.583/48.750s.
Worker queue waits were median67ms, max214ms, and do not explain minutes.
Parallel request durations are never summed as user latency.

App-recorded model-call costs were$0.301590/$0.177139/$0.472972. Prior CI settled
costs were$0.284989/$0.197732/$0.311792, with an additional unresolved$0.193272
Palantir hold. The recorded model cost is lower for the completed Planet Labs workflow despite
higher first-extraction cost. T-Mobile source work changed, and Palantir CI
was incomplete: neither supports a general same-model cost-saving claim.
Native first extraction alone totaled$0.069469 versus CI$0.046122; actual
token counts and generated outputs differ. Leap's displayed$0.03/$0.03/$0.04
cannot be equated with a verified invoice or this app's recorded model-call ledger. Google charges are calculated from returned token
usage and the versioned rate table; they are not verified invoices. Transcript
subscription credits, hosting/database overhead and external invoices are not
converted into this total, so true all-in cost is not established.

## Fair LeapEdge interpretation and no-audit quality

REA recovered an observable frontend path: submit analysis, subscribe to stored
progress, render a short summary/keypoints/call, with a separate cached branch.
Leap's displayed prompt includes`critique.v1`, and its client has checking
states. Its backend architecture, actual audit scope, global cache state,
provider calls and model-stage mapping remain unobserved. It is reasonable to
compare first synthesis and readable draft separately, but not to assert that
Leap performs no audit. Its rapid result also serves a smaller visible product
than our separately generated root and research brief.

Without audits, our first extraction has useful economic substance and source
pointers. Planet Labs preserves the distinction between continuing net losses
and positive adjusted EBITDA, a conditional watch stance, backlog realization
and dilution risks. Leap is shorter and easier to scan, but turns that watch
stance into an avoid/wait-before-entry recommendation and omits net loss.
Our first Palantir extraction retains more explicit future checks in some
outputs; Leap offers broader short coverage but drops normalization and
position-sizing qualifications. Neither provides verified investment truth.

Unaudited output also exposes serious defects. Native Planet Labs proposes
101–105 guidance from ambiguous caption text. Native Palantir inserts1,049
customers and future EPS decimal points, and contains conflicting price forms.
T-Mobile mixes personal preference with advice and can omit the EPS condition
on a hypothetical$280 rerating. These need literal, condition and attribution
checks before reviewed publication.

The final child audits caught Planet's101 guidance, Palantir price and quote
errors, and T-Mobile's incorrectly sourced$280 sentence. They also withheld
valid nearby clauses and some explicitly convertible quantities. Conversely,
the published Planet Labs brief still adds“before committing capital,” and
T-Mobile still promotes the creator's personal preference into advice.
More auditing is insufficient when evidence is lost or the critique contract
does not test actor/action strength. The native literal gate catches Palantir's
unsupported1,049 even when Claude accepts it using an invalid implied calculation.

The final gate also loses valid EPS expressed in cents and lower bounds with
shared billion-unit range suffixes. Three parser cases erase supported margin,
FCF, cash and guidance clauses along with the disputed field; two other numeric
rejections correctly block unestablished digits/decimals. Preserve the correct
rejections and repair the supported clauses.

Native first-root coverage on the fixed25 composite material units is8complete,
15partial,2absent, versus CI10/13/2 and Leap5/20/0. This is coverage only,
not an accuracy score; a covered unit can contain a serious source-fidelity
error. Final native publication kept7/9,10/11 and11/18 draft sentences. Those
counts also do not establish material completeness or correctness.

## Ordered next-work checklist

- [x] Restore live Google/OpenRouter provider mix and product defaults; preserve CI selection.
- [x] Repeat the three videos with audits enabled; retain outputs, costs, stage times and source hashes.
- [x] Review first extraction and child pre-final-audit drafts separately against Leap and source wording.
- [ ] **1. Fix evidence loss and attribution.** Preserve every source range in`pipeline.ts` materializeMentions, introduce stable proposition IDs and clause-to-range dependencies, and test personal“for me”versus viewer advice, watch versus before-entry, and conditional scenarios. Exact source bytes and sentiment counts must survive. This is prerequisite to shorter audits.
- [ ] **2. Repair numeric representation narrowly.** In`research-numeric-check.ts` and the numeric validators, normalize unambiguous percent/currency metadata and explicit cents/fraction conversions; retain ambiguous digits, dates, currency, count/threshold and GAAP basis as unresolved. Never insert plausible decimal points or infer counts from rounded growth.
- [ ] **3. Publish supported atoms and repair once.** In`research-pipeline.ts` and`faithful-audit.ts`, version a source-only, budget-bounded repair path. Preserve accepted originals, audit every changed atom, pass accepted sentences as coverage context, and expose unresolved material gaps. Simply removing the`!faithful` guard is insufficient.
- [ ] **4. Make coverage reflect published content.** Carry proposition IDs into`research.ts`/`research-readiness.ts`; recompute after rejection and display selection. Preserve business driver, valuation assumptions, countercase, creator ownership and next test. A sentence count or cited evidence count cannot stand in for material coverage.
- [ ] **5. Redesign the first screen.** In`analyst-view.ts`,`AnalystView.tsx` and`Analysis.tsx`, show the main company first; use short headings, balanced summary slots and exact timestamps. Replace whole-company deduplication with proposition deduplication. Move follow/budget controls beneath the assessment and remove the empty tactical column. Preserve all material conditions and publication points.
- [ ] **6. Reduce repeated tokens.** Introduce one canonical quote dictionary and ID references, schema-limited numeric/condition objects and compact critic verdicts. Recall should receive locally relevant inventory plus a compact global proposition index, not the full frozen inventory in every window. Losslessly evaluate60/80-cue packing; prior offline comparison reduces repeated inventory bytes37.5%/50%, not proven total token/time savings. Preserve all source cues and correct cross-window deduplication.
- [ ] **7. Remove duplicate generation only after coverage proof.** Reuse the accepted material graph for the brief and bottom line; avoid a second independent retelling that upgrades stance or invents rationale. Use bounded batches, independent-family fidelity/coverage checks and selective recovery. Keep Jev as triage with unresolved material items escalated; do not infer accuracy from agreement with Claude.
- [ ] **8. Verify and roll out incrementally.** First add regressions for these exact source errors and clause-loss cases. Then freeze matched-source/config experiments; compare actual delivered coverage, unsupported assertions, cost, first usable output and full reviewed latency. Preserve old runs and rollback flags. Start with the three-video cases, then a bounded diverse set; claim measured medians/tails only when sample size supports them.

Highest-likelihood sequence: source contracts and deterministic rendering first,
bounded atomic repair second, redundant token removal third, generation/model
experiments last. Proposed goals are reviewed caption briefs within60–90s and
typical all-in cost≤$0.15, with no source-fidelity regression; these are goals,
not results demonstrated by this repeat. All three native samples recorded model costs below$0.50; full all-in cost
is not established. An analyst should identify the creator's
stance, economic reason, key assumption, countercase and next check within
30seconds, with a clear distinction between source fidelity and independent
financial verification.

## Private reproducible evidence

Full local artifacts reside at
`audits/leapedge-20261011/native-repeat-20261011` in the shared workspace:
`comparison-stats.json`/`.csv`,`summarize-repeat.py`, before/after settings and
diff, six run exports,49 call records,31 stage timings,92 retained provider
responses, six publication documents, browser captures,
`PRE-AUDIT-QUALITY.md`, structured source-unit judgments and
`IMPLEMENTATION-PLAN.md` with source anchors and fixture acceptance criteria.
The calculation records SHA-256 digests and can run offline. Earlier Leap
outputs and REA evidence remain in the neighboring fresh/paired directories.
Credentials are excluded from reports and commits.
