# Candidate C first-case gate — do not resume unchanged

Revision `9589119`, paused after one of20 cases. First Mandarin brief `badc47bb-0089-4c2f-a810-e9f83b9add49` publishes11 sentences. This is a selected source-fidelity assessment, not full external factual verification. The other19 cases remain unassessed. No provider or LeapEdge calls were made for this review.

**Blocker: published typed financial facts contain a100x unit error.** In `s4`, the actual and expected Fed hikes each have `value:25, unit:percentage_points`, quoting respectively “美联储已经加息了25个基点” and “最新点阵图对应年内还要加息25个基点啊”. In `s5`, the BOJ hike has the same typed quantity while quoting “加息25个基点”. All quotes say25 basis points, equal to0.25 percentage points. Sentence prose is correct, but the published structured facts are wrong and can mislead numeric comparisons/calculations. Preserve raw drafts; withhold invalid typed facts or validate an explicit basis-point representation rather than silently replacing source text. Unchanged candidate C should remain paused.

| Selected check | Candidate A | Candidate B | Candidate C |
|---|---|---|---|
| Exact duplicate text | Eight repeated pairs | No repeated published text in inspected brief |11 sentences,11 unique texts |
| 4.93% vs H.15 4.94% label | Disputed without established convention | Disputed despite unresolved convention note |Unverified/insufficient; observationBasis unknown, evidence retained |
| Future yen appreciation/hiking pace |Not certified in initial selected check |Explicitly identified as missing |s11 restores both monitoring conditions |
| Source limitations |Retained candidate history |Published warnings |Three source warnings retained |
| Typed basis-point quantities |Not assessed here |Not assessed here |Three100x unit errors; blocker |

The yield passage remains in `externalSupport` with a model relationship of potential contradiction and explicit unknown observation basis. The final sentence label/audit reason correctly withhold the external verification claim. The original model audit remains in the run trace; no claim of a verified1bp contradiction is justified. Exact-dupe success does not exclude semantic redundancy. Monitoring restoration matches retained k6/k7 source context and does not verify real-world macro claims.

Settled cost for the paused one-case candidate is **$0.306253 = $0.236253 model + $0.07 external search**, with no open holds. Do not add this cumulative snapshot to itself on resume. Runtime starts with frozen transcript/metadata and excludes acquisition and UI display. Historical LeapEdge timing is unavailable for a comparable ratio. Companion JSON retains snapshot hash, exact bad facts, source limitations and yield comparability fields. Candidate remains a failed first-case gate pending a versioned fix and new controlled evaluation.

## Additional numeric sweep and runtime boundary

Reviewed all 18 final structured facts against their retained source quotes. No additional material value/scale/currency mismatch was found beyond the three basis-point errors. The1.5 million JPY example preserves scale; repayment11111 USD is a rounded source example. FX rates150 and135 preserve JPY/USD orientation in prose/labels, while typed unit `other` is less specific. The19.8x/18.6x and425 EPS/index-target rounding is source-stated; do not create a contradiction merely from approximate targets. No computed calculation is published; s2 carries an explicit withheld-calculation omission. This selected numeric sweep does not independently verify actual market facts.

Controller session wall time was 110.718s, and recorded stage execution summed to 110.436s. Wall time includes admission/checkpoint/controller overhead and stop handling. Both begin with a frozen retained transcript and end at the first-case checkpoint; neither measures fresh ingestion or insight rendering in the UI. The other19 cases are specifically **not started**, not failed or implicitly passed.
