---
name: build-feature
description: Build one feature from the YouTube Intelligence v2 build plan, end to end — read the spec, write the failing test first, implement, verify, update the delivery ledger, push. Use when asked to build, continue or finish a feature by its F-number (F25, F32, F44…), when picking up "the next feature", or when resuming delivery work in a fresh session.
---

# Build one feature

The loop from build plan section 3, as steps rather than prose. One feature per
pass. Do not start a second until the first is pushed and the ledger says so.

## 0. Know where you are

```sh
node -e 'const l=require("./docs/delivery/ledger.json");
const f=l.features.find(x=>x.id===process.argv[1]);
console.log(JSON.stringify(f,null,2))' F25
```

If no feature was named, take the first `todo` whose prerequisites are all
`merged`. If its prerequisites are only `in-review`, **stop and say so** — the
branch carrying them has to merge first, or the work is built against a base
that is about to change.

Read the ledger entry's `spec` sections in
`docs/spec/youtube-intelligence-v2-spec.md`, the feature's row in the build
plan, and the existing test for every module the entry's `files` touch.

## 1. Write the failing test first

In the `tests` file the ledger entry names. It must fail for the right reason
before you write any implementation — a test that passes against unwritten code
is testing nothing.

- `node:test` and `assert/strict`
- database through `tests/helpers/db.ts` `freshDatabase()`
- HTTP through `tests/helpers/fetch-stub.ts` `stubFetch()`
- models through `FakeModelTransport`
- name the case after the behaviour, not the function

Check build plan section 4 for the cases this feature's test file is expected to
cover. If the feature touches an area an invariant governs, add to
`tests/invariants.test.ts` rather than only testing the happy path, and remove
the matching entry from its `PENDING` list.

## 2. Implement

Follow the conventions in `AGENTS.md`. Stay inside the files the ledger entry
names; a change outside them is a pull request to the lane that owns them.

## 3. Verify — all five, every time

```sh
npm test
YTI_DB=pglite npm test
npm run typecheck
npm run build
node --experimental-strip-types scripts/promotion-gate.ts --offline
```

Plus `npm audit --omit=dev` if you added a dependency, and
`scripts/postgres-check.ts` against a real Postgres if you touched locking,
queueing or concurrency — PGlite is single-connection and cannot prove them.

A failure here is the deliverable, not an obstacle. Fix it before moving on.

## 4. Self-review the diff adversarially

Read your own change as a reviewer looking for a reason to reject it:

- Does every new boundary parse through zod?
- Does a failure path leave the ledger, the queue or the database consistent?
- Did you add a `fetch` outside a transport without listing it?
- Did you leave a comment describing behaviour the code no longer has?
- Would this pass if the provider returned something malformed, twice?

## 5. Update the ledger — same commit

```jsonc
// docs/delivery/ledger.json
{ "id": "F25", "status": "in-review", "pr": 12, ... }
```

Set `status`, add the `pr`, correct `files` and `tests` to what you actually
wrote, and update `updated`. Run `tests/delivery-ledger.test.ts`; it will tell
you if the entry and the repository disagree.

Flip to `merged` only when the pull request merges.

## 6. Commit and push

Title `F##: <what changed>`. In the body: the spec section, the tests added, the
commands run, and any deviation from the plan with its reason. Push to the
lane's branch.

If the lane has no pull request yet, **open one as a draft now**, before the
work is finished. Twenty-one commits of completed phase-2 work once sat on a
branch with no pull request and nobody knew; a draft costs nothing and makes
that impossible.

## When you cannot finish

Push what works, leave the ledger entry `todo` with a `note` saying exactly what
is done and what blocks it, and say so in the pull request. A half-built feature
recorded honestly is recoverable. One that is silent is rebuilt from scratch.
