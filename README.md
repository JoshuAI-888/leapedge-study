# YouTube Intelligence

Standalone research lab for **Finradar → Intelligence → YouTube Intelligence**.

Hosted app: https://youtube-intelligence-two.vercel.app (private workspace access required).
The historical GitHub repository name, `leapedge-study`, is not the product name.

## What works

- Durable video-analysis jobs with multilingual source text, English synthesis, original quotes, timestamp links, deterministic evidence checks and separate model critique.
- Free YouTube.js caption retrieval, optional Supadata native-caption adapter, timed transcript import and Gemini video fallback. Incomplete or invalid sources stop for review.
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

Local development uses SQLite unless `DATABASE_URL` is set. The hosted deployment uses **Next.js + Vercel Functions/Cron + Neon Postgres + OpenRouter + YouTube Data API + FMP + Resend**. No Python hosting is required. Historical Python experiments remain available under `leapstudy/` and are not deployed.

The Vercel cron advances leased, checkpointed stages. Closing the browser does not stop research. Paid requests are bounded and conservatively reserved; uncertain outcomes remain reserved and are not automatically retried. `YTI_BUDGET_USD` is a cumulative USD ledger ceiling, not a monthly rollover or account billing feature.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Optional Promptfoo replay is isolated from app dependencies and deployment:

```sh
npm ci --prefix evaluations/tooling --ignore-scripts
node --env-file=.env --experimental-strip-types scripts/evaluate.ts RUN_ID RUN_ID
```

Use only trusted local evaluation configuration. The separate Promptfoo dependency tree has documented advisories; it is not installed in the hosted app. Replay performs no new model calls. Fresh paid A/B runs are available in Evaluation lab.

## Evidence and deployment

- [Completion and verification record](docs/completion-report.md)
- [Feature parity and intentional differences](docs/implementation-checklist.md)
- [Deployment, operation and recovery](docs/production-and-integration.md)
- [Finradar integration handoff](docs/finradar-module-handoff.md)
- [Initial model research](docs/benchmark-findings.md)

Generated timestamps and model critique are not independent proof of what was spoken. The lab exposes that uncertainty. Model/provider availability and transcript access can fail; no universal LeapEdge-quality guarantee is claimed. Historical return replay cannot substitute for an accumulated forward record.
