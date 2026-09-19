# Standalone completion loop — 19 September 2026

> 20 September 2026 update: the user removed the old US$25 cap for a bounded 20-video comparison. That comparison is complete with findings; see [the report](live-comparison-20-20260920.md). Historical budget/status statements below describe the earlier pilot. Finradar integration remains excluded.

## Scope and authority

The user requested completing Phase 2 (6/10 → 10/10) and Phase 3 (0/18 → 18/18), then stopping before Finradar integration. `standalone-scope.json` is the machine-readable boundary. Phase 4 F50–F55 remains outside this execution, including its standalone-adjacent corpus, context, sharing and digest extensions. Existing working features remain supported.

The user removed the fifty human-verified cases from scope. They are not deferred debt, a prerequisite, or a task for the user. Keep historical reports and the legacy diagnostic harness for provenance/regression checks, but never make their sample minimum a delivery or promotion requirement. Build first; later compare outputs on identical videos against LeapEdge. A comparison measures agreement and usefulness, not independently verified truth. Do not convert a disagreement into a confirmed error without source evidence.

Existing mockups under `docs/spec/mockups/` are the visual reference. Build a standalone shell using those tokens and layouts; embedding in Finradar is excluded.

## Execution order

1. **Prepare:** scope amendment, clean checkout, repeatable loop commands, corrected setup docs, isolated real Postgres and deterministic fixture data. Record the audited baseline (324 tests, typecheck/build and main CI passing).
2. **Reliability:** F26 queue/worker → F27 checkpoint/restart; wire pause/drain, lease fencing, bounded concurrency, no duplicate charges and fallback-aware reservations. F29 cost projection can proceed separately. Replace channel placeholders with verified canonical IDs when available. Close F31 on real Postgres evidence.
3. **Evidence:** F32 windowed ASR → F33 agreement → F34 tie-break and F35 trust ladder. Human review remains an optional L3 action; removing the evaluation corpus does not permit automatic human-verification badges.
4. **Research and automation:** F36 leaderboard → F37 Changes; F38 sentiment; F39 signed push; F40 batch → F41 replay. Exercise provider adapters with fixtures first. Historical replay implementation is required; unbounded paid replay of every historic upload is not implicitly authorized.
5. **Interface:** F42 shell → F43 shared components → F44 Today, F45 Channels, F46 Leaderboard/Methodology, F47 Analysis and F48 Saved/Lab/Settings. Build against real API contracts and seeded rows; do not substitute static mockups for the app.
6. **Close F49:** complete the browser matrix, fix findings, repeat relevant checks, write conformance evidence, and stop before F50. No feature is counted as complete merely because all expected files exist.

## Per-feature loop

Read ledger/spec → write a failing behavioural test → implement → targeted tests → review failure paths → full checks on each integration checkpoint → browser check when a user flow changes → fix and retest → record evidence and commit → update PR and ledger. Use small feature commits and a draft PR so progress is visible. Independent lanes may use subagents as specified in the repository build plan. A lane does not overwrite another lane's files.

The repository-local skills apply with this scope amendment taking precedence. The current request authorizes continuing through both build phases; old phase-by-phase approval text does not create a new implementation pause. A missing paid-service budget or host blocks only the dependent live action, not independent implementation. Keep deployment/merge state distinct from local completion.

Commands:

```sh
npm run delivery:status
npm run delivery:next
npm run delivery:verify
# Offline environments can omit registry access; this leaves audit evidence pending:
npm run delivery:verify -- --offline
```

The controller selects eligible work and executes verification; the coding agent implements each selected item. It does not autonomously create features, merge PRs, invent browser evidence or promote an advisory quality report into a pass. Logs live under ignored `data/build-loop/`. Reviewed phase conformance summaries belong in `docs/gates/`.

## Verification layers

- **Deterministic:** schema rejection, source-span hashes, translations preserving originals, trust transitions, settlement/statistics fixtures, retry/unknown-outcome budget guards, permissions, duplicate webhooks and batch callbacks.
- **Real Postgres:** separate worker processes/connections claim four jobs concurrently, enforce the configured limit, fence expired leases, pause/drain, kill a worker during a stage, restart and prove a retained/settled call is not billed again. PGlite alone cannot prove these behaviours.
- **Browser end to end:** operate the real UI using browser control, trace API/data/result boundaries, reload to verify persistence, exercise failures and inspect actual screenshots. Fixture providers must be labelled as such; a fixture run is not live-provider evidence.
- **Live services after build:** bounded video runs with available credentials, authenticated push callback on HTTPS, batch submit/poll/reconcile, real prices, and a persistent worker. Record skipped or unavailable checks explicitly.
- **Later LeapEdge comparison:** canonical URL/video ID, both run timestamps/configurations, source availability, normalized tickers/stance/conditions/levels, quote provenance, timestamps, omissions, contradictions, usefulness, latency and measured cost. Preserve raw outputs privately. Start with available valid links; fifty is a target, not a build gate. Do not assume fifty links exist because the former requirement said fifty.

## Browser and visual acceptance matrix

| Surface | Workflows and states |
|---|---|
| Shell | Navigate every page, deep-link/reload/back, active navigation, no broken routes; keyboard focus and mobile navigation |
| Today | Submit valid/invalid/duplicate URL; observe queued/running/completed/failed; filter and open a result; retained state after reload |
| Channels | Search/follow/favourite; discovery versus paid processing switches; cost before save; over-budget message; persistence; provider failure |
| Analysis | Evidence/translation, timestamp playback, trust rationale, low-trust/unsupported state, review action, saved call and notes |
| Leaderboard | Creator/ticker view, market/benchmark/horizon/trust filters, sorting, insufficient sample, Changes dates, CSV and methodology definitions |
| Saved | Save/unsave, edit notes, reload; empty state and long text |
| Lab | Prompt/config selection, experiment status, costs, provider diagnostics, comparison clearly distinguished from factual verification |
| Settings | Valid/invalid fields, save/reset, team/account default inheritance, budget/provider errors |
| Responsive | Desktop, tablet and narrow phone; no clipped controls or accidental page-wide horizontal overflow; legible long Chinese/English text |
| UX failure paths | Loading/empty/error/retry, disabled or destructive actions explained, visible success/failure feedback, keyboard-only critical flow |

Capture viewport, URL, commit, fixture/live mode, steps, expected and actual results, screenshot path, and issue/retest status. Inspect screenshots for spacing, hierarchy, contrast, truncation, alignment and overlays. A screenshot file alone is not proof that an interaction worked.

## Live-run authorization and prerequisites

- **Authorized:** run the worker on this Mac for now and document hosted setup. No new hosting subscription.
- Existing server-side keys: Gemini, OpenRouter, YouTube, TranscriptAPI, Supadata for the tie-break path, FMP. Use ignored environment files or the provider's secret store; never paste values into documentation or reports.
- **Authorized:** at most US$25 total API spend and 20 LeapEdge analyses for this task. Count retries, ASR/transcript credits and batch jobs against this allowance. Maintain the task spend record; stop paid calls before exceeding it. The fifty-video comparison target cannot all run on LeapEdge within twenty authorized analyses; prioritize a representative subset and report the actual N.
- A working LeapEdge browser session when comparison begins. TrueAlphaData channel links already exist in `docs/archive/handoff-truealphadata.md`; resolve and validate their canonical IDs. Locate a real fifty-video list if available; the active gold file contains only five pending cases.
- A reachable HTTPS test callback for live push delivery. Production data and existing Finradar deployments are not test fixtures.

Do not claim unattended hosting, live notifications, provider quality or LeapEdge parity from local tests. These are explicit final-report rows.
