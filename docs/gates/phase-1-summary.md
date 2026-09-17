# Phase-1 gate: what ran, what it means, and what makes it binding

**Branch:** `feat/yti-v2` (worktree of `youtube-intelligence`), through F20.
**Spec:** section 9, phase-1 row. **Build plan:** F21.
**Ran on:** 2026-09-17, offline, no keys, no spend.

| Artifact | Configuration | `configHash` | Verdict |
|---|---|---|---|
| `docs/gates/phase-1-v5.json` | team defaults, `prompts.version = evidence-first.web.v5` | `8208231c53f67f62…` | `advisory-only` |
| `docs/gates/phase-1-v7.json` | `docs/gates/configs/v7.json`, `prompts.version = evidence-first.web.v7` | `1b3207abd4947b81…` | `advisory-only` |

Commands, exactly as run from the branch root:

```
node --experimental-strip-types scripts/promotion-gate.ts --offline \
  --out docs/gates/phase-1-v5.json

node --experimental-strip-types scripts/promotion-gate.ts --offline \
  --config docs/gates/configs/v7.json --out docs/gates/phase-1-v7.json
```

`docs/gates/configs/v7.json` is a full `TeamPreferences` document produced from
`teamDefaults()` with only `prompts.version` changed, so the two runs differ in
exactly one hashed key. Both exited 0.

**Headline: nothing in either report is binding, and the two reports are not yet
a comparison.** They are identical apart from `configHash`, `prompts.version`,
`id` and the timestamp. Both say `verdict: advisory-only`, `binding: {total: 0,
passed: 0, failed: 0}`, and all four checks came back `value: null`,
`advisory: true`, `blocking: false`.

---

## 1. What each gate check reports

The gate reads one team configuration, computes its configuration hash, runs the
gold-set report over stored runs, and compares four measurements with the
thresholds in `lab.gates`. The gold set is the only source of gate checks.

| Check id | Metric | Comparison | Threshold | What it reports |
|---|---|---|---|---|
| `goldPrecision` | `claims.precision` | min | ≥ 0.90 | Of the claims the pipeline accepted on gold videos, the share that a reviewer also expected. Matched one-to-one on `(ticker, stance)`, greedily. A claim with no ticker is always a false positive. |
| `goldRecall` | `claims.recall` | min | ≥ 0.80 | Of the claims a reviewer expected, the share the pipeline accepted. Measures what the pipeline misses. |
| `anchorWithin2s` | `anchors.accuracy` | min | ≥ 0.95 | Of the reviewer-verified anchors that could be compared with a matched accepted claim, the share whose start second lands within two seconds of the verified span. Only claims with `anchorVerified: true` and a span count. |
| `costPerAcceptedClaim` | `cost.perAcceptedClaimUsd` | max | ≤ US$0.25 | Total recorded `run.cost` across replayed gold runs divided by the number of accepted claims. It is what the runs actually cost, not an estimate. |

Each check comes back with `value`, `threshold`, `meetsThreshold`, `advisory`,
`blocking` and a one-line `reason`. `meetsThreshold: null` means the metric had
no denominator — nothing to divide by — which is different from failing.

The report also carries, under `sources.goldSet`, figures the gate records but
does **not** turn into a pass/fail check:

- `cases` — total, verified, pending, scored, and `missingRun` (gold videos with
  no replayable run). Currently 5 total, **0 verified**, 5 pending, 0 scored, all
  five in `missingRun`.
- `critic` — the critic's own precision and recall where `audit.verdict` exists.
- `sentiment` — agreement between the reviewer's sentiment and the run's, on
  matched claims.
- `validity` — `graded` and `passed` from `gradeRun`. This is the figure that
  answers the spec's "zero structural rejections on the gold set": it is binding
  only in the sense that a reviewer reads it, and it is `0 / 0` today because no
  run was graded.

Two phase-1 exit criteria are **comparisons between two reports, not checks
inside one**: "precision and recall not below v5" and "cost per accepted claim
at least 40% lower". The gate compares each configuration against the absolute
thresholds above; the v5-versus-v7 judgement is made by diffing the two JSON
files. That diff is meaningless until both files carry real numbers.

## 2. Why every check is advisory

Two independent reasons, both of which need a person:

1. **No verified gold cases.** `evaluations/gold-set/cases.json` holds five
   cases and every one is `status: "pending"`. Spec 4.9 requires at least fifty
   human-verified cases before the numbers bind, so `goldReport` sets
   `advisory: true` with the reason *"Only 0 of 50 required verified cases;
   metrics are advisory, not a gate."* `lab.gates.advisoryPolicy` is
   `report-only`, fixed at the schema boundary: an advisory check is printed
   next to the binding ones and can never fail the gate. That is why
   `binding.total` is 0 and why `pass: true` here means "nothing was tested",
   not "the configuration is good".

2. **No live runs.** With no `--runs` file the gate replays the runs already in
   the research database; this worktree's database has none, so `runs: 0` and
   every metric has an empty denominator. `--offline` routes every model call
   through `FakeModelTransport`, so the run is free and keyless — and also
   cannot produce new extractions. `mode: "offline"` carries the limitation
   verbatim in the report: prompt, model or transport changes need fresh runs
   before the numbers reflect them.

