# Long-source ASR fidelity — first candidate fails reference-readiness

The 3,920-second podcast `ZfOQoh82JTo` completed fresh native ASR under revision `ddf1006`: 271.737 seconds wall time, US$0.592134 settled model cost, 14 base windows and 12 gap checks, 995 retained segments. This boundary covers ASR acquisition only, excluding metadata lookup, extraction, research and UI. The retained report is `data/readiness-20260927/fresh-long-asr.json` (run `e05957f3-c9ed-4314-85dd-1cb23286219d`).

**Window completion is not reference accuracy.** A largest remaining gap of 2.903 seconds and 86.44% speech occupancy do not establish semantic completeness, correct words or usable timestamps. No audio was independently listened to in this review; retained caption timings are a comparator, not a human-verified ground truth.

| Selected anchor | Retained captions | New ASR | Assessment |
|---|---|---|---|
| First Dutch Bros introduction | `s00592`, 1373.52 seconds | Gap recheck `asr-25-0`, 1373.985; earlier recovery `asr-15-15`, 1391.137 | Recheck is close to captions, but both versions remain. Earlier recovery has roughly 18 seconds of cue drift and duplicates the introduction. |
| 19× operating cash flow | `s00637`, 1484.0 | `asr-15-31`, 1497.744–1499.705 | Comparable phrase is packed into a much later cue. This cue contains 44 whitespace-delimited words in only 1.961 seconds; implausible density makes the timestamp unusable. |
| Low starting price / moat qualification | `s00658–s00663`, 1540.48–1550.32 starts | `asr-5-13–asr-5-15`, 1540.76–1553.36 | Semantic qualification survives; selected cue boundaries are relatively close. This does not rescue drift elsewhere. |
| Ownership disclosure after Dutch Bros discussion | `s00664`, 1553.76: “I don't have any of these.” | `asr-5-17`, 1554.8: “I don't love, I don't love any of this.” | Material semantic disagreement: absence of ownership versus negative preference. Do not choose a winner without an independent audio check; flag the disclosure as unresolved. |
| Opendoor no-position qualification | `s01606`, 3717.28: “not short Open Door” | `asr-12-36`, 3717.48: “I'm not short Opendoor” | Selected negation is preserved. |
| Hypothetical cover before IPO | `s01607–s01608`, 3719.92–3722.079 starts | `asr-12-37`, 3719.64–3724.74 | Conditional/hypothetical phrasing survives; it must not become an actual position. `asr-12-38` also retains “psychologically short.” |

The problematic recovery clip is **1300.74–1500.08 seconds**, approximately 199 seconds long. Its later nested recheck is 1373.985–1383.99 seconds. The mismatch is therefore not a constant whole-video offset, and applying a blanket timestamp correction would falsify provenance. The ASR also contains one invalid-timestamp recovery near 2502.94–2700.08. All original responses and timestamps remain unchanged.

## Bounded corrective experiment

A separately identified **120-second base-window** trial is warranted: 33 base windows instead of 14. It should keep the same video, native model, source metadata, prompt policy and actual-price reporting, with no extraction or LeapEdge calls. Smaller windows are a hypothesis, not a demonstrated fix; long gap-recovery clips can still occur, so record their actual lengths and nested repair depth.

Prepared `scripts/verify-long-asr-controlled.mjs` requires an explicit new `--id`, new output file, `--window-seconds 120`, private local runtime environment and spend ceiling. It uses a separate `yti_perf_readiness_asr_<id>` database, exclusive session lock, and exact code/settings/window/metadata/prompt identity for resumption. Existing 300-second results/database are preserved. Suggested bounds are `--max-usd 10 --max-steps 120 --max-minutes 45`. No new paid trial was executed by this review.

A deterministic guard now rejects English cues with at least 20 words and more than 12 words per second. Rejected clips over 30 seconds are subdivided using the existing retained-paid-response path; still-implausible clips at or below 30 seconds stop with `needs_review`. No timestamps are stretched or invented. The observed cue fails; a 24-word/two-second cue and short rapid interjection pass. Two regression tests failed first and then passed; all nine windowed-ASR tests and typecheck passed.

The density guard catches compressed paragraphs, **not ordinary-speed speech shifted by 20 seconds**, lexical substitution, speaker confusion or duplicate segments. Acceptance for the new trial must separately inspect these known anchors, compare repeated phrase placement, preserve the ownership/no-position qualification, and disclose remaining disagreements. Neither occupancy nor a smaller maximum gap is sufficient for a reference-quality pass.

## Controlled 120-second candidate — completed, selected comparison

Frozen revision `68eda4d`, run `95b4bb9e-f16d-42b6-92ee-0fd8fbca6abd`, source SHA-256 `ce3a42d7348cd06949de7ed7beac853f27f6386446936e6a3a26faa51e98a30e`. The private evidence export is `data/readiness-20260927/fresh-long-asr-120.json`. No further provider calls were made for this assessment.

