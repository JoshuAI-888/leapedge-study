# Controlled results and economics

All live writes ran on new local Postgres, not production. Nine generation requests completed, one media submission was rejected before a job name, and one independent-critic call was rejected with expired-key HTTP401. Recorded model cost: **US$0.097319625**, zero remaining live-test holds, zero new caption-provider credits. These are returned usage × repository tariffs, not provider invoices or all-in costs. Across all test arms, recorded per-video totals were$0.02323950 Planet,$0.033048375 T-Mobile and$0.04103175 Palantir; these combine comparison arms and are not one production workflow. The $5 ceiling was not approached. Full private request/source/response manifests remain under ignored `data/gemini-batch/`; sanitized JSON/CSV, identities, source/prompt/schema hashes and usage are in [benchmark.json](results/benchmark.json) and [benchmark.csv](results/benchmark.csv).

## A: synchronous direct YouTube

Native Flash 3.8, pinned SDK 2.22.0, static LOW resolution, same original-language verbatim prompt, absolute 0–30 second interval, output cap 2,048 including reasoning. No caption text supplied to the media request. Conservative maxima priced the **whole original video** at 300 tokens/sec, even though only 30 seconds were requested: $0.08553 Planet, $0.13008 T-Mobile, $0.25698 Palantir. Existing budget reservations used provider countTokens; no automatic retry or caption purchase.

| Video | Whole asset seconds | Returned segments | Call including preflight | Recorded USD | Result |
|---|---:|---:|---:|---:|---|
| Planet Labs `Mepjkm_0ns4` |346|11|8.029s|.003609|Accessible, schema/bounds pass|
| T-Mobile `_mEvVWGfmjU` |544|5|6.038s|.00337275|Accessible, schema/bounds pass|
| Palantir `fSx-Ho8mi18` |1108|7|15.489s|.00361275|Accessible, schema/bounds pass|

n=3: median 8.029s, range 6.038–15.489s; median $0.003609. These are short intervals, not full-video transcription latency/cost. Language strings were en/eng; no multilingual speech was tested. No complete-asset speech coverage, missed/duplicated/hallucinated speech rate, verified names/numbers/negations or timestamp error can be established from these intervals without independent reference listening.

Caption-text edit agreement on complete saved cues inside 0–30s is 0.900 Planet, 0.761 T-Mobile and 0.683 Palantir. Cue boundaries were not independently reviewed and end cues can differ from the requested window. These are source-agreement diagnostics, **not WER, CER, audio accuracy or timing truth**. Candidate/reference hashes and edit counts are exported; verified WER/CER/anchor errors remain null.

## B: batch direct YouTube

Exactly the same Planet GenerateContent model, prompt, schema, window and request fingerprint as A (`cbb150…`). Submission rejected HTTP400; no provider resource name; zero charge recorded and reservation released. The old implementation retained only “Batch submission rejected:400,” so the exact provider error detail is lost. Diagnostic retention should have been repaired before this request. It was repaired afterward with a failing regression test; this experiment did **not** repeat the rejected media request.

Do not infer either universal YouTube-in-Batch support or universal prohibition from this result. A schema, media restriction or another field could have caused rejection. That question remains unresolved. No multi-video Batch test, downloader, media re-encoding workaround or File upload alternative was performed. No suitably authorized local media asset was supplied, and a URL rejection did not authorize bypassing YouTube access controls.

## C: paired frozen transcript extraction

The three original saved caption sources are hashed, frozen and reused without acquisition charges. Both arms use Flash 3.8, same source, snapshot prompt `evidence-first.web.v10-pm1`, current extraction schema, prompt/payload/schema hash, max 24,000 output and low reasoning. Exporter refuses a source/prompt/schema/payload/model mismatch. All paired request fingerprints match exactly.

