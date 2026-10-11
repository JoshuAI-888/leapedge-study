# Inference providers

Approved 11 October 2026; implementation merged in PR 38 and transport-schema
compatibility repair merged in PR 39.
Production release: `9f218fcd87c0bc86dbd5c85cc9bee4e60d3d3122`,
Vercel `dpl_JD6JTyGYamgYFdYvyWwh7LTkFo4E`, ready 11 October 2026. The subsequent schema repair release is
`7252d96c4948ae0c4d9dea9abe6345592ec51c3f`, Vercel
`dpl_zmUTdWDmGLBG6SyAe4MjjLXu9tJn`, READY with the production alias.
The live workspace was switched and persisted with balanced routing.
A database comparison confirmed only provider choices, exact model aliases and
the new routing preference changed; audio, prompts, budgets and other settings
were preserved. Both final feature-head GitHub verification runs passed
(38121401282 and 38121398472).

11 October rollback: the user restored the original provider mix. Product
defaults use Google native for Gemini 3.8 Flash extraction/synthesis and Gemini
3.1 Flash Lite translation, and OpenRouter for Claude Sonnet 5 critique/context.
Cheaper Inference remains selectable with its catalog, pricing and routing controls.
Audio transcription and audio review stay on Google native. Jev remains separate. A saved workspace keeps
its existing explicit providers until an administrator saves a new configuration.
Queued analyses and historical results keep their original configuration snapshots.

## Configuration

Store `CHEAPER_INFERENCE_API_KEY` in the server environment. Vercel Production
needs this secret before activating Cheaper Inference in the live workspace.
Never put it in Supabase preferences, browser fields or public environment variables.
Google audio still requires `GEMINI_API_KEY`; selected OpenRouter stages or an
enabled Google fallback require `OPENROUTER_API_KEY`. No schema migration is needed.

Settings → Providers and models offers per-stage providers, model search and a
bulk provider change that preserves models. Save team configuration applies the
change to newly queued analyses. Critique must use a different model family from
extraction. The routing preference defaults to balance; discount and speed are
explicit alternatives. A routing preference does not change the chosen model.

The server reads the authenticated model catalog with a bounded 60-second cache.
Settings shows input, output, cached input, cache write, long-context rates,
context/output limits, the price-check timestamp and a 10,000-input/1,000-output
example. Only the three verified pre-switch models have a comparison with the
dated Google/OpenRouter reference rates. Missing prices are unknown, not free.
Models without verified output limits cannot execute. Endpoint compatibility
does not establish a model's suitability for a research stage.

## Billing and source fidelity

The transport uses `/v1/chat/completions`, forwards JSON schemas and reasoning
controls, rejects media and foreign cached-content handles, and verifies the
served model. `X-CI-Techniques: off` and `X-CI-Prompt-Cache: passthrough` prevent
optional prompt transformations or added cache markers. There is no silent
model substitution or automatic fallback from Cheaper Inference to another API.

Reservations use conservative direct/list and maker-tier rates, including cache
writes and long-context tiers, rather than only the cheapest advertised route.
The call ledger records the pricing version/check time, requested/served model,
provider, usage and actual settled charge. Pending bills retain their budget hold
and retained response; a timeout with uncertain billing is not retried automatically.
The display estimate is not the final bill. Prompt, quote-copying, schema and
evidence checks continue to apply above the transport.

## Validation evidence

On 11 October, both repository suites passed 1,108 tests, with zero failures and
one existing skip each. Typecheck and production build passed. The offline
promotion diagnostic remains advisory-only and makes no accuracy claim.
Focused checks cover catalog validation/cache isolation, model identity, exact
and pending billing, output limits, preserved provider choices and critic independence.
Regression checks also cover legacy paid-response replay without the new routing
preference, metadata-free pending bills and retained exact charges when a model
response is rejected. These failures cannot fabricate a charge or repeat paid work.

An isolated local fixture workspace loaded 90 text models from the live catalog.
Browser acceptance verified provider switching without model substitution,
save/reload persistence, model price updates and prevention of correlated critique.
The 375-pixel viewport had no document overflow. Screenshots are retained in the
task's `audits/leapedge-20261011/provider-review/screenshots` directory.

Two small synthetic structured-text checks confirmed actual served model IDs and
settled Cheaper Inference bills. Gemini 3.8 Flash took 128–153 seconds through
Cheaper Inference versus 6–8 seconds directly; Claude Sonnet 5 took about 10 seconds
versus 2.5–3.4 seconds through OpenRouter. A literal stance assertion failed for
both native Gemini and CI Flash Lite; this fixture is not an accuracy benchmark
or a translation-stage test. It cannot establish research-quality or speed parity.

Four further calls used the actual translation contract and the production
v10-pm1 critique prompt on identical bounded inputs. Both translation routes passed
ID coverage and immutable-original hash checks and preserved the IDIQ/revenue
negation, ONDS, $1 billion ceiling, below-$15 condition, incomplete merger and
2026-10-11 date. Both critics accepted the same supported conditional claim.
CI translation took 18.715 seconds/$0.000207 versus Google 1.722 seconds/$0.0002855;
CI critique took 10.343 seconds/$0.005838 versus OpenRouter 9.128 seconds/$0.009184.
The CI pair cost $0.006045 versus $0.0094695 (36.2% lower); translation alone
was 27.5% lower because billed token counts differed. The same model and input
do not guarantee identical token accounting. This proves bounded prompt/schema
compatibility, not a full workflow fidelity or completion-time benchmark.

A further small Gemini pair used the app’s explicit low reasoning setting:
CI took 24.610 seconds/$0.000135 versus Google 2.516 seconds/$0.00022275.
Both preserved the source meaning and negations; Google used a different stance
wording from the literal fixture. The CI request also carried a 35% minimum
discount constraint, so it is not a latency measurement of the unconstrained
production balance route. No speed-equivalence claim is supported.

