# Audio-grounded transcript accuracy

14 September 2026. Retrieval success, transcription accuracy and synthesis support are separate measurements. Provider agreement is not an independent reference: both APIs can return the same YouTube caption track.

## Reproducible scoring

`npm run eval:transcripts -- path/to/cases.json` writes a versioned local artifact under ignored `data/evaluations`. Add `--save` with the normal environment loaded to persist the result in Settings. Identical inputs use the same content-derived record ID. Each result retains provider, source hash, development/held-out split and scoring version. Raw source excerpts and private reviewer details should stay in ignored files.

The schema is exported from `evaluations/transcript-accuracy.ts`. Each case defines a bounded audio window, an independently transcribed reference, review identity/date, and matching candidate excerpts. Unverified references or unreviewed excerpt boundaries produce `pending_audio_review` with null metrics. Merely changing the attestation field does not establish that review happened.

English uses word edit distance; Chinese uses character edit distance without simplified/traditional conversion. Case is normalized; decimal points, percent and sign distinctions are retained. Rates are errors divided by reference units and can exceed 100% with insertions. This is a versioned task-specific normalization, not a claim of comparability to every published WER/CER benchmark.

Critical financial details use occurrence-specific manual annotations: issuer, ticker, number, negation, condition and attribution. The reviewer must record what the candidate actually says at that occurrence. Exact annotation agreement is deliberately stricter than semantic equivalence. Missing annotations count as failures. Automated word scores alone cannot decide whether a price or condition was materially altered.

Timestamp anchors refer to the same reviewed spoken occurrence. Missing candidate anchors remain unmeasured; the denominator includes them. Report within-two-seconds count, measured count and mean absolute error together. Caption-span coverage is not speech completeness: silence and music must not be scored as omitted speech.

## Review protocol

1. Listen to the selected audio without reading any candidate transcript. Transcribe exact words; mark unresolved speech and exclude ambiguous snippets from scored ground truth until resolved.
2. Verify at least an early, middle and late passage for each long video. Include English, Mandarin, mixed English/Chinese company names and financial numbers. Add accessible captionless examples when the source blocker is resolved.
3. Independently review the reference, source window boundaries, critical facts and matching timestamp anchors. Record reviewer/date; do not use an LLM-generated transcript as a human reference.
4. Freeze held-out cases before editing prompts. Existing LeapEdge development references are not held out. Run the same reviewed excerpt through each candidate with matching boundaries.
5. Report each language and source type separately. Never extrapolate excerpt-level accuracy to an entire video or general uptime.

The initial packet contains early/middle/late windows from existing cached English and Chinese videos. These are **pending review**, with no accuracy scores asserted. The packet is private at `work/completion-next/audio-cases.json`.

## Proposed release gates

- Zero unsupported published trading claims on the reviewed acceptance set; count misses separately.
- Zero unflagged errors in reviewed critical financial facts. Missing or uncertain facts must be withheld or visibly unresolved.
- At least 95% of reviewed citation anchors within two seconds; report missing anchors in the denominator.
- Evaluate useful key-point recall against independently annotated audio/source expectations and LeapEdge separately. Do not use an arbitrary target count or promote a prompt solely on development examples.

These are acceptance targets, not achieved results. A reference reviewer is still required; the current environment does not supply independently heard human reference transcripts.