The consequence for v7 specifically: changing `prompts.version` changes the
configuration hash and therefore produces a separate, correctly-identified
report, but offline replay cannot re-extract anything, so a v7 report over v5
runs would measure v5's output. **The v7 numbers only become v7's once someone
queues gold videos with `promptVersion: evidence-first.web.v7` and exports
those runs.** The current `phase-1-v7.json` is a correctly-hashed empty
measurement, nothing more.

`--live` is not implemented: `scripts/promotion-gate.ts` exits 2 with a message
pointing at `--offline`. Live keys enter through the runs file, not the gate.

## 3. The standby exit criterion — met, offline, in tests

"Standby engages on an injected vendor error and not on a missing-captions
case" is the one phase-1 criterion that needs no keys, and it is covered by
`tests/standby.test.ts` (8 tests, all passing):

| Criterion | Test | What it injects | What it asserts |
|---|---|---|---|
| Engages on a vendor error | "A 503 from TranscriptAPI trips the breaker for fifteen minutes and routes captions to Supadata" | HTTP 503 | `native_captions_supadata` served; breaker kind `5xx`, 15-minute cooldown from the injected clock; the draft provider is not called again while open, and is retried once closed |
| Engages on a vendor error (non-HTTP) | "A network failure from TranscriptAPI trips the breaker as a network error and engages the standby" | a rejected `fetch` | breaker kind `network`; standby serves the captions |
| Does **not** engage on missing captions | "A 206 or 404 from TranscriptAPI never trips the breaker and never falls back" | HTTP 206, then 404 | `null` returned, no breaker state, **zero** Supadata calls — a video without captions has none at either vendor, so falling back would only spend credits |

The 503 and 206/404 cases were already present from F18. The network case was
added here, because until now a rejected request was only covered as a unit
assertion on `vendorErrorForFailure`, never end to end.

## 4. What the human must run with live keys to make this binding

Prerequisite: `docs/handoff/phase-0-human-inputs.md`, deliverables **A** (50
verified cases → `gold-cases.json`) and **B** (one completed run per gold video
→ `runs.json`). Nothing below produces a binding number without both.

Set `YTI_BUDGET_USD=30` in `.env` for the session and lower it afterwards.
Expect roughly US$0.20–0.95 of model spend per video.

**Step 1 — validate the cases (no keys, no database).**

```
node --experimental-strip-types scripts/gold-validate.ts --cases gold-cases.json --strict
```

Must report zero schema errors, `verified ≥ 50`, `en ≥ 20`, `zh ≥ 15`, every
verified claim `anchorVerified: true`, and at least ten rejection-only cases.
`--strict` exits non-zero until then.

**Step 2 — export the v5 runs from Neon.**

```
DATABASE_URL="postgres://..." node --experimental-strip-types scripts/export-runs.ts \
  --cases gold-cases.json --out runs-v5.json
```

Queue any video printed as `MISSING` (procedure in the handoff, section B) and
re-export until nothing is missing. Every row needs `promptVersion:
evidence-first.web.v5`, `output.source.segments[].start_seconds`,
`output.claims[].audit.verdict` and a positive `cost` — those four are what make
anchors, critic precision and cost measurable.

**Step 3 — the v5 gold-set report, on its own.** This is the command that turns
precision, recall, anchor accuracy and cost per accepted claim from `null` into
numbers:

```
node --experimental-strip-types scripts/gold-set.ts --offline \
  --cases gold-cases.json --runs runs-v5.json --out data/evaluations
```

Read `report.advisory`. Once it is `false`, the gate below is binding.

**Step 4 — queue the same videos on v7 and export those runs.** Same procedure
as step 2, with `promptVersion` set to `evidence-first.web.v7` when queueing, to
`runs-v7.json`. This is the step that costs money twice and the only way the
v5-versus-v7 comparison becomes real.

**Step 5 — the two binding gate runs.**

```
node --experimental-strip-types scripts/promotion-gate.ts --offline \
  --cases gold-cases.json --runs runs-v5.json \
  --out docs/gates/phase-1-v5-binding.json

node --experimental-strip-types scripts/promotion-gate.ts --offline \
  --config docs/gates/configs/v7.json \
  --cases gold-cases.json --runs runs-v7.json \
  --out docs/gates/phase-1-v7-binding.json
```

Each exits 1 if a binding check misses its threshold. `--offline` stays: with a
runs file the gate is a pure comparison of recorded output against verified
cases, so it needs no key even when the runs it reads were paid for.

**Step 6 — the two comparisons the gate does not compute.** Read both JSON files:

- **Precision and recall not below v5:** `results.goldPrecision.value` and
  `results.goldRecall.value` in the v7 report, each at least the v5 report's.
- **Cost per accepted claim at least 40% lower:**
  `results.costPerAcceptedClaim.value` in the v7 report must be
  `≤ 0.6 ×` the v5 report's. The absolute US$0.25 cap is the gate's own check;
  the 40% reduction is the phase-1 criterion and has to be read off by hand.
- **Zero structural rejections:** `sources.goldSet.validity.graded` equals
  `sources.goldSet.validity.passed`, and `failures` is empty, in both reports.

**Definition of done for the phase-1 gate:** both reports `verdict: pass` with
an empty `advisory` array, the three comparisons above satisfied, and
`tests/standby.test.ts` green — or a written decision recorded against each
criterion that fails, naming whether the threshold's rationale changes, the
prompt changes, or the result is accepted as it stands.
