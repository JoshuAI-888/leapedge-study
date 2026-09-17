# YouTube Intelligence versus LeapEdge: fresh browser comparison

Tested 15 September 2026 UTC / 15–16 September Auckland. Production browser workflows; three new videos from three new channels; one separately identified retry. This is a product benchmark, not a trading recommendation or certified accuracy study.

## Decision

**Do not declare parity or promote an experimental prompt on this evidence.** Our portal produced broader English coverage and completed a long video that LeapEdge could not transcribe. LeapEdge was substantially more effective on the Chinese case and offers a more concise report-to-saved-trade workflow. Our evidence and experiment visibility are stronger, but failed embedded playback, duplicated instruments, lost numerical qualifiers, an empty “Completed” report, and a sharing scope mismatch are material defects.

No model or prompt improvement was deployed during this comparison. The production experiment cap was increased from US$15 to US$20 within the approved experiment allowance, then the same deployment artifact was redeployed. The long retry is not silently substituted for its failed first attempt.

## Method and reproducibility

The protocol was recorded in `docs/browser-parity-protocol-20260915.md`. Video IDs were checked against previous local test records before output inspection. Each URL was entered through the visible browser form in both products. We inspected rendered reports, expanded audit details, tested selected controls and captured screenshots. Browser automation used the already authenticated Chrome session; report generation was not invoked through hidden APIs.

The portal used `evidence-first.web.v5`, synthesis model displayed as `google/gemini-3.8-flash`, and critic `google/gemini-3.5-flash`. Native Google experimental ingestion, long-window experiments, scheduled channel analysis and digest generation were off. This round therefore does **not** establish native Google ingestion performance. LeapEdge displayed `keypoints.v1-insights.v3-critique.v1`, Gemini 3.1 Flash-Lite and 3.7 Flash among its stages. Model names and prompt versions are observations of product metadata, not independently verified backend routing or recovered prompt text.

Timing starts at the browser submit action and ends at the first captured terminal state/report. These are **observed upper bounds**, including polling and manual refresh delays. They are not server durations, controlled simultaneous races, or p50/p95 estimates. LeapEdge displayed Live OFFLINE and remained queued in one tab after its completed report appeared in Trends; refreshing exposed the result. This prevents interpreting the four-second short-video difference as a speed advantage.

Files:

- `scripts/browser-parity.py`: timestamped visible DOM captures and actions.
- `scripts/browser-parity-screenshot.py`: selected Chrome window screenshots; capture window ID is session specific.
- `scripts/summarize-browser-parity.py`: reproduces timing and displayed usage from retained captures.
- `docs/browser-parity-results-20260915.json`: machine-readable results.
- `data/browser-parity-20260915/`: private raw captures and inspected images; excluded from delivery checkout.
- `data/browser-parity-20260915/report.html`: private side-by-side visual appendix.

The Mac briefly locked. Black, overlapping-window and wrong-tab captures were rejected. Only subsequently inspected correct-window captures appear in the visual appendix. Screenshots contain signed-in account information and remain local. Offscreen content used deferred rendering; cards were scrolled into view before judging their content. One overly broad DOM capture is retained privately but is not used as visible UI evidence.

## Matched cases and outcomes

| Case | Source | LeapEdge | YouTube Intelligence |
|---|---|---|---|
| English, 12:10 | Miles Talks Finance, `hYAnAtEqzI0`: “This Stock Will Change (Early Investors) Lives…” | 131s; one SOFI idea | 127s; three ideas: SoFi, Celsius, Zillow |
| English, 38:35 | Financial Education, `Q6G8pXFkKLk`: “4 Stocks to Go ALL IN September 2026” | 148s to stopped: too long to transcribe in one pass | First attempt: 194s to budget failure. Separate retry after cap increase: 264s, four cards covering three distinct companies |
| Chinese, 11:58 | 阳光财经, `9nb3fp76Rz0`: “美股：基本上定了。【2026-09-11】” | 63s; Dell, SOX and SPY ideas | 167s; Completed but zero accepted ideas; four claims and six key points rejected |

