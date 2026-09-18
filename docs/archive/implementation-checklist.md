# Feature parity and acceptance matrix

Updated 14 September 2026. Product scope is the standalone personal **YouTube Intelligence** lab, prepared for Finradar integration. Account, subscription, credits and billing management are excluded. Provider cost controls are included.

> **Superseded in one row, 18 September 2026.** This is the v1 acceptance record and is kept as it was written. One row has since changed: v2 feature F20 retired the free YouTube.js adapter and the Tapline/BibiGPT adapters, so "Source acquisition" below no longer describes the code. The current chain is TranscriptAPI native captions as the draft, Supadata on standby behind a per-vendor circuit breaker, then the Gemini video fallback. Everything else in this table stands as the record of what was verified on 14–16 September.

| Feature | Delivered behavior | Evidence / difference from LeapEdge |
|---|---|---|
| Video analysis and library | Durable queue, stage/status history, source import/fallback, reports, JSON export, reopen by ID | Live English/Chinese runs; invalid/incomplete source fails closed. Universal source success is not established. |
| English synthesis and original citations | Exact source spans, original quotes, translated quotes, ticker/number validation, semantic critique | Live errors retained. Stops and existing-holder instructions are distinguished from new entries. Generated timestamps remain unverified estimates. |
| Source acquisition | TranscriptAPI native first, Supadata native backup, free YouTube.js, enabled capped Supadata generation, then Gemini fallback | Cloud native retrieval 40/50 after retries; ten missing tracks independently unavailable locally. Supadata generation returned 403; engineering review pending. No universal source-success claim. |
| Channels | Follow/unfollow, favourites, latest/older discovery, opt-in automatic analysis, channel details | Five real channels resolved; 250 uploads retained. Collapsible upload lists reduce scrolling. Failed handle replaced by observed canonical channel ID. |
| Today and daily archive | Local-date evidence digest, cross-source synthesis, independent critique, archive | Actual multi-report synthesis tested; deterministic grouped evidence remains available separately. |
| Saved ideas and watchlist | Save, notes, open/done/dismissed, ticker watchlist | Hosted persistence/state transitions verified. These are research records, not broker orders. |
| Search and trends | Claim-level text/facets, date filters, direction/conviction/instrument summaries, dated changes | Browser empty-state and clearing verified. Dated links replace overlapping scatter points. Different horizons are not automatically called a reversal. |
| Sharing | Frozen filtered research or briefing snapshots, seven-day expiry, immediate revocation | Hosted anonymous read and revoked 404 verified. Shares do not include private settings. LeapEdge's indefinite-until-revoked sharing is intentionally narrowed. |
| Creator versus SPY | Matched adjusted sessions, signed long/short returns, eligibility/staleness checks, per-channel aggregates | Real FMP prices plus independent arithmetic tests. FMP may differ from LeapEdge's Yahoo data. No invented returns for unsupported or unpriced calls. |
| Historical backfill | Older upload discovery and publication-date return replay | Clearly retrospective; cannot prove a recommendation was captured at the time. |
| Forward record | First observed collection report frozen per video; later prompt choices cannot rewrite it | Transactional regression test. A mature 90-day record requires 90 days of actual accumulation. |
| Daily scheduling and email | Timezone/hour settings, one daily job, audited synthesis before delivery, Resend submission, signed event endpoint | Concurrent scheduling/send-once tests pass; live submission accepted. Mailbox receipt and configured live webhook remain external verification items. |
| Prompt/model settings | Bundled immutable prompt versions, editable new versions, model choices, source/model/token/cost provenance | Existing runs retain their prompt and inference configuration. Settings changes do not rewrite history. |
| A/B lab | Fresh same-source model/prompt variants, retained-output Promptfoo replay, comparisons, reviews, improvement proposals/outcomes | Actual paired runs and known failures persisted; LeapEdge reference expectations visible. Automated scores are not audio or human quality scores. |
| Visual design and navigation | Pale blue/white surfaces, blue actions, clear typography, responsive cards, keyboard search, light/dark/system | Browser inspection at desktop and 400px width; Vital-inspired design language, not a pixel-for-pixel clone. |
| Hosted operations | Vercel + separate Neon, private access, authenticated Cron, leases/fencing/reservations, backup/export/restore | Hosted seven-check suite and isolated Postgres concurrency/restore passed. Multi-user owner scoping belongs to Finradar integration. |
| Repository handoff | Portable feature/server boundaries, scripts, tests, CI, runbook, Finradar mapping | Finradar itself is not merged or modified. |

## Explicit acceptance limits

A completed feature is not a guarantee that every generated result equals or exceeds LeapEdge. The comparison corpus is small; missing context and source-fidelity failures are documented in the completion report and lab. LeapEdge's exact prompts, transcript provider, scheduling internals and pricing accounting are not available from UI metadata.

The intended quality differences are stricter evidence and price-role handling, visible rejected claims, reproducible prompt/source versions and honest missing-data states. Remaining source or synthesis shortcomings are recorded as failed/inconclusive results, not silently relabeled as parity.

## 14 September follow-up

Transcript accuracy scoring now has a separate pending/scored record in Settings. Audio-review packets remain unverified until a reviewer independently checks speech and boundaries. Candidate prompt v6 is an experiment; v5 remains the default. Provider order follows the observed native-caption latency results. See `transcript-accuracy-benchmark.md` and `leapedge-source-disclosure.md`.
