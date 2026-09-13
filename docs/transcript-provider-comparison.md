# Transcript provider decision — 13 September 2026

Recommendation: trial Supadata Free as the first native-caption provider, with TranscriptAPI.com as the cost challenger. Do not buy an annual plan or turn on automatic credit recharge before a same-video test. This is a product-fit recommendation, not a measured reliability ranking. No paid transcript provider has yet been tested with a live key in this project.

## Current advertised costs (USD, before taxes)

| Option | Entry / allowance | Evidence and language features | Main tradeoff |
|---|---|---|---|
| Supadata | Free: 100 credits/month. Pro: $17 for 3,000 credits/month. Mega: $47 for 30,000. The $5/300-credit Basic tier is described as annual-only in the pricing footnote. | Native-only mode; timestamped original-language text; separate generation mode; asynchronous jobs. Native request: 1 credit; generation: 2 credits/minute. | An unavailable native-caption lookup (206) still costs 1 credit. Monthly credits expire. The current adapter is already wired and mock-tested. |
| TranscriptAPI.com (not the separate .io business) | 100 free trial credits. $5/month for 1,000 successful requests; monthly top-ups $2.50/1,000. | Timestamped text with start/duration, language priority, channel/search/playlist endpoints. | Lower YouTube-only cost; limited independent evidence found. Missing captions require a separate transcription fallback. |
| ScrapeCreators | 100 free credits. $47 prepaid for 25,000 credits, no expiry. | YouTube caption segments with startMs/endMs and language selection; broad social APIs. Caption endpoint: 1 credit; eligible cached responses: 0. | Higher initial outlay, useful for irregular usage or future broader social research. No generated-audio fallback is established by the transcript endpoint documentation reviewed. |
| Self-managed youtube-transcript-api | Open-source software has no API charge; proxies, compute and maintenance are separate. | Native and automatic captions, timestamps, language/track selection. | Maintainer documents cloud-IP blocking. More operational work than a hosted provider; not recommended as this Vercel app's primary source. |

Sources: [Supadata pricing](https://supadata.ai/pricing), [Supadata transcript documentation](https://github.com/supadata-ai/supadata-docs/blob/main/get-transcript.mdx), [TranscriptAPI.com pricing](https://transcriptapi.com/), [TranscriptAPI.com API](https://transcriptapi.com/docs/api/), [ScrapeCreators pricing](https://scrapecreators.com/), [ScrapeCreators transcript endpoint](https://docs.scrapecreators.com/v1/youtube/video/transcript/), [OSS maintainer documentation](https://github.com/jdepoix/youtube-transcript-api).

## Volume examples

For 1,000 native transcripts in one month, excluding retries, metadata and generation: Supadata Pro costs $17; TranscriptAPI.com monthly costs $5; ScrapeCreators requires a $47 upfront pack, of which about $1.88 of credits would be consumed. The last number is consumed credit value, not the invoice.

For 10,000 native transcripts: Supadata Mega $47; TranscriptAPI.com monthly $27.50; ScrapeCreators consumes $18.80 of its $47 prepaid pack. These are calculated examples, not measured bills.

Supadata generated transcription of a 40-minute video consumes 80 credits, versus one native-caption credit. Therefore 100 such generated videos require 8,000 credits. This is why native and generated paths need separate budgets. We do not need provider translation: preserve original captions and synthesize English in our existing model pipeline.

## User feedback and confidence

Supadata: a public evaluator reports duplicated text and weak sentence structuring; the report is marked In Review. It does not establish a population failure rate or conclusively identify native versus generated mode. Another user reports needing separate title/channel and transcript requests. Our existing YouTube metadata adapter avoids that extra Supadata lookup. [Duplication report](https://feedback.supadata.ai/p/consistent-duplicated-lines-in-transcripts), [metadata request feedback](https://feedback.supadata.ai/p/combined-requests).

ScrapeCreators: G2's seller page displayed 4.6/5 from 382 reviews at inspection. Visible users praise setup, cost and reliability. These concern the broader product, not a controlled Chinese-caption evaluation. Visible examples are seller-invited; the vendor also offers credits for honest G2 feedback. Treat these as adoption/support signals, not proof of transcript accuracy. [G2](https://www.g2.com/sellers/scrape-creators), [vendor incentive disclosure](https://scrapecreators.com/).

TranscriptAPI.com: searched independent reviews and developer feedback, but found little sufficiently detailed independent evidence to rank multilingual accuracy or long-term uptime. Much discoverable content is vendor-authored. Its low price makes it worth testing, not automatically more reliable. No star score is assigned.

The OSS maintainer's cloud-blocking warning is direct operational evidence; it explains why a locally working library may fail after deployment.

## Acceptance experiment

Use the same 20 public videos against Supadata and TranscriptAPI.com: eight Chinese-language finance, eight English finance, two long videos over one hour, two known caption-unavailable cases. Reuse existing LeapEdge comparisons where possible; this provider test does not require new LeapEdge credits. Include the current NaNa, Plain Bagel and partial-source Pronk examples.

Record each provider attempt, video duration, selected language/track, raw response hash, source kind, normalized segments, credits, latency and error. Preserve immutable originals and distinguish automatic captions from manually authored captions where the provider exposes that fact. Do not label all native captions as human-verified.

Assess retrieval rate among known-caption videos, median/p95 latency, timestamp order/overlaps, duplicated lines, missing beginning/end passages and cost per usable transcript. Manually listen to sample passages and all extracted ticker/price quotations; transcript-to-transcript agreement alone cannot establish audio accuracy. First run the same synthesis prompt/model on each retrieved source so the source variable is isolated; only then compare model/prompt changes.

Proposed gate: no silently truncated source accepted; no fabricated timing or undetected ticker/price changes in audited evidence; all expected no-caption failures correctly identified. The sample is a pilot, not a production SLA. Store per-case outcomes and reviewer observations in Evaluation Lab. Move to Supadata Pro only if the free trial passes and usage exceeds the free quota. Select TranscriptAPI.com instead if it matches the evidence checks with better cost/latency.

## Architecture fit

Vercel TypeScript worker steps call provider HTTPS endpoints; Neon stores immutable transcript snapshots, provenance, analyses and spend events. No additional Python host is needed. Keep YouTube Data API for metadata/discovery. A native-caption miss can enter the separately budgeted multimodal fallback, visibly labelled generated and subject to stronger evidence checks. Never assume a provider's generated transcript is verbatim audio truth.

The exact transcript vendor behind LeapEdge is unknown. Its developer statement and pipeline metadata do not identify a supplier; this recommendation does not claim to reproduce undisclosed infrastructure.
