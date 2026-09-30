# Phase-5 conformance report (30 September 2026)

**Gate row (F77, requirements `docs/delivery/leapedge-gap-ux-proposals-20260929.md`, spec §7.6).** Work: the LeapEdge-gap features F56–F76. Gate to exit: a browser and visual matrix for every new or changed surface (desktop and 390 px, light and dark), keyboard-critical flows, and empty, loading, error and retry states; fixture data covering macro views, CJK titles, parsed and unparsed levels, reuse and failed runs; registry CI for new columns; this report. Spec section 9 has no phase-5 row. The criteria below come from the F77 requirement and the standalone build loop's browser matrix.

**Verdict: met in fixture mode, before merge, with one criterion deferred.** Every surface passed at both widths and in both themes (112 of 112 matrix cells). All 11 recorded flows passed. The five checks are green. Loading states were not captured on screen and are deferred in `gate-debt.md`. This is a pre-merge gate: F56–F76 are `in-review` on PR #19 and none is `merged`, so the gate describes the PR branch, not the main line. Nothing here measures live providers, accuracy or parity with LeapEdge.

Artifacts: `docs/gates/phase-5-baseline.json` (matrix, flows, console errors, overflow and check results), `tests/phase-5-gate.test.ts`, `scripts/seed-phase5.ts`.

## Build evidence

| Feature | Commit | Evidence |
|---|---|---|
| F56 Research query API | `cf497ca` | `repos/research-query.ts`, `actions/query.ts`; `tests/research-query.test.ts` |
| F57 UX foundations | `c00d38b` | `ui/SplitBar.tsx`, `ui/url-state-core.ts`, `ui/navigation.ts`, `styles/foundations.css`; `tests/ui-foundations.test.ts` |
| F58 Trading day and time zone | `d3ae568` | `trading-day.ts`, `ui/TradingDay.tsx`; `tests/trading-day.test.ts` |
| F59 Macro, theme and sector views | `91cb4a6` | `instrument-kind.ts`, `ui/InstrumentLabel.tsx`; `tests/instrument-kind.test.ts` |
| F60 Richer call fields | `cdf8b89` | `level-parse.ts`, migration `0010_call_fields.sql`, prompt v9; `tests/level-parse.test.ts` |
| F61 Verdict, summary, key points | `b37c7db` | `verdict.ts`, `ui/Verdict.tsx`, `pages/Analysis.tsx`; `tests/verdict.test.ts` |
| F62 Search | `e925b56` | `pages/Search.tsx`, `ui/search-state.ts`; `tests/search-page.test.ts` |
| F63 Export | `f6db45e`, `ab976ae` | `server/.../export.ts`, `export-columns.ts`, `ui/ExportMenu.tsx`; `tests/export.test.ts` |
| F64 Daily report and archive | `05b57ba` | `pages/Report.tsx`, `server/.../daily-report.ts`, `ui/ReportSummaryCard.tsx`; `tests/daily-report.test.ts` |
| F65 Trends | `9a93a23` | `pages/Trends.tsx`, `trends-series.ts`, `ui/charts.tsx`; `tests/trends-series.test.ts` |
| F66 Channel page | `6b48625` | `pages/Channel.tsx`, `channel-page.ts`; `tests/channel-page.test.ts` |
| F67 Channels list | `32fc7c7` | `pages/Channels.tsx`, `channel-stats.ts`, `metrics/channel-columns.ts`; `tests/channel-stats.test.ts` |
| F68 Watchlist | `b62962c` | `ui/Watchlist.tsx`, `ui/PinButton.tsx`, `watchlist.ts`; `tests/watchlist.test.ts` |
| F69 24-hour trending | `3240dda` | `metrics/sentiment-window.ts`, `ui/SentimentPanel.tsx`; `tests/sentiment-window.test.ts` |
| F70 Unread markers | `27f5e76` | `ui/unread.ts`, `ui/UnreadDot.tsx`; `tests/unread.test.ts` |
| F71 Follow prompt | `f2b2b28` | `follow-prompt.ts`, `ui/FollowPrompt.tsx`; `tests/follow-prompt.test.ts` |
| F72 Live progress and Retry | `ce4ea4f`, `88a3321` | `progress-steps.ts`, `ui/StepProgress.tsx`, `run-progress.ts`; `tests/progress-steps.test.ts` |
| F73 Token counts | `a7b7086` | `call-usage.ts`, `ui/CallUsageTable.tsx`; `tests/call-usage.test.ts` |
| F74 Reuse finished analyses | `5b31d2d` | `server/.../reuse.ts`; `tests/run-reuse.test.ts` |
| F75 Saved calls | `a1a1901` | `pages/Saved.tsx`, `saved-calls.ts`; `tests/saved-calls.test.ts` |
| F76 Quick search | `8b04681` | `ui/CommandPalette.tsx`, `ui/command-palette.ts`; `tests/command-palette.test.ts` |
| Wiring | `c40856b` | Report card on Today; unread dots on Search and channel pages |
| F77 gate | `6c68bb5`, `0a91caf` and the fixes below | `scripts/seed-phase5.ts`, `tests/phase-5-gate.test.ts`, this report, `phase-5-baseline.json` |

