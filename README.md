# YouTube Intelligence

Standalone research lab for **Finradar → Intelligence → YouTube Intelligence**.

Hosted app: https://youtube-intelligence-two.vercel.app (private workspace access required).
The historical GitHub repository name, `leapedge-study`, is not the product name.

## What works

- Durable video-analysis jobs with multilingual source text, English synthesis, original quotes, timestamp links, deterministic evidence checks and separate model critique.
- TranscriptAPI native captions as the draft source, Supadata on standby behind a per-vendor circuit breaker, timed transcript import and Gemini video fallback. A video with no captions at either vendor returns nothing rather than spending standby credits. Incomplete or invalid sources stop for review.
- Channel follow/favourite, latest/older upload discovery, opt-in automatic analysis, per-channel research and trends.
- Saved ideas and notes, search facets, dated direction changes, daily evidence synthesis, timezone scheduling, Resend delivery and expiring/revocable public snapshots.
- Adjusted-price FMP/SPY comparisons, separate historical replay and immutable forward observations. Missing and stale prices are excluded explicitly.
- Versioned prompts, frozen-source A/B experiments, model/token/cost records, append-only reviews and improvement outcomes.

Account, subscription, credits and billing management are excluded. The access gate and provider spend ledger are included.

## Run locally

Node 24 is required. `npm ci --ignore-scripts`, copy `.env.example` to `.env`, configure server-side credentials, then run:

```sh
npm run dev -- --port 3101
# Separate terminal, same working directory:
npm run worker
```

Local development requires an isolated Postgres database configured through `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. `YTI_DB=pglite` is an in-process test database; separate web and worker processes do not share it. The hosted deployment uses **Next.js + Vercel Functions/Cron + Neon Postgres + OpenRouter + YouTube Data API + FMP + Resend**. No Python hosting is required. Retired v1 research code — the Python experiments and the one-off evidence scripts — is kept under `scripts/archive/`, excluded from the typecheck and never deployed.

The Vercel cron advances leased, checkpointed stages. Closing the browser does not stop research. Paid requests are bounded and conservatively reserved; uncertain outcomes remain reserved and are not automatically retried. `YTI_BUDGET_USD` is a cumulative USD ledger ceiling, not a monthly rollover or account billing feature.

## Verify

```sh
npm test
npm run typecheck
npm run build
node --experimental-strip-types scripts/promotion-gate.ts --offline
npm audit --omit=dev
```

All five run without credentials and are what CI runs. The offline promotion
gate replays stored runs against the gold set; it makes no model calls and
costs nothing.

## Current completion scope

Complete Phase 2 and Phase 3, then stop before Phase 4 / Finradar integration.
See [the standalone build loop](docs/delivery/standalone-build-loop.md) and
[its scope manifest](docs/delivery/standalone-scope.json).

The user removed the fifty human-verified gold cases from scope on 19 September
2026. Build verification uses tests, real Postgres concurrency and browser/visual
evidence. LeapEdge output comparison follows the build using available video
links and TrueAlphaData/LeapEdge channels. The legacy gold command above is a
regression diagnostic only; its advisory result neither blocks delivery nor
establishes quality. Agreement with LeapEdge is not independent ground truth.

## Evidence and deployment

- [Delivery review, 18 September 2026](docs/review/delivery-review-20260918.md)
- [Spec and build plan](docs/spec/)
- [Deployment, operation and recovery](docs/production-and-integration.md)
- [Finradar integration handoff](docs/finradar-module-handoff.md)
- [v1 acceptance record and archived evidence](docs/archive/README.md)

Generated timestamps and model critique are not independent proof of what was spoken. The lab exposes that uncertainty. Model/provider availability and transcript access can fail; no universal LeapEdge-quality guarantee is claimed. Historical return replay cannot substitute for an accumulated forward record.
