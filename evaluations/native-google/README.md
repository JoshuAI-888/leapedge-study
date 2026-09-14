# Native Google-only ingestion experiment

Isolated from application dependencies and Vercel uploads. Uses published `@google/genai` 2.22.0 and a committed lockfile. No production route changes. The question is whether native Google can replace all transcript providers; caption-first/Google-fallback is the alternative if Google-only fails the quality/cost/latency gates.

## Current evidence

Nine controlled tests pass, including real SDK HTTP requests to a local fixture: structured video/offset serialization, one attempt on HTTP503, connected cancellation, truncation, empty output, timestamp bounds, unknown usage and immutable budgeted artifacts. TypeScript compilation passes. These do not establish live YouTube access or audio accuracy.

The user configured GEMINI_API_KEY. Model access and independent YouTube metadata preflight succeeded. One English-control generation was rejected in 345ms with HTTP429 RESOURCE_EXHAUSTED: Gemini prepayment credits depleted. No transcript was returned; this is a billing blocker, not an ingestion failure. The attempt and NZ$2.50 reservation are retained. Do not rerun the identical configuration blindly: after confirmed funding, create an explicitly linked retry without deleting the rejected record.

## Reproduce

From the repository root:

```sh
npm ci --prefix evaluations/native-google --ignore-scripts
npm --prefix evaluations/native-google run typecheck
npm --prefix evaluations/native-google test
```

Place an enabled native Gemini key in the root ignored `.env` as `GEMINI_API_KEY`; retain `YOUTUBE_API_KEY` for independent duration metadata. Do not put credentials in command arguments or reports.

```sh
# Read-only model access and YouTube metadata preflight, no generation:
node --env-file=.env --experimental-strip-types evaluations/native-google/runner.ts english
# One generation, explicitly submitted:
node --env-file=.env --experimental-strip-types evaluations/native-google/runner.ts english --execute
```

First phase cases: `english` (short English control), `alpha` (CMjt6f4eVdA captionless), `macro` (J25UuUqHT3Y captionless), `offset` (60–120 seconds of the English control). Run one at a time and inspect each result before the next. The same configuration cannot be submitted twice. This runner deliberately does not yet expose repeated rounds, agentic mode, alternate models or automatic repair; extend only after inspecting feasibility results.

## Budget and artifacts

New campaign directory: ignored `data/native-google-20260915`. Before sending a model request, reserve NZ$2.50 under the NZ$10 feasibility cap. The complete approved campaign cap is NZ$50 / 60 model requests, but this runner restricts itself to phase one. Reservations are retained after every outcome until reconciliation. No automatic retries/top-ups. Requests use LOW thinking level and a 32,768 output cap; a thinking level is not itself a numeric hard limit. A stale lock or recorded attempt requires inspection, not blind deletion.

NZ$2.50 is a conservative reservation, not an exchange-rate quote: it accommodates up to 1.1M input tokens plus 32,768 output plus an additional conservative 32,768-token thought allowance at recorded 3.8 Flash rates, using a conservative NZ$2 per US$1 conversion and additional margin. Verify model pricing/access before subsequent phases. Input beyond context limits is an explicit provider failure, not a reason to increase spend automatically.

Raw responses, usage, configuration, source intervals and metadata remain private. Errors are redacted against supplied keys. Unique files cannot overwrite earlier attempts. The model's language, omissions and timestamps are assertions pending review. Missing token counts yield unknown cost; any returned estimate excludes discounts and is not confirmed billing. Static sampling and segment coverage do not prove complete speech recall. Unknown media access is not inferred from token totals.

## Promotion

No sources from this harness become canonical reports automatically. Normalize and review them first, attach independent audio-reference windows, then run unchanged v5 synthesis for the same-source quality comparison. Retain failures and missing tails. Follow `docs/native-google-ingestion-plan.md` before changing production routing or retiring providers.
