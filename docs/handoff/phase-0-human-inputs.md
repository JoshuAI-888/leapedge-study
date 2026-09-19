# Phase-0 human inputs: what to produce, how, and what "done" means

> Superseded on 19 September 2026: the user removed the fifty human-verified cases from scope. This document is historical, not an outstanding request. Follow [the standalone loop](../delivery/standalone-build-loop.md); LeapEdge comparison follows the build.


**For:** the person running the live keys.
**Branch:** `feat/yti-v2` (worktree of `youtube-intelligence`), commits `dea63a4` (F01) to `b94831e` (F08a, the four scripts named below).
**Why this exists:** phase 0 built the evaluation harness (gold set and promotion gate) but every number it reports is still *advisory*, because the inputs that make it binding can only be produced by a person with the audio and the keys. The moment each input lands, the matching gate check becomes binding.

| Input | Makes binding | Deliverable file |
|---|---|---|
| A. 50 verified gold cases | gold precision, gold recall, anchor accuracy, sentiment agreement | `gold-cases.json` |
| B. v5 runs for every gold video | the same four plus cost per accepted claim | `runs.json` |
| C. frozen responses per stage | offline replay of the gold set in CI | `frozen-model.zip` |

Send everything back as **attachments in the chat with Claude**. The VideoConviction benchmark and its licence question were removed from the design on 17 September 2026; nothing about it is needed. On receipt each file is validated against its schema, placed in the branch, the gate is run, and the result is reported.

---

## 0. Setup once

