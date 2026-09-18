# BibiGPT authenticated test — 15 September 2026 (NZ)

The supplied temporary key authenticated successfully. `/api/v1/me` reported a free account with 150 minutes before testing. The key remains in ignored local environment storage; it is not deployed or committed.

The captionless Alpha video `CMjt6f4eVdA` returned HTTP 200 and `success: true` after 80.738 seconds, but `subtitlesArray` was empty, `rawLang` was empty and `contentText` was empty. The response reported `costDuration: 778` and reduced `remainingTime` from 9000 to 8222 seconds. Our parser rejects it. This is a semantic failure hidden behind an HTTP success response, with a reported allowance debit. LeapEdge previously produced four ideas and nine key points for this video, so BibiGPT has not closed that availability gap.

The English control `SHMPiWbbR6E` returned 63 subtitle segments in 21.646 seconds. Its whitespace-normalized text matched the retained TranscriptAPI response. This establishes text agreement, not independent audio accuracy.

The Mandarin control `3u24qyWjSVM` returned 278 segments in 21.092 seconds. Compared with the retained TranscriptAPI text, the only whitespace-normalized differences were seven deletions of `QQ`: all seven `QQQ` references became `Q`. A repeat returned identical subtitle arrays in 9.735 seconds and reported another 1005-second debit. This discrepancy is reproducible in this short test window. Without an audio reference, we cannot determine the exact spoken wording or attribute the transformation to a particular internal BibiGPT step. It is nevertheless material for ticker extraction and should not be silently corrected.

Valid responses also omitted language metadata (`rawLang: ""`). The normalizer now preserves unknown language rather than inventing it from the requested language. Empty subtitles, preview sources and invalid timing remain rejected. Structural validity does not establish completeness or correctness.

Do not enable BibiGPT in the production fallback chain on this evidence. Confirm captionless behavior, empty-result billing and repeated-character handling with the provider before further paid tests. The second captionless video `J25UuUqHT3Y` likewise returned success with zero subtitles after 130.756 seconds and reported a 1919-second debit. All five requests finished with HTTP responses; there are no unresolved client timeouts. Total reported debit: 4872 seconds (81.2 minutes), leaving 4128 seconds (68.8 minutes). No additional OpenRouter or LeapEdge calls were used.

These requests occurred later than the three-provider comparison; response times are not a simultaneous benchmark. Provider caching may influence repeat timing.

Sources: [BibiGPT integration](https://bibigpt.co/user/integration), [subtitle endpoint](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail), [account allowance endpoint](https://docs.bibigpt.co/api-reference/agent/get-current-account-plan-and-remaining-minutes).
