# Managed caption integration and cloud validation

14 September 2026. Both user-provided keys authenticated successfully and are configured as encrypted, server-only production variables in the existing standalone Vercel project. No account or billing settings were changed.

## Delivered

- Supadata and TranscriptAPI native-caption adapters, original source text retained with language, timing and provider provenance.
- Durable request records, provider-specific caches, concurrent-submission protection, asynchronous job polling and per-provider campaign credit caps.
- Shared Supadata request pacing and up to three bounded retries after explicit temporary HTTP errors. Ambiguous transport timeouts remain held for review rather than resubmitted.
- Explicitly enabled Supadata generation as a fallback; automatic spoken-language detection preserves the input-language goal.
- Exact caption-anchor repair: a misplaced cue ID can be corrected only when the unchanged quote appears uniquely and contiguously. Altered words, ambiguous matches and unsupported tickers remain rejected.
- Diagnostic history and three comparison snapshots saved in Settings/Evaluation. Source and model failures remain visible.

## Cloud retrieval evidence

A 50-video corpus spans the five previously followed/discovered channels plus existing reference videos. The initial pass made 55 requests: both providers on five references and TranscriptAPI on all 50. Follow-up provider fallback and retry probes resulted in 90 app diagnostic invocations total; cached/permanent-failure checks are included in that number, so it is not a count of billable provider requests.

After bounded retries, 40/50 distinct videos returned native captions. The ten remaining videos also returned `TranscriptsDisabled` through the free local Python library. This is one observed window on a selected corpus, not a statistical uptime guarantee. Returned captions were not all independently audio-verified. Initial probe labels used `unavailable` for any no-source result; retained HTTP codes distinguish rate limits/timeouts from missing tracks, and the final diagnostic API exposes those states separately.

The first concurrent Supadata probes hit free-tier 429s. TranscriptAPI retrieved the long reference during that failure. Shared rate pacing was implemented, tested and deployed; the subsequent long-video Supadata request succeeded. TranscriptAPI temporary failures on NaNa and two other Chinese videos recovered on bounded retries; Supadata also recovered those captions during the cross-provider checks.

## Synthesis findings

| Comparison | Before | After |
|---|---|---|
| Long-video unchanged Python-caption draft, exact-anchor re-audit | 0 accepted claims / 3 key points | 4 claims / 6 key points |
| AI-debt unchanged caption draft, exact-anchor re-audit | 0 claims / 3 key points | 0 claims / 5 key points |
| Fresh Supadata long-video source, same v5 prompt and models | Earlier Gemini source was incomplete or failed | 4 claims / 5 key points |

These counts do not establish LeapEdge parity. The long draft duplicates Nubank across synthesis chunks. Some company theses lack exact ticker evidence; a fresh Mastercard claim was rejected for adding an unsupported high-margin characterization. The AI-debt output still trails LeapEdge's nine-key-point reference. Re-audits retain the original quote strings and preserve all earlier failures. No benchmark candidate silently replaced the selected production collection.

## Captionless fallback limitation

Supadata returned HTTP 403 `forbidden` for both the macro reference and a short control video. The control's detailed response said the video was age-restricted and required authentication; this is the provider's report, not independently established YouTube policy classification. The native track for that short control was retrievable. Consequently existing-caption access and media access for new ASR are separate capabilities.

The first full cloud macro run reached the Gemini fallback, but its generated transcript failed schema validation for duplicate segment IDs or reversed timing. That failed result is retained. A stronger fallback run is separately recorded; consult its final result in the evaluation history. The integration is operational, but no claim of 100% source availability or superior synthesis accuracy is made.

## Validation

38 unit/integration tests passed, including failover, concurrent deduplication, uncertain spend retention, async polling, credit limits, explicit temporary-failure retry, and exact-quote corruption/ambiguity rejection. Type checking and Vercel production builds passed. Seven hosted checks passed for private access, database reads, settings, saved-idea transitions, share/revocation, dispatcher authentication and cross-origin rejection.

Zero new LeapEdge analysis credits were used; saved signed-in reference reports were reused. Detailed provider attempt metadata is in `managed-caption-cloud-results.json`; raw transcripts and diagnostic responses remain private. Further work: captionless media acquisition, exact issuer/ticker evidence association, duplicate idea consolidation and audio-grounded quality evaluation.
