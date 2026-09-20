# Frozen-stage optimisation experiment

> **Superseded candidate — not current-release gains.** Adversarial review rejected removal of uncited external and baseline text. The current candidate retains that full context and only bypasses AI review for deterministically invalid sentences. The combined 26.7% stage-time and 12.0% stage-cost reductions below describe the rejected candidate and must not be attributed to the current release. Selective English translation savings remain applicable.

Frozen translation and final research audit only; not ingestion-to-display.

Comparable: **true**. Quality: **review-required**.

One paired trial per stage; provider variability remains. Changed verdicts require source-backed adjudication; unchanged verdicts are not accuracy proof. Extraction/audit recall, queueing and UI paint are not measured.

| Video | Stage | Before sec | After sec | Saved sec | Before USD | After USD | Before input/output tokens | After input/output tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1WNowIoNgtg | translate | 16.266 | 0.001 | 16.265 | 0.009295 | 0.000000 | 5132/5341 | 0/0 |
| 1WNowIoNgtg | research-audit | 17.380 | 29.631 | -12.250 | 0.059852 | 0.071700 | 21081/1769 | 21095/2951 |
| ZfOQoh82JTo | translate | 26.866 | 0.001 | 26.865 | 0.017137 | 0.000000 | 9154/9899 | 0/0 |
| ZfOQoh82JTo | research-audit | 19.650 | 17.518 | 2.132 | 0.108168 | 0.098960 | 43634/2090 | 39545/1987 |
| M1FJ5dNiBEs | translate | 0.000 | 0.001 | -0.001 | 0.000000 | 0.000000 | 0/0 | 0/0 |
| M1FJ5dNiBEs | research-audit | 14.238 | 14.830 | -0.592 | 0.036024 | 0.035892 | 10417/1519 | 10431/1503 |
| SPIRV9UjNYU | translate | 9.792 | 9.053 | 0.739 | 0.004781 | 0.004293 | 2370/2792 | 2107/2511 |
| SPIRV9UjNYU | research-audit | 17.956 | 18.520 | -0.564 | 0.076344 | 0.063450 | 29302/1774 | 22270/1891 |

Measured sequential stage work: 122.148 → 89.554 seconds. Measured stage API spend: $0.311600 → $0.274295. These sums are not end-to-end latency.


## 1WNowIoNgtg: audit verdict differences

Frozen source: `f9c9d50e18785fd4f72254102e17f8c962310e6ac4863f8e84b547f3f74f421c`. Frozen draft: `e14c2e42f2c4af8be506bc2c7cd81551fbccffa67f5e7bc55ebfc30a67266eb5`.

Audit payload bytes: 54719 original → 54749 actual; 17 video evidence items and 12 sentences. Policy: all-video-evidence-and-cited-external-v1.

- **s1** (reason/assessment changed): before true / unverified — Supported by k1 quote describing put selling as insurance-like income mechanism. After true / unverified — Directly supported by k1 quotes describing put selling as an income strategy analogous to insurance.
- **s2** (reason/assessment changed): before true / unverified — Supported by k1/k2 describing wanting to own stock and limit-order analogy. After true / unverified — Supported by k1/k2 quotes on choosing desired ownership stocks and limit-order analogy.
- **s3** (reason/assessment changed): before true / unverified — Matches k1/k3 quotes on $3000 weekly target risk scaling with $100k vs $1M portfolios; financialFacts correctly labeled as scenario. After true / unverified — Matches k1/k3 quotes on capital size vs weekly target risk; scenario figures preserved as scenario not forecast.
- **s4** (reason/assessment changed): before true / unverified — Supported by k2/k4/k5 on capped upside risk. After true / unverified — Supported by k2/k4/k5 on capped upside risk.
- **s5** (reason/assessment changed): before true / unverified — Supported by k7/k12 on 30 delta and 30-45 day window. After true / unverified — Matches k7/k12 on 30 delta and 30-45 day window guidance.
- **s6** (reason/assessment changed): before true / unverified — Matches k11 on escalating assignment risk near expiration. After true / unverified — Matches k11 quote on assignment risk rising near expiration with high delta.
- **s7** (reason/assessment changed): before true / unverified — Matches k8/k10 on rolling and wheel strategy tactics. After true / unverified — Matches k8/k10 on rolling or wheel strategy as management tactics.
- **s8** (reason/assessment changed): before true / unverified — Matches c1/c4 on Google 370 puts in the money and early assignment on margin. After true / unverified — Matches c1/c4 quotes on Google 370 puts in the money and early assignment on margin.
- **s9** (reason/assessment changed): before true / unverified — Matches c1/c4/c5 on rolling or 5% covered call plan; financialFact correctly scenario-labeled. After true / unverified — Matches c1/c4/c5 quotes on rolling or selling a 5% higher covered call to reach breakeven.
- **s10** (reason/assessment changed): before true / unverified — Matches c2 on Microsoft ITM put slightly down requiring management. After true / unverified — Matches c2 quote on Microsoft ITM put management options.
- **s11** (reason/assessment changed): before true / unverified — Matches c3 on Palantir Nov 20 puts preferred over outright purchase due to limited near-term upside view. After true / unverified — Matches c3 quotes on preferring puts over outright purchase due to Palantir being 'tapped out' and November 20 expiration.
- **s12** (classification changed): before true / unverified — Matches c3 quotes on 165 strike, $1.85 premium, and 155 support; breakeven calculation (165-1.85=163.15) correctly framed as scenario, though sentence states breakeven 'above' 155 which matches arithmetic. After false / disputed — The cited quotes are internally inconsistent: creator states 165 strike minus $1.85 premium yields a breakeven, then separately states the breakeven figure is 155, which is arithmetically inconsistent (165-1.85=163.15, not 155) and possibly refers to the earlier discussed 175-strike scenario. The draft resolves this ambiguity by asserting the breakeven is 'above' the 155 support level, which is not supported by the quotes and constitutes an invented reconciliation of a contradictory source rather than a faithful report.