Three LeapEdge credits were consumed. The last observed balance was 13, down from 16, before Auckland midnight. No post-reset balance is asserted. LeapEdge was not retried on the long case. The portal retry may benefit from retained source work; treat it as a recovery observation rather than a cold first attempt.

### Short English: broader coverage, less concise presentation

Both reports described the SoFi accumulation thesis, a P/E around 22 and $50/$100 future price scenarios. LeapEdge offered one high-conviction long idea, nine key points and a compact summary. The portal also retained Celsius and Zillow accumulation views with multiple source segments and timestamp controls. This is **additional extracted coverage**, not proof that every additional claim is correct: fresh audio has not been independently scored.

The portal’s English quotation and English translation were repeated verbatim, increasing report length without adding information. Saving SoFi through Research succeeded, but a missing explicit ticker caused the saved card to say “Research idea · Miles Talks Finance” instead of retaining the known instrument name. LeapEdge provided Save to Trade directly in the report; our report required navigation to Research/Search before saving.

LeapEdge’s rendered supporting quotation had no timestamp button or timestamped citation link in the inspected report. Our citation controls were more specific, but selecting a timestamp opened an embedded player that returned **YouTube error 153**, so the verification workflow failed in practice. A source link still existed; embedded playback must not be marked passed merely because the iframe URL received the correct start offset.

### Long English: successful recovery with synthesis defects

LeapEdge explicitly stopped because the video was too long to transcribe in one pass. This is evidence against assuming LeapEdge’s advertised multimodal fallback is universally reliable; it does not identify the provider or exact internal cause.

Our first run acquired timed English source material but exhausted the local experiment cap during analysis. Its failure UI incorrectly offered “Drop unverified point and continue audit,” which is inappropriate for a budget error. After the US$5 cap increase, an unchanged production retry completed.

The retry produced separate “SoFi Technologies” and “SoFi” cards, plus Netflix and “Win Resorts,” while the thesis referred to Wynn. Four cards therefore represent only three distinct companies. Celsius was rejected because its ticker was not explicit in the selected evidence. Five key points were accepted and one descriptive key point rejected for lacking an action, suggesting actionability criteria are being applied too broadly to contextual key points.

Numerical conditions were preserved in prose but flattened in structured fields: “under $20” became entry `$20`, and “under $100” became entry `$100`. These are not equivalent execution conditions. Quotes fragmented into tiny separately cited pieces, including single words, also made verification unnecessarily difficult. Netflix’s bear/bull 2030 prices were presented as scenarios in key points rather than an immediate entry; preserve that distinction in subsequent changes.

The result establishes a useful recovery capability in this example, **not accuracy or general long-video reliability parity**.

### Chinese: a clear functional failure in our portal

LeapEdge produced a summary, ten key points and three ideas. Our portal produced no accepted research despite marking the run Completed. All four draft claims and six key points failed quotation matching. The source timing coverage label showed 100%, but rejected quotations lacked usable aligned timestamps. Source coverage is not quotation accuracy or successful extraction.

Investigate original-language normalization, source segment identities, span selection and alignment before changing thresholds. The browser evidence alone does not establish the precise root cause. Relaxing quotation validation to make this case pass would undermine the intended trust model.

LeapEdge also contained an internal inconsistency: a semiconductor key point referenced a 200-day moving average, while its card referenced a semiannual moving average. It left some entry/expiry fields in Chinese despite otherwise English synthesis. Its Dell quotation attributed a price target to RBC; whether the creator endorsed an actionable trade needs source review. Our rejected Dell draft suggested avoidance, a direction disagreement that remains **unverified** and must not be scored as either product being right.

The source player reported closed captions unavailable for the Chinese and short English examples, while our ingestion still obtained timed text. This proves a discrepancy between browser availability and provider availability, not that the videos are universally captionless. No fresh case in this round is established as ground-truth “no caption track anywhere.”

## Frontend and workflow comparison