| Measurement | Earlier 300s trial | 120s candidate |
|---|---:|---:|
| Forced ASR wall time | 271.737s | 304.936s |
| Settled model ledger | $0.592134 | $0.52072575 |
| Stored base/recovery windows | 14 | 34 |
| Gap checks | 12 | 5 |
| Final cues | 995 | 1,085 |
| Speech occupancy | 86.442% | 86.851% |
| Largest uncovered gap | 2.903s | 2.700s |

The second run took 12.2% longer and cost 12.1% less. This is one stochastic run per treatment, and the second revision also adds density rejection; it does not isolate a causal window-size effect or establish a production latency percentile. Both boundaries exclude metadata acquisition, caption probing, extraction, synthesis, research and display. The 120s result covers cue extent 0–3920s; occupancy measures timestamp union, not semantic accuracy or completeness. `audioVerified` remains false. Thirty-three windows were initially planned; one invalid absolute-timestamp response for 1800–1920s was split, yielding 34 completed base/recovery windows. Its paid response remains retained.

### Known Dutch Bros failures

- **Delayed duplicate introduction improved in this sample.** `asr-11-14` spans 1371.7–1376 with “Okay. These last four ... Dutch Bros”; retained caption first Dutch Bros starts1373.52. The cue contains preceding words, so its start is not a word-aligned Dutch Bros timestamp. Founding location and the Grants Pass correction follow in order (`asr-11-16..20`,1377.4–1386.1). The former repeated introduction around1391s is absent; `asr-11-23` instead discusses Coupang/Stryker then returns to Grab/Dutch Bros. This resolves the selected repeated-introduction symptom, without certifying all timestamps.
- **Implausibly compressed cash-flow cue improved.** `asr-12-11`,1482.38–1489.12, retains “EV to operating cash flows is 19 times” with normal cue duration; the retained caption19x anchor starts1484. The earlier1497.744–1499.705 cue compressed43 English words. No final120s cue has at least20 English words at over12 words/second. Passing this guard cannot detect ordinary-density drift or wrong words.
- **Moat and entry condition retained.** `asr-12-23..24`,1524.26–1530.46, express difficulty identifying sustainable advantage. `asr-12-28..29`,1540.82–1553.86, preserve conditional buying, strong growth expectation, low starting price and concern about the moat. Caption low-entry anchor starts1540.48.
- **Ownership disclosure remains unresolved and is not fixed.** Retained caption `s00664`,1553.76, says “I don't have any of these.” Earlier ASR changed this to “I don't love ... any of this.” The120s cue `asr-12-30`,1554.02–1556.34, instead says “Let's, let's take a look. And I want, I want to add”. Neither ASR contains the caption's no-position statement. Independent audio review is still needed to determine the spoken wording; do not infer ownership or confidently publish its absence from either ASR.

### Opendoor qualifiers retained

`asr-31-34`,3716.466–3719.166, explicitly says “I'm not short Opendoor” (retained caption anchor3717.28). `asr-31-35` and `asr-32-0`,3719.333–3724.84, straddle the window boundary but preserve “if I was” and hypothetical covering before the IPO. `asr-32-1`,3724.84–3730.08, retains “psychologically short”. Selected negation and conditional meaning are preserved; this must remain one contextual evidence group during extraction.

### Remaining acceptance limit

The shorter-window candidate is a useful improvement for the known compressed/duplicated references, but it is **not fully reference-verified**. The material ownership discrepancy remains. Also `asr-11-26` spans1402.6–1429.6 for a relatively short passage; cue extent alone cannot demonstrate exact word-level alignment. Do not use the smaller largest gap or higher occupancy as a semantic pass. Before describing the long-source path as investment-decision ready, adjudicate the ownership passage against independently reviewed audio, check selected timing anchors across the whole recording, and test that extraction preserves adjacent-window qualifiers. No timestamps were retimed and no raw ASR content was changed during this review.

## Generated source-fidelity disclosure

Acquisition finalization now appends an idempotent source limitation to `run.output.limitations`: processed windows/cue coverage do not verify wording, timestamps or semantic completeness. Existing limitations and original ASR source remain unchanged. The warning does not assert that a specific quotation failed, and usable text still advances to synthesis. Existing research snapshot/publication plumbing carries it into source omissions, making the research readiness result partial even when every accepted evidence item is represented. This change applies when finalization runs; previously retained completed sources are not silently rewritten.

A new integration regression first failed because the warning was absent, then passed through acquisition → research snapshot → accepted published sentence plus source omissions → partial readiness. It also checks retained prior limitations, no raw source rewriting, and no duplicate warning on repeat finalization. All 10 selected acquisition/readiness tests and TypeScript checks passed. Fixtures only; no paid calls.

Follow-up adversarial check found that source publication overwrote acquisition limitations. The first fixture had skipped that real publication stage, so it did not establish end-to-end preservation. Fixed the final publisher to merge/deduplicate existing limitations. The extended regression now invokes actual source publication (and its automatic research queue), repeats publication to verify idempotence, and then publishes research. It failed on the real warning-loss assertion before the fix and passes afterward. TypeScript also passes. This correction supersedes the narrower original test claim.