## ZfOQoh82JTo: audit verdict differences

Frozen source: `8828ae192fa35bf131109eea76965006f0807ffa83169ea51f659794851cd54a`. Frozen draft: `e7a8063d38aa27074734bc471cfa6cc0c32b2030456edfa8b0308dd6bc59b469`.

Audit payload bytes: 114126 original → 103502 actual; 23 video evidence items and 14 sentences. Policy: all-video-evidence-and-cited-external-v1.

- **s-1** (reason/assessment changed): before true / corroborated — Corroborated by external filing k1/web-0eecc2f5a3-2 matching APY, cashback, and Lead Bank partnership details. After true / corroborated — Corroborated by external SEC filing matching APY, cashback and partner bank details.
- **s-2** (reason/assessment changed): before true / corroborated — Matches k1 quote and external filing confirming 4.5% APY and 2% cashback with direct deposit. After true / corroborated — Matches k1 quote and external filing on 4.5% APY/2% cashback.
- **s-3** (reason/assessment changed): before true / unverified — Creator estimate ('I'm guessing') and SoFi deposit figure correctly labeled as approximate/reported per k2. After true / unverified — Creator estimate/guess clearly framed as such, matches quotes.
- **s-4** (reason/assessment changed): before true / corroborated — Matches k4 and external SEC filing on Nu Global APYs and 35+ country coverage. After true / corroborated — Matches external SEC filing for Nu Global yields and country coverage.
- **s-5** (reason/assessment changed): before true / unverified — Accurately reflects creator's countercase in k4/k5/k6 regarding cash pickup necessity and corridor complexity. After true / unverified — Accurately reflects creator's stated skepticism and cash-pickup rationale.
- **s-6** (reason/assessment changed): before true / unverified — Correctly captures creator's loss-leader/limit argument from k4 and k5 quotes. After true / unverified — Reflects creator's stated concern about loss-leader economics and send limits.
- **s-7** (reason/assessment changed): before true / unverified — Accurately reflects creator's stated holding and rationale per c1 quotes. After true / unverified — Matches c1 quote on TLT yield and hedge rationale with conditions preserved.
- **s-8** (reason/assessment changed): before true / unverified — Matches c2 quote on TLT price levels and liquidity rationale, correctly framed as scenario. After true / unverified — Matches c2 scenario values (81 to 120) and framing as scenario not forecast.
- **s-9** (reason/assessment changed): before true / unverified — Matches k9/k10 quotes on 10-year yield below 5% and core CPI heading to 2%, properly framed as forecast/creator view. After true / unverified — Matches k9/k10 quotes on rate/CPI expectation, correctly framed as forecast.
- **s-10** (reason/assessment changed): before true / unverified — Matches k8 quote on TransDigm's 20x EV/EBIT and aftermarket-driven insulation thesis. After true / unverified — Matches k8 quotes on valuation multiple and aftermarket thesis.
- **s-11** (reason/assessment changed): before true / unverified — Matches k16/k17 valuation figures for LVMH and Hermès and stated preference rationale. After true / unverified — Matches k16/k17 multiples and preference stated.
- **s-12** (reason/assessment changed): before true / corroborated — Corroborated by external Financial Post article confirming Carney's announcement, airport names, and land ownership retention. After true / corroborated — Corroborated by external Financial Post article matching announcement details.
- **s-13** (reason/assessment changed): before true / unverified — Accurately reflects creator's skeptical view in k13 about AI slowdown rhetoric being cover for capex cuts. After true / unverified — Reflects creator's skeptical opinion accurately per k13 quotes.
- **s-14** (reason/assessment changed): before true / unverified — Matches k21 quotes on Cathie Wood's $10 trillion Starship revenue scenario and creator's rejection of it. After true / unverified — Matches k21 quotes on projection figures and creator's skeptical framing preserved as scenario/countercase.

## M1FJ5dNiBEs: audit verdict differences

Frozen source: `91759df271a22bbee5dc9900f0db17c07b5a7ffa2308fb2949c13d7aed42fddc`. Frozen draft: `d8403dcb13a2b99b9d472776272bf81bfef59b088028c8b22c8a0b45356a79ef`.

Audit payload bytes: 21876 original → 21906 actual; 7 video evidence items and 10 sentences. Policy: all-video-evidence-and-cited-external-v1.

- **s-1** (reason/assessment changed): before true / unverified — Supported by k1 quote content on safety compute workloads and lab constraints. After true / unverified — Matches k1 content on safety compute and constrained labs.
- **s-2** (reason/assessment changed): before true / unverified — Matches k2 quote exactly for figures and dates. After true / unverified — Figures match k2 quote exactly (5GW 2026, 1.5GW prior, 10GW 2027).
- **s-3** (reason/assessment changed): before true / unverified — Matches k2 quote for OpenAI trajectory. After true / unverified — Matches k2 OpenAI trajectory figures.
- **s-4** (reason/assessment changed): before true / unverified — Supported by k3 quotes regarding smaller deployments and named operators. After true / unverified — Matches k3 on smaller deployments and named beneficiaries.
- **s-5** (reason/assessment changed): before true / unverified — Matches c1 quote on holding and put strategy at 79 strike. After true / unverified — Matches c1 quote on holding and 79 put strategy.
- **s-6** (reason/assessment changed): before true / unverified — Matches c2/k4 on Muse app ranking and caveat about popularity vs downloads. After true / unverified — Matches c2/k4 on Muse ranking and caveat about popularity vs downloads.
- **s-7** (reason/assessment changed): before true / unverified — Matches c2/k4 quotes on market cap, PE ratio, and bullish thesis on intelligence/compute monetization. After true / unverified — Matches k4 quotes on market cap, PE ratio, and margin thesis.
- **s-8** (reason/assessment changed): before true / unverified — Matches k5 quotes on Nvidia price, market cap, and Vera Rubin profit-per-gigawatt claim, correctly labeled as claim/forecast. After true / unverified — Matches k5 quotes on share price, market cap, and Vera Rubin profit claim.
- **s-9** (reason/assessment changed): before true / unverified — Matches k5 quote on 67x throughput per TCO claim, properly attributed as third-party estimate. After true / unverified — Matches k5 quote on 67x throughput per TCO claim.
- **s-10** (reason/assessment changed): before true / unverified — Reasonable grounded inference from k1/k2 about interconnection/capital constraints as invalidation condition; appropriately framed as a check rather than a forecast. After true / unverified — Reasonable grounded inference from k1/k2 about infrastructure and financing constraints; framed as a check, not a forecast.

## SPIRV9UjNYU: audit verdict differences

Frozen source: `c835829dab9c4d7cb7fa468b7d3dbd1ba564b6c6d7756244e1b0ec62a0909185`. Frozen draft: `dbebcd3a35aec9660f1ddbbb55e6151721d6aada578405a022a02d4ce2f9eb52`.

Audit payload bytes: 68298 original → 51267 actual; 8 video evidence items and 10 sentences. Policy: all-video-evidence-and-cited-external-v1.

- **s1** (reason/assessment changed): before true / corroborated — Matches k1 and is corroborated by external sources on target cut and mid-2027 deferral. After true / corroborated — Matches k1 and is corroborated by external sources on Yardeni's target cut from 8,400 to 7,900, deferred to mid-2027.
- **s2** (reason/assessment changed): before true / corroborated — Multiple compression from 19.8x to 18.6x with unchanged $425 EPS is directly supported by k1 and corroborated externally. After true / corroborated — Multiple compression from 19.8x to 18.6x with unchanged $425 EPS is directly supported by k1 and external source.
- **s3** (reason/assessment changed): before true / unverified — Supported by k2 quotes on energy prices constraining Fed flexibility and corporate budgeting. After true / unverified — Supported by k2 discussing high oil prices, repeated conflict, and Fed policy constraints.
- **s4** (reason/assessment changed): before true / unverified — Supported by k2 quotes on discounting future cash flows due to higher rates. After true / unverified — Reflects k2's logic about higher rates increasing opportunity cost and compressing valuations of future cash flows.
- **s5** (reason/assessment changed): before true / unverified — Supported by k3 and k4 describing carry trade unwind mechanics and forced selling of quality assets. After true / unverified — Matches k3/k4 description of carry trade unwind forcing asset sales unrelated to fundamentals.
- **s6** (classification changed): before true / unverified — BOJ 25bp hike to 1.25% on Sept 18 with yen softening on in-line outcome is supported by k3/k5 quotes. After true / corroborated — BOJ 25bp hike to 1.25% and yen softening due to expected outcome is directly quoted in k3/k5.
- **s7** (classification changed): before true / unverified — S&P +1% to 7,600, Nasdaq +1.7%, 10yr yield 4.93% figures match k6 quote language. After true / partial — S&P 500 1% rebound and 10-year yield at 4.93% figures match k6 quote, though external source shows differing yield (5.01%) suggesting partial divergence.
- **s8** (reason/assessment changed): before true / unverified — Matches c1 and k7 conditional long-term AI holding stance with stated conditions. After true / unverified — Directly reflects creator's stated conditional long-term AI bullishness in c1/k7 with correct conditions preserved.
- **s9** (reason/assessment changed): before true / unverified — Invalidation condition (cost inflation eroding margins, earnings downgrades) is directly grounded in c1 risks and k6 discussion. After true / unverified — Reflects the stated risk in c1 and k6 regarding cost pressure eroding profits triggering earnings downgrades.
- **s10** (reason/assessment changed): before true / unverified — Reasonable next-check question grounded in k3/k5 content about future BOJ pace, yen trajectory, and capital withdrawal. After true / unverified — Reasonable next-check question grounded in k3/k5 content about monitoring BOJ pace, yen trajectory, and leveraged fund flows.

## Source-backed review of classification changes

### 1WNowIoNgtg / s12

Defensible stricter rejection, but preserve usable contract terms as separately attributed facts. c3: s00776–s00787 (1611.12–1640.64s) says 165 strike and $1.85 premium; s00790 (1642.4–1646.799s) says 155. Draft asserts breakeven above155. Arithmetic is163.15, but source linkage is ambiguous and noncontiguous. New critic refuses to silently reconcile. The raw original full transcript/audio gap has not been rechecked in this stage-only review.

### SPIRV9UjNYU / s6

Raw critic overclaims independent corroboration. Final factual gate prevents false verified label, but fragile robustness remains and needs correction. k3 and k5 repeat the same creator ASR range asr-1-36–asr-1-46 (453.22–501.3s). Both support what the creator said about25bp/1.25%, but sentence externalIds is empty. Final brief factualStatus remains unverified.

### SPIRV9UjNYU / s7

Raw critic alleges divergence across different dates; final factual gate downgrades to unverified but audit reason retains misleading discrepancy. k6 asr-1-47–asr-1-62 describes Sept17 market rebound/yield4.93%. Retained web-64dbccebcb-1/-2 describe Wednesday/Sept16 yield5.01%. Those are different dates, so they do not establish a contradiction. Sentence externalIds is empty.

No new acceptance/rejection classifications changed in the AI-compute or long-podcast final audit. This checks the frozen final-draft experiment only; it does not establish that earlier extraction preserves Credo, Dutch Bros, every option term, or the full transcript. Those require the separate full-pipeline regression review. No new LeapEdge calls were made.

## Subsequent quality correction

The final-brief gate now removes unsupported external audit explanations and robustness claims when downgrading factual status. This addresses the Mandarin s6/s7 presentation leakage recorded above. It does not prove model semantic variance is solved. Current-candidate measurements and source-backed quality checks must be reported separately.
