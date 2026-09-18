# Gate debt register

**Opened:** 18 September 2026, by `docs/review/delivery-review-20260918.md`.
**Decision recorded:** the human inputs that make the promotion gate binding are
not expected soon, so the project stops presenting these thresholds as gates it
passes and starts tracking them as debt it owes.

This register exists so that "the gate passed" is never said about a run that
measured nothing.

---

## 1. What is true today

`scripts/promotion-gate.ts --offline` exits 0 and reports:

```
verdict: advisory-only
binding: { total: 0, passed: 0, failed: 0 }
```

All four checks report `value: null`, `advisory: true`, `blocking: false`.
Reproduced on `main` on 18 September 2026.

The cause is one input, not four. `evaluations/gold-set/cases.json` holds **five
cases, every one `status: "pending"`**, against the fifty verified cases spec 4.9
requires. `evaluations/gold-set/report.ts` therefore sets `advisory: true` with
the reason *"Only 0 of 50 required verified cases; metrics are advisory, not a
gate"*, and `lab.gates.advisoryPolicy` is fixed at `report-only` at the schema
boundary, so an advisory check can never fail a gate.

There is a second, independent cause: with no `--runs` file the gate replays runs
already in the research database, and there are none for the gold videos. Every
metric has an empty denominator. `--offline` routes model calls through
`FakeModelTransport`, which is free and keyless but cannot re-extract, so a
report for a new prompt version over old runs would measure the old prompt.

**`pass: true` in these reports means "nothing was tested". It does not mean
"the configuration is good".**

## 2. The debt, check by check

| Check | Threshold | Status | What clears it |
|---|---|---|---|
| `goldPrecision` | ≥ 0.90 | not measured | Handoff A: ≥ 50 verified cases |
| `goldRecall` | ≥ 0.80 | not measured | Handoff A |
| `anchorWithin2s` | ≥ 0.95 | not measured | Handoff A, with `anchorVerified: true` on every verified claim |
| `costPerAcceptedClaim` | ≤ US$0.25 | not measured | Handoff B: one completed run per gold video, carrying a positive `cost` |

The thresholds themselves are **unchanged**. They were not lowered, and lowering
them was considered and rejected: a weaker bar that is met tells you less than a
strong bar that is honestly marked unmet.

## 3. Phase exit criteria that are not yet satisfiable

From spec section 9. A criterion marked *deferred* has no path to being measured
until the debt above is cleared.

| Phase | Criterion | Status |
|---|---|---|
| 0 | Harness reports precision, recall, anchor accuracy and cost for v5 | **deferred** |
| 1 | Gold-set precision and recall not below v5 | **deferred** |
| 1 | Cost per accepted claim at least 40% lower | **deferred** — and note this is a comparison *between* two reports, which the gate does not compute; it is read by hand from the two JSON files |
| 1 | Zero structural rejections on the gold set | **deferred** (`validity.graded` is 0) |
| 1 | Standby engages on an injected vendor error and not on a missing-captions case | **met**, by `tests/standby.test.ts`, no keys required |
| 3 | At least 95% of L2 anchors within two seconds on the gold set | **deferred** |
| 4 | A context check cites only sources inside its window on 100% of a 50-call sample | **deferred** |

Every other phase-2, phase-3 and phase-4 exit criterion is satisfiable from
tests and fixtures, and is not affected by this register.

## 4. How phases proceed in the meantime

Recorded so the deviation from build plan section 3 is explicit rather than
accidental:

1. A phase closes on **build evidence** — every lane item merged, `npm test`,
   `npm run typecheck`, `npm run build`, the offline gate and `npm audit` clean
   in CI, and a written conformance report comparing the work with the spec's
   "Gate to exit" row, as `docs/gates/phase-1-conformance.md` already does.
2. The conformance report **must** state, per criterion, whether it was met,
   deferred to this register, or failed. A deferred criterion is never written
   up as met.
3. No gate artifact may carry `verdict: pass` while `binding.total` is 0. The
   gate already enforces this by returning `advisory-only` instead.
4. This register is updated whenever a criterion moves between states.

## 5. What clears the debt, in order

The full procedure is `docs/handoff/phase-0-human-inputs.md`. In short:

1. **Handoff A** — 50 verified gold cases (≥ 20 English, ≥ 15 Chinese, ≥ 10 with
   no actionable call), validated by
   `node --experimental-strip-types scripts/gold-validate.ts --cases gold-cases.json --strict`.
   `scripts/gold-draft.ts`, on `feat/yti-v2`, drafts cases from exported runs to
   cut the manual effort; a drafted case is still not a verified one until a
   person has listened to the span.
2. **Handoff B** — one completed v5 run per gold video, exported with
   `scripts/export-runs.ts`. Expect roughly US$0.20–0.95 of model spend per
   video; `YTI_BUDGET_USD` defaults to 2 and must be raised for the session.
3. **Handoff C** — frozen responses per stage, so CI can replay offline.
4. The same videos queued under `evidence-first.web.v7` and exported again. This
   is the step that costs money twice, and it is the only way the v5-versus-v7
   comparison becomes real.
5. Two binding gate invocations, one per runs file, then the three hand-read
   comparisons in `docs/gates/phase-1-summary.md` section 6.

Until step 1 lands, nothing after it can start.

---

*Threshold values live in `lab.gates` (`src/features/youtube-intelligence/settings.ts`);
the minimum verified-case count lives in `evaluations/gold-set/report.ts`. If either
changes, change it there and record why here.*
