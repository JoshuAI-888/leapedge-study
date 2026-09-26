# Investment readiness implementation — 27 September 2026

Status: implementation and acceptance in progress. PR #13 is not a production release. The first live candidate (`ddf1006`) failed quality acceptance; no performance or quality-parity claim follows from its execution times.

## Changes and regression evidence

- Explicit audit recovery retains original evidence, answers only missing verdicts, caps retries, locks the run and blocks uncertain paid outcomes. Changed mentions require an exact-content audit identity; supplementary non-call mentions are no longer discarded.
- Readiness accounts for the retained evidence inventory separately from execution completion and factual confidence. Empty research requires review; partial coverage and withheld statements remain visible. This is not a measurement of every material idea in the full video.
- External labels require an assertion, exact retained passage and eligible primary citation. Mixed contradiction is exposed. Unknown observation conventions cannot establish a numerical dispute. Passage matching still requires an independent semantic judgment.
- Historical and current date windows are separate; day-only publication dates cannot prove a same-day later update. Search planning is materiality-led and bounded at eight queries with explicit scope limitations.
- One additive coverage repair preserves original verdicts. Exact duplicate additions are excluded with a retained trace. Optional repair failure must not hide already audited statements. Remaining gaps and unknown charges stay visible.
- Transcript chunk planning requires every original segment unchanged. Fresh audio acquisition is being evaluated separately from frozen-caption replay.
- The comparison workspace accounts for all twenty retained cases, including failed attempts, published versus draft output, known cost and missing comparable timing. Nineteen saved LeapEdge summaries are usable; no new LeapEdge requests.

## Browser acceptance

Isolated PostgreSQL fixture database `yti_perf_readiness_ui`, local production-build server on port 3021, queue paused, no worker/provider credentials. Synthetic examples are clearly labelled. Existing live database/history were not changed.

Verified with Chrome control:

- Today shows empty and partial research before the feed; both appear in the review count and appropriate activity states. The rebuilt Lab has five Processing complete labels and zero Ready labels.
- Partial brief exposes unresolved valuation/countercase evidence, exact quote, timestamp and retained provenance; an older empty revision remains selectable.
- Legacy confidence without assertion support displays unverified/not-established while retaining historical audit explanations.
- Evidence drawer exposes exact support and contradiction passages, closes with Escape and returns keyboard focus to its originating control.
- Tactical/fundamental controls and separate current-update section remain present.
- Processing-profile dropdown saved Efficient in the fixture workspace and retained it after reload; the explanatory page describes safeguards and experimental overlap.
- The retained comparison page exposes twenty cases and failure/cost/timing boundaries with expandable reference output.
- Mobile 390×844 and 320×800 had no horizontal overflow in the inspected partial-brief/comparison views. Desktop Today screenshot inspected. These fixtures do not prove real YouTube playback.

Private screenshots: `data/readiness-20260927/desktop-today.png` and `mobile-partial-final.png`. HTTP route/profile/invalid-input checks are recorded separately in `http-smoke.json`. Real local PostgreSQL integrity and row-lock checks passed in disposable databases.

## Live evaluation and remaining release gates

See `readiness-live-quality-20260927.md` for source-backed findings. Initial candidate repeated eight original statements through coverage repair and lost a final brief when its optional supplement exceeded its limit. Both block promotion. Corrected code requires a separately identified candidate; never splice its results into the failed candidate or erase the cost of failed attempts.

The first runner preserves responses at each stage but lacks graceful drain/resume. A durable PostgreSQL controller now checkpoints stages, drains on SIGINT/SIGTERM, rejects changed-code resumes, and preserves unknown paid outcomes. Four isolated interruption scenarios passed without provider calls. Candidate B demonstrated a clean live pause with no open holds. Frozen-source replay excludes acquisition, production queue and browser display; it cannot establish fresh URL-to-result speed. Historical LeapEdge timing is not a comparable backend measurement.

