# Operational optimisation: source-backed quality review

## Method and status

Read-only review of `data/operational-efficiency-20260920/live-sequential.json`, followed by the planned overlap arm. No new LeapEdge requests. Retained transcripts are the reference for the specific checks below; agreement with an earlier LeapEdge output is not factual verification. Model extraction and summarisation may vary between live runs, so attribution of a difference to scheduling alone requires caution.

Review complete: BEFORE delivered three of four briefs (AI failed audit); AFTER delivered all four. The targeted findings below do not support overlap promotion or a claim of unchanged output quality. This is a bounded source review, not universal factual certification.

## BEFORE: sequential baseline

| Video / targeted check | Source reference | Observed baseline output |
|---|---|---|
| Options `1WNowIoNgtg`: Palantir expiry and strikes | `s00760–s00761`, 1578.159–1579.84s: November 20 and 175 put; `s00785`, 1630.48s: 165 alternative | All nine accepted sentences omit this example. Core short-put strategy, management choices and Google positions remain. This is a coverage limitation, not successful preservation of the specific expiry/strike detail. |
| Options: inconsistent breakeven | `s00785–s00795`, 1630.48–1652.48s: 165 strike, $1.85 premium, claimed 153 breakeven, later $12 premium | No accepted sentence publishes this inconsistent arithmetic. No breakeven sentence appears among rejected rows either: this run omits the example rather than demonstrating a guard rejection. |
| Long podcast `ZfOQoh82JTo`: Dutch Bros moat and entry qualification | `s00643–s00664`, 1498.08–1553.76s: sustainable advantage questioned; purchase would require strong growth and a low starting price | Sentence s12 retains the 19× operating-cash-flow valuation but omits the moat skepticism and entry qualification. The targeted countercase is not covered in the main brief. |
| Long podcast: TransDigm risk | `s00742–s00745`, 1739.2–1756.72s (leverage); `s00756–s00764`, 1785.52–1804.96s (flight hours); `s00770–s00782`, 1817.84–1851.76s (maintenance/pricing power) | Sentence s11 explicitly retains balance-sheet leverage, global-flight-hours and maintenance-spending downside; s10 retains historical growth/margins. |
| Long podcast: Opendoor hypothetical | `s01597–s01608`, 3695.76–3722.079s: possible OpenAI ticker confusion; speaker says not short, would hypothetically cover ahead of IPO | Entire topic absent from 16 accepted sentences; coverageFindings explicitly records its omission. No false actual-short claim is published, but hypothetical/no-position context is not surfaced. |

The options critic/validator also withheld an attempted Alphabet Q2 earnings sentence because its typed financial facts did not quote the cited transcript evidence. All accepted sentences in these first two briefs are labelled unverified. Those labels are appropriate uncertainty disclosures, not proof that the claims are true.

### AI baseline failed closed

For `M1FJ5dNiBEs`, extraction completed, but its research brief failed at `research-audit` with `Incomplete research audit.` No final brief was published. The raw record retains the draft, request hashes and preflight metadata; a draft is not scored as a delivered summary. The source explicitly contains Nvidia/AMD/Credo holdings (`s00029–s00036`, 58.48–72.72s) and Credo as a favorite valuation opportunity under the 170s (`s00209–s00215`, 462–473.599s), but there is no accepted final output against which to assess their coverage in this baseline. This is a delivery failure and an enforced audit boundary, not a quality pass or evidence of an optimisation regression. Paid work remains part of experiment cost.

### Mandarin baseline: numeric and date fidelity

`SPIRV9UjNYU` completed separately in `live-sequential-mandarin.json`; all eight accepted sentences are unverified, with no rejected sentences. The brief preserves the source’s 8,400→7,900 year-end target reduction and 8,400 deferred to mid-2027 (s1; `asr-0-3–10`), unchanged 2027 EPS $425 and 19.8×→18.6× multiples (s2; `asr-0-23–29`), and BOJ September 18 hike of 25 bp to 1.25% (s4; `asr-1-36–46`). The market-move figures also match: S&P +1% to 7,600, Nasdaq +1.7%, Treasury yield 4.93% (s6; `asr-1-48–49`). However, s6 omits the explicit source date of September 17, reducing chronology clarity next to the September 18 BOJ sentence. It does not explicitly relabel those moves as September 18. The conditional AI holding thesis and earnings-deterioration invalidation risk remain in s7–s8.

The critic’s coverageFindings request additional external analyst views, but those suggestions are not themselves verified evidence or a requirement to publish secondary-source claims. This review checks fidelity to the retained Mandarin source rather than endorsing the underlying market figures.

## AFTER: overlap arm

### Options: completed with quality concerns

The overlap options brief has eleven accepted sentences and two rejected sentences. The deterministic arithmetic guard rejects s-11, which combines the correct November 20 / 175-or-165-strike example with the false `165 − 1.85 = 153` breakeven. This is a demonstrated guard rejection, unlike BEFORE, but the safe expiry/strike details are withheld with the sentence.

