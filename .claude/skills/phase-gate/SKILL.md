---
name: phase-gate
description: Run and write up a YouTube Intelligence v2 phase gate — the checks, the artifact, and a conformance report that states every exit criterion as met, deferred or failed. Use when a phase's features are all merged, when asked to close or run a phase gate, or when asked whether a phase is done.
---

# Close a phase

A phase does not close because its features are built. It closes because
somebody wrote down, criterion by criterion, what was shown and what was not.

## Current execution override — 19 September 2026

Read `docs/delivery/standalone-scope.json` and `docs/delivery/standalone-build-loop.md`.
The current user request authorizes completing Phase 2 and Phase 3 before stopping
at Phase 4. The fifty human-verified cases are removed, not deferred. Old text
below requiring those inputs or a separate human approval to start the next of
these two build phases is superseded. Do not stop independent implementation for
those reasons. Preserve real checks, honest merge state and conformance reports.
Use browser control for the documented workflow and visual acceptance matrix;
never infer it from a production build. The promotion command below is a legacy
regression diagnostic only. Later LeapEdge comparisons have a cap of twenty
analyses and all APIs together have a US$25 task cap. The worker runs on this Mac;
hosted setup is documented. No Phase 4 feature or Finradar deployment is included.

## 0. Is the phase actually ready?

```sh
node -e 'const l=require("./docs/delivery/ledger.json");
const p=Number(process.argv[1]);
const f=l.features.filter(x=>x.phase===p&&x.status!=="removed");
for(const x of f) console.log(x.status.padEnd(10), x.id, x.title);' 2
```

Every feature in the phase must be `merged`. An `in-review` one means the gate
would describe work that is not on the main line yet. Stop and merge it.

## 1. Run the gate

```sh
npm test
YTI_DB=pglite npm test
npm run typecheck
npm run build
npm audit --omit=dev
node --experimental-strip-types scripts/promotion-gate.ts --offline \
  --out docs/gates/phase-N-$(date +%Y%m%d).json
```

Then the phase's own tests, from build plan section 3:

- phase 2 — `tests/e2e-parallel.test.ts tests/resume.test.ts`, and
  `scripts/postgres-check.ts` against a **real** Postgres, because PGlite is
  single-connection and cannot prove `SKIP LOCKED` or lease fencing
- phase 3 — `tests/leaderboard.test.ts tests/push.test.ts tests/metrics-registry.test.ts`
- phase 4 — `tests/context-check.test.ts`

## 2. Read the gate artifact honestly

Open the JSON. If `binding.total` is 0, **the gate measured nothing**, and
`pass: true` means only that nothing could fail. Say that in the report in those
words. Do not write "the gate passed".

This is the current state for every phase and it is expected: see
`docs/gates/gate-debt.md`.

## 3. Write the conformance report

`docs/gates/phase-N-conformance.md`, modelled on
`docs/gates/phase-1-conformance.md`. It must contain:

**A build-evidence table** — one row per feature, with its commit and the file
or test that shows it exists.

**An exit-criteria table** — one row per criterion from spec section 9's row for
this phase, and every row carries exactly one of:

| Verdict | Means |
|---|---|
| **met** | Named the test or artifact that shows it, reproducibly |
| **deferred** | Cannot be measured yet; names the entry in `docs/gates/gate-debt.md` |
| **failed** | Measured and missed; names the threshold and the value |

No criterion may be absent, and none may be summarised away. If a criterion is
deferred, the register must already list it — add it there first.

**Open items carried forward** — anything found and not fixed, so the next phase
inherits a list rather than a surprise.

## 4. Update the register and the ledger

- `docs/gates/gate-debt.md` — move any criterion that changed state.
- `docs/delivery/ledger.json` — the phase's gate feature (F21, F31, F49, F55)
  goes to `merged`, and `updated` changes.

## 5. Open the gate pull request

Body: the commands exactly as run, the artifact path, the exit-criteria table,
and what a human must do to make the deferred rows binding.

**A human approves the gate.** The next phase's lanes open after that approval,
not after the tests go green. Phase 2 once opened while phases 0 and 1 were both
still advisory, which is why this step is written down.

## What a phase gate never does

- Report `pass` over an empty measurement.
- Lower a threshold to clear a criterion. Restating it as advisory, in the
  register, with the reason, is the honest move; changing the number is not.
- Skip, disable or quarantine a test to go green.
