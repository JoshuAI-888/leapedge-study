---
description: Run one turn of the delivery build loop — pick the next feature, test first, verify, update the ledger, push.
argument-hint: "[F-number, or blank for the next one]"
---

Continue the build. $ARGUMENTS

## Pick the work

Read `docs/delivery/ledger.json`. If I named a feature above, build that one.
Otherwise take the first `todo` whose prerequisites are all `merged`.

**Stop and tell me instead of starting** if:

- its prerequisites are only `in-review` — the branch carrying them has to merge
  first, or this is built against a base that is about to change;
- the ledger and the repository disagree about what exists;
- the feature is blocked on something only a person can supply, which the ledger
  entry's `note` will say.

Build **one** feature. Do not start a second.

## The loop

Follow the `build-feature` skill. In short:

1. Read the spec sections the ledger entry names under `spec`, its row in
   `docs/spec/youtube-intelligence-v2-build-plan.md`, and the existing tests for
   every module it touches.
2. **Write the failing test first**, in the file the ledger entry names. Run it
   and show me it failing for the right reason before you write any
   implementation.
3. Implement, inside the files the ledger entry names. A change outside them is
   a pull request to the lane that owns them, not an edit in passing.
4. Verify. All five, every time:
   ```sh
   npm test
   YTI_DB=pglite npm test
   npm run typecheck
   npm run build
   node --experimental-strip-types scripts/promotion-gate.ts --offline
   ```
   Add `npm audit --omit=dev` if you added a dependency, and
   `scripts/postgres-check.ts` against a real Postgres if you touched locking,
   queueing or concurrency — PGlite is single-connection and cannot prove them.
5. Re-read your own diff as a reviewer looking for a reason to reject it.
6. Update the ledger entry — status, `pr`, and the `files` and `tests` you
   actually wrote — **in the same commit as the code**.
7. Commit as `F##: <what changed>`, push, and open a draft pull request if the
   lane has none.

## Rules

- **A failing guard is right until proven otherwise.** If
  `tests/conventions.test.ts` or `tests/invariants.test.ts` fails, assume the
  change is wrong, not the guard. If the guard really is wrong, fix it in the
  same commit and say why in the message.
- **Never skip, disable or loosen a test to go green**, and never lower a
  threshold to clear a criterion.
- **A gate reporting `pass: true` with `binding.total: 0` measured nothing.**
  The gold set holds 5 cases against the 50 spec 4.9 requires, so that is the
  current state of every gate. Never call it passed. See
  `docs/gates/gate-debt.md`.
- **If a feature unlocks a pending invariant**, write it in
  `tests/invariants.test.ts` and remove its entry from that file's `PENDING`
  list. The test will tell you when this applies.
- **If you cannot finish**, push what works, leave the ledger entry `todo` with
  a `note` saying exactly what is done and what blocks it, and tell me. A
  half-built feature recorded honestly is recoverable; a silent one is rebuilt.

## Report back

Four things, briefly:

1. What you built, and anything you decided differently from the plan, with why.
2. What each of the five commands said — the numbers, not "all green".
3. Anything you found and did not fix, and where you recorded it.
4. What the next feature is, and whether anything blocks it.