Before deployment: finish corrected live evaluation, inspect long-audio results and remaining source gaps, run both full suites/typecheck/build/offline gate, verify final UI build, pass CI, and select the production database/worker topology. Then perform authenticated submission through that exact web/database/worker path, restart/recovery and visible-result verification. Preserve backups and local history. No Finradar integration or fifty-case human gold set is part of this work.

## Fresh long-audio trial

The first trial forced native audio acquisition for the original 3,920-second video, without using captions as transcription input. It completed acquisition in 271.737 seconds, with US$0.592134 settled and no open holds. Fourteen base windows and twelve gap checks produced 995 cues. Maximum remaining timestamp gap was 2.903 seconds. Speech intervals occupy 86.44% of duration; that number includes neither pauses nor independent evidence that all words were transcribed.

This trial **did not pass fidelity acceptance**. Comparison with retained captions found a recovered Dutch Bros window drifting approximately 14–20 seconds, a 47-word cue compressed into 1.961 seconds, and a duplicated/reordered phrase across a gap re-listen. A possible ownership disclosure also differs between sources. The Opendoor not-short/hypothetical-cover qualification survives, but selected agreement cannot certify the rest. The next controlled experiment uses shorter windows and rejects implausibly compressed cues without retiming them. All first-trial responses and costs remain retained in a separate database/export.

## Corrected candidate checkpoint

Candidate `68eda4d` passed both full suites (554 passing, one existing skip each), typecheck, production build, both CI verification jobs and Vercel preview. The offline promotion gate remains advisory-only. These checks do not certify investment quality.

Candidate B's first published brief removed eight duplicate additions (18 sentences became nine unique sentences), but the external verdict still labelled two differently specified Japanese yield observations as disputed even while its explanation acknowledged unknown conventions. The run was safely paused; its US$0.6686765 ledger comprises US$0.5286765 model and US$0.14 external-search cost, with no open holds. It is not a twenty-case pass. New structured comparability checks and presentation changes must pass before another separately identified candidate. Raw candidate B evidence remains intact.

The controlled 120-second ASR trial finished in304.936s for US$0.52072575. Selected duplicated/delayed Dutch Bros cues and compressed cash-flow timestamps improved. The possible ownership statement remains unresolved against captions, which are themselves not independently verified ground truth. Smaller windows therefore do not establish semantic fidelity. See `long-asr-fidelity-20260927.md` for both treatments and measurement limits.

## Final source-preservation and browser checks

Root review found that normal source publication overwrote acquisition limitations, despite the first ASR unit-level check passing. The regression was extended through the actual publish step, failed at that boundary, then passed after preserving and deduplicating prior limitations. Frozen replay now also copies source limitations/completeness without carrying old analysis forward.

A source-backed Vistra case exposed an omitted Bloom Energy core holding after an overconfident extraction was rejected. Recall selection now includes core-holding and sector-reluctance phrases and exposes prior acceptance/rejection reasons to the recall model. The original rejected extraction is unchanged; any narrower recovery must pass an independent audit. The exact retained source selects one relevant window instead of zero. This regression does not certify every material point in every source.

Chrome inspection of the new build verified both synthetic matched/unknown comparisons and the actual retained candidate-B yield discrepancy. The actual old disputed audit now displays **Potential conflict · comparison unverified**, retains its primary-source passage and original explanation, and lists unknown comparison dimensions. No candidate-B data was rewritten; the local app was read-only with its queue paused. At390×844, the evidence drawer remained within the viewport (document375px, viewport390px), and Escape returned focus to the originating evidence button. Matched synthetic support and contradictions still display their appropriate labels. Screenshots: `comparison-desktop.png`, `comparison-mobile.png`, `live-potential-conflict.png` under the private readiness data directory.

Final integrated checks after the comparability, Bloom recall and source-publication fixes: **570 passing, one existing skip, zero failures** in each of the default and PGlite suites (571 tests each). Typecheck/build pass; offline gate remains advisory-only. The four interruption/resume fixtures also pass with source-limitations preserved. An intermediate concurrent suite caught the newly added recall regression before its implementation landed; the frozen final rerun above is the release-check evidence.