This isolates a **single full-source extraction request**, not the complete production workflow: it uses existing extraction prompt/payload/schema and modelCall, but omits production temporal-context wrapping and ten-minute chunk planning. The Palantir full-source arm therefore differs from normal chronological chunking. It does not measure translation, recall, identity checks, root critique, child synthesis, final audit or publication. Full pipeline comparison was blocked by the independent critic's expired key; no bypass or substitute critic was used.

| Video | Sync USD | Batch USD | Observed reduction | Sync raw result | Batch first observed result |
|---|---:|---:|---:|---:|---:|
| Planet |.01474875|.00488175|66.90%|12.481s|149.394s|
| T-Mobile |.01978125|.009894375|49.98%|14.130s|259.375s|
| Palantir |.02539350|.01202550|52.64%|15.157s|190.979s|

Totals: sync$0.05992350, Batch$0.026801625, observed stage reduction 55.27%. Median stage cost$0.01978125 versus$0.009894375. Median sync 14.130s (12.481–15.157); median first observed Batch 190.979s (149.394–259.375). Submission plus preflight was 7.239–7.842s. Poll observations bound availability; they do not reveal queue duration or provider processing time. No p95 or population throughput claim is supportable from three observations.

Planet Batch reported 9,030 cached of 10,715 input tokens, with 2,086 output tokens; its control had 1,790 output and no reported cache hit. Batch's own usage at standard rates is$0.00976350 before the 0.5 multiplier. Thus the 66.9% paired difference combines Batch, caching and output variation. T-Mobile outputs were 2,144/2,146 tokens; Palantir 2,410/2,052. Model stochasticity/order and implicit caches were not controlled; this is not a causal estimate of a fixed50% saving. Google generated all six text outputs successfully; every extraction passed Zod and exact range resolution.

Quality still fails the promotion test. Both Planet arms reconstructed$101m guidance from captions that read “under$1 million” and$105m. The sync arm also used$100m elsewhere. The existing numeric gate marks 101m **unresolved** against the exact copied range; see [quality-regressions.json](results/quality-regressions.json). This establishes inconsistency with the retained source, not what the speaker actually said. A transcription doubt elsewhere does not make an unsupported number acceptable. T-Mobile/Palantir semantic completeness and attribution were not independently audited. Key-point counts differed (T-Mobile 4→3, Palantir 4→3), which alone proves neither an omission nor a quality improvement.

The attempted cross-family critique used existing faithful-audit instructions/schema, copied source quotes, modelCall and the same campaign cap. OpenRouter returned exact error: `Provider HTTP 401. No automatic paid retry. Provider said: API key expired.` Its hold released and recorded cost was 0. No live independent verdict, checked analyst view or reviewed publication resulted. Existing deterministic tests still reject invented decimals, misattributed forecasts, reversed/unsupported semantics, weakened conditions, unavailable audits and unaudited repairs. No fluent extraction was promoted into reviewed investment evidence.

Grouped SDK input of 1 versus 3 independent keyed requests passed offline wire serialization, including video offsets/system/schema/thinking/LOW fields. Current orchestration still creates one provider job per item. Live grouped throughput/cost/recovery is **not measured**. Grouping should amortize job/poll overhead, not add another 50% token discount; dependent stages still need separate barriers.

## D: hybrid policy experiment

The tested pure policy preserves manual immediate routing; channel Batch requires explicit enablement plus prerequisites; historical Batch is preferred only when enabled and eligible. A request requiring media stays immediate unless the exact media Batch workload is verified. This policy is **not wired into production**. Existing caption reuse, missing/low-coverage source routing, independent critique and publication gates were exercised by offline repository tests. Reliable captions remain reusable; absence or questionable coverage must choose the currently permitted synchronous native verification path or hold for review, given B's unresolved rejection. A background origin never grants permission to skip critique or publish inaccurate evidence.

No hybrid all-in gain or end-to-end reviewed latency is measured. Time to raw extraction is distinct from first usable checked analyst view. Checked-findings and reviewed-publication timing, per-provider queue/process decomposition and complete media cost remain null.

## Break-even: how much spend is actually eligible?