`tests/phase-5-gate.test.ts` checks that every file and test the ledger names for F56–F76 exists.

### Defects found by the gate and fixed

| Commit | Fix | Test |
|---|---|---|
| `f66447d` | Chart/Table switch hidden on Trends and the channel page | browser matrix |
| `afa1bf9` | Report source verdict lines showed raw macro and sector keys | `tests/daily-report.test.ts` |
| `85e3112` | Page-wide horizontal overflow on Today at 390 px | browser matrix (overflow) |
| `77ffe9b` | Failed-analysis empty state said the video had no calls | browser matrix |
| `5519b1f` | Analysis tab labels cut off at phone width | browser matrix |
| `ae02fc3` | Quick search sent a typed ticker to Trends on Enter; it now opens Search | `tests/command-palette.test.ts`, flow `palette-ctrl-k-ticker-enter` |
| `19edc94` | Column headings on the Trends and report tables were faded in light and blue-filled in dark | browser matrix |
| `6e8fc97` | Search video rows ran macro labels together ("Macro · Gold Macro · Oil") | `tests/search-page.test.ts` |
| `067688a` | Chart lane labels were drawn illegibly over the first column | browser matrix |
| `11e1023` | Report and channel-page source lines ran instrument labels together | `tests/daily-report.test.ts` |

## Checks

These were run on commit `11e1023` under Node 24.21.0, with suite concurrency 3 because memory is limited.

| Command | Result |
|---|---|
| `node --experimental-strip-types --test --test-concurrency=3 tests/*.test.ts` | 1001 tests: 1000 pass, 0 fail, 1 skipped (the real-Postgres process-kill test, which needs a real Postgres URL) |
| same with `YTI_DB=pglite` | 1001 tests: 1000 pass, 0 fail, 1 skipped |
| `npm run typecheck` | clean |
| `npm run build` | clean |
| `node --experimental-strip-types scripts/promotion-gate.ts --offline` | exit 0, `verdict: advisory-only`, `binding.total: 0`. **The gate measured nothing**, and `pass: true` means only that nothing could fail. |
| `npm audit --omit=dev` | found 0 vulnerabilities |

## Exit criteria