Accepted s-12 states that the Palantir thesis “is invalidated” below support 155 and the net breakeven, attributed to Creator. Its cited c3 quote describes a downside target and the purported protection, not an explicit creator invalidation rule. The critic’s auditReason cites the inconsistent 153 breakeven as support even though the numeric sentence was withheld. This stronger source attribution is a quality concern; a sourced scenario or explicitly labelled analyst inference would be more faithful. The run remains labelled unverified/insufficient, but those labels do not repair the attribution.

BEFORE explicitly stated substantial downside losses (s-6). AFTER emphasizes upside capping, assignment and management without an equally explicit general loss warning. QQQ/Microsoft/Nvidia coverage present in BEFORE s-9 is lost when the combined portfolio sentence is rejected for quote mismatches. Palantir’s near-term capped-upside thesis is newly included in AFTER s-10. These mixed changes do **not** establish options quality parity. They may reflect independent model variation; no causal claim that overlap itself produced the defects is made.

### Long podcast: completed with coverage and confidence concerns

The overlap brief retains TransDigm leverage and flight-hours risk in s-9, and separates the existing TLT holding from the rate forecast. Dutch Bros is absent entirely (BEFORE retained its valuation but missed the moat/entry qualification); Opendoor remains absent. The eleven-sentence output therefore does not resolve those targeted baseline coverage limitations.

LVMH s-7 is labelled `partial` factual corroboration while its own auditReason says the cited LVMH shareholder letter contains revenue/margin data, **not** the asserted 19× trailing / 17× forward / 9.3× EV-to-EBITDA multiples. The retained primary source is dated July 27, 2026 and is eligible, but eligibility is not entailment. The robustnessReason also states that only the transcript supports these numbers. The label overstates demonstrated corroboration and should remain unverified for that assertion. This is a concrete confidence-label concern absent from the all-unverified BEFORE brief, though independent live model/retrieval variation prevents attributing it uniquely to overlap.

### AI: delivered brief, no completed baseline counterpart

The overlap AI brief completes with nine accepted unverified sentences and no rejected sentences. s-1 preserves existing Nvidia/AMD/Credo/Astera/CoreWeave holdings, without converting them to new purchases. s-9 preserves Nvidia platform commentary and a quoted current price of 220 without treating it as entry. The source’s distinct Credo favorite-valuation opportunity under the 170s (`s00209–s00215`) remains absent from the main brief. The critic also identifies underdeveloped bearish countercases.

This is a delivered result where BEFORE failed audit; no completed BEFORE AI brief exists for paired semantic parity. Do not score the rejected delivery as an empty-but-correct summary.

### Mandarin: targeted fidelity retained, chronology clearer

The overlap Mandarin brief delivers eleven accepted unverified sentences with no rejected sentences. The checked numerical values remain faithful: 8,400→7,900; 2027 EPS $425; 19.8×→18.6×; BOJ +25 bp to 1.25%; S&P +1% to 7,600; Nasdaq +1.7%; Treasury yield 4.93%. Unlike BEFORE, s6 explicitly preserves the market move date of **September 17**, separately from the BOJ **September 18** decision in s3. Conditional AI holding, margin-pressure countercase, and earnings-deterioration risk remain visible. No independent corroboration is asserted. This targeted case shows preserved fidelity and improved chronology clarity.

The critic mentions an external article with September 16 values differing from the creator's September 17 figures. Different dates do not establish a contradiction; those suggestions remain audit observations and are not adopted as proof of error.

## Comparison decision

| Check | BEFORE | AFTER | Decision |
|---|---|---|---|
| Delivered final briefs | 3/4; AI audit failed closed | 4/4 | Completion improved in this sample; not semantic parity |
| Options arithmetic | Inconsistent example omitted | False breakeven explicitly rejected | Guard demonstrated; safe contract specifics still absent |
| Options balance and attribution | General substantial downside warning; portfolio positions retained | Weaker explicit loss warning; portfolio sentence rejected; unsupported explicit creator invalidation | Quality concerns unresolved |
| Dutch Bros / Opendoor coverage | Moat/entry and Opendoor missing | Dutch Bros entirely missing; Opendoor missing | No targeted coverage improvement |
| TransDigm risk | Leverage/flight-hours retained | Leverage/flight-hours retained | Targeted risk preserved |
| External confidence | Completed briefs all unverified | LVMH partial label despite explicit absence of corroboration | Confidence-label failure |
| AI Nvidia / Credo | No published baseline brief | Existing holdings retained; Credo valuation opportunity omitted | Cannot establish paired parity |
| Mandarin numeric/date fidelity | Numbers faithful; September 17 omitted | Numbers faithful; both dates explicit | Targeted improvement |

**Do not promote speculative overlap based on this experiment.** Keep it disabled while retaining the implemented experimental path and raw results. Separate the scheduling/cost result from output-quality acceptance. The sample reveals both stochastic coverage variation and a concrete confidence-label weakness; it cannot prove that overlap caused them, but equally cannot support the requested no-quality-sacrifice claim.

Before reconsidering promotion, retain comparable full-pipeline inputs/settings, explicitly test the known coverage checklist, ensure typed external corroboration is supported by the cited material rather than merely an eligible URL, and label analyst invalidation inferences distinctly from creator statements. Record failure cost and latency, including the unsuccessful baseline AI audit, rather than comparing only successful runs. Do not rerun LeapEdge or replace raw failed outcomes with later repaired outputs.
