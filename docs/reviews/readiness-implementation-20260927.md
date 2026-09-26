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

The existing runner preserves responses at each stage but lacks graceful drain/resume. A new durable benchmark controller is being tested before further paid evaluation. Frozen-source replay excludes acquisition, production queue and browser display; it cannot establish fresh URL-to-result speed. Historical LeapEdge timing is not a comparable backend measurement.

Before deployment: finish corrected live evaluation, inspect long-audio results and remaining source gaps, run both full suites/typecheck/build/offline gate, verify final UI build, pass CI, and select the production database/worker topology. Then perform authenticated submission through that exact web/database/worker path, restart/recovery and visible-result verification. Preserve backups and local history. No Finradar integration or fifty-case human gold set is part of this work.

## Fresh long-audio trial

The first trial forced native audio acquisition for the original 3,920-second video, without using captions as transcription input. It completed acquisition in 271.737 seconds, with US$0.592134 settled and no open holds. Fourteen base windows and twelve gap checks produced 995 cues. Maximum remaining timestamp gap was 2.903 seconds. Speech intervals occupy 86.44% of duration; that number includes neither pauses nor independent evidence that all words were transcribed.

This trial **did not pass fidelity acceptance**. Comparison with retained captions found a recovered Dutch Bros window drifting approximately 14–20 seconds, a 47-word cue compressed into 1.961 seconds, and a duplicated/reordered phrase across a gap re-listen. A possible ownership disclosure also differs between sources. The Opendoor not-short/hypothetical-cover qualification survives, but selected agreement cannot certify the rest. The next controlled experiment uses shorter windows and rejects implausibly compressed cues without retiming them. All first-trial responses and costs remain retained in a separate database/export.
