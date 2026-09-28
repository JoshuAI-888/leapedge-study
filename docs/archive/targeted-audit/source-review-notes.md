# Source review preparation

`source-review-manifest.json` prepares source-backed review for the same 20-video cohort. It does not mark either pipeline accepted. It contains 18 focused checks from retained source-quality findings and 60 deterministic source sentinels, with exact segment IDs, indexes, timestamps, original text and hashes. All final-output reviews remain pending.

The selected defects cover relationship direction, conditional versus observed margins, IDIQ access versus funded orders, caption ambiguity, annual growth versus CAGR, speaker ownership disclosures, strike/delta/premium/expiry roles, and actor-specific execution qualifiers. Review both prose and typed facts; a missing typed field cannot excuse incorrect prose. Inspect the final stored brief and visible readiness, not solely an intermediate critic response.

Of the 60 sentinel windows, 58 fall outside the retained inventory; the remaining two use the fallback outside known-defect anchors only. The sentinel windows preferentially fall outside the retained evidence inventory and outside the selected known-defect anchors. Their contents are not presumed material or accurate. They are not claimed historically unseen: there is no exhaustive log of what earlier reviewers read. Review surrounding segments when a selected window splits a thought. These samples are independent of either candidate's output; they do not establish full-transcript recall.

## Important input boundaries

- All 20 selected source runs have completed execution and retained transcripts. That does not verify caption correctness, segment completeness, language accuracy or timestamp alignment.
- The long video retains 1,692 transcript segments, of which 693 lie outside the selected research inventory's quoted ranges. Case 12 has 414 of 1,335 outside; case 18 has 460 of 1,030 outside. These are segment accounting counts, **not material omission counts**. Background chatter and repeated text may be outside evidence ranges.
- Case 14's IDIQ qualifier is a confirmed example of a material source qualification missing from the historical inventory. A pipeline that merely reuses that inventory cannot claim this defect fixed by improving coverage audits. Freeze identical full transcript access for both arms; either accept that this research-only experiment cannot pass the wider quality gate, or separately fix extraction and establish a new matched baseline.
- The long video's retained LeapEdge capture is not a usable completed report. Source-based checks remain applicable, but no fabricated LeapEdge comparison or processing duration is permitted.
- Moving-average, compacted price literals and option-caption ambiguity require explicit uncertainty unless original audio/chart review supplies evidence. This manifest does not perform those checks or rewrite source text.
- Source artifact references point to ignored private snapshots. Cloud execution must receive the exact hashed files, or freeze a replacement manifest explicitly before paid calls. A missing snapshot is not permission to substitute different sources silently.
- Freeze both arms' source transcript, evidence inventory, source metadata, external-source text and dates, cutoffs, model settings and implementation. Keep acquisition/source costs distinct from fresh research costs. Imported historical attempts must not be counted as new charges.

## Review procedure

For each paired final output, record the statement IDs, actual text, source anchors, coverage state and a supported/incorrect/incomplete/ambiguous determination with explanation. Preserve failed and missing outputs in the denominator. Ask whether each material condition survives, whether one actor's qualifier transferred to another, and whether a new supplement affects an uncited evidence item despite an `unaffected` model declaration.

Withholding an incorrect statement prevents publication of that error but does not recover the underlying information. An unresolved material gap must remain visible and must not be scored as complete coverage. Comparator agreement is not factual verification, and the removed 50-human-case requirement is not reinstated.

Validation command:

```sh
node --experimental-strip-types --test tests/targeted-source-review-manifest.test.ts
```

The structural test runs without private snapshots. The source-integrity test explicitly skips when private files are absent; it must pass with zero skips before cloud evaluation. At preparation both tests passed, including verification of every retained quote against its exact source segments.