| Journey step | LeapEdge observation | Portal observation | Assessment / expected improvement |
|---|---|---|---|
| 1. Submit and progress | Simple URL entry; queued/transcribing states; Live OFFLINE and refresh needed | Prominent URL entry and stage indicators; generic queued/running; detailed failures can be verbose | Partial on both. Poll reliably; show last update and actionable failure category |
| 2. Read report | Compact full-page summary and idea cards; green/olive visual hierarchy | Blue/white library with a narrow report drawer and long evidence lists | LeapEdge easier to scan. Use summary-first layout, concise cards and expandable source details |
| 3. Verify evidence | Supporting quotes observed, no timestamp navigation found on these cards | Multiple timestamps, original text and audit reasons; embedded player error 153 | Our intended capability is stronger, but playback fails. Provide working timestamped external fallback |
| 4. Save an idea | Save to Trade inside report; saved SOFI confirmed | Save through Search succeeded; known name lost when ticker absent | Add report-level Save; preserve instrument name independently of ticker |
| 5. Find research | Ticker, conviction, direction, channel, window and title search; Enter required; genuine empty result tested | Live text filters and additional direction states; clear/empty behavior tested | Both usable. Reduce empty chart scaffolding; make search semantics explicit |
| 6. Follow channel | Report-level follow; Miles channel confirmed; future analysis behavior described | URL follow and Discover latest; 50 uploads discovered; auto-analysis explicitly off | Both manual workflows work. Portal offers controls but needs more steps |
| 7. Browse trends | Compact scatter plot with overlapping points and network-oriented context | Collection-based counts, bars, directions and history | Different scopes. Do not imply collection statistics are market-wide consensus; deduplicate aliases |
| 8. Creator performance | New channel showed one stream/call; no SPY comparison observed there | Eligibility and adjusted-price/SPY methodology exposed | No new return calculation or mature cohort validated in this round |
| 9. Settings and experiments | Account, timezone, theme, email, billing and sharing settings | Prompts, models, costs, provider tests, human review and improvement history | Portal is more inspectable; long raw lists need stronger information hierarchy |
| 10. Share and revoke | Share publication not exercised | Temporary share tested with explicit approval; scope mismatch; revoke confirmed 404 | Fails exact-payload expectation even though revocation worked |

Design inspection was desktop at approximately 1583px browser width. This is not a responsive/mobile, keyboard accessibility or WCAG audit. Theme switching, archive lifecycle, saved-item notes/status editing, JSON download integrity and all possible error scenarios were not exhaustively retested. Billing/account management remains intentionally out of prototype scope. Daily email acceptance remains deferred to Finradar as requested. Do not treat visible controls as end-to-end passes.

### Sharing incident and resolution

The user authorized a temporary public link for only the new SoFi research result. The visible filter showed that result when Share was selected, but the newly completed long run expanded the server-side selection: the link contained three SoFi claims across two videos. This is a preview/publish selection race or scope mismatch; the precise implementation mechanism has not been proven by code tracing.

The link was created at 12:02:49 UTC, revoked at approximately 12:05:03, and confirmed to return 404 at 12:05:43. No link token is included here. Initial automation attempts targeted offscreen content; scrolling the share control into view allowed revocation. That automation issue is distinct from the application scope defect.

Required design: show an explicit immutable selection preview with claim IDs/count and video count; create the share from that exact snapshot; keep revoke visible and confirm revoked state. Add a regression test where a matching analysis finishes between preview and publication.

## Cost, latency and architecture implications

| Portal report | Displayed model cost/reservation, USD | Model stages | Total model tokens | Summed model-stage time |
|---|---:|---:|---:|---:|
| Short English | 0.1880115 | 6 | 123,743 | 24.142s |
| Chinese, no accepted evidence | 0.075081 | 2 | 65,532 | 30.058s |
| Long retry | 0.9270435 | 12 | 594,365 | 101.339s |

These sum to about US$1.1901 for the three listed terminal reports and **exclude the failed first long attempt**, which incurred additional model work. They are not an all-in provider/hosting invoice. The failed attempt’s visible rounded model rows total approximately US$0.413. Retained source cost, infrastructure cost and reservation reconciliation are not fully established by these UI captures.

