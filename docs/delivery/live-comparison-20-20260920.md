# Twenty-video live comparison — 20 September 2026

The app is not yet at LeapEdge's observed completion reliability. Across 20 distinct videos from 11 channels, it completed 13 (65%), failed five, and stopped two for review. LeapEdge had 19 usable reports (95%) and one terminal failure. These are cohort observations, not population accuracy estimates. The 13 completed local reports produced 30 accepted calls; only eight retained explicit ticker symbols.

The approved Finradar UI build and its desktop/mobile checks preceded this cohort. Current source is main `a414c02` (UI implementation PR #7); no extraction code was changed during the experiment. Native Chrome operated LeapEdge and the local app. The first local video was submitted through Today; the remaining 19 used the same app queue function. The local worker ran three concurrent stages in a separate localhost database `yti_compare_20260920`, with no scheduler, subscriptions, email, production writes or automatic retries. No existing runtime settings were changed. The user removed the previous $25 spending cap for this cohort.

## Cost reconciliation

| Item | USD / usage | Evidence and meaning |
|---|---:|---|
| Local app model ledger | $2.15065205 | 52 completed model calls, including failed analyses; no outstanding holds |
| Google native, current-rate calculation | $1.249320 | Recorded token usage × current published rates; not an invoice |
| OpenRouter critic | $0.926886 | Provider response usage.cost, 13 calls |
| **Repriced model total** | **$2.176206** | **$0.108810 per attempted video** |
| TranscriptAPI | 16 credits; $0 incremental cash | Signed-in Free Plan; 28 of 100 credits remaining after test; no purchase |
| LeapEdge allowance | 16 analyses consumed | 18 remaining before → 2 after; four pre-existing report references |
| LeapEdge displayed spend | $0.68 across 15 reports | Includes $0.10 attached to older references; $0.58 visible on 12 newly submitted reports. Five reports have no displayed amount. Missing is not zero. |

A pricing defect was discovered: the app records Gemini 3.1 Flash-Lite at $0.10 input / $0.40 output per million tokens, while Google's current standard rates are $0.25 / $1.50. Nine translation calls used 18,963 input and 20,645 output tokens: $0.03570825, versus $0.01015430 in the app ledger. The adjustment is $0.02555395. Gemini 3.8 Flash's $0.75 / $3.75 rates match the current introductory rate. See [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

TranscriptAPI recorded 16 successful requests and four unsuccessful attempts; its [billing rules](https://transcriptapi.com/docs/api/#credit-usage--billing) charge successful requests. At the displayed $5/1,000-credit monthly package, the 16-credit allocation would be $0.08; this is a capacity-cost illustration, not money charged today. YouTube metadata used the existing API quota; no paid top-up or subscription was purchased. No invoice-level total, tax, account-wide credit deduction or LeapEdge cash price is inferred from its displayed pipeline spend. The earlier one-video pilot is excluded.

## Per-video results

Local cost below is repriced model usage, including failed attempts. “Accepted” excludes rejected drafts. LeapEdge cost is its displayed amount, with unshown values left blank.

| # | Video / channel | Local outcome; accepted calls | LeapEdge outcome; ideas | Local USD | LeapEdge displayed USD |
|---|---|---|---|---:|---:|
| 1 | [大多头突然改口！我为什么还敢拿着AI股？｜雅德尼下调目标](https://www.youtube.com/watch?v=SPIRV9UjNYU) — 霍比特小灰 | needs_review; 0 | ready; 1 | 0.084453 | 0.030 |
| 2 | [Anthropic突然出大问题了](https://www.youtube.com/watch?v=J_VpfkM74Wk) — 霍比特小灰 | failed; 0 | ready; 0 | 0.108221 | 0.040 |
| 3 | [美股：基本上定了。【2026-09-11】](https://www.youtube.com/watch?v=9nb3fp76Rz0) — 阳光财经 | needs_review; 0 | ready; 3 | 0.098256 | 0.030 |
| 4 | [早盘闪崩真相！NaNa说美股(2026.07.31)](https://www.youtube.com/watch?v=3u24qyWjSVM) — NaNa说美股 | completed; 6 | ready; 4 | 0.143328 | not shown |
| 5 | [AI Compute Demand Could DOUBLE Again by 2027!!](https://www.youtube.com/watch?v=M1FJ5dNiBEs) — Jose Najarro Stocks | completed; 3 | ready; 3 | 0.102488 | 0.030 |
| 6 | [CoreWeave & Nebius GPU Pricing Just Exploded — Here’s Why](https://www.youtube.com/watch?v=LF7fgz1HAFs) — Jose Najarro Stocks | completed; 1 | ready; 2 | 0.092508 | 0.030 |
| 7 | [AMD Stock Is Entering a New Cycle‼️Listen Up](https://www.youtube.com/watch?v=U32FPvvBaNI) — Jeremy Lefebvre Clips  | failed; 0 | ready; 4 | 0.044500 | 0.050 |
| 8 | [Oracle & Adobe Shareholders‼️Brand New Developments](https://www.youtube.com/watch?v=jPy5aDhMsMY) — Jeremy Lefebvre Clips  | completed; 2 | ready; 2 | 0.185132 | 0.060 |
| 9 | [If You Missed NVIDIA Stock, This is Way Bigger.](https://www.youtube.com/watch?v=elD62rk5Ijo) — Ticker Symbol: YOU | completed; 1 | ready; 1 | 0.115846 | not shown |
| 10 | [These Stocks Will Make Millionaires By 2029](https://www.youtube.com/watch?v=zYeJZu1hkdM) — Ticker Symbol: YOU | completed; 0 | ready; 2 | 0.113175 | not shown |
| 11 | [Nu Bank's Territorial Expansion; LVMH + Stocks At Cheapest Valuations Ever; Fed Hikes Interest Rates](https://www.youtube.com/watch?v=ZfOQoh82JTo) — Chit Chat Stocks Podcast | failed; 0 | stopped; 0 | 0.182090 | 0.140 |
| 12 | [Ian Bezek Returns to Discuss Why Brazilian Bank INTER Is Undervalued + Much More [PODCAST]](https://www.youtube.com/watch?v=iBMZc7zs_Ew) — Chit Chat Stocks Podcast | failed; 0 | ready; 1 | 0.108017 | 0.090 |
| 13 | [Palantir News: Can Palantir Turn $10,000 Into $1,000,000 By 2035?!](https://www.youtube.com/watch?v=tUR0w-LDSbU) — YT Finance | completed; 0 | ready; 1 | 0.076147 | 0.020 |
| 14 | [This Small Palantir Partner Just Unlocked One Billion Dollars in AI Defense Contracts!](https://www.youtube.com/watch?v=DuIyF_34ReI) — YT Finance | completed; 1 | ready; 1 | 0.088693 | 0.030 |
| 15 | [You're Gambling on Stocks - Stop Losing Money](https://www.youtube.com/watch?v=QEwLInO3iZY) — Let's Talk Money! with Joseph Hogue, CFA | completed; 0 | ready; 0 | 0.016362 | not shown |
| 16 | [7 Stocks to Buy Heavy Before the Market Takes Off](https://www.youtube.com/watch?v=IjYr5acuBT4) — Let's Talk Money! with Joseph Hogue, CFA | completed; 7 | ready; 6 | 0.180977 | 0.040 |
| 17 | [Superinvestors are buying this stock I added $10,000+ last week](https://www.youtube.com/watch?v=pWnu1C8I6Xw) — Invest with Henry | completed; 1 | ready; 1 | 0.035416 | 0.010 |
| 18 | [Generate $3,000 Weekly Passive Income with this Options Strategy](https://www.youtube.com/watch?v=1WNowIoNgtg) — Invest with Henry | completed; 1 | ready; 1 | 0.202407 | not shown |
| 19 | [Why I Buy the Strongest Mining Stocks First — Not the Cheapest](https://www.youtube.com/watch?v=vrTbCxUzRw4) — Bullmarket Lifestyle by Daniel Wilhelmi | completed; 7 | ready; 4 | 0.152907 | 0.040 |
| 20 | [Silver Is at Triple Support — If It Breaks, $54 Is in Play](https://www.youtube.com/watch?v=Dy_0RtmAt1U) — Bullmarket Lifestyle by Daniel Wilhelmi | failed; 0 | ready; 1 | 0.045283 | 0.040 |

## What differs

**1. 霍比特小灰 — SPIRV9UjNYU.** Local audio coverage check stopped publication; LeapEdge has one macro AI long thesis. No paired extraction score.

**2. 霍比特小灰 — J_VpfkM74Wk.** Local ASR rejected invalid absolute timestamps; LeapEdge completed a nine-point informational report with no trade ideas. Local failure is not a no-call agreement.

**3. 阳光财经 — 9nb3fp76Rz0.** Local audio coverage check stopped publication; LeapEdge returned DELL long (640 target), SOX long and SPY neutral.

**4. NaNa说美股 — 3u24qyWjSVM.** Both favor VOO and QQQ and retain COIN stop 140. Local preserves COIN as conditional on an existing dip-buy at support 141; LeapEdge labels long with entry 140. Local adds semiconductor-index and MSTR calls; LeapEdge adds RDDT avoid. Nasdaq condition is explicit locally; horizons and conviction differ.

**5. Jose Najarro Stocks — M1FJ5dNiBEs.** Strong thesis/direction agreement on Credo, Meta and Nvidia. Both retain Credo entry under the 170s. Local tickers are all unresolved and conviction is medium; LeapEdge assigns CRDO/META/NVDA, higher META/NVDA conviction and long-term horizons.

**6. Jose Najarro Stocks — LF7fgz1HAFs.** Both describe bullish CoreWeave economics. Local has one CoreWeave long call with a two-year horizon and a caption misspelling in the name; LeapEdge has two MACRO long cards separating Nebius and CoreWeave. Company/ticker aggregation is weak on both sides.

**7. Jeremy Lefebvre Clips — U32FPvvBaNI.** Local rejects the entire synthesis because one cited range exceeds two minutes. LeapEdge provides AMD, WYNN, RH and AXP long calls. Paid response retained; no silent retry.

**8. Jeremy Lefebvre Clips — jPy5aDhMsMY.** Both identify Adobe avoid and Oracle debt/sizing risk. Local Oracle stance is conditional on a small high-risk position, with a five-year horizon; LeapEdge labels long/long-term. Adobe avoid/high agrees. Local tickers unresolved.

**9. Ticker Symbol: YOU — elD62rk5Ijo.** Both identify SKHY long and the ADR premium. Local explicitly prefers direct Korean shares over the ADR and uses medium conviction; LeapEdge uses high/long-term. Instrument-market distinction deserves preservation.

**10. Ticker Symbol: YOU — zYeJZu1hkdM.** Local draft identifies both companies but captions spell tickers CHR and LIT; the independent critic rejects both. Completed local report has zero accepted calls, while LeapEdge has COHR and LITE long. Preserve rejection while adding explicit auditable entity resolution; do not silently repair source quotes.

**11. Chit Chat Stocks Podcast — ZfOQoh82JTo.** Both fail the 65-minute podcast. Local rejects absolute timestamps in windowed ASR; LeapEdge says too long to transcribe in one pass and displays $0.140. A shared failure is not extraction parity.

**12. Chit Chat Stocks Podcast — iBMZc7zs_Ew.** Local synthesis response is incomplete and is rejected. LeapEdge returns INTR long/high with a Brazilian bank valuation thesis. Retain the local paid partial response and add bounded recovery.

**13. YT Finance — tUR0w-LDSbU.** Local returns five key points and no actionable calls; LeapEdge turns the hypothetical four-times-over-a-decade PLTR discussion into a long idea. This is a recommendation-threshold difference, not a proven local omission without source review.

**14. YT Finance — DuIyF_34ReI.** Both are bullish on Ondas. Local preserves successful Mistral closing/integration as a condition and leaves conviction unspecified/ticker unresolved; LeapEdge assigns ONDS high/long-term and includes more catalysts.

**15. Let's Talk Money! with Joseph Hogue, CFA — QEwLInO3iZY.** Both correctly agree at the output level on no actionable trade ideas for the 38-second educational clip. Local has two key points; LeapEdge has four. No independent factual score is claimed.

**16. Let's Talk Money! with Joseph Hogue, CFA — IjYr5acuBT4.** Broad thematic agreement on ServiceNow, energy, cybersecurity, and avoiding rate-sensitive/consumer sectors. Local adds AI infrastructure and insurers, and rejects a weak Palantir watch extraction. LeapEdge has a long card spelled PALTR and maps generic energy to XLE. Local long instrument lists are not split into separate tradable entities.

**17. Invest with Henry — pWnu1C8I6Xw.** Both identify VST/Vistra long and insider/institutional support. Local retains the creator's purchase of 100 shares, high conviction and no explicit horizon; LeapEdge uses medium/long-term.

**18. Invest with Henry — 1WNowIoNgtg.** Both identify selling PLTR puts, including strike 165. Local retains 175 alternative and 155 support but labels strikes as generic entry levels and omits November 20 expiry from its horizon. LeapEdge explicitly retains the expiry and assignment risks.

**19. Bullmarket Lifestyle by Daniel Wilhelmi — vrTbCxUzRw4.** Both agree on SSR Mining/New Pacific bullishness and avoiding McEwen. Banyan differs in headline stance (local avoid-now vs LeapEdge long), but both require a pullback before buying. Local additionally includes Cabral, 1911 Gold and Lundin; LeapEdge retains New Pacific's 20% upside target while local leaves structured levels empty.

**20. Bullmarket Lifestyle by Daniel Wilhelmi — Dy_0RtmAt1U.** Local synthesis fails the two-minute evidence-range rule; LeapEdge gives SILVER avoid/medium with conditional downside $54–$60. No paired extraction score.

## Prioritized next work

1. **Repair ASR window timing and coverage.** All four videos entering native audio fallback failed or required review: two invalid absolute timestamps, two insufficient coverage. Keep the checks; improve generation/recovery. Do not shift timestamps or lower coverage to manufacture passes.
2. **Recover from invalid extraction spans and truncation.** Two otherwise captioned videos failed because a range exceeded two minutes; one long podcast returned incomplete synthesis. Validate/repair bounded subparts or split work, retain original attempts and account for retry costs.
3. **Resolve instrument identities with provenance.** Twenty-two accepted calls lack ticker fields. The optical-networking video lost both calls after captions produced CHR/LIT rather than COHR/LITE. Separate source wording from a verified entity mapping; preserve original quotes. Split multi-company claims where supported.
4. **Fix cost table and evidence-link initialization.** Reconcile the Flash-Lite rates above. On initial mining-report load, the selected 1911 Gold quote was 12:09 but the source link started at Banyan's 5:48. Clicking Listen changed it to 12:09. Initialize player time from the selected sorted claim.
5. **Preserve financial semantics and coverage.** Conditional exposure must remain conditional; distinguish put strikes/expiry from generic stock entry levels. Retain explicit November 20 options expiry and New Pacific's 20% upside role. Decide and document the hypothetical-analysis versus actionable-call boundary.

These are findings for the next build iteration; this test did not silently modify the pipeline or rerun failures until they passed. Finradar integration remains excluded.

## Browser and evidence verification

- First live submission showed confirmation, Queued, Analysing and a persistent report route.
- Today displayed 20 video activities, seven review items and 30 matching text-checked calls. The default Audio-agreed filter correctly showed none; this cohort performed audio fallback only when captions were missing, not independent audio agreement for all captioned calls.
- Dark-theme Today and the populated mining Analysis page were visually inspected in native Chrome. The previously approved desktop/mobile checks are in `finradar-ui-alignment.md`.
- The mining report displayed all seven accepted calls, quotes, English evidence, trust counts and save controls. Clicking Listen updated the external source link to 729 seconds; the actual YouTube player entered audio-playing state after Play. This proves player operation, not quote/timestamp accuracy against a human-reviewed source.
- The optical-networking report correctly showed Ready with “No accepted calls”; both rejected drafts remain in the stored results. Completed does not mean every draft passed.
- Twenty LeapEdge reports were captured through native browser accessibility, with account/navigation text removed before saving. Nineteen had report metadata; the stopped podcast had the terminal error. Four reports were pre-existing (two generated earlier that day and two older references); they are explicitly not new independent generations. Prompts were `keypoints.v1-insights.v3-critique.v1`; most displayed Gemini 3.7 Flash, while the older Mandarin reference displayed 3.6 Flash.
- Local config: `evidence-first.web.v7`, Gemini 3.8 Flash synthesis/windowed audio, Gemini 3.1 Flash-Lite translation, independent Claude Sonnet 5 critic via OpenRouter; no automatic retry or context enrichment. Captions first, audio when missing.
- The cohort ran from 2026-09-19T20:33:13.945Z to 2026-09-19T20:42:30.071Z. Queue elapsed times include waiting behind other cases, so they are not a controlled speed benchmark against cached LeapEdge reports.
- Neither product is ground truth. No fifty-case human dataset or human-verified badge was created. No percentage “accuracy” is asserted. Remaining Batch API, HTTPS push, and broader historical browser acceptance are not closed by this comparison.

Machine-readable summary: [live-comparison-20-20260920.json](live-comparison-20-20260920.json). Private full outputs, rendered reference text, stage costs, progress, selected settings and reproducible normalization scripts are retained under ignored `data/comparison-20260920/`.

Raw capture SHA-256: `7bf9f4c37b425ecd9d2031db9b37ca10d1ca5085beb9a6825417f70519789e0d`. Local run/call snapshot SHA-256: `8a8d11bed871b6d361eef74bb538700f41bee125146b5a496033f6d850ce6018`.
