# Live production sample after performance build

Four videos from the original twenty were submitted through the installed Mac production implementation (`7b609a2`, merged in PR #10), using the real `yti_live` database and live providers. Fresh metadata/caption ingestion was used; no retained transcript was injected. Automatic intake stayed paused; a bounded runner admitted only this cohort and its child briefs, without running the scheduler. Concurrency was temporarily three and restored to one afterward. Each run's snapshot enabled windowed ASR when captions were missing; global ASR settings stayed unchanged.

## Result: blocked by depleted Gemini prepayment credits

The native Gemini route returned HTTP 402. A read-only model-catalogue request succeeded; one minimal generation diagnostic confirmed `RESOURCE_EXHAUSTED` and the message: “Your prepayment credits are depleted.” The provider points to https://ai.studio/projects for project/billing management. No generation succeeded, no critic or external search ran, and no new summaries can be compared to retained LeapEdge results. These failed timings are not evidence of improved end-to-end speed.

| Original case | Video | Ingestion outcome | Terminal stage | Submission → failure |
| --- | --- | --- | --- | ---: |
| 1 | Mandarin AI-market / SPIRV9UjNYU | Captions unavailable; ASR generation blocked | asr-source | 7.13 s |
| 5 | AI compute / M1FJ5dNiBEs | Captions retained; 99.96% timestamp coverage | synthesis | 6.09 s |
| 11 | 65-minute bank podcast / ZfOQoh82JTo | Captions retained; 99.87% timestamp coverage | synthesis | 14.51 s |
| 18 | Palantir options / 1WNowIoNgtg | Captions retained; 100.00% rounded timestamp coverage | synthesis | 8.44 s |

Coverage describes caption time spans, not audio-verified accuracy. Unlike the historical failure, the long podcast now has an available caption response, so this attempt did not exercise long-form ASR recovery. That provider-availability difference must not be credited to the performance code.

## Cost and recovery

Sixteen generation attempts were rejected; all reservations were released. Recorded model ledger cost is $0, with no outstanding holds. The extra eight-output-token-capped diagnostic also returned HTTP402 without a generated response. Three successful TranscriptAPI responses used three credits; one unavailable response used zero recorded credits. No cash top-up was purchased; no invoice-level cost is inferred. No new LeapEdge calls were made.

All failed runs and successful transcripts remain in the production database. Once the provider account is funded, recover from those retained sources/checkpoints through audited recovery runs rather than paying for the same caption retrieval again. The Mandarin case still requires ASR. The independent audit must remain enabled; changing to a different model merely to obtain a passing run would change the benchmark.

The sample also exposed an operational improvement: bounded chunk workers drain/start the remaining chunk tasks after a fatal account error, resulting in several distinct rejected requests. They do not retry the same paid request, but account-level HTTP402 should stop admission of untouched chunks while retaining completed siblings. This is a new finding, not an implemented fix in this test.

Machine-readable run IDs and stage timings: [production-sample-20260920.json](production-sample-20260920.json). Full source/provider records are retained in ignored `data/prod-sample-20260920` and the production database. Browser visual inspection was unavailable while the Mac was locked.
