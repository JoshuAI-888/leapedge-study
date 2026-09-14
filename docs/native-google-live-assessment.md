# Native Google ingestion: first funded decision

15 September 2026. Funding is working. Native ingestion is feasible, including a video for which our earlier caption-provider tests returned no transcript. **Do not retire TranscriptAPI or Supadata yet.** The native adapter remains isolated from production routing.

## What the live tests establish

| Case | Duration | Native result | Latency | Remaining concern |
|---|---:|---|---:|---|
| English control SHMPiWbbR6E | 2:45 | 39 structurally valid segments | 12.5s | Audio accuracy unverified |
| Captionless Alpha CMjt6f4eVdA | 12:59 | 110 structurally valid segments | 31.0s | Audio accuracy and exact numerical claims unverified |
| Captionless macro J25UuUqHT3Y | 31:59 | 199 segments; rejected | 89.2s | One segment ends at 2016.14s, beyond the 1919s video |
| English interval, 60–120s | 1:00 interval | 15 structurally valid segments | 8.0s | Original-timeline coordinates observed for this request only |
| Long benchmark wkAqHlYL7bQ | 40:23 | 348 structurally valid segments | 80.2s | Full speech recall and timestamps unverified |
| Mandarin ticker benchmark 3u24qyWjSVM | 16:45 | 51 structurally valid segments | 42.6s | Different text from earlier captions; requires audio adjudication |

All successful requests reported VIDEO modality tokens. This is media-usage evidence, not proof of complete audio decoding. Schema, timing bounds and timeline coverage do not establish transcription accuracy. No generated source was promoted to a canonical report.

The macro failure is explicit, retained and excluded from accepted sources. Its suspect segment runs from 1198.14 to 2016.14 seconds. Do not silently change that end time to a plausible value: verify the local audio window first.

The offset request retained original source coordinates. Matching passages occur near 61–66 seconds in both full and clipped outputs. However, the two outputs spell a coined alliance name differently. This is useful evidence of transcription variability even when both results pass structural checks.

## Comparison with existing providers and LeapEdge

Earlier TranscriptAPI, Supadata and Tapline tests failed to retrieve both captionless cases. BibiGPT also returned empty subtitles for both despite HTTP200/success flags. Google returned nonempty text for both and structurally valid evidence for Alpha. The prior provider calls were on an earlier date, so this is an availability observation, not a contemporaneous randomized comparison.

Where captions exist, earlier median retrieval times were 0.768s for TranscriptAPI, 1.205s for Tapline and 2.882s for Supadata. Native Google took much longer on these benchmark videos. It has not established a speed advantage over caption retrieval.

The Mandarin Google output preserves QQQ in relevant passages; BibiGPT previously shortened seven QQQ occurrences to Q relative to TranscriptAPI. This does not prove Google is correct on all symbols. Google returned 4456 whitespace-normalized characters versus 3862 in earlier captions. On the long video it returned 31222 versus 34663. These differences require alignment and audio review, not a conclusion that more text is better or less text proves omission. Segment counts are not comparable accuracy scores.

The Alpha transcript includes Bitcoin 106,000, Tesla 500/550 and Apple 258–260 discussion, consistent with the subjects in the captured LeapEdge report. This is only a preliminary source-content comparison. We have not yet run unchanged v5 synthesis on these native sources or established claim-level parity with LeapEdge. LeapEdge's displayed $0.030 covered a different pipeline/model configuration; comparing it directly with native ingestion alone would be misleading.

## Implementation and cost

Ten model requests are journaled, including the original unfunded HTTP429, two HTTP400 configuration diagnostics and a deliberately plaintext diagnostic. The generated responseJsonSchema configuration was rejected; a simpler native responseSchema succeeded. The public runner now uses this working transport, connected cancellation and no SDK retries. Ten controlled tests and TypeScript checking pass.

Known estimated cost across requests with complete usage fields is **US$0.501678**. This is not the total billed cost: five attempts have unknown estimates, including Alpha and Mandarin where thinking-token usage was omitted. All ten conservative reservations remain held: **NZ$25 of the NZ$50 campaign**. No new LeapEdge credits were consumed. Request estimates use the recorded model rates; invoice reconciliation remains pending.

Raw responses stay private. Public JSON records every attempt's configuration, latency, token breakdown, source hash, validation status and cost uncertainty. Results are also stored as the native Google caption benchmark in Settings.

## Architecture decision and next gates

The supported next candidate is **caption retrieval first, native Google as an experimental captionless fallback**. No production provider is removed at this stage. Google-only has not met the accuracy, repeatability or cost-per-accepted-report gates.

1. Score original audio windows for all five videos, emphasizing numbers, negations, ticker spellings, the macro invalid interval and beginning/middle/end coverage. Provider agreement is supporting evidence, not ground truth.
2. Test bounded overlapping extraction on the macro failure and long-video difficult windows. Keep original errors; compare absolute timestamps and duplicate/omitted speech. Do not auto-repair with guessed times.
3. Run unchanged v5 synthesis over accepted native sources and compare with saved provider/LeapEdge outputs. Score missed/unsupported claims, entry versus resistance, existing holdings versus new trades, original-language quotes and English synthesis.
4. Repeat acquisition across time, then run hosted shadow jobs with measured costs and explicit failure statuses. Apply the approved plan's observation gates before removal.

If those gates pass, native Google can replace the OpenRouter media-acquisition path and reduce the need for paid ASR/transcript fallback services. Removing every caption provider is a separate decision: captions may remain cheaper and faster. Vercel, Neon, durable jobs, YouTube metadata, source validation, synthesis/audit, Resend and the product workflows remain necessary. Native ingestion does not remove evidence verification.
