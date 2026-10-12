# Source atom rollback and performance direction

The user requested reverting the source atomisation, exact dictionary
deduplication and compact audit-context experiment on 12 October 2026. Runtime
source, benchmark scripts and tests are restored exactly to `89ad484`, before
PR43/44. Original Google/OpenRouter defaults, independent audits and earlier
PR41/42 publication fixes remain. The experimental setting is removed.

Prior results and raw responses remain as historical evidence. Stored completed
runs are retained. No database migration, destructive data reset or paid rerun is
part of this rollback. Runtime restoration passed local verification; release
state is recorded in the delivery ledger.

## Learning

The same-source campaign increased mean processing from 108.031 to 165.521
seconds and recorded model cost from $0.863104665 to $1.348871826. Input tokens
rose 36%, output tokens 66%, and paid calls rose from 49 to 59. Newly triggered
coverage repairs and their independent checks cost $0.19133801, accounting for
39% of the cost increase. Context encoding saved little: 827 synthesis bytes
for T-Mobile, with raw evidence retained for the other two videos.

The extra structured generation did not pay for itself. Shorter prompts are not
an adequate success metric; total generated tokens, sequential dependencies,
repair frequency and published material coverage must all be measured. These
single observations also include earlier publication changes, so they do not
isolate each optimisation's causal effect.

The previous work already provides bounded parallel extraction/recall and
audits, weighted audit planning, transport metadata caching, safe reuse of
unchanged paid results, optional provider routing and an incremental checked
findings view. These remain. They are not new recommendations. Queue waits in
the measured cohorts were usually tens of milliseconds, making a database or
queue rewrite a weak explanation for minute-long processing.

## What LeapEdge teaches us

The previously authenticated fresh-video comparison observed readiness within
roughly 35–50 seconds for T-Mobile, 38–61 for Planet and 10–48 for Palantir.
These are browser polling intervals on previously absent account results, not
proof of a globally cold backend. REA exposed the shipped client's processing,
cache/progress and presentation surfaces, including a `critique.v1` marker. It
did not reveal model calls, independent audit depth or inference timing. We
cannot claim that removing a specific audit would reproduce LeapEdge speed.

Its compact, early orientation is useful inspiration. Our target should be time
to a useful, source-checkable assessment and time to the completed assessed
coverage, with both scopes labelled. Showing provisional generated claims as
accepted analysis would trade trust for an attractive stopwatch.

## Recommended experiments, in priority order

| Priority | Change | Why it could help | Quality and trust condition |
|---|---|---|---|
| 1 | Shorten audit responses, retaining full audit inputs | Produce a concise reason code for accepted matches; detailed reasons and exact missing source quotes only where needed. Less returned prose can shorten the expensive critic stages without reducing targets. | Independent cross-family checks, every verdict/coverage ID, rejection explanations and all missing material qualifiers remain mandatory. Truncated or malformed output cannot count as acceptance. |
| 2 | Reuse accepted wording instead of regenerating a whole brief | Build a useful initial reading view from independently accepted clauses and existing fields. Ask a model only for material analysis genuinely absent from that inventory. This attacks the serial child synthesis stage. | Deterministic formatting must not change meaning or invent a recommendation. Every new or rewritten assertion gets its own independent check. Retain complete inventory, provenance, opposing clauses and coverage diagnostics. |
| 3 | Improve the first checked reading surface | Extend the existing checked-findings view into a compact thesis, key drivers, valuation conditions, countercase and next-check view; expose it as soon as its own checks finish. Group repeated timestamp controls and place the concise view earlier on phones. | Label partial scope and ongoing source/coverage review visibly. Do not hide omissions or treat excerpt fidelity as financial truth. This improves time to useful reading; it does not by itself reduce final processing duration or model cost. |
| 4 | Arrange shared prompt prefixes to benefit from provider caching | Repeated original source and fixed instructions can be reused by the same model across recall/audit requests, without generating another representation. Measure cached tokens and total cost rather than assuming a cache hit. | Preserve all original source text, tenant isolation, model identity, budgets and request fingerprints. Run a separate warm-prefix arm and cold/new-video control; do not call reuse a cold-video processing win. Storage/create costs and provider support need verification before explicit cache use. |
| 5 | Test existing same-model routing options against tail latency | Compare default, latency and throughput routes on identical request/model families and realistic output lengths. Existing settings already support these choices; this is an evaluation before changing defaults. | Preserve required structured-output parameters, privacy/data-handling restrictions, family independence and price ceilings. Record actual serving provider and unknown outcomes. Routing is a preference, not a latency guarantee. |

