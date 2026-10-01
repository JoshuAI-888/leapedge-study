# Human listening review: intake and corrected interpretation

## Current conclusion

Nine completed, human-attested development windows have been received. The user confirmed that Chinese embedded subtitles were checked against spoken audio. This supplies useful wording evidence for quote, number, issuer and condition review.

**Timestamp accuracy remains unmeasured.** After initial inspection, the user clarified: “my timing may not be super accurate, its just when i stopped to transcribe it.” These timestamps cannot be treated as precise spoken landmarks.

The initial diagnostic comparison suggested 29–113 second discrepancies against native segment intervals. That inference is withdrawn: the supplied times are pause/transcription times, so the differences do not establish native timestamp drift, its direction or magnitude. They are retained only as unvalidated comparisons for auditability. No provider or deployment decision should be based on those differences.

## Provenance and reproducibility

Original review SHA-256: `25b8cecfea70d7afa113254b0b0faf060ab66c4a054b164293ff10f360d65e77`.
Packet SHA-256: `aba6d2f7236d405bb2814876a952c711077032f0b2a7ae4f81234a440ad9de9f`.

Packet identity, all nine window/video IDs, languages, development split, requested boundaries, nonempty text and listening attestations passed validation. Original answers are retained byte for byte in private `data/human-review-20260915`; a separate working copy preserves the original notes. No API calls or credits were consumed.

Reproduce from the app root:

```sh
python3 scripts/import-blind-review.py /Users/joshmini/Downloads/youtube-intelligence-blind-review.json
```

The script saves `docs/human-review-intake-20260915.json` with source hashes and ten selected phrase correspondences. Its `unvalidatedPauseTimeDifference` values are explicitly not timing-error measurements. Overall accuracy and timestamp accuracy remain null. Diagnostic phrases were chosen after inspection, not as a random or held-out sample.

No new external documentation was consulted for this intake. Findings derive from the supplied review, clarification and frozen local outputs. A general report of model timing problems would not validate these particular timestamps.

## What can be evaluated next

Compare matching spoken passages by content, independently of pause timestamps. Score supported numbers, negations, conditions and issuer attribution; track omissions separately. Do not slice candidate transcripts solely by the supplied times or publish whole-window WER/CER until matching passage boundaries are reconciled. For timestamp accuracy, a small separate review must mark the moment an identifiable phrase begins; the full transcription does not need to be repeated.

## Reference reconciliation

- Window 1 contains uncertain wording around “andine” and an invented alliance name; preserve uncertainty rather than silently correct.
- Window 3 has analytical notes in the timing field and a conflicting “Bitcoin” heading over a Tesla continuation. Do not treat that heading as issuer evidence.
- Several entries extend beyond the nominal requested window. With pause times unvalidated, exact audio boundaries are unknown; preserve all text as context until aligned.
- Window 7's “Marcato Libre” spelling requires an explicit normalization policy rather than automatic treatment as an acoustic error.
- Window 8 ends “next video” in the reference but “next time” in notes. Keep the reference and flag the conflicting note.
- Narrative critical-fact notes are annotations, not automatically verbatim truth. Full-window evaluator status has not been automatically promoted to `audio_verified`.

## Steps 1–2 status

Step 1 remains open: v8 source selection fixed quote-copying mechanics on three development videos; observed-yield/resistance and below-stop qualifier defects remain. Step 2 now has human-attested wording references, but no validated timestamp accuracy or full aggregate accuracy score. No new LeapEdge side-by-side or held-out result is established. Keep the experimental setting and existing providers pending the original quality gates; this intake does not justify changing that decision.