`net saving fraction = 0.5 × eligible synchronous spend / original all-in spend − incremental Batch overhead / original all-in spend`.

At zero incremental overhead, the 15% proposed all-in gate needs at least 30% eligible spend. At 5% added overhead it needs 40%; at 10% it needs 50%. Caption subscriptions, Sonnet/other-family critiques, Jev, hosting/DB, failed work and retained unknown bills do not receive a Google Batch discount. Cache storage/tool tariffs need separate treatment.

An offline decomposition of the **historical 11 October original-provider49-call, three-video cohort** gives the following potential ceiling, using saved call/run identities whose hashes are exported. This is not a new production or Batch measurement:

| Recorded group | USD | Calls | Google Batch eligibility |
|---|---:|---:|---|
| Native root text |.382887600|28|40.23% of recorded model spend; current root route can select Batch|
| Native research-child text |.104790750|6|Additional11.01%; current child does not inherit Batch mode|
| OpenRouter |.462596000|12|Ineligible for Gemini Batch; preserve independent family|
| Jev/other |.001426152|3|Ineligible|
| Total |.951700502|49|Caption/infra invoices excluded, not zero|

Current root-only maximum is 20.12% of recorded model spend; explicitly extending eligible child text would raise the theoretical maximum to 25.62%. Applying that ceiling without measuring workflow delays, cache differences or rejected outputs would be a mistake. With$0.03/video of illustrative original caption/infra costs and$0.01/video added Batch overhead, the root-only projection is about 15.50% all-in saving; $0.015 added overhead drops it below 15%. Those overhead figures are scenarios, not measured invoices.

Historical native workflow costs were $0.301590/$0.177139/$0.472972; full briefs 85.015–181.026s, with source/provider/cache confounders documented in [native-provider-repeat](../../delivery/native-provider-repeat-20261011.md). Prior Cheaper Inference costs $0.284989/$0.197732/$0.311792 plus an unresolved$0.193272 Palantir hold cannot prove a cheaper completed workflow. No current rerun of those providers is possible with the expired independent-critic credential.

The historical average model-only $0.31723 becomes about$0.25342 under the root-only mathematical discount, or$0.23595 if all native text were eligible. Neither reaches the typical$0.15 objective before caption/infra costs. A hard$0.50 objective is plausible for some captioned cases but not established all-in; Palantir leaves little overhead margin, and historical hour-long forced-ASR trials exceeded$0.50 before all research work. Treat$0.50 as an admission objective or explicit review/rejection boundary, not a guarantee obtained by weakening evidence gates.

## Scaling scenarios, not load tests

Extrapolate the historical three-video average and root-only maximum, keeping all critic work. USD/day below excludes unmeasured caption/infra costs:

| Videos/day | Baseline model projection | Root-Batch model lower bound | Typical$0.15 all-in target | Hard$0.50 objective |
|---:|---:|---:|---:|---:|
|50|15.86|12.67|7.50|25.00|
|250|79.31|63.35|37.50|125.00|
|1,000|317.23|253.42|150.00|500.00|

No load/quotas benchmark was run. That cohort averaged 9.33 native root requests and 97,573 input tokens/video. With one job per request and 100 concurrent jobs, steady state requires average job residence below 5.14h at 50 videos/day, 1.03h at 250, and 15.4min at 1,000. With a 3M enqueued-token quota, the comparable token-residence bounds are 14.76h, 2.95h and 44.3min. These use Little's law and historical work amounts, not guaranteed Google throughput or the actual project's unknown quota. Grouping reduces concurrent-job pressure but does not remove token limits. Sequential stage delays can accumulate; a 24-hour objective per batch is not a 24-hour full-workflow promise.

A fixed-minute poll per pending job can approach 144,000 polls/day at 100 jobs, plus analysis retries/scans. The actual 15-minute Vercel heartbeat and bounded drains differ from a continuously awake minute worker. Infrastructure consumption, queue age, polling backoff and service ownership must be measured before scaling. No production monitor was activated to obtain these numbers.