For priority 1, the schema already bounds reasons but currently permits up to
1,000 characters for each faithful verdict. Change output discipline first,
without shortening the source context or changing acceptance criteria. Use
fixture tests to prove complete IDs, exact missing-point anchors and reliable
rejection before a paid test. Do not apply hard output caps that cut off required
coverage. [Anthropic's latency guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)
supports reducing unnecessary generated tokens while preserving performance;
the actual gain here remains unmeasured.

For priority 2, start with verbatim accepted clauses and deterministic layout;
do not assume the root has perfect completeness or the same verification scope
as a final research brief. Keep the existing full workflow available during a
shadow comparison. Readiness and unresolved gaps must remain honest. This is a
proposed design experiment, not an implemented second rollback feature.

For priority 4, [Google's current caching guide](https://ai.google.dev/gemini-api/docs/caching)
documents implicit caching and stable common-prefix placement, including a
4,096-token minimum for Gemini 3.8 Flash. It does not guarantee that these
requests will hit. [OpenRouter's routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection)
supports latency/throughput preferences for priority 5. Our previous observed
Sonnet calls all used Claude Platform on AWS; no successful route comparison
has yet justified switching the default.

## Investment-team acceptance and measurement

An independent fidelity audit establishes what the video said; it does not
verify the investment claim against filings, earnings releases or current
prices. The reading surface must distinguish source assertions, interpretations,
independent financial corroboration and unresolved ambiguity. Preserve cents
versus dollars, reporting periods, EBITDA versus net income, actor attribution,
valuation scenarios, retention persistence, cancellation risk, personal holdings
and uncertainty. In particular, source-caption contradictions must stay visible
instead of being silently reconstructed into plausible financial numbers.

Use the existing fixed 25-composite material inventory to diagnose regressions,
plus narrow adversarial cases for numbers, actors, conditions and omission
handling. This does not create a new fifty-case prerequisite or an accuracy
badge. A small analyst review of ambiguous source passages would improve the
evidence for professional usefulness, but is a distinct future evaluation.

Before each proposed optimisation: freeze sources, prompt versions, models,
routes and scope; change one factor; verify offline contracts; then measure a
bounded matched cohort. Report source acquisition, queue time, first checked
render, final coverage completion, retries, all settled/reserved costs, input,
output and cached tokens separately. Use identical-video comparisons and new
video controls, randomise treatment order and obtain repeated observations
before claiming typical or p95 latency. Do not substitute an approximate root
checkpoint for an exact browser-render timing.

Do not promote a speed change with a material numeric, attribution, qualifier,
coverage, unknown-outcome or first-screen ambiguity regression. Preserve raw
requests/responses, provenance, original verdicts and immutable changed repairs.
No proposed change removes an independent audit or puts an unchecked
recommendation in the investment team's primary reading view.

## Rollback verification

PR45 restores `src/`, `scripts/` and `tests/` byte-for-byte to `89ad484`.
No dependency, migration, queue/lease/concurrency or model-default changes.
Both full local suites passed (1,210 tests; 1,209 passed, zero failed, one
existing skip). Typecheck/build and the offline advisory diagnostic passed;
the latter measures no binding accuracy metrics. Desktop and 390px mobile
settings/result acceptance passed against an isolated, queue-paused Postgres
database holding retained paid outputs. The setting was absent and the mobile
document width was 390px with no horizontal overflow. No new
paid provider calls or LeapEdge credits are required for this rollback. The
retained 108-second historical baseline is not a measured post-rollback result:
it predates some retained publication fixes, so no exact restored latency is
promised.