| Criterion | Verdict | Evidence |
|---|---|---|
| Browser and visual matrix for every new or changed surface at 1440×1000 and 390×844, light and dark | **met** | `phase-5-baseline.json` → `matrix`: 28 surfaces × 4 variants = 112 cells, 112 pass, 0 fail. A cell passes when it loads, its content checks are found, it has no page-wide overflow and it logs no application console errors. The surfaces: Today; Report latest, a past session and the archive; Search calls and videos with filters, and empty; Trends by ticker with price, by channel, and as a table; the channel page; Channels and the add drawer; Analysis completed, CJK, unfollowed, no-ideas, failed with Retry, running with progress, and queued; Saved Open, Reviewed, Removed and All; Leaderboard; Settings; Methodology; the palette open. The screenshots were inspected, and the defects above came from that inspection. |
| Keyboard-critical flows | **met** | Flows `keyboard-search-filters-and-palette`: Tab reaches the Search facet filters, which have a visible focus style; Enter applies Bullish; Tab then Enter opens the palette from the sidebar; ↓ moves the active option; Escape closes it and returns focus. `palette-ctrl-k-ticker-enter`: Ctrl+K focuses the combobox, and Enter on NVDA opens Search filtered to NVDA. |
| Other key flows | **met** | All 11 flows pass: Search chips and Clear all; Load 50 more; Trends column click narrows the drill list; Report prev/next skips the weekend (Mon 28 ↔ Fri 25 Sep); Saved tab switching; Delete permanently offered only in Removed, where Cancel closes the confirmation without deleting; unread dots and the sidebar "N new" count drop by one after an analysis is opened; the Today Levels column toggle; watchlist tabs (4 pins, including PLTR with "No price"); the phone palette and More menu. |
| Empty, error and retry states | **met** | Matrix cells `search-empty` (a "No calls match" message plus a one-click removal suggestion), `leaderboard` (no eligible records), `analysis-no-ideas` ("No investable ideas"), `analysis-failed` (stopped at step 2, Retry from step 2, and an honest empty state), `analysis-running` (step 4 of 5 with elapsed time) and `analysis-queued`. |
| Loading states | **deferred** | Loading was not captured on screen, because it is transient against a local fixture database. The code renders `role="status"` placeholders, but a screenshot was not taken. Listed in `gate-debt.md` §3 (phase 5). |
| Fixture coverage | **met** | `scripts/seed-phase5.ts`: 4 channels, one Chinese-language and one unfollowed. 100 completed analyses: 12 recent and 88 history over 58 sessions, with a Friday-evening-ET upload and a weekend upload that both roll into Mon 28 Sep. All three sentiments, plus macro (rates, oil, gold, USD, growth) and sector (semis) calls. CJK titles. Parsed and unparsed levels, catalysts and actions. One expiry soon (2 Oct) and one expired (25 Sep). Trust L0, L1 and L2. One failed, one running and one queued run. Recent runs carry the current pipeline identity, so they are reusable (F74). 4 pins, 9 price series over 84 sessions, and saved ideas in the open, done and dismissed states. The guard refuses any database but a local `yti_phase5_gate` with `YTI_ISOLATED_DB=true` and `YTI_FIXTURE_MODE=true`; `tests/phase-5-gate.test.ts` checks that as a pure function. |
| Registry CI for new columns | **met** | `tests/phase-5-gate.test.ts` checks that `today.calls`, `report.calls`, `trends.periods`, `channels.followed`, `analysis.modelCalls` and `lab.stepUsage` are in the UI column manifest and map to registry ids. It also checks that every literal `<MetricHeading id>` in those sources is in the manifest, and that the Today and Channels templated ids match. `tests/metrics-registry.test.ts` checks every manifest row against the registry. |
| Routes and navigation | **met** | `tests/phase-5-gate.test.ts`: every phase-5 path resolves through `resolveRoute`, and every sidebar entry and phone tab resolves through `routeFromHref`. |
| Five checks green | **met** | See Checks above. |
| No page-wide horizontal overflow at 390 px | **met** | `overflow390`: 28 pages × 2 themes, and `scrollWidth ≤ innerWidth` on all 56. Wide content (the watchlist strip and tables) scrolls inside its own panel. |
| No application console errors | **met** | 0 application errors across the matrix and flows. There are 56 `net::ERR_CERT_AUTHORITY_INVALID` entries, all on Analysis pages. They come from the YouTube player and thumbnail requests through the sandbox HTTPS proxy, and the page shows its player-blocked fallback. |

## Honesty notes

- **Fixture mode only.** All data is synthetic, from `scripts/seed-phase5.ts`, and runs with `YTI_FIXTURE_MODE=true` against an isolated local Postgres behind `next dev`. The fixture banner shows on every page. No provider, YouTube, price or LeapEdge call was made.
- **Pre-merge.** Measured on local commit `11e1023`, five commits ahead of the PR #19 head `6c68bb5` and not pushed. F56–F76 are `in-review`, not `merged`. The full matrix ran before `11e1023`. The report, channel-page and search-videos cells were re-run after it.
- **No LeapEdge comparison and no live-provider run.** Nothing here is evidence of extraction accuracy, provider quality or parity with LeapEdge. A comparison, when run, is reported separately and never counted as verified accuracy.
- **The offline promotion gate is advisory-only.** `binding.total` is 0, so it measured nothing.
- **Screenshots** are working files in the session scratchpad and are not committed. `phase-5-baseline.json` records each cell's file name, checks, overflow and console output.

