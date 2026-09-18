---
description: Close a phase — run the gate, write the artifact, and state every exit criterion as met, deferred or failed.
argument-hint: "[phase number]"
---

Close the phase gate. $ARGUMENTS

Follow the `phase-gate` skill.

## Before anything else

Every feature in the phase must be `merged` in `docs/delivery/ledger.json`. One
still `in-review` means the gate would describe work that is not on the main
line. Stop and say so.

## Then

Run the phase's checks, write the artifact to `docs/gates/phase-N-<date>.json`,
and write `docs/gates/phase-N-conformance.md` modelled on the phase-1 one.

The conformance report must carry **one row per exit criterion** from spec
section 9's row for this phase, and every row must say exactly one of:

- **met** — naming the test or artifact that shows it, reproducibly;
- **deferred** — naming its entry in `docs/gates/gate-debt.md`;
- **failed** — naming the threshold and the value.

No criterion may be missing, and none may be summarised away.

## What this never does

- Report `pass` over an empty measurement. If `binding.total` is 0, the gate
  measured nothing, and the report says that in those words.
- Lower a threshold to clear a criterion. Restating it as advisory in the
  register, with the reason, is honest; changing the number is not.
- Skip, disable or quarantine a test to go green.

## Finish

Update `docs/gates/gate-debt.md` for anything that changed state, set the
phase's gate feature to `merged` in the ledger, and open the gate pull request
with the commands as run, the artifact path, the criteria table, and what a
person must do to make the deferred rows binding.

Then tell me it needs my approval before the next phase's lanes open.
