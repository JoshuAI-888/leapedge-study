# Channel monitoring acceptance — 9 October 2026

Implemented and merged in [PR 36](https://github.com/JoshuAI-888/leapedge-study/pull/36), commit `6542e4a88304ba281806baa8cfacf3c9c934367c`. Production deployment `dpl_3FmBfo4LPKZFqmYiwkA9pc4Zf4PY` reached READY and owns https://youtube-intelligence-two.vercel.app.

## Final configuration

- App monitoring **off**, saved schedule hourly (`0 * * * *`, UTC), maximum one new analysis per check.
- Vercel Cron Jobs **enabled**, definition `/api/cron/intelligence`, `*/15 * * * *`. This implements the user's explicit choice of a small scheduled check remaining while app monitoring is paused.
- `YTI_CRON_ENABLED=true` in Production only; false in Preview and Development. These targets are separate environment entries. No database credential or model key was changed for this feature.
- One followed test channel, YT Finance (`UC3xKgYs1GqtoPu9tyYSjR8w`), retained for metadata browsing; automatic processing restored to off/on-request. No pending or running jobs at cleanup.
- The live UI reports the existing cumulative model cap as **US$75** and monthly cap as **US$750**. This task did not change those limits.

## Production browser and cron checks

1. Monitoring defaults off. A one-minute cron expression is rejected and Save is disabled.
2. Custom `0 12 * * 1-5` saves while off and survives a browser reload; the displayed next-30-day count is 21.
3. Turning on the toggle without acknowledging costs leaves Save disabled. Acknowledgement allows saving. The temporary test used every 15 minutes, maximum one video, with the explicit last-24-hours option.
4. Check now fetched the real YouTube uploads playlist, retained **50 discoveries**, and returned **one channel, zero queued analyses, zero channel errors**. Latest returned publication was `2026-04-10T01:16:13Z`, before the selected cutoff `2026-10-08T01:51:30.474Z`; zero paid work was the correct result.
5. Vercel's dashboard Run invoked the authenticated production cron endpoint while paused and enabled. Observed requests returned HTTP 200. The enabled check before the next scheduled time did not duplicate discovery or analysis. Final paused request ID: `rhr4q-1791510751692-2284abecc031`.
6. Pausing needs no cost acknowledgement. After reload, monitoring is off, Check now is disabled, and the hourly schedule/one-video limit remain saved.
7. Before and after: **225 runs, 2,000 cost-ledger entries, US$54.606584935 completed ledger cost**. This monitoring test added **US$0 model spend**. Hosting/database resources were used and are not represented by that model ledger.
8. No application console error or HTTP 5xx appeared in the inspected new-deployment test window. Console warnings came from the installed MetaMask Chrome extension. The local development hydration warning came from an extension adding an HTML attribute; it was not reproduced as an application production error.

**Acceptance limit:** No eligible recent upload was available, so this live monitoring test does not prove a new automatically discovered video reaching a published brief. Automatic queuing and pause behavior were tested with controlled fixtures and real PostgreSQL concurrency. Two actual manually submitted videos completed the separate prior pipeline test; see [manual processing](manual-processing.md). No historical upload dates or cutoff were falsified to buy a test analysis.

## Automated and database checks

- Both full local suites: 1,075 tests, **1,074 passed, zero failed, one existing skip** each (`npm test` and `YTI_DB=pglite npm test`).
- Typecheck, production build, offline promotion diagnostics, and dependency audit passed. Promotion diagnostics remain advisory-only and do not establish content accuracy.
- Final feature-head GitHub runs [37871049100](https://github.com/JoshuAI-888/leapedge-study/actions/runs/37871049100) and [37871052453](https://github.com/JoshuAI-888/leapedge-study/actions/runs/37871052453) passed.
- Five monitoring tests cover UTC cron validation/counts, concurrent due ticks, pause during metadata fetch, paused automatic work versus manual processing, and default-off/cost acknowledgement. Ten action contract tests passed.
- Real isolated PostgreSQL: eight concurrent forced ticks produced exactly one metadata request and one queued run, with zero provider/model calls. Pausing then skipped work. Generic PostgreSQL rollback, locking, claim fencing, and reservation checks also passed in a separate clean database.
- Local Next server and test PostgreSQL server stopped after validation. No new runtime dependency or schema migration.

## Cost interpretation

The fixed heartbeat produces 2,880 checks per 30 days even when paused. At the [published Pro invocation rate](https://vercel.com/docs/functions/usage-and-pricing) of US$0.60/million (checked 9 October), invocation-only charges are about **US$0.002 before credits**. CPU, memory, database and network are additional; this is not the total operating cost. The app shows monitoring frequency, selected-channel projections, measured analysis-only average, and both model caps separately. Use the Vercel Cron Jobs switch to stop periodic checks entirely.

For normal use, follow [the step-by-step guide](channel-monitoring.md). Routine app schedule changes require no environment edits or redeploy.
