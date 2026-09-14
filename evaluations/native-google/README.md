# Native Google-only ingestion experiment

Isolated from application dependencies and Vercel uploads. Uses published `@google/genai` 2.22.0 and a committed lockfile. No production route changes. The question is whether native Google can replace all transcript providers; caption-first/Google-fallback is the alternative if Google-only fails the quality/cost/latency gates.

## Current evidence

The detailed [findings white paper](../../docs/native-google-findings-white-paper.md) is the current decision record, including documentation research, all failures, controlled follow-ups and synthesis A/B outcomes. The first-funded assessment remains a historical snapshot.


Fifteen controlled tests pass, including real SDK HTTP requests to a local fixture. Live funding is now working. Native Google returned a short English control, an offset clip and a captionless Mandarin source. Another captionless source was rejected for an out-of-duration timestamp. See `docs/native-google-live-assessment.md` and the immutable attempt summary in `docs/native-google-live-results.json` for the complete results and remaining accuracy limitations.

The original generated `responseJsonSchema` configuration received HTTP400. The simplified Google `responseSchema` format succeeded. The public runner now uses that format, structured fileUri, default static processing and provider-default thinking/media resolution. This is an empirically working configuration, not proof that all JSON-schema configurations are unsupported.

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

First phase cases: `english` (short English control), `alpha` (CMjt6f4eVdA captionless), `macro` (J25UuUqHT3Y captionless), `offset` (60–120 seconds of the English control), `long` and `mandarin` (existing provider benchmarks). Run one at a time and inspect each result before the next. The same configuration cannot be submitted twice. This runner deliberately does not yet expose repeated rounds, agentic mode, alternate models or automatic repair; extend only after inspecting feasibility results.

## Budget and artifacts

New campaign directory: ignored `data/native-google-20260915`. Before sending a model request, reserve NZ$2.50 under the cumulative NZ$35 feasibility/acquisition cap. The complete approved campaign cap is NZ$50 / 60 model requests, with NZ$15 retained for the later review/hosted phase. Reservations are retained after every outcome until reconciliation. No automatic retries/top-ups. Requests use provider-default thinking and a 32,768 output cap. A stale lock or recorded attempt requires inspection, not blind deletion.

NZ$2.50 is a conservative reservation, not an exchange-rate quote: it accommodates up to 1.1M input tokens plus 32,768 output plus an additional conservative 32,768-token thought allowance at recorded 3.8 Flash rates, using a conservative NZ$2 per US$1 conversion and additional margin. Verify model pricing/access before subsequent phases. Input beyond context limits is an explicit provider failure, not a reason to increase spend automatically.

Raw responses, usage, configuration, source intervals and metadata remain private. Errors are redacted against supplied keys. Unique files cannot overwrite earlier attempts. The model's language, omissions and timestamps are assertions pending review. Missing token counts yield unknown cost; any returned estimate excludes discounts and is not confirmed billing. Static sampling and segment coverage do not prove complete speech recall. Unknown media access is not inferred from token totals.

## Promotion

No sources from this harness become canonical reports automatically. Normalize and review them first, attach independent audio-reference windows, then run unchanged v5 synthesis for the same-source quality comparison. Retain failures and missing tails. Follow `docs/native-google-ingestion-plan.md` before changing production routing or retiring providers.

## Follow-up and offline reproduction

`followup.ts` offers `schema-no-max`, `schema-small-max`, `macro-window-a` and `macro-window-b`, with dry-run default. The frozen failing request lives in `fixtures/rejected-schema-request.json`. Both schema variants timed out; both macro windows passed structural checks. Do not retry the uncertain schema requests blindly.

`shadow-synthesis.ts` executes the existing v5 prompts on the retained Alpha source. `--single-segment-quotes` creates the separately labeled candidate. `--execute` is required for either. Raw source/prompt snapshots, per-item failures and critics remain private. No source or prompt is automatically promoted.

Text-only stages use byte/output/thought-based reservations from `text-budget.ts`, sharing the same NZ$50/60-request journal; media reservations remain NZ$2.50. The smaller text reservations do not release previous holds. Current totals and unknown billing are in the white paper.

Offline report commands (from repository root, private artifacts required):

```sh
node --experimental-strip-types evaluations/native-google/compare.mjs
node --experimental-strip-types evaluations/native-google/report.mjs
node evaluations/native-google/whitepaper-appendix.mjs
```

The comparison's edit rates are differences from historical captions, not audio-grounded WER/CER. The generated audio review packet deliberately remains unscored. `snapshot-sources.py` archives consulted public pages with verified TLS; it makes no model calls.
