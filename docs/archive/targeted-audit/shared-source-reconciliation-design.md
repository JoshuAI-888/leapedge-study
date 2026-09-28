# Proposed shared source reconciliation — not implemented

The active 40-arm experiment remains unchanged. This proposal is a separate shared-input improvement, not permission to alter one benchmark arm or to claim the known source omissions fixed.

## Observed failure boundary

Research snapshots contain accepted claims, key points and checked non-call mentions. They do not contain the full transcript. A qualifier absent from that inventory cannot reliably be recovered by further statement or inventory coverage audits.

The retained sources already used `source-recall.full-chronological.v2`:

| Retained source | Windows processed | Windows assessed | Recorded result |
|---|---:|---:|---|
| Long video `ZfOQoh82JTo` | 46/46 | 14/46 | incomplete |
| IDIQ video `DuIyF_34ReI` | 9/9 | 2/9 | incomplete |

These fields come from the source runs in `candidate-h-session-1.json` and `candidate-h-remaining8-session-2.json`. Completing a recall model call is not equivalent to complete proposition reconciliation. The IDIQ qualification at `s00072`–`s00085` is absent from the retained research inventory despite that earlier full chronological review.

## Smallest proposed shared architecture

1. Freeze the original transcript, source hash, chronological window plan, existing inventory and reconciliation policy version before research begins. Preserve the existing path and historical inputs.
2. Reuse an upstream window reconciliation only when its original cues match exactly and its proposition accounting passed the required policy. Missing, malformed, unresolved or incompletely accounted windows remain explicitly unresolved.
3. Perform a bounded shared enrichment pass for unresolved windows. Review original cue text and the relevant retained propositions for material conditions, quantities, actors, ownership, negation, countercases and causal qualifications. Every cue receives a proposition or a valid nonfinancial exclusion; do not exclude material context because it lacks a trade stance.
4. Persist proposed neutral qualifier records as exact source pointers with original quotes and hashes. These are source-context candidates, not restored accepted trade calls. Do not inherit human verification or acceptance from a rejected upstream candidate. Existing independent research audits must evaluate any published statement based on them.
5. Merge deterministically without overwriting original evidence IDs or outputs; preserve proposed, rejected, malformed and unresolved records. Freeze the same enriched input once for both research arms.
6. Use assigned original windows for bounded coverage checks. Do not attach the entire transcript to every audit request. Preserve enough surrounding context to bind conditions and actor changes; cross-window references require explicit dependencies and conservative reassessment.

The protocol must distinguish input enrichment from targeted coverage reuse. A new matched baseline is required after enrichment. It cannot be inserted into the current benchmark and still be attributed solely to the audit-path change.

## Costs and verification gates

No numerical cost or latency saving is promised. The longest retained example has 32 windows not currently assessed; enrichment could add substantial work. Record shared preprocessing calls, tokens, failures, duration and costs separately, and allocate them identically when presenting full end-to-end arm totals. Never hide common costs to make a pipeline look cheap.

Before paid work: tests must cover exact cue accounting, input-hash mismatch, malformed pointers, cross-window conditions, actor switches, numerical ambiguity, prior rejected candidates, unresolved exclusions, duplicate evidence IDs and crash/replay without duplicate charges. Original source bytes must remain untouched.

Before production: source-backed review must demonstrate recovery of the IDIQ qualification and known ownership/conditional/numerical defects in final accepted prose and readiness, with no new material omissions in independent source windows. A shared source record or model `accounted` status cannot certify semantic completeness. Caption/audio ambiguities remain uncertainties until separately verified. Cloud execution, UX acceptance and user-approved promotion remain independent gates.

Status: design only. No source-context production change, provider call, enrichment run or benchmark-input mutation performed.
