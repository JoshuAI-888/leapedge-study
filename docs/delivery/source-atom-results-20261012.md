# Source atom optimisation: same-source results

> Historical results. The user subsequently requested a full rollback, including
> removal of the experimental setting. See
> [rollback and performance direction](source-atom-rollback-20261012.md).

Implemented in order: source atom metadata in existing extraction/recall calls;
lossless exact deduplication; compact independent audit context. PR43 merged at
`fc4a6d19263af5676620c6c07f64efc97c9680a4`. The first live request exposed a
native Google schema incompatibility before generation, with zero recorded
spend. PR44 fixed literal `const`/`additionalProperties` serialization and
merged at `f4358ba9171528e29430baf0afd851b7501d549c`. Corrected production
deployment `dpl_6n7hMMLSowuFtSQ5mbhqpWoL9yGa` was verified READY on the
canonical alias before paid runs resumed.

**Decision at the end of this cohort: keep the option off by default.** The three new audited workflows were slower
and more expensive than their retained native baselines. Original Google
Gemini3.8Flash extraction and OpenRouter Sonnet5 critique/context defaults remain
unchanged; Jev/Claude checks were retained in the frozen comparison treatment.

| Video | Baseline processing seconds → new | Baseline recorded model USD → new | Paid calls |
|---|---:|---:|---:|
| T-Mobile `_mEvVWGfmjU` |113.162 →179.754|0.289194250 →0.440141870|16 →19|
| Planet Labs `Mepjkm_0ns4` |78.401 →105.759|0.178604706 →0.237301912|13 →15|
| Palantir `fSx-Ho8mi18` |132.529 →211.050|0.395305709 →0.671428044|20 →25|

Mean active processing rose from 108.031 to 165.521 seconds (+53.2%). Three-run
recorded cost rose from $0.863104665 to $1.348871826 (+56.3%). All six root/child
runs completed; 59 new paid calls settled, one rejected request released at $0,
with no unknown/open holds. The current $5 allocation totals $4.481129197 including
earlier $3.132257371. No new LeapEdge credits or source-acquisition calls.

Timing spans first successful stage claim through the final automatic brief
checkpoint, excluding source acquisition and pre-start queue wait. T-Mobile's
zero-cost pre-generation rejection and correction/release wait remain in raw
records: its all-attempt claimed span is 754.061 seconds, versus 179.754 seconds
after correction. These are one sequential observation per video against earlier
baselines, not population latency. Source bytes/hash/title/as-of and models
match; the release also includes prior publication fixes. It does not isolate
each optimisation's causal effect or establish LeapEdge backend equivalence.
Native ledger prices are catalogue-based, not independently verified invoices.

The reduced context did not reduce total work. Initial synthesis evidence
encoding saved 827 bytes for T-Mobile; the other two chose raw evidence because
encoding was larger. Larger generated inventories and coverage repairs raised
total measured input tokens from 514,109 to 697,143 and output from 71,265 to 118,442
(including Jev input). All three needed independently audited changed repairs.
Offline replay on identical earlier drafts reduced audit-context bytes by
0.5–5.9%; that is an encoding result, not a live speed win.

Published quality is mixed. T-Mobile now separates AT&T debt from Comcast and
retains fringe economics, but loses uncertain Delta-report and rerating-doubt
qualifications. Planet recovers105m/1–6m guidance and cancellation risk, while
still missing the distinction between EBITDA and net profit, AI willingness to pay,
and valuation qualification. Palantir preserves 41/33 cents, Karp's clicks/tokens/chats
attribution, owned long and monitoring thresholds, but loses 157%-persistence/
130%-sensitivity, annual guidance and position-sizing detail; raw 2905 and the
149/849/24% contradiction need adjacent ambiguity labels.

The fixed 25-composite/70-component/77-caption-anchor review yields complete/
partial/absent counts of 0/7/0, 1/6/0, 4/7/0, versus retained baseline 0/6/1, 2/4/1,
4/6/1. These are completeness judgments by the unblinded implementation author,
not independent human verification, financial truth, accuracy or a quality rank.
All new briefs still carry partial-readiness diagnostics.

Desktop and 390px reading checks used retained live output in a paused isolated
database; the setting's save/reload and default-off behavior passed. Primary
heading and thesis/scenario/countercase/next-check hierarchy survive. Duplicate
timestamp controls and the low phone position of the concise brief remain
usability opportunities. This does not measure real-user reading time.

## Proposed next experiment, not performed

- Separate lossless compaction from generated atom metadata and compare identical
  accepted drafts/requests first; keep defaults and all independent checks.
- Compact repair-generation context as well as critic context: dictionary-encode
  repeated evidence/draft structures and reconstruct them exactly before use.
- Replace duplicated literal atom prose with validated source references where
  the same information is already carried by copied quotes; retain every actor,
  period, condition and opposing clause.
- Track qualifier obligations through extraction, rejection, repair and final
  publication. Accept source-backed clauses separately so rejecting one number
  does not discard valid neighboring facts. Validate retention/cancellation/
  personal-stance cases before another paid cohort.
- Put the concise brief earlier on phones and group identical playback targets
  while keeping full evidence provenance available.

Full private evidence is in
`../audits/leapedge-20261012/source-atoms/` relative to the repository root: raw exports, prompts/responses,
timings, ledgers, reading projections, locked judgments, reconciliation and
screenshots. The corrected source passed both full local suites (1231 total,
1230 pass,zero fail,one existing skip), typecheck/build/offline advisory
diagnostic, plus exact-head push/PR CI 38169074835/38169078446. No dependency or
migration changes. No Supabase login was needed.
