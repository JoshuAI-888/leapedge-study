> Earlier research snapshot. For the deployed app and latest verification, see [completion report](completion-report.md).

# LeapEdge pilot: observed quality and initial model comparison

13 September 2026. Personal research prototype; NZ$500/month ceiling. This is a small engineering pilot, not a statistically reliable model leaderboard.

## Initial recommendation

Use **Gemini 3.8 Flash as the provisional default for English synthesis**, with explicit evidence rules and deterministic validation. Keep **Gemini 3.1 Flash-Lite for inexpensive source preparation**, but do not make its short extraction the only route into the stronger model. Keep **Gemini 3.1 Pro Preview as an optional challenger/escalation**, not the automatic default. In this pilot it was slower, more expensive and less compliant with exact-quote formatting; this does not establish weaker reasoning generally.

OpenRouter successfully handled direct public YouTube URL ingestion using its Google AI Studio provider. That is sufficient for the personal prototype. Direct Gemini remains worth comparing later if native ingestion controls or provider-specific features become necessary. No evidence here establishes that an intermediary improves the underlying model's synthesis.

Google documents 3.8 Flash as generally available, with a 1M-token context and adjustable thinking; its current prices are promotional through December 2026. These capabilities make it a reasonable candidate, not a guarantee of financial-research accuracy. [Google model documentation](https://ai.google.dev/gemini-api/docs/latest-model).

## LeapEdge baseline observations

| Case | Output | Important finding |
|---|---|---|
| NaNa, Chinese market commentary | Four ideas: VOO, COIN, RDDT, QQQ | COIN entry and stop both displayed as 140; the quoted sentence conditions its advice on someone already having bought. A low-risk/high-reward entry thesis is stronger than the supporting quote establishes. |
| Daniel Pronk, English stock picks | Five long ideas: LMB, MELI, NU, MA, META | Detailed synthesis, but each large thesis has only one short supporting quote. Entry fields include valuation ratios and vague descriptions, not consistently trade prices. |
| Plain Bagel, educational methodology | Summary and key points; zero trade ideas | Passed the negative control at the product level: it did not force stock recommendations out of educational content. |

The three report pages exposed no visible timestamp links. This is an observation of these reports, not proof that timestamps never work. The educational report displayed US$0.040; the first two did not expose a comparable cost in the inspected state. The three submissions are preserved in the account for subsequent A/B checks; no additional channels were subscribed.

Report links: [NaNa](https://leapedge.app/analyses/3u24qyWjSVM__keypoints.v1-insights.v3-critique.v1), [Pronk](https://leapedge.app/analyses/wkAqHlYL7bQ__keypoints.v1-insights.v3-critique.v1), [Plain Bagel](https://leapedge.app/analyses/kXYvRR7gV2E__keypoints.v1-insights.v3-critique.v1). These may require sign-in.

Populated search exposed an additional distinction: filtering COIN returns its matching *analysis*, while the insight panel tallies all four ideas in that video. The panel labeled the non-long share “neu,” whereas Trends correctly separated the avoid share. Our prototype should define whether each filter operates on videos or claims, and preserve avoid separately from neutral.

Historical videos submitted today appeared on today's analysis timeline. The integration must preserve publication time separately from analysis time, especially if measuring a creator's historical call performance.

## Controlled Chinese-source tests

The shared source was generated once by Gemini 3.1 Flash-Lite via Google AI Studio: 77 segments, approximately 4,600 Chinese characters, 33.79 seconds, US$0.033789. Usage reported 91,596 input and 7,260 output tokens, with 91,453 input video tokens. The transcript and generated timestamps were not independently audio-verified.

Each row below is one live request. Synthesis timing/cost exclude shared transcription, key-point extraction and critique. Provider choices and thinking defaults were recorded but not held identical across models; these are observed route-level measurements, not definitive model-speed rankings.

| Prompt family | Model | Synthesis time | Synthesis cost, USD | Result |
|---|---|---:|---:|---|
| Reconstructed trade schema | Gemini 3.5 Flash | 15.06 s | 0.034833 | Three ideas; assigned COIN entry at 140 despite the source's existing-position condition |
| Same reconstructed prompt/source | Gemini 3.8 Flash | 9.29 s | 0.015537 | Four ideas; still assigned COIN entry around 140; also inferred SOXX from the semiconductor index |
| Full-source evidence schema | Gemini 3.8 Flash | 35.55 s | 0.046738 | Eleven research claims; ten passed deterministic checks; retained VOO and separated indices from ETF symbols |
| Same full-source evidence prompt/source | Gemini 3.1 Pro Preview | 69.50 s | 0.139050 | Ten research claims; six passed deterministic checks; four contained ellipses inside supposedly exact quotes |

The evidence schema deliberately extracts broader research claims, whereas the reconstructed schema asks for actionable trades. Counts between those prompt families are **not recall scores**.

The 3.8 evidence failure was a stop-level string that removed punctuation from the source; it was not evidence of an invented price. Pro's four nonexact quotes abridged source passages with ellipses; they were not demonstrated fabricated statements. Both failure types are repairable, but neither should be labeled verbatim without correction. Some price-role checks also failed where the quoted evidence did not contain the requested level text.

A separate extraction → synthesis → per-claim critique run accepted four claims and handled COIN's existing-position condition correctly. It omitted VOO's explicit allocation preference. This exposed a coverage problem in the cheap extraction stage even though the later checks passed. Direct full-source synthesis recovered that preference.

The full-source drafts have not yet received exhaustive human semantic grading. Deterministic acceptance means source-span and field checks passed, not that every implication is correct. Model critic acceptance in the separate pipeline is likewise not ground truth.

## What the experiment supports

- **Prompt/schema design matters substantially.** A newer model repeated the same entry-inference error under the reconstructed prompt.
- **A stronger model can still damage quotations.** Exact span validation is needed even for Pro output.
- **Precision and coverage must both be tested.** Dropping unsupported claims helps precision, but a short preliminary extraction can omit important supported material.
- **The expensive multimodal source should be reused.** Text-only synthesis was much smaller than the source-video input and can be compared without repeatedly ingesting the video.
- **RAG is not required for this single-video case.** Full transcript context is inexpensive enough; archive retrieval is a later, separate problem.

## English smoke test and source-coverage failure

Flash-Lite generated 204 English transcript segments in 182.41 seconds for US$0.081755. It returned a normal completion and an apparent closing sentence, but its final timestamp was 1,800 seconds and it contained no Meta section. A direct-video 3.8 Flash audit reported approximately 2,424 seconds total duration and a Meta section beginning around 1,947 seconds, consistent with LeapEdge's inclusion of Meta. This audit is additional model evidence, not a human-verified duration or transcription.

On the incomplete transcript, direct 3.8 synthesis took 13.68 seconds and US$0.026475. It returned five research claims (market context plus four companies), missed Meta, and wrongly put a historical $114 Limbach price into the entry field. All five claims passed the simple text checks. A separate semantic critique rejected the $114 field in 3.57 seconds for US$0.014249, correctly identifying its historical role.

The direct-video audit cost US$0.171651 and took 28.49 seconds. Its output requirement was a short structural survey, so that time must not be compared with the 182-second full-transcription request as if the tasks were identical.

This test makes coverage gating a prerequisite: retrieve independent duration metadata, check missing intervals, inventory all company sections, and transcribe long sources in bounded sections or acquire reliable timed captions. A successful response and plausible ending do not establish complete source coverage. The harness now includes a tested time-coverage helper; obtaining independent duration and automatically repairing missing sections remain integration work.

## Remaining verification

No audio-grounded gold dataset, calibrated conviction score, chart-reading evaluation, caption-provider reliability test, direct-Gemini latency comparison, p95 latency measurement or repeat-run stability study has been completed. No claim of overall accuracy superiority is justified by these few runs.

Before folding this into the destination app, add a small human-labeled set with source timestamps, test at least Chinese and English across multiple creators, repair citation-format failures without silently changing content, and measure unsupported claims plus omitted critical claims. Keep exact model/prompt/source versions in every record.

## Deliverable status

Measured API cost for this pilot: **US$0.6456595**, across 16 successful requests. Three LeapEdge submissions were used. Twelve local regression tests passed. Credentials and full generated transcripts are excluded from the distributable source package. The harness is a portable experiment, not a deployed app.
