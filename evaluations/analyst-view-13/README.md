# Analyst-view benchmark: 13 videos, 29 September 2026

A frozen set for measuring whether YouTube Intelligence is more actionable and
easier to skim than LeapEdge, without losing fidelity to the source.

| Folder | Contents |
|---|---|
| `transcripts/` | The timestamped transcript our run used, one per video. The reference for every judgement. |
| `leapedge/` | LeapEdge's existing analysis (summary, key points, trade ideas), captured on 29 Sep. |
| `ours-baseline/` | Our output before the analyst-view work: key points, calls, ticker sentiment and brief, from production runs on 29 Sep (pipeline faithful-v1, prompt v8). |
| `review/` | One AI review per video. Each lists the must-know items from the transcript, what each system captured, fidelity errors with timestamps, call issues, and 1–5 scores. |

These reviews are AI judgements against the transcript. They are not
human-verified and not ground truth. LeapEdge agreement is not accuracy.

## Baseline (average of 13 reviews, 1–5)

| | Ours | LeapEdge |
|---|---|---|
| Coverage | 4.62 | 2.92 |
| Fidelity | 3.85 | 3.00 |
| Actionability | 2.69 | 3.46 |
| Clarity | 2.31 | 4.23 |
| Overall | 3.38 | 2.92 |

Must-know items captured: ours 102 of 133, LeapEdge 45 of 133.
iN7WmJTeEQc failed on our side (fixed by PR 17), which lowers our averages.

## Corrections to the reviews

- vrTbCxUzRw4: the review counts LeapEdge's "NEWP" for New Pacific Metals as a
  wrong ticker (expected NUAG). Both are correct: NUAG is the Toronto listing and
  NEWP the NYSE American listing (SEC company_tickers_exchange.json, 29 Sep).

## Blind rounds

Judged with `judge-rubric.md` on notes prepared by `prepare-judging.ts` (A/B
per video, key kept outside the round), scored by `score-round.ts`. LeapEdge's
notes are identical in every round, so a change in its scores is judge
variation (about ±0.3).

| Round (29–30 Sep, 9 videos) | Change on our side | Ours clarity | LeapEdge clarity | Ours actionability | LeapEdge actionability | Ours overall | LeapEdge overall |
|---|---|---|---|---|---|---|---|
| Baseline (non-blind, raw output) | v8, no analyst view | 2.22 | 4.11 | 2.78 | 3.22 | 3.44 | 2.78 |
| 1 | v9 structured ideas + analyst view | 2.33 | 3.78 | 3.44 | 2.44 | 3.33 | 2.22 |
| 2A | page only: no repeats, card-free sentiment list, glance line, shorter | 2.78 | 3.78 | 3.11 | 2.78 | 3.11 | 2.11 |

## Target

Beat LeapEdge on all four dimensions, with no drop in coverage or fidelity. The
plan is in `docs/delivery/analyst-view-plan.md`.
