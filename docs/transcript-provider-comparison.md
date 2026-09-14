# Transcript provider comparison and captionless test

14 September 2026. Six selected videos, three rounds, 54 live requests from the same local client to cloud APIs. Four had retrievable captions; two were previously unavailable through both managed providers and the free local library. This is repeatability evidence in one short window, not an uptime study. No local response cache was used; upstream caches can still affect timing.

| Native provider | Successful responses | Median successful request | Range | Captionless success |
|---|---:|---:|---:|---:|
| TranscriptAPI | 12/18 | 0.768 sec | 0.382–1.683 sec | 0/6 |
| Tapline | 12/18 | 1.205 sec | 0.385–4.400 sec | 0/6 |
| Supadata | 12/18 | 2.882 sec | 2.415–24.412 sec | 0/6 |

The success column means a nonempty, structurally valid transcript. **One Supadata success returned `lang=yue` despite requesting `zh-CN`; only 11/12 successes matched requested primary-language metadata.** The next two responses returned `zh`. This is a language-selection consistency failure, not a transport error. The production adapter now withholds mismatched fresh and cached tracks. Tapline does not echo a returned language in this response schema; its requested language alone is not proof of original-language selection.

On the AI-debt video and short control, all providers returned the same text after whitespace normalization. Tapline and TranscriptAPI also agreed on the Mandarin video. On the long Pronk video, text differed: Supadata differed from TranscriptAPI by three commas, while Tapline had many punctuation/case differences and some wording differences. These comparisons do not establish which transcript matches audio. No audio accuracy score has been asserted.

Tapline with `language=orig` initially returned 404 for the long English video. The documented explicit `en` request succeeded. This separate initial probe is not included in the 54-request table. Production integration must not rely on that orig behavior without further validation.

## LeapEdge captionless comparison

Video: `CMjt6f4eVdA`, a Chinese Alpha-channel weekly review. All three native APIs returned unavailable in all three rounds. LeapEdge completed an analysis with four ideas, nine key points, 88.6k displayed tokens, and $0.030 displayed cost. This used one new LeapEdge analysis allowance.

LeapEdge therefore demonstrated report availability where our native providers did not. Its public fallback description is consistent with multimodal video transcription, but the UI does not prove which internal source path ran. No quote timestamp links appeared in the inspected accessibility tree, and the visible first two quote cards had no timestamp controls. Apple's 258–260 resistance zone appeared as an Entry despite the displayed quote describing resistance. Preserve this discrepancy in evaluations; do not reproduce it to improve superficial parity.

Reference: https://leapedge.app/analyses/CMjt6f4eVdA__keypoints.v1-insights.v3-critique.v1

## Costs and integration decision

Tapline documents two credits per subtitle request, zero credits for failed requests, and 500 free starter credits. The table used at most 24 successful-request credits. Its Starter tier is $49/month, or $39/month equivalent billed annually, for 100,000 monthly credits. Supadata's test allowance accounting is at most 18 credits and TranscriptAPI's 12; these are documented request-cost bounds, not reconciled invoices.

Keep TranscriptAPI first. Tapline is a plausible additional native-caption backup, but adds no captionless coverage in this test. It is tested through a standalone harness and has an SRT normalizer; it is **not enabled in the production fallback chain**. Supadata remains the configured backup, now with language guards. Its generated-media issue is still with engineering.

Sources: https://tapline.sh/youtube-transcript-api and https://api.tapline.sh/openapi.json

## BibiGPT

BibiGPT documents `GET /api/v1/getSubtitle`, original-language selection, timestamped subtitle arrays, and async summary tasks for longer videos. For integration, use raw subtitles, not polished-text/article endpoints. A normalizer now rejects preview-only, wrong-video and malformed-timestamp payloads, but it has only controlled-response tests until API access is supplied.

The web attempt reached a login requirement. An API key was requested; no account was created and no subscription purchased. Documentation warns that API behavior may differ from the website. Its machine-readable pricing page is dated May 2026 and lists API credit packs starting at $20 for 2,000 credits, but does not define a reliable credit-to-transcription-minute conversion there. Confirm live account pricing and API quota before purchase. Website membership is not sufficient evidence of funded API access.

Sources: https://bibigpt.co/developers , https://docs.bibigpt.co/api-reference/introduction , https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail , https://bibigpt.co/pricing.md

## Reproduction

`node --env-file=.env scripts/benchmark-transcript-providers.mjs` makes at most 18 requests per configured provider across three rounds and saves raw data under ignored `data/provider-benchmark`. It skips already recorded attempts and interrupted/uncertain submissions. No automatic top-up or new subscription is included. Start a separate explicitly named campaign when a later time window is needed; do not silently overwrite earlier evidence.

Structured results: `three-provider-repeat-results.json`. Audio review protocol: `transcript-accuracy-benchmark.md`. Settings retains provider comparisons separately from audio-reference accuracy and synthesis A/B results.