LeapEdge displayed $0.030 for each successful short report and $0.100 for the long failure, with 87.7k and 81.8k tokens on the successful English and Chinese reports. Its displayed currency, cost coverage and accounting semantics were not established, so an exact cost ratio is inappropriate.

The long portal run used two synthesis stages and ten critique stages, repeatedly consuming roughly 52k input tokens in individual critiques. That is a concrete candidate for cost/latency reduction through bounded evidence context or batched auditing. Test omission, condition and citation regressions before changing it. Summed model time is substantially below browser elapsed time; investigate queue, ingestion and polling separately rather than blaming the model for the entire wait.

Keep the existing provider fallback architecture during diagnosis. This browser round does not justify removing transcript providers, switching native Google on by default, or adding a vector database. Source quality, localized evidence alignment and orchestration are more immediate constraints than infrastructure replacement.

## Known issue research and proposed remedies

Google’s official [YouTube IFrame API reference](https://developers.google.com/youtube/iframe_api_reference) defines error 153 as a request lacking an HTTP Referer or equivalent API-client identification. The [required minimum functionality documentation](https://developers.google.com/youtube/terms/required-minimum-functionality) describes identification requirements for embedded players. This is consistent with the observed playback failure, but the app’s actual request headers were not inspected. Investigate inherited Referrer-Policy, embedding context and browser restrictions; test a suitable documented referrer policy and a timestamped YouTube fallback. A policy change is a proposed remedy, not a verified fix.

No provider incident or documentation finding has been established as the cause of our Chinese quotation rejection, duplicate aliases, dropped price operators or share scope expansion. These should remain application hypotheses, with reproducible cases attached, rather than being attributed to an external service. LeapEdge’s long-video explanation is a product error message, not proof of its exact backend implementation.

## Ranked next work and acceptance criteria

1. **Chinese quotation alignment and honest outcome state.** Diagnose all ten rejected items against the retained source; preserve original-language text and source IDs. Empty accepted output must say analysis could not establish evidence, not a normal ready report. Gate on fresh Mandarin/Cantonese and English regressions without increasing unsupported acceptance.
2. **Trading semantics and entity identity.** Preserve comparator/operator, level role, execution condition and timeframe; canonicalize aliases while retaining spoken names. This long run must produce one SoFi instrument view, keep “under” conditions, and distinguish scenarios from entries.
3. **Verification UX.** Fix or provide a working fallback for error 153; merge adjacent short quotations into readable spans; suppress redundant English translations. Test actual audio playback at a known landmark, not merely iframe URL construction.
4. **Exact share payload.** Freeze explicit selected IDs at preview and publication; reproduce concurrent completion; confirm unrelated/new matching results cannot enter a share. Retest revocation separately.
5. **Independent source scoring and larger speed sample.** Review fresh blind windows for quotes, numbers, tickers, negations, conditions, omissions and timing. Record omissions separately from precision. Then repeat first attempts across lengths/languages with fixed polling, separating cached/retry runs and provider failures. The earlier nine human-reviewed windows do not supply timestamp ground truth for these new videos.
6. **Reduce avoidable work only after quality gates.** Benchmark localized or batched critique context, stage scheduling and budget preflight. An insufficient-budget case should fail clearly before expensive partial work where feasible, with retained work reusable for recovery.

## Confidence and completion boundary

High confidence in the observed UI states, rendered output differences, retained costs, failed playback and revoked sharing link. Moderate confidence that the short English experience is broadly comparable and that long-video recovery is useful. Low confidence in general accuracy parity, multilingual reliability, universal captionless support or production latency distributions from three cases.

The requested fresh browser comparison and report are complete. The whole product is **not** complete: the defects above remain open, automatic channel-to-report scheduling was not run in this round, mature forward creator performance requires elapsed time, and source-grounded accuracy needs additional review. No percentage of parity or promise of 100% success is justified by these results.
