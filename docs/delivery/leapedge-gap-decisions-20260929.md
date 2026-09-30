# LeapEdge feature gaps — scope decisions, 29 September 2026

Source: a teardown of leapedge.app captured 29 Sep 2026 (logged in as a Pro user), compared
against this repository at `main` on the same day. The user decided each gap one by one.
Billing, quotas, auth, public share links, social sharing, favourites and marketing pages
were excluded by default (the product is not sold).

These decisions are **scope, not delivery**. Nothing here is built yet. The accepted items are
build-plan phase 5 in the ledger (F56–F77); their UI/UX requirements are in
`leapedge-gap-ux-proposals-20260929.md`, with wireframes in `docs/spec/mockups/LeapEdgeGaps.html`.

## Already present — no work

| LeapEdge capability | Where it lives here |
|---|---|
| Auto-ingest of new uploads | PubSubHubbub + polling (`push.ts`, `channels.ts` `pullDue`; F39) |
| Creator leaderboard vs SPY | `Leaderboard.tsx`, `leaderboard.ts` (Wilson, t, p, BH q; F36/F46) |
| Verbatim quote, English translation, play-from timestamp | `Analysis.tsx`, `SourcePlayer.tsx` (F12/F14/F47) |
| Self-critique that drops drifted claims | `schemas/critique.ts`, `briefing-pipeline.ts` (F15) |
| No-caption fallback | Windowed ASR, Whisper tie-break, Supadata standby (F18/F32/F34) |
| Light/dark/system theme | `Settings.tsx`, `Shell.tsx` |
| Mobile layout | `Shell.tsx`, `workspace.css` |

## Decisions

| # | Gap | Decision | Scope agreed | Ledger |
|---|---|---|---|---|
| 1 | Daily cross-creator report page + archive | **In** | Page with themed narrative, ranked in-focus tickers with source counts, direction split, source runs; archive of past days. Builds on `briefings.ts` / `briefing-pipeline.ts`. | F64 |
| 2 | Faceted search / archive | **In** | Facets (ticker, channel, direction, conviction, window, title) with live counts; aggregate panel; URL-persisted filters; pagination; substring title match. | F62 |
| 3 | Trends dashboard | **In** | View by channel / ticker / direction; 1d–1y/all; KPI tiles; calls-over-time scatter; drill list; state in URL. | F65 |
| 4 | Per-channel page | **In** | Streams, calls, lean, typical conviction, top tickers, benchmark record, analyses list, link to filtered search. | F66 |
| 5 | Verdict box, summary, numbered key points | **In** | On the analysis page and compactly on list cards; explicit "no investable ideas" state. | F61 |
| 6 | Richer call fields | **In** | Catalysts, expiry, recommended action, numeric level parsing (original text kept); levels shown on cards. Prompt/schema version bump. | F60 |
| 7 | Reuse completed analyses | **In** | Same video + pipeline/prompt version returns the finished run at $0; explicit Re-run forces a paid run. | F74 |
| 8 | Watchlist with price context | **In** | Today panel: today's tickers + pinned tickers, sparkline, % change, mention count; existing price source. | F68 |
| 9 | Morning email digest | **Out** | Stays in F54 (phase 4). | — |
| 10 | CSV / JSON export | **In** | From search (filtered set), channel page and daily report. | F63 |
| 11 | Channels list stats | **In** | Last pull, pulls/7d, top ticker, lean bar, live "analysing" status; sort by activity / recently added. | F67 |
| 12 | Live stage stepper + general Retry | **In** | Stepper with elapsed time; Retry resumes from last checkpoint without duplicate spend. | F72 |
| 13 | Macro / theme / sector views | **In** | Labelled (e.g. MACRO: rates, SECTOR: semis) and aggregated in report, search, trends, trending. | F59 |
| 14 | US trading day + team timezone | **In** | Daily boundaries by US trading day (ET, holiday-aware); display timezone set in Settings. | F58 |
| 15 | 24h trending | **In** | 24h window on the existing sentiment panel, vs prior 24h. | F69 |
| 16 | Cmd/Ctrl+K quick search | **In** | Global palette over tickers, channels, titles (substring). | F76 |
| 17 | Saved ideas improvements | **In** | Group by call date, show levels/catalysts/expiry, hard delete. | F75 |
| 18 | Unread markers | **In** | Per-browser (shared passcode, no per-user accounts) unread dots and "new since last visit" count. | F70 |
| 19 | Follow-channel prompt on analysis | **In** | Banner on analyses from unfollowed channels, with cost projection before confirming. | F71 |
| 20 | Token disclosure | **In** | Per-stage input/output tokens and the model-call list in Processing details. | F73 |

Foundations added with them: F56 (research query API), F57 (UX foundations and screenshot-audit
fixes). Gate: F77.

## UX decisions D1–D4 (accepted 29 September 2026)

After reviewing the UX proposals the user answered "Yes" to recording them and adding the features
to the ledger, which accepts the four recommended resolutions (spec §7.6):

- **D1** Step progress only while a run is working; finished runs keep the four states.
- **D2** Grouped module sidebar; quick search in the side panel, not Finradar's top bar.
- **D3** "Material developments" moves from Today to the Daily report page.
- **D4** Periods, ranges and filters are URL view state and never write a setting.

## Suggested build order

Dependencies first, then highest analyst value: 14 (trading day) and 13 (macro labels) and 6
(call fields) are data foundations used by 1, 2, 3 and 8. Then 1 → 2 → 3 → 4 → 5 → 10, then the
smaller items (7, 11, 12, 15, 16, 17, 18, 19, 20).
