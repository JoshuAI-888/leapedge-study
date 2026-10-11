# Inference providers

Approved 11 October 2026; implementation merged in PR 38.
Production release: `9f218fcd87c0bc86dbd5c85cc9bee4e60d3d3122`,
Vercel `dpl_JD6JTyGYamgYFdYvyWwh7LTkFo4E`, ready 11 October 2026.
The live workspace was switched and persisted with balanced routing.
A database comparison confirmed only provider choices, exact model aliases and
the new routing preference changed; audio, prompts, budgets and other settings
were preserved. Both final feature-head GitHub verification runs passed
(38121401282 and 38121398472).

The product defaults use Cheaper Inference for text extraction/synthesis,
independent critique, context and translation. The models remain Gemini 3.8 Flash,
Claude Sonnet 5, Claude Sonnet 5 and Gemini 3.1 Flash Lite. Audio transcription and
audio review stay on Google native. Jev remains separate. A saved workspace keeps
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

The catalog's three configured models advertised 35% lower token rates. Repricing
two completed workflows at identical usage gave $0.62924 versus $0.96740,
including unchanged Jev fees (34.96% lower). This is a counterfactual, excludes
other platform costs and Google audio, and does not guarantee realised savings.

## Hosted workflow compatibility follow-up

The first hosted same-video check completed extraction: run
`0b294502-7de6-48da-b513-adbb44583af7`,13 settled calls,$0.182394,200.745s,
versus the previous native/Router run,$0.22687,57.13s. The source hash matched
and both retained two accepted ideas, though stance/conviction wording differed.
The automatic brief `638652cc-762e-4fa0-8ce3-8bdf7a0072d8` failed validation:
Gemini returned materiality scores above the allowed0–3 range. Its$0.01496
charge and failed response remain retained; no blind retry was made.
The extraction output also used empty option metadata where the native run
returned null. Legacy Google-style nullable schemas need standard JSON Schema
translation at the new transport boundary. Compatibility repair is in progress;
the first hosted check does not establish whole-workflow quality parity.

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
