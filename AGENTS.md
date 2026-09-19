<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# YouTube Intelligence

Standalone research lab for Finradar → Intelligence → YouTube Intelligence. The
GitHub repository name, `leapedge-study`, is not the product name.

## Read these first, in this order

1. **`docs/delivery/ledger.json`** — where delivery stands, feature by feature.
   This is the single source of truth, not a conversation and not a branch name.
   `tests/delivery-ledger.test.ts` keeps it honest. **Update it in the same
   commit as the work it describes.**
2. **`docs/spec/youtube-intelligence-v2-spec.md`** (revision 3) — the design.
   Read the section your feature's ledger entry names under `spec`.
3. **`docs/spec/youtube-intelligence-v2-build-plan.md`** — the 54 features,
   their dependencies, lanes and test plan.
4. **`docs/gates/gate-debt.md`** — why every gate currently reports
   `advisory-only`, and what would change that.

## Current scope override — 19 September 2026

Read `docs/delivery/standalone-scope.json` and `standalone-build-loop.md` before
choosing work. Complete phases 2 and 3; stop before phase 4. The user removed the
fifty human-verified cases from scope. The old gold harness and its artifacts are
historical diagnostics, not a delivery prerequisite. Build checks and browser
acceptance remain mandatory; LeapEdge comparison follows the build. Never label
comparison agreement as verified accuracy or fabricate a human-reviewed badge.
The current instruction authorizes continuing through both build phases; old
per-phase permission text is superseded for implementation within this scope.

## Verify

These five are what CI runs. All need no credentials.

```sh
npm test                                                          # node:test
YTI_DB=pglite npm test                                            # Postgres dialect
npm run typecheck                                                 # next typegen && tsc
npm run build
node --experimental-strip-types scripts/promotion-gate.ts --offline
```

Node 24 (`package.json` engines); Use Node 24 for this build loop.

## Conventions

- **Imports carry the `.ts` / `.tsx` suffix.** Node runs the sources directly.
- **No enums, namespaces or constructor parameter properties** —
  `--experimental-strip-types` cannot strip them. `tests/conventions.test.ts`
  asserts this.
- **zod at every boundary**, including model output that arrived under a
  `responseSchema`.
- **Tests are `node:test` + `assert/strict`** in `tests/*.test.ts` — the glob is
  flat, so a test in a subdirectory never runs. Database through
  `tests/helpers/db.ts`, HTTP through `tests/helpers/fetch-stub.ts`, models
  through `FakeModelTransport`.
- **Model traffic goes through a transport** (spec 4.1). Any other `fetch` must
  be listed in `MAY_FETCH` in `tests/conventions.test.ts` with what it talks to.
- **Retiring something means adding it to `RETIRED_IN_CODE`** in the same file,
  so it cannot quietly come back — which is how `chunking.auditSource` survived
  being deleted once already.
- **A lane owns its files.** Changing a file another lane owns is a pull request
  to that lane, not an edit in passing.
- **No new runtime dependency** without naming it in the pull request.

## Working loop

Use the `build-feature` skill for a feature and the `phase-gate` skill for a
gate. Both are in `.claude/skills/`. The short version: read the spec section,
write the failing test first, implement, run the five commands above, update the
ledger, push. Open the pull request when the lane *starts*, as a draft — work
nobody can see is work that gets built twice.

## Archives

`docs/archive/` and `scripts/archive/` hold the v1 evidence trail and retired
research code. They are exempt from the convention guards and excluded from the
typecheck and the Vercel bundle. Nothing there describes the current system.