The initial catalog's three configured models advertised 35% lower token rates. Repricing
two completed workflows at identical usage gave $0.62924 versus $0.96740,
including unchanged Jev fees (34.96% lower). This is a counterfactual, excludes
other platform costs and Google audio, and does not guarantee realised savings.

A fresh catalog check at 08:12:23 UTC (pricing checked 08:10:40 UTC) changed
Gemini 3.8 Flash to $0.5175 input/$2.5875 output per million, 31% below the dated
$0.75/$3.75 Google reference. Claude Sonnet 5 remained $1.3/$6.5 and Flash Lite
$0.1625/$0.975 (35% below their dated references). The live Settings view
correctly refreshed its prices and savings estimate. Initial quotes and probes
above are historical snapshots; 35% is not a fixed discount promise.

## Hosted workflow compatibility follow-up

The first hosted same-video check completed extraction: run
`0b294502-7de6-48da-b513-adbb44583af7`, 13 settled calls, $0.182394, 200.745s,
versus the previous native/Router run, $0.22687, 57.13s. The source hash matched
and both retained two accepted ideas, though stance/conviction wording differed.
The automatic brief `638652cc-762e-4fa0-8ce3-8bdf7a0072d8` failed validation:
Gemini returned materiality scores above the allowed 0–3 range. Its $0.01496
charge and failed response remain retained; no blind retry was made.
The extraction output also used empty option metadata where the native run
returned null. Legacy Google-style nullable schemas need standard JSON Schema
translation at the new transport boundary. PR 39 converts those schema positions
to explicit null alternatives and lists the equivalent choices for small bounded
integers. This happens only during CI request serialization: original schemas,
validation domains, prompts and paid-response fingerprints remain unchanged.
Invalid returned scores are still rejected, never clamped. The first hosted
check does not establish whole-workflow quality parity.

A bounded recheck of the exact retained research prompt/payload through the
corrected serialization passed: 11 sentences, every materiality score in 0–3,
settled $0.015456, 54.390 seconds. No retry or database write was used in this
probe. The serving model/provider can still ignore or reject structured-output
parameters; strict output is not an unconditional provider guarantee. App-level
validation and independent evidence checks remain necessary.

A second bounded check used extraction chunk 0's retained source and the
production v10-pm1 prompt with the corrected nullable schema. It returned an
Ondas claim with `option`, `owner_name` and `horizon_en` all null, rather than
invented option metadata. The exact charge was $0.013775 and elapsed time
36.377 seconds. Only the output cap was reduced from 24,000 to 14,721 tokens
to keep the conservative reservation below $0.10; the response ended normally.
Together the two schema probes cost $0.029231. Neither wrote to the database or
retried a paid call. They prove bounded compatibility, not whole-workflow parity.

The repair passed both full repository suites: 1,112 tests passed, zero failed,
one existing skip each. Typecheck, build and advisory offline diagnostic passed.
The focused transport/schema suite passed 21 tests. Both final feature-head
GitHub runs passed (38122830575 and 38122828674).

## Final hosted production check

On the schema-repair release, parent `899f678f-8018-417a-81c4-41767c7abdd7`
and brief `39dfcafc-db26-4eec-acc6-d77431e7ef56` both completed and published.
All 18 calls settled; no outstanding call reservation remained for these runs.
The source hash matched the native baseline. Both accepted ideas had `option: null`,
removing the invented option labels. All 11 draft materiality scores were in 0–3;
10 sentences were published after application checks, with one withheld.
The UI explicitly reports partial readiness, 5/15 retained evidence items
represented and one current source-consistency warning. That inventory differs
from the native brief's 7/11; these ratios are not comparable accuracy scores.
Some overlapping idea summaries and empty structured conditions remain; source
qualification and coverage work still matter.

| Component | Earlier Google/OpenRouter | Final Cheaper Inference |
| --- | ---: | ---: |
| Analysis | $0.226870 / 57.130s | $0.211348 / 681.087s |
| Brief, including unchanged Jev | $0.061314358 / 43.021s | $0.088506812 / 124.051s |
| Complete workflow | $0.288184358 / about 100s | $0.299854812 / 805.105s |

Analysis cost was 6.8% lower, but the complete workflow was **4.0% more expensive**
in this sample. Elapsed time includes a queued pause and explicit resume at the
saved critique stage; completed paid calls were retained. Different output,
billed token counts and audit work prevent a same-usage interpretation. Lower
catalog rates did not produce whole-workflow savings here. Compatibility is
verified on this bounded workflow; fidelity, speed and cost parity are not.
The approved default remains Cheaper Inference with balance routing and the
same models. The original providers are selectable. For latency-sensitive use,
the earlier Google/OpenRouter route is the stronger observed baseline; wider
representative evidence is needed before claiming routine savings.

No error/fatal runtime logs were returned for the repair deployment between
08:04:28 and 08:20:16 UTC. This bounded log query is not proof of universal health.
No Supabase migration or login is required for this provider change.

## Operational switch and rollback

After deployment and bounded representative compatibility checks, save the four
text stages to Cheaper Inference in the live workspace. Preserve the existing
models, prompts, budget, monitoring and other preferences. Save/reload confirms
the actual workspace configuration; code defaults alone do not migrate it.
Rollback sets extraction/translation to Google and critique/context to OpenRouter,
with the same models. Existing runs continue from their frozen configuration.

Sources: [API documentation](https://www.cheaperinference.com/docs),
[optimization guide](https://www.cheaperinference.com/docs/optimization) and
[OpenAPI](https://www.cheaperinference.com/api/openapi.json), checked 11 October 2026.