## Open items carried forward

1. **Loading states** (deferred above). Screenshot each page with the query API delayed.
2. ~~**Saved "Since saved: No price"** appears when no close exists after the save date, for example for a call saved in the current session. The wording should say that no close has happened yet.~~ Fixed after the gate: when a price series exists but has no close on or after the call's session, the card reads "No close since <date> yet" (test in `tests/saved-calls.test.ts`).
3. ~~**The Saved sort select is truncated at 390 px** ("By session, newest fi…").~~ Fixed after the gate: filter labels take the full width below 560 px, so the sort select is not cut off (checked at 390 px).
4. ~~**Analysis copy on runs without calls.** The no-ideas empty state mentions "key points above and Research context below" when there are none, and "Summary appears after the research brief is generated" also shows on failed and running runs.~~ Fixed after the gate: the no-ideas copy mentions key points and Research context only when they exist, and the summary placeholder no longer shows on failed runs (it already stayed hidden while running).
5. ~~**The trust count strip** on Analysis draws the Audio-agreed and Human-verified pills filled even at a count of 0. This predates phase 5. It should be reviewed so that a zero count never reads like a human-reviewed badge.~~ Fixed after the gate: a zero-count trust pill renders as a dashed outline in muted ink in both themes, never a filled badge (checked in dark mode).
6. ~~**`verdictLineText`** (F61), used as the verdict box's `title`, still joins instrument labels with spaces.~~ Fixed after the gate: `verdictLineText` joins instruments with commas (test in `tests/verdict.test.ts`).
7. **The Leaderboard shows no eligible records** under the fixture at its default trust and horizon, so a leaderboard with settled records was not exercised in this matrix (phase 3 covers it in tests).
8. **Today's Video activity** makes the phone page about 10,000 px long before "Load older activity". A shorter first page on phones would help.
9. **Not in the matrix:** a tablet width, the Lab page (F73's step-usage table is covered by tests and the registry check only), and submitting a duplicate URL for reuse (F74 is covered by `tests/run-reuse.test.ts`).
10. **YouTube playback** could not be exercised because the sandbox proxy blocks the player. Timestamp links were checked only as links.

## Re-verified after merging main (30 September 2026)

Before merge, `main` was merged into this branch (commit 1804efc). `main` had moved on with the analyst-view session's work: prompt v9/v10 structured ideas, the analyst view, listing resolution (migration 0009) and pipeline hardening. Four overlaps were reconciled so that main's work keeps its behaviour:

- **Prompts.** Phase 5's own "v9" became `evidence-first.web.v11`, which is main's v10 plus expiry and macro theme. It is opt-in, and the team default stays v8.
- **Claim contract.** Claims use main's `action` enum and dated `catalysts`. F60 adds only `expiry` and `macro_theme`.
- **Migration 0010.** It follows main's 0009 and stores main's fields.
- **Analysis page.** Main's analyst view is the primary summary whenever a run has one.

Checks on the merged head (Node 24):

| Check | Result |
|---|---|
| `npm test` and `YTI_DB=pglite npm test` | 1038 tests, 1037 pass, 1 skipped (the existing real-Postgres test) |
| Typecheck and build | Clean |
| Offline promotion gate | Advisory only (`binding.total` 0) |
| GitHub `verify` and the Vercel preview | Green |

The phase-5 fixture database was re-seeded on the reconciled schema (10 migrations). The browser matrix passed again at 112/112 cells, and all 11 flows passed. The only console errors were from the sandbox blocking the YouTube player.

Impact on other work:
- **The paired-comparison harness** submits through `/api/intelligence/runs`, which never reuses a finished run (F74).
- **Main's prompt versions v1–v10** keep their exact bytes.
- **Open PR #22** (Jev pre-screen) merges onto this head with three trivial conflicts: two import and settings-key lists, and the action-count and ledger-date lines. With those resolved, its typecheck and affected tests pass.
