# Standalone build conformance

> 20 September 2026 update: the user removed the old US$25 cap for a bounded 20-video comparison. That comparison is complete with findings; see [the report](live-comparison-20-20260920.md). Historical budget/status statements below describe the earlier pilot. Finradar integration remains excluded.

Scope: complete Phase 2 and Phase 3, with no Finradar integration (F50–F55).
The fifty human-verified cases were removed from scope by the user. They are
not a hidden release gate. Product comparison means output agreement and
usefulness, not independent factual accuracy.

## Implementation and evidence

| Features | Implementation | Evidence |
| --- | --- | --- |
| F26–F27 | Durable jobs, fenced leases, concurrency, stage checkpoints, fingerprinted response replay | `queue`, `resume`, `e2e-parallel`, `run-config` tests; final real PostgreSQL run passed 2/2 without skips |
| F28–F29 | Eight confirmed TrueAlpha Tier-1 channels; unavailable LeapEdge ranking explicit; versioned selection, honest cost coverage and budget holds | `channel-seed`, `cost-metrics`, `monthly-reserve` tests |
| F31 | Phase 2 conformance record | `docs/gates/phase-2-baseline.json`; final command evidence recorded by build loop |
| F32–F35 | Windowed native ASR, per-span agreement, bounded tie-break, signed content-bound reviews, resumable explicit audio requests | `windowed-asr`, `agreement`, `trust`, `run-config`, `invariants` tests |
| F36–F38 | Query-time benchmark statistics, significance/BH adjustment, Changes with retained price revisions and ordered settlements, distinct-creator sentiment | `significance`, `leaderboard`, `sentiment-shift`, `metrics-registry` tests |
| F39–F41 | Signed bounded WebSub notifications, native batch submit/poll, bounded historical replay and idempotent discovery | `push`, `batch`, `replay` tests; live hub/batch acceptance remains separately labelled |
| F42–F48 | Standalone page shell, seven-column ticker board, Today, Channels, Analysis, Saved, Lab, Settings, registry-derived methodology | `ui-viewmodel`, `actions`, `settings`, registry tests; desktop workflows observed in `docs/gates/browser-acceptance.json` |
| F49 | Final acceptance gate | Open until the remaining browser/mobile and visual checks are completed; not inferred from file existence or unit tests |

The original monolithic interfaces and unused subpanels were retired. `/`
redirects to Today and `/research` to Lab. Existing share management remains in
Lab; new Finradar/sharing integration is outside this scope.

## Verification boundaries

Synthetic fixtures are isolated from live data and visibly labelled. No signed
human validation has been fabricated. Full source evidence, native ASR and
third-party reports have different meanings; no one replaces the others.

The source-level build report is generated under ignored `data/build-loop/`.
It records the exact source hash, tests, PostgreSQL-dialect checks, typecheck,
production build and dependency audit. The paid pilot refuses stale or changed
source evidence. Real PostgreSQL evidence is a separate test because an
in-process database cannot establish multi-connection concurrency or process
restart behaviour.

Browser acceptance is still in progress. Native Chrome control stopped
returning screen and accessibility content while entering responsive mode;
restoring a visible unlocked browser is required to finish the remaining
mobile, populated-board, latest-control and final-production visual checks.
This is not marked passed.

## Live validation and operations

The task has a combined US$25 API ceiling and a maximum of 20 LeapEdge analyses.
No hosting subscription is authorized or needed. The local profile uses an
isolated persistent PostgreSQL cluster; service preparation and actual service
installation are different statuses, recorded in the final result.

The historical comparison inventory identifies three complete retained
LeapEdge reports among nine archived candidate URLs. A pilot can compare current
local outputs to those dated reports without spending new LeapEdge analyses.
Fresh LeapEdge runs, live HTTPS push delivery, and completed native Batch API
jobs require their own evidence. Do not report them as tested from fixtures.

## Live-discovered provider compatibility fix

The first caption-first pilot reached synthesis and received a definitive Gemini
HTTP 400; its reservation was released and no automatic retry occurred. A minimal
model request succeeded. The extraction schema failed unchanged but succeeded
when nested `maxItems` constraints were removed from the provider request.
Google documents that very large or deeply nested schemas can be rejected:
<https://ai.google.dev/gemini-api/docs/structured-output>.

The native transport now omits those provider-side expansion caps without
mutating shared schemas. Required fields, shape and other constraints remain;
the application still applies the original Zod limits before accepting output.
A regression first failed on the original transport, then passed with the fix,
and checks that 41 extracted claims are rejected locally. This also applies to
native batch requests, which use the same parameter builder. Final build evidence
is rerun after this source change, before resuming paid verification.

A second live finding was an adapter mismatch: native Gemini completed with
`STOP`, while the provider-independent pipeline required `stop`. The transport
now maps only the successful native reason to `stop`; blocked/truncated outcomes
remain failures. Recovery additionally recognizes the old retained native
`STOP`, allowing the same paid response to replay without another synthesis
call. The existing resume regression was changed to that actual retained shape
and failed before the fix; all 28 targeted transport/recovery tests then passed.

Retained synthesis then replayed successfully and translation completed. The
independent critic returned HTTP 404 because its current OpenRouter catalogue
and endpoint metadata omit `temperature`, while the adapter sent it with
`require_parameters: true`. The adapter now uses the catalogue already read for
pricing to omit unsupported temperature, preserving strict schema enforcement
and the configured non-Google critic. The capability regression failed before
the change and passed afterwards. No silent model substitution was made.

The live critic returned complete verdicts but used empty strings for optional
cross-claim notes. The local parser now normalizes blank optional notes to
absent. Invalid types, empty required reasons, unknown verdicts and duplicate
IDs remain rejected. This compatibility regression failed before the change
and passed afterwards; replay uses the retained critique without another fee.


## Current handoff

The caption-first live pilot completed and published three L1 claims. See
`live-comparison.md` and its JSON counterpart for differences from the retained
LeapEdge report and total task allocation of US$0.12925415. No fresh LeapEdge
analysis, audio agreement or human review is implied. Three Mac services are
running from Application Support; worker heartbeat is current and queue
admission remains paused. The status API returned HTTP 200.

The gate stays open for the listed browser/mobile checks and live batch/push
evidence. PR #6 merged on 19 September 2026 UTC after both GitHub verification runs
passed. The ledger now records code on main; the remaining acceptance gaps
are still open. Merged code does not mean final visual acceptance passed.


## Merge verification

PR #6 merged as `a74efb76152d995a646462a3c763e619928008c0` after both
GitHub verification runs passed. The Vercel preview failed before compilation
because its migration guard could not establish database isolation:
`YTI_PRODUCTION_DB_HOST` is unset. No guard was bypassed and no deployment
database environment was changed. Configure an isolated preview database
before retrying preview deployment. This does not change the local Mac runtime.