1. Node 24 (the branch's `package.json` says 24; Node 22 also runs it). `npm ci --ignore-scripts`.
2. Copy `.env.example` to `.env` and fill the keys below. Never commit `.env`.

| Task | Keys needed | Notes |
|---|---|---|
| A | none | Watching and listening only |
| B (export) | `DATABASE_URL` (Neon) | Read-only export of runs already there |
| B (new runs) | `OPENROUTER_API_KEY`, `YOUTUBE_API_KEY`, `TRANSCRIPTAPI_API_KEY`, optional `SUPADATA_API_KEY` | `YTI_BUDGET_USD` must be raised: default is 2 |
| C | same as B (new runs) | One short video |

3. Live model spend expected: B about US$0.20 to US$0.95 per video (measured range on this pipeline); C one video. Set `YTI_BUDGET_USD=30` in `.env` for the session and lower it afterwards.

All commands are run from the branch root: `node --env-file=.env --experimental-strip-types scripts/<name>.ts ...`

---

## A. Gold set: 50 verified cases

### What a case is
One video, with every actionable call and every stance-tagged instrument mention the creator makes, each tied to the exact seconds where the words are said, verified by a person who listened.

### Video selection
- At least **20 English** and at least **15 Chinese** videos; the remaining 15 either language.
- Take them from the seeded channels (LeapEdge top 20, TrueAlphaData Tier 1), published in 2026, with a mix of lengths (at least 10 videos over 25 minutes).
- Include at least **10 videos with no actionable call** (news round-ups, education). These carry `expectedRejections` only and are what stops the model inventing calls.
- The five cases already in `evaluations/gold-set/cases.json` (`v824SHV6COE`, `J25UuUqHT3Y`, `3u24qyWjSVM`, `wkAqHlYL7bQ`, `kXYvRR7gV2E`) count once verified.

### Per-case procedure
1. Watch with captions **off**. Note every moment the creator states a view on an instrument.
2. For each, record: ticker (US listing symbol; for Hong Kong or A-shares use the exchange code such as `0700.HK`), stance, creator conviction, sentiment, the span (start and end seconds, and the words as heard in the original language), and mark `anchorVerified: true` only after you have replayed that span and confirmed the words.
3. Record what must **not** be extracted as `expectedRejections` (for example "macro commentary on yields, no instrument", "sponsor read", "hypothetical example").
4. Set `status: "verified"`, add the case-level `review` with your name and an ISO timestamp.

### Field rules (from `evaluations/gold-set/schema.ts`)
- `stance`: `long | short | neutral | avoid | watch | hold | conditional`
- `creator_conviction`: `high | medium | low | unspecified`. Rubric: **high** = stated action with size or timing ("I bought more", "adding at 118"); **medium** = stated view with hedges ("I like it here, but"); **low** = passing or hypothetical ("could be interesting"); **unspecified** when no commitment is expressed. Delivery confidence is not conviction.
- `sentiment`: `bullish | neutral | bearish`. For calls it follows the stance (long → bullish; short, avoid → bearish; neutral, watch, hold → neutral; conditional → the direction of the condition). For mentions that are not calls, grade the view expressed.
- `span`: `startSeconds` ≥ 0, `endSeconds` > `startSeconds`, `text` non-empty in the original language.
- `videoId`: exactly 11 characters. `language`: `en | zh`. `split`: `development` for the first 40, `held_out` for the last 10 (never used to tune prompts).
- No two claims in one case may share the same ticker and stance.

### Shape
```json
{
  "version": "gold-set.v1",
  "cases": [
    {
      "id": "najarro-20260910",
      "videoId": "dQw4w9WgXcQ",
      "language": "en",
      "split": "development",
      "status": "verified",
      "review": { "reviewer": "J. Fang", "reviewedAt": "2026-09-20T09:14:00Z" },
      "source": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "notes": ["38 min weekly review"],
      "expectedClaims": [
        {
          "id": "c1",
          "ticker": "NVDA",
          "stance": "long",
          "creator_conviction": "high",
          "sentiment": "bullish",
          "span": { "startSeconds": 761.0, "endSeconds": 782.5, "text": "if we get a pullback toward one-eighteen I'm adding" },
          "anchorVerified": true,
          "reviewer": "J. Fang",
          "reviewedAt": "2026-09-20T09:14:00Z"
        }
      ],
      "expectedRejections": [
        { "id": "r1", "reason": "10-year yield remark is macro context, no instrument", "ticker": null }
      ]
    }
  ]
}
```

### Validate before sending
```
node --experimental-strip-types scripts/gold-validate.ts --cases gold-cases.json
```
It reads one file only (no database, no keys). It prints, per case, why a case is not yet verified, and totals. Add `--strict` to get a non-zero exit until 50 are verified, or `--json` for a machine-readable summary. Schema errors are printed as `<json path>: <message>` and exit 1.

### Success criteria
- Validator reports **zero schema errors**, **verified ≥ 50**, **en ≥ 20**, **zh ≥ 15**.
- Every claim in every verified case has `anchorVerified: true` and a span you replayed.
- At least 10 rejection-only cases.
- Deliverable: `gold-cases.json`.

---

## B. v5 runs for every gold video

### Export what Neon already has
```
DATABASE_URL="postgres://..." node --experimental-strip-types scripts/export-runs.ts --cases gold-cases.json --out runs.json
```
Prints one line per gold video: the run id found, or `MISSING`. Only completed, non-experiment runs are exported, newest per video, which is exactly the filter the gate applies. Without `DATABASE_URL` the script reads the local SQLite file instead, so make sure the variable is set for the Neon export.

### Produce the missing ones
1. Start the app and the worker against the same database:
   ```
   npm run dev -- --port 3101
   npm run worker
   ```
2. Queue each missing video (the default prompt version is v5; the ids below are the ones the app accepts):
   ```
   curl -X POST http://127.0.0.1:3101/api/intelligence/runs \
     -H 'content-type: application/json' \
     -d '{"url":"https://www.youtube.com/watch?v=<videoId>","model":"google/gemini-3.5-flash","criticModel":"google/gemini-3.1-pro-preview"}'
   ```
   If `YTI_APP_ORIGIN` and `YTI_ACCESS_TOKEN` are set, sign in first at `/access` and send the session cookie.
3. Wait until the run shows `status: completed` (the worker logs it; or `GET /api/intelligence/runs`).
4. Re-run the export. Repeat until nothing is `MISSING`.

### Success criteria
- `runs.json` contains one **completed** run for every gold `videoId`, with `promptVersion` equal to `evidence-first.web.v5` (the current default; a different value means the run was queued with a non-default prompt and does not count).
- Each run has `output.source.segments[]` with `start_seconds` (needed for anchor checks) and `output.claims[]` with `audit.verdict` (needed for critic precision).
- `cost` is a positive number on every run.
- Deliverable: `runs.json`.

---

---

## C. Frozen responses, one per stage

Pick one short English gold video with captions. Then:
```
node --env-file=.env --experimental-strip-types scripts/freeze-responses.ts --url "https://www.youtube.com/watch?v=<videoId>" --stages transcribe,synthesis,critique-0
```
The script runs the video through the pipeline with a recording transport, writes `tests/fixtures/model/<stage>-<hash>.json` for each stage, scrubs key material from the recorded request, and reloads each file to prove it round-trips. It never overwrites an existing file. Keys needed: `OPENROUTER_API_KEY`, `YOUTUBE_API_KEY` and `TRANSCRIPTAPI_API_KEY`.

Two cautions. Run it with `DATABASE_URL` **unset** so it uses a fresh local SQLite file: the script steps the oldest queued run in whatever database it sees, so against Neon it would spend money on any other queued run first. And `--dry-run` is not free: it still runs the video through the paid pipeline, it only diverts the output files to a temporary directory.

### Success criteria
- One envelope for each of `synthesis` and `critique-0`, and `transcribe` if the video needed transcription.
- File names match `<stage>-<hash>.json` and the script reports each as `ok`.
- No API key or `Authorization` value anywhere in the files (search them).
- Deliverable: `frozen-model.zip` containing the new files.

---

## What happens after you send the files

1. Each file is validated: `gold-validate` for A, the `RunRow` schema for B, `loadFrozen` for C.
2. The gate runs:
   ```
   node --experimental-strip-types scripts/promotion-gate.ts --offline \
     --cases evaluations/gold-set/cases.json --runs runs.json \
     --out docs/gates/phase-0-live.json
   ```
3. The result is reported against the thresholds in team settings (`lab.gates`):

| Check | Threshold | Binding once |
|---|---|---|
| Gold precision | ≥ 0.90 | A and B |
| Gold recall | ≥ 0.80 | A and B |
| Anchors within 2 s | ≥ 0.95 | A and B |
| Cost per accepted claim | ≤ US$0.25 | B |

**Definition of done for the phase-0 gate:** `verdict: pass` with no advisory checks, or a written decision on any check that fails (raise the threshold's rationale, fix the prompt, or accept and record).
