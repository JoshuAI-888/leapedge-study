# Phase-1 conformance report (17 September 2026)

**Gate row (spec section 9, phase 1).** Work: native transport for all stages; pointer evidence with `responseSchema`; mentions with sentiment and rationale; batched critique with explicit caching; low media resolution; realistic reservations with retries; Supadata standby with circuit breaker. Gate to exit: gold-set precision and recall not below v5; cost per accepted claim at least 40% lower; zero structural rejections on the gold set; standby engages on an injected vendor error and not on a missing-captions case.

**Verdict: advisory only.** The build is complete and verified; three of the four exit criteria cannot be measured until the phase-0 human inputs (verified gold set, one completed run per gold video) exist. The fourth, the standby criterion, is met by `tests/standby.test.ts`.

## Build evidence

| Item | Commit | Evidence |
|---|---|---|
| F10 native transport | `1d430c4` | `transport/google-native.ts`, `transport/prices.ts`; every request carries `responseSchema` and `mediaResolution: LOW`; `countTokens` with local fallback |
| F11 stage routing | `8905648` | per-stage transport from settings, `fallbackToOpenRouter`, `requireDifferentFamily`; `provider.only` and `json_object` gone from the OpenRouter path |
| F12 pointer evidence | `d26a037` | `source_span` on claims; extraction schema returns ranges; app copies and hashes the text |
| F13 mentions | `bb57399` | `sentiment.ts`; mention needs rationale and resolvable span; sentiment derived from stance for calls |
| F14 translation | `8f304af` | one call over copied spans; `text_original` hash re-asserted |
| F15 batched critique | `74a521e` | one critique per run from an explicit context cache; per-claim loop, `auditIndex` and `source-repair` removed |
| F16 retry policy | `d1cc43e` | `retry.ts`; `yi_calls.attempt`; second attempt only after the previous closes |
| F17 reservations | `0639f45` | counted tokens times rate; reconcile from usage; unknown outcomes held then reconciled by `sweep` |
| F18 standby | `111021c` | per-vendor circuit breaker; explicit Supadata modes; credit-exhausted event |
| F19 prompt v7 | `715c253` | candidate only; v1 to v6 hashes unchanged |
| F20 retirement | `f795da9` | `youtubejs.ts`, `additional-transcript-formats.ts` and tests deleted; `youtubei.js` out of `package.json` and the lockfile; comparison-week path kept behind `transport.default` |
| F21 gate run | `775e904` | `phase-1-v5.json`, `phase-1-v7.json`, `phase-1-summary.md`, `configs/v7.json` |
| follow-ups | `d4a2eb3` | fallback wrapper forwards cache methods and never re-issues a cached request; `PromptVersion.translation` |

Tests: 197 of 197 on the SQLite driver and on PGlite (168 at the phase-0 baseline). `npm run typecheck` and `npm run build` clean.

Pipeline checks: no per-claim critique stage, no `source-repair`, no `json_object` or `provider.only` under `src/`, adapters deleted, `youtubei.js` removed. All true.

## Exit criteria

| Criterion | Status | Why |
|---|---|---|
| Gold-set precision and recall not below v5 | Not measurable | 0 of 50 gold cases verified; no runs for the gold videos. Both reports show `value: null`. |
| Cost per accepted claim at least 40% lower | Not measurable | Same inputs missing. The gate checks the absolute US$0.25 cap only; the 40% comparison is read by hand from the v5 and v7 reports. |
| Zero structural rejections on the gold set | Not measurable | `validity.graded` is 0 because no run was graded. |
| Standby engages on a vendor error and not on missing captions | **Met** | `tests/standby.test.ts`: 503 and a network failure trip the breaker and route to Supadata; 206 and 404 return null with zero standby calls. |

The v5 and v7 reports are identical apart from `configHash`, `prompts.version`, `id` and timestamp: offline replay cannot re-extract, so a v7 report over v5 runs would measure v5 output. The comparison becomes real only with a second set of runs queued under v7.

## What makes it binding

1. Handoff A: 50 or more verified gold cases, validated with `scripts/gold-validate.ts --strict`.
2. Handoff B: one completed v5 run per gold video, exported with `scripts/export-runs.ts`.
3. The same videos queued under `evidence-first.web.v7` and exported a second time.
4. Two gate invocations, one per `--runs` file, then the hand-read comparisons: v7 precision and recall at least v5's, v7 cost per accepted claim at most 0.6 times v5's, `validity.graded` equal to `validity.passed` in both.
5. A recorded sign-off, or a written decision per failing criterion.

## Open items carried into phase 2

- Record `priceTableVersion` next to stored costs, and re-check the rate table in `transport/prices.ts` before the phase-2 ledger relies on it.
- `usage.outputTokens` excludes reasoning tokens while `costUsd` includes them; the ledger should use the transport's cost rather than recompute from tokens.
- `run.output.rejectedMentions` mixes extraction and critic rejections; a `kind` field would let the UI separate them.
- `scripts/audit-institutional-chinese.ts` still drives its own per-claim critique and no longer matches the pipeline.
