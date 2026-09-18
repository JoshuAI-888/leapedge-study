> Historical implementation notes. Current deployment uses Neon/Postgres and isolates Promptfoo in `evaluations/tooling`. See [completion report](completion-report.md) and [operations](production-and-integration.md).

# YouTube.js and Promptfoo integration

Implemented 13 September 2026 in the standalone YouTube Intelligence lab. This change does not complete the separate Neon/Vercel persistence migration.

## Caption path

Imported source / retained native cache → YouTube.js free retrieval → optional configured Supadata native retrieval → existing budgeted Gemini transcription fallback. Set `YTI_YOUTUBEJS_ENABLED=false` to disable the new extractor. No browser cookies, account credentials, external proxy or paid transcript account is used by YouTube.js.

The adapter retains supplied caption text and segment boundaries, language/track metadata where exposed, source hash, attempt duration and retrieval outcome. Generated/manual track type remains unknown if it cannot be matched. Caption text is not labelled audio-verified. Invalid payloads fail validation; failed attempts cool down for 15 minutes. Successes are cached across model comparisons. Paid fallback remains subject to the existing ledger and budget cap.

Run a free extraction probe (no model calls):

```sh
npm run test:captions -- 3u24qyWjSVM kXYvRR7gV2E wkAqHlYL7bQ
```

**Actual live result:** all three failed retrieval on this machine. Diagnostic checks returned `UNPLAYABLE` / `Video unavailable` and transcript HTTP 400. Both locally generated and server-generated session configurations were tried; neither solved the English diagnostic case. This does not prove videos lack captions, or identify the cause as IP blocking. No successful live caption retrieval or Vercel retrieval is claimed. Mock tests verify normalization, cache, malformed responses and fallback behavior.

Attempts are visible under Research → Settings → Free caption retrieval history.

## Evaluations

Promptfoo is a development dependency, not imported by the deployed application. The current provider replays existing full-pipeline outputs; it cannot initiate paid model calls. This isolates regression evaluation from generation costs and retains the model/prompt/source information.

```sh
# Default historical comparison: intentionally exits 1 when older outputs fail.
npm run eval:replay

# Evaluate any newly completed runs from the existing app/pipeline.
npm run eval:replay -- RUN_ID_A RUN_ID_B
```

Queue new model/prompt variants through the existing lab, then supply their run IDs. This preserves the application's spending and uncertain-retry controls. The evaluator does not yet launch fresh model variants itself.

Results are written to `data/evaluations/<id>.json` and the persistent Evaluation Lab. Full artifacts include frozen outputs and the check code/hash. The visible table shows model, prompt version, findings and outcome. Original generation cost is distinct from zero new replay cost. Telemetry is disabled and results are not shared with Promptfoo Cloud.

`evaluations/checks.ts` checks accepted claims against retained verbatim quotes, explicit tickers/prices and audit verdicts. Video-specific checks cover separate VOO/QQQ ideas, Reddit monitoring, macro context and educational no-trade output. These expectations are provisional retained-text review criteria. They do not establish audio fidelity, comprehensive recall or independent semantic correctness. Use the human-review comparisons for those questions.

**Actual first replay:** five saved outputs, two passes, three failures, zero provider errors and zero new model spend. Gemini 3.5/v3 Chinese analysis and Gemini 3.8/v3 educational analysis passed. Earlier outputs were flagged for missing separate ETFs, Reddit discussion or insufficient macro coverage. These are regression results, not accuracy percentages or a fresh randomized model trial.

## Validation and remaining deployment caveats

24 unit/integration tests passed and the Next production build passed after integration. Browser inspection confirmed the persisted evaluation is displayed. Free retrieval has not succeeded live; the current fallback remains necessary. Neon/Vercel migration remains separate work.

`npm audit fix` applied compatible updates. Promptfoo's development dependency tree still reports seven high advisories involving optional archive/native-image/transformer/security-tool paths; no forced downgrade was applied. Do not enable those unrelated features or install their native/browser payloads for this replay harness. Review/resolve those advisories before publishing a general-purpose evaluation service. The production dependency audit is recorded separately.
