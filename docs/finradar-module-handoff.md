# YouTube Intelligence integration handoff

The standalone lab is deployed on Vercel with a separate Neon database. Product name: **YouTube Intelligence**. Finradar placement: **Intelligence → YouTube Intelligence**. The GitHub repository name is not a product/menu label.

## Integration boundary

Inspected Finradar commit: `2747859c087dc1626e43b2b6fdb5871ede784247`. Re-check current contracts before integration; Finradar has other active development streams.

| Standalone component | Finradar integration |
|---|---|
| `src/features/youtube-intelligence` | Reuse domain contracts, source checks, chunking, performance and research components; replace root-relative links with the module route. |
| `src/server/youtube-intelligence/database.ts` | Replace the standalone pool with `src/server/platform/db.ts:getPool`; add reviewed migrations through the existing migration system. Do not auto-create tables per request in the integrated app. |
| `store.ts` leases and reservations | Adapt to `src/server/platform/tasks.ts` and `budget.ts`, preserving idempotent stage keys, fencing, retained responses and uncertain-call behavior. |
| Private workspace cookie | Replace with existing Finradar authenticated owner context; scope every document, share, queue and query by owner. Do not introduce a second account system. |
| `market.ts` | Reuse Finradar's issuer/listing resolution and FMP transport/cache. Keep adjusted prices, matching SPY sessions and explicit eligibility. |
| Resend sender/scheduler | Use the existing email transport and delivery events. Do not duplicate email credentials or subscription billing. |
| Evaluation checks and artifacts | Keep prompt snapshots, source hashes, request limits, model/token/cost history and improvement outcomes. Promptfoo stays an isolated development tool. |

## Routes to add through the integration owner

- `/youtube-intelligence`: research workspace under Intelligence navigation.
- `/youtube-intelligence/analysis/[id]`: addressable evidence report.
- Module-scoped API routes and dispatch hooks using existing platform auth/tasks.
- Public frozen reports retain expiring/revocable capability URLs and exclude private preferences/keys.

## Invariants to retain

1. English synthesis, original-language quotations, explicit source provenance and timestamp uncertainty.
2. Index references never silently become ETF tickers; stops never become entries.
3. Failed/unavailable/incomplete/empty/stale states stay distinct.
4. A/B runs do not silently replace collection reports or rewrite the first forward observation.
5. Browsing does not trigger model charges; uncertain paid calls are not silently retried.
6. Channel returns are per-call descriptive statistics, not portfolio returns. Historical replay is clearly separate from forward tracking.
7. No new account/subscription/credits/billing product is included.

The current standalone lab is single-workspace by design. It must receive owner scoping before being exposed as a multi-user Finradar module. This handoff does not claim that a Finradar merge has occurred.
