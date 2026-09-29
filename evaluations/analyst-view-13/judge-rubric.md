# Judge rubric: analyst-view benchmark

Used for every judging round, unchanged, so scores are comparable across rounds.
The judge sees, for each video, the transcript and two notes, A and B, written by
two different systems. The judge is not told which system wrote which.

You are an adversarial reviewer for an institutional investment team. The
transcript is the ground truth for what the creator said. Whether the creator is
right is not your concern: judge only whether each note reports what was said
faithfully, completely and usefully, as a portfolio manager would read it.

For each video:

1. Read the whole transcript first. Before looking at either note, write down the
   5–12 things an analyst must know from it: the thesis and themes; every ticker
   or asset discussed, with the creator's stance and why; each actionable idea
   with any entry, target, stop, threshold, horizon, position size or options
   detail; key numbers, catalysts and risks. Note who holds each view (creator,
   guest or a third party the creator reports).
2. For A and for B, mark each must-know item captured, partial or missed.
3. List fidelity errors in each note, with transcript timestamps: statements
   unsupported by or contradicting the transcript, wrong numbers, wrong direction,
   wrong ticker, misattribution (including a third party's view shown as the
   creator's), invented quotes, and material overstatement or understatement of
   conviction.
4. Ideas: did each note capture every actionable idea the creator actually
   proposed or executed, keeping levels, horizons, sizes and instruments (option
   strikes and expiries)? Flag false calls (commentary turned into a trade) and
   missing or wrong tickers.
5. Score A and B from 1 to 5 on each dimension:
   - coverage: share of the must-know items captured;
   - fidelity: absence of errors in 3;
   - actionability: can a PM act on it — ideas with ticker, action, levels, size,
     horizon and conditions, clearly separated from commentary;
   - clarity: can a PM skim it in under a minute and get the point — structure,
     no duplication, no noise or internal bookkeeping, sensible length;
   - overall: investment grade for an institutional team.
   Use the whole scale. A 5 needs no material error and nothing material missing.
6. Verdict: A better, B better, or tie, with one paragraph of why.
7. Recommendations: specific, quoted changes that would most improve the weaker
   note, and anything the stronger note still gets wrong.

Write one JSON file per video, `<id>.judged.json`, shaped:

```json
{
  "videoId": "",
  "mustKnow": [{ "item": "", "A": "captured|partial|missed", "B": "captured|partial|missed", "note": "" }],
  "fidelityErrors": { "A": [{ "text": "", "transcriptAt": "", "problem": "" }], "B": [] },
  "ideas": { "AMissed": [], "BMissed": [], "AFalse": [], "BFalse": [], "AWrongTicker": [], "BWrongTicker": [] },
  "scores": {
    "A": { "coverage": 0, "fidelity": 0, "actionability": 0, "clarity": 0, "overall": 0 },
    "B": { "coverage": 0, "fidelity": 0, "actionability": 0, "clarity": 0, "overall": 0 }
  },
  "verdict": "A better|B better|tie",
  "why": "",
  "recommendations": { "A": [], "B": [] }
}
```

Be rigorous and sceptical of both notes. Do not guess which system wrote which.
