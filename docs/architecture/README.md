# YouTube Intelligence — target architecture decision record

**15 September 2026 · Proposed target, not a deployment record.**

[16:9 PNG](youtube-intelligence-target-architecture.png) · [Editable SVG](youtube-intelligence-target-architecture.svg) · [Reproduction script](render_target.py) · [Detailed findings white paper](../archive/native-google-findings-white-paper.md)

The diagram is 2560 × 1440. Reproduce it with `python3 docs/architecture/render_target.py` from the project root; Pillow and the macOS Arial fonts are required. The renderer makes no network requests. No routing, subscription or production configuration was changed to create these artifacts.

## Provider decisions

| API / dependency | Target decision | Reason and condition |
|---|---|---|
| YouTube Data API | Keep | Discover uploads, resolve channel/video metadata and duration. A metadata API key cannot download arbitrary creators' captions; the official caption-download endpoint requires authorization and permission to edit the video. |
| TranscriptAPI | Keep as first caption route | Historical successful median 768ms; retrieved 4/6 videos in the repeated comparison. Fastest of those three providers on this corpus. |
| Supadata native captions | Keep as second caption route | Historical median 2881.5ms; same 4/6 coverage. Provides a second vendor route, but demonstrated no additional missing-caption coverage. Shared YouTube dependencies limit independence. |
| Native Google Gemini API | Pilot for caption-unavailable videos and bounded re-extraction | Successful structural results on a prior no-caption case and a 40-minute source. A separate full-video result failed timestamp bounds. Accuracy and hosted repeatability gates remain open. Do not replace the caption providers yet. |
| OpenRouter text synthesis | Keep provisionally | Retains existing text synthesis/model comparison access. Native text was exercised, but that is not yet a justified migration of all text routing. |
| OpenRouter media fallback | Retire conditionally | Native media ingestion could replace this role after promotion. This is not removal of OpenRouter as a whole. |
| Tapline | Exclude from active target routing | Same 4/6 coverage, 1204.5ms successful median; no demonstrated advantage over the selected primary. Preserve test artifacts and adapter rather than canceling an account. |
| BibiGPT | Exclude from active target routing | Both prior no-caption cases returned HTTP200 with empty subtitles and reported usage debit. Mandarin output shortened seven QQQ occurrences to Q relative to retained captions. No independent audio reference establishes which transcript is correct. |
| Supadata generated ASR | Hold outside the target path | Tested 403 responses, including a control, leave the intended fallback unproven. Support/access resolution and a fresh test are needed before reconsideration. This proposed hold is not a claim that the existing production flag was changed. |
| YouTube.js / free caption scraping | Remove from target hot path | No proven cloud reliability advantage in retained tests. Archive developer utilities; do not depend on an extra production scraper service. |
| FMP | Keep | Adjusted price data and SPY comparisons; eventually reuse Finradar's resolver/cache. Benchmark definitions and cohort dates must be explicit. |
| Alpha Vantage | Reserve; not a second active dependency | No necessity established alongside FMP. This is a simplification decision, not a failed-provider test result. |
| Resend | Keep | Digest delivery. API submission acceptance does not establish inbox receipt; receipt/live webhook acceptance remains a release check. |
| Vercel + Neon | Keep | UI/API and staged job orchestration; durable job state, source/evidence records, prompt versions and budgets. Validate hosted retries and recovery before production promotion. |
| Vector database / RAG | Not required for this source-to-report pipeline | Direct source evidence is sufficient for single-video extraction. Cross-video semantic retrieval can be added later if a concrete use case warrants it. |

## What the tests mean

The [provider campaign](../archive/three-provider-repeat-results.json) had 54 requests: six videos × three repetitions × three providers. All three retrieved four videos. These timings are historical client-to-cloud measurements, not a simultaneous comparison with native Google or a Vercel SLA.

Native Google produced a structurally valid transcript for the 12:59 Alpha video where earlier routes could not retrieve captions. The 40:23 test also passed structure. The 31:59 macro result contained an out-of-bounds timestamp and was rejected; two overlapping 90-second follow-up windows passed. Those windows motivate localized repair experiments; they do not demonstrate an accurate repaired full transcript.

On a frozen Alpha source, single-segment quote guidance changed text-audit acceptance from 1/9 to 8/9 items. This is a one-source development comparison, not a held-out quality score. Review still found a condition added to an accepted claim and views missing from the candidate. Neither critic acceptance nor schema validity constitutes independent audio verification.

The native campaign recorded 25 generation requests and NZ$37.86 in held reservations. Known usage estimates totalled US$0.604299, but 15 attempts had unknown cost. That number is **not** the campaign's total bill and cannot justify a per-video savings claim. The overall product budget remains NZ$500/month.

## Simplification and promotion gates

If native ingestion passes, replace the **media-acquisition fallback role**, reduce redundant provider attempts and avoid maintaining a separate download/transcription service for the tested public-URL path. Keep identity, timestamp, quote, ticker and semantic checks; keep failure artifacts, cost accounting and rollback. Independent evidence does not become unnecessary when a provider is removed.

Before promotion:

1. Score the retained audio-review windows independently, including tickers, numbers, negations, timestamp errors and omitted claims.
2. Repeat on held-out long, multilingual and caption-unavailable videos; compare fresh LeapEdge outputs where credits allow. Record failure and omission rates, not only successful examples.
3. Demonstrate Vercel execution, bounded retries, unknown-outcome handling, reservations and rollback. Do not duplicate potentially billable timed-out requests blindly.
4. Retest downstream synthesis after source changes. Validate quote boundaries and conditional trade language separately from exact string matches.
5. Complete channel-to-digest delivery and performance-cohort checks. A forward 90-day result requires elapsed observation time; it cannot be manufactured by a short release test.

## LeapEdge comparison and limits

LeapEdge's developer describes Firebase/GCP and extraction → synthesis → critique. Captured UI metadata exposes version labels and model names, not exact prompts, source-provider contracts or its current internal routing. Its transcript API remains unknown.

The retained Alpha report showed four ideas and nine key points, with one entry appearing to represent resistance in the supporting text. That is a concrete output concern, not evidence that our complete product is superior. Our design prioritizes inspectable original-language sources, failed attempts, prompt versions and A/B history. End-to-end accuracy parity, reliability superiority and lower total cost remain unproven.

## Documentation basis

- [Google video understanding](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding): structured YouTube media input and clipping; support does not guarantee exhaustive transcription.
- [Google structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): schema support and application validation boundaries.
- [YouTube captions.download](https://developers.google.com/youtube/v3/docs/captions/download): permission requirements.
- [Research source register](../archive/native-google-research-sources.json): official references and related issue reports used in the white paper.

This diagram uses those retained research findings; it does not represent a new live provider benchmark.
