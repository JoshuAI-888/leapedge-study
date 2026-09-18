# YouTube Intelligence v2 — proposed update specification

**Status:** Proposal for review, revision 4 (18 September 2026). Revision 4 records the four decisions taken in the review of 17 September 2026: the per-minute Vercel cron invocation is the worker, claiming jobs from a Postgres `jobs` table up to a global concurrency cap, so no separate always-on host is introduced; each preview deployment gets its own Neon branch through the Neon–Vercel integration, migrated by the build command; account identity waits for the Finradar merge, so the workspace is one account and owner scoping, L3 signing, the sharing rework and the per-account digest are deferred; and phase 3 is delivered as a thin vertical slice (3a) followed by the rest (3b). Revision 3 (17 September 2026) removes the VideoConviction benchmark from the design: no product surface uses its labels, so it is no longer a promotion gate, a Lab panel, a seed source or a repository fixture; the gold set is the only evaluation set. Nothing in this document has been implemented, deployed or promoted. Revision 2 folds in the review of the TrueAlphaData handoff (commit d341270) and the VideoConviction handoff (commit c0a0fb6), the answers received on navigation, benchmarks, providers, replay, sharing, users and languages, and the evaluation of Supadata as a standby provider. There is no separate addendum.
**Scope:** The `feat/youtube-intelligence` codebase in this repository, its hosted lab, and its planned merge into Finradar under Intelligence → YouTube intelligence.
**Companion:** Target-state mockup canvas (Finradar theme): https://claude.ai/artifact/42c21wSpbiEtPrHJLh7THZ. Artboard sources are kept under `docs/spec/mockups/`.

---

## 1. Summary

The current system is built around two defences: never spend a cent twice, and never trust the model. Both are correct instincts. Applied as blanket rules they now cause most of the observed failures: transient errors become terminal states, reservations lock the budget at roughly sixty times real cost, quotes are rejected over a join space, and each claim costs a full-transcript critique call.

This specification replaces each blanket defence with a measurement, consolidates model traffic on the native Google SDK for proven workloads while keeping OpenRouter for model flexibility, adopts the Google capabilities the workload actually needs, and reshapes the product around one question an investment team asks: **what did credible creators say, how sure were they, and how far can we trust the record?**

Two rules apply to everything the product shows:

1. **Every number is computed from stored rows when it is requested.** Nothing displayed is imported from a spreadsheet, typed in, or frozen in a snapshot that cannot be recomputed. This is the difference between this product and TrueAlphaData, whose site renders two published Google Sheets.
2. **Every column and figure carries a hover that states, in plain language, what it means and the steps used to calculate it.** The hover text, the Methodology page and the calculation share one source, so they cannot drift.

Changes, in delivery order:

| # | Change | Primary outcome |
|---|---|---|
| 1 | Model transport policy: native Gemini for production stages, OpenRouter for the critic, the context check, experiments and any non-Google model | Cost, feature access, flexibility |
| 2 | Evidence by pointer, not by copy | Reliability of accepted claims |
| 3 | Three-call pipeline with cached transcript and batched critique, plus an optional context check | Cost, latency, simplicity |
| 4 | Idempotent retries and realistic reservations | Reliability, operability |
| 5 | Two-tier source: TranscriptAPI captions as draft, windowed Gemini transcription as reference, Supadata on standby, agreement as the trust signal | Verifiable accuracy |
| 6 | Trust ladder as a first-class data field | Usability for decisions |
| 7 | Always-on worker, Postgres-only, relational core | Throughput, simplicity, Finradar fit |
| 8 | YouTube push notifications and Batch API for channel automation | Cost, freshness |
| 9 | Gold set as the single promotion gate | Confidence in every later change |
| 10 | Computed metrics registry: one definition per figure, rendered as hover text, Methodology page and CI test | Trust in every number |
| 11 | Leaderboard by ticker and by creator, with a user-chosen benchmark, sample-size gates, multiple-comparison control, and a Changes view over a user-chosen window | Parity with LeapEdge, then beyond |
| 12 | Sentiment engine: every mention graded bullish, neutral or bearish with a cited rationale, persisted per ticker, traceable to video and channel; sentiment shift over a user-chosen comparison period | Decision support |
| 13 | Context check: dated external evidence from the days around the video, summarised through OpenRouter | Trusted, time-matched context |
| 14 | Default channel seed of about 60 from LeapEdge and TrueAlphaData; the team picks which to process (Tier 1 and LeapEdge's top 20 selected by default) under a US$150 budget it can raise; Tier-1 historical replay from January 2026 | A populated product on day one, under budget |
| 15 | Front-end revamp inside Finradar's shell: module side panel, decision-first surfaces, sortable tables with hover definitions | Usability |

---

## 2. Outcomes for the investment team

The investment team does not consume transcripts, prompts or provider diagnostics. They consume calls: an instrument, a direction, the creator's stated conviction, the levels and conditions, the horizon, what was known at the time, and a reason to trust that the record is faithful. Everything else is plumbing.

| Today | Target |
|---|---|
| A completed run can show zero accepted claims because of a caption join space | Provenance is guaranteed by construction; rejections mean real disagreement, not formatting |
| "Audio unverified" is a permanent disclaimer | Each claim carries a trust level backed by a caption-to-audio agreement score and, where reviewed, a human signature |
| Creator conviction and model confidence share one screen without distinction | Conviction is the creator's word; trust is the system's evidence grade; they are shown separately and never merged |
| Channels are polled hourly, three at a time | New uploads arrive by push and are analysed in batch within hours, automatically, under a monthly budget the team sets |
| Creator performance is a per-channel figure against SPY, frozen in a JSON snapshot | A leaderboard by ticker and by creator, recomputed from settlement rows on request, against the benchmark each user chooses, with confidence intervals and sample-size gates |
| No view of how the creator crowd is moving | Sentiment shift per ticker, this period against the one before, on a period each user chooses |
| A call is judged only on the creator's words | A short context check states what the market, filings and news said in the days around the video, with every source dated inside that window |
| Six tabs mixing decisions with lab tooling | One page under Finradar's Intelligence menu with its own side panel: Today, Channels, Leaderboard, Saved calls, Lab, Settings |
| Cross-video questions require scanning JSON blobs | A searchable corpus with citations for "what have creators said about NVDA since August" |

Why this is the right decision for that user:

- **Usability.** The first screen is a ranked list of trusted calls with agreement across creators and the sentiment shift, not a run history. Every column can be sorted and every heading explains itself on hover.
- **Cost.** Batch pricing halves model spend on automated work. Cached transcripts remove the per-claim transcript re-send. Low media resolution removes frame tokens from a transcription task. Measured on the repo's own runs, the long English retry drops from twelve model stages to three.
- **Simplicity.** One production transport, one database dialect, one queue, three model calls per video, one page with six side-panel items.
- **Flexibility.** OpenRouter stays for the critic, the context check and cross-vendor comparison. Every provider, model, transport, processing mode, benchmark, comparison period and budget is a visible setting with a safe default.
- **Trust.** Nothing on screen comes from a spreadsheet. A reader can hover any figure, read how it was worked out, open the Methodology page that renders the same definitions, and export the rows that produced it.

---

## 3. Design principles

1. **Measure instead of forbid.** Where the current code forbids retry, spend or trust, the new design measures the risk and lets a setting decide.
2. **Provenance by construction.** The application copies source text; the model only points at it.
3. **Conviction is not confidence.** Creator conviction, system trust level and any market outcome are three fields, never one.
4. **Computed, never copied.** Every displayed figure is a function of stored rows and the viewer's settings, evaluated on request. External datasets are test fixtures, never product data.
5. **Explain every number where it is shown.** One registry entry per metric feeds the hover, the Methodology page and the CI test.
6. **Time-matched context.** External evidence attached to a call is dated inside the window around the video's publication. Later information is shown separately and labelled.
7. **Proven workloads on native APIs, exploration on the aggregator.**
8. **Every automatic action has a budget, a cap and an off switch the team controls.**
9. **Hide complexity, keep it reachable.** Diagnostics, prompts, providers and costs live in Lab and in collapsible panels, never on decision surfaces.

---

## 4. Architecture changes

### 4.1 Model transport policy

**Decision.** Production stages call the Gemini Developer API directly through `@google/genai`. OpenRouter is the transport for the critic, the context check, experiments, non-Google models, and any stage a user explicitly routes there. A non-Google critic through OpenRouter is confirmed as acceptable.

**Rationale.** Today every text call and the video fallback go through OpenRouter pinned to Google AI Studio. That pays a markup to reach the same endpoint and loses batch pricing, explicit context caching, media resolution control, clip offsets on YouTube URLs, agentic video mode and schema-enforced output. The native SDK already exists in the repo and is already proven on the hardest stage. The white paper itself flagged transport as an uncontrolled variable in the A/B.

| Scenario | Transport | Why |
|---|---|---|
| Transcription, extraction, translation, audio review on Gemini | Native | Batch, caching, media resolution, schema, agentic mode |
| Critic from a different model family | OpenRouter | One key, one API shape, uncorrelated errors |
| Context check over dated sources | OpenRouter | Any vendor; the sources are supplied, so no provider search feature is needed |
| Evaluation lab A/B across vendors | OpenRouter | Same reason; cost is bounded by the experiment |
| A user who wants a non-Google extraction model | OpenRouter, by setting | Flexibility without code change |
| Google outage or quota exhaustion | OpenRouter fallback, if enabled | Continuity; off by default so cost stays predictable |

**Implementation.** A `ModelTransport` interface with two implementations behind `modelCall`. The ledger, retained responses, prompt snapshots and metrics sit above the interface so production runs and experiments remain comparable. Drop the per-call catalogue download, the `provider.only` pin and the `json_object` response format; replace with a cached price table, direct calls and `responseSchema`.

### 4.2 Evidence by pointer

**Decision.** Extraction returns segment IDs or ID ranges. The application copies the exact retained text into the claim. String matching survives only as a sanity assertion, never as a gate.

**Rationale.** The v8 experiment in `evidence-selection.ts` produced zero structural failures across 29 items where the copy-and-match baseline lost eight of nine. The "more than 20 IDs" schema failure is removed by supplying the output contract as a `responseSchema`.

**Contract change.** `Claim.evidence[]` gains `source_span: {start_id, end_id, start_seconds, end_seconds, text_hash}`. `quote_original` is derived, never model-written. `quote_translation_en` is produced in a separate cheap call over the copied span, so translation can never alter the evidence.

### 4.3 Three-call pipeline, plus an optional context check

**Decision.** Per video: one extraction over the full transcript; one batched critique over all claims with the transcript supplied from an explicit context cache; one optional repair or translation pass. Chunking applies only above a configurable token threshold. A fourth, optional call produces the context check (section 4.14) for each call that names a ticker; it runs after the critic so it only spends on accepted claims.

**Extraction also records mentions.** Alongside actionable calls, extraction emits every stance-tagged reference to an instrument (bullish, bearish, neutral) with its segment pointer and a flag `is_call`. Mentions feed the sentiment shift (section 4.13); calls feed the leaderboard. Both carry trust levels.

**Rationale.** The long English retry ran twelve stages and 594k tokens for about US$0.93. Gemini's context window makes chunking at 64 KB unnecessary, and per-claim critique multiplies transcript cost by claim count. Batched critique also lets the critic see cross-claim consistency, which the per-claim design hid.

**Critic independence.** The default critic is a different model family from the extractor, routed through OpenRouter. This is a setting; a Google-only configuration remains valid.

### 4.4 Idempotent retries and realistic reservations

**Decision.** Provider calls are keyed by run, stage and attempt. Retries are permitted for 429, 5xx and timeouts that occurred before any response bytes, with jitter and a per-stage cap. Reservations are estimated from counted input tokens plus the output cap, reconciled from the provider's reported usage, and released on any terminal outcome. Unknown outcomes hold a bounded reservation for a configurable window, then move to a reconciliation queue rather than blocking the run.

**Rationale.** The current ledger reserves context length times the highest rate and holds it forever on an unknown outcome. Held reservations were NZ$37.86 against US$0.60 of known cost across 25 requests.

### 4.5 Two-tier source and the agreement signal

**Decision.** Captions remain the fast draft. A windowed Gemini transcription from the YouTube URL is the reference source, requested in fixed windows with `videoMetadata` offsets so timestamps are bounded by construction. The two are aligned with the edit-distance tooling already in `evaluations/transcript-accuracy.ts`. Per-span agreement is stored with each claim.

**Rationale.** All caption providers read the same YouTube track and fail together (four of six, forty of fifty). The one route independent of captions is model transcription from audio. The full-video run drifted 97 seconds; two 90-second clips agreed to within 0.06 seconds. Windowing fixes drift; the agreement score turns "audio unverified" into a number.

**Policy setting.** ASR runs always, only when captions are missing, or only when a claim's cited span is needed for a trust upgrade. Default: when captions are missing, plus on demand for any claim promoted to Today.

**Audio download is now permitted.** That opens two options that the design keeps in the Lab until the gold set shows they win: Speech-to-Text v2 with Chirp 3 for word-level timestamps at about US$0.003 per minute in batch, and uploading the audio file to Gemini through the Files API, which removes the YouTube-URL fetch path and its daily limits. Neither is the default; downloading adds an extraction step that breaks whenever YouTube changes, and windowed Gemini already meets the two-second anchor gate.

### 4.6 Trust ladder

Every claim and mention carries one of four levels. The level is computed, stored, filterable and visible everywhere the item appears.

| Level | Name | Requirement |
|---|---|---|
| L0 | Extracted | Passed schema and deterministic checks only. Never shown on Today. |
| L1 | Text-checked | Pointer evidence, price and ticker checks, batched critic accepted. |
| L2 | Audio-agreed | Caption and ASR agree on the cited span above the configured threshold and the timestamp anchor is within two seconds. |
| L3 | Human-verified | A named reviewer listened to the cited span and signed the claim. Append-only. The reviewer is the signed-in Finradar account. |

Creator conviction (high, medium, low, unspecified) is a separate field and is always displayed with the label "creator conviction". Nothing in the UI combines the two into a single score. The VideoConviction finding that high creator conviction did not beat the market is adopted as policy: conviction is shown and used to filter which calls the leaderboard scores, never as a weight.

### 4.7 Always-on worker, Postgres only, relational core

**Decision.** `scripts/worker.ts` becomes the production worker on an always-on host with a Postgres-backed queue (pg-boss or Graphile Worker). Vercel serves the UI and API only. SQLite and the dialect rewriter are removed; tests use PGlite. Claims, mentions, evidence spans, transcripts, reviews, channels, prices, settlements and context checks get their own tables with additive migrations.

**Rationale.** A per-minute cron running one job at a time under a global advisory lock cannot serve eighty auto-analysed channels. The JSON-blob store forces every cross-video feature to scan everything and freezes the leaderboard in a snapshot that cannot be recomputed for a different benchmark. The Finradar handoff already requires reviewed migrations and shared platform tasks; this change is the precondition for the merge.

### 4.8 Channel automation: push and batch

**Decision.** Subscribe followed channels to YouTube's push hub. New uploads enqueue a batch job by default; user-submitted URLs run immediately. Teams choose per channel.

**Rationale.** Push is free, near real-time and uses no Data API quota. The Batch API is half price with higher rate limits and a turnaround well under a day, which matches an overnight digest.

### 4.9 Gold set and promotion gates

**Decision.** Before any prompt, model or transport change is promoted, it must be evaluated against one frozen set: at least fifty human-verified claims across English and Chinese with audio-checked anchors. The evaluation reports claim precision and recall, critic precision and recall, sentiment agreement, anchor accuracy within two seconds, and cost per accepted claim. The VideoConviction benchmark that earlier revisions paired with the gold set was removed on 17 September 2026: the product never reads its labels, so it was an evaluation-only dependency with a licence question attached, and the gold set already measures ticker, stance and conviction directly.

**Licensing.** TrueAlphaData's rows are of unstated licence. Finradar is confirmed as never commercial, so they may be used, with attribution, as an evaluation reference. They never appear as product data (section 4.11). No VideoConviction data is held in the repository.

### 4.10 Provider decision and the standby provider

**Decision.** TranscriptAPI for captions, Gemini native for the audio transcript, Supadata on standby behind a circuit breaker. Nothing else in the production path.

| Route | Measured in this repo | Price | Per 30-minute video | Role |
|---|---|---|---|---|
| TranscriptAPI | Fastest of three, median 768 ms; 40 of 50 videos | US$5 per 1,000 credits, 1 credit per successful transcript, failures free | ≈ US$0.005 | Draft for every video |
| Gemini native, YouTube URL, windowed | Structurally valid on 4 of 5; 97 s drift on full video, 0.06 s in 90 s clips | US$0.75 per M input, US$3.75 per M output; batch halves both | ≈ US$0.20 immediate, ≈ US$0.10 batch | Reference transcript when captions are missing (about 1 in 5 videos) and on demand for calls promoted to Today |
| Supadata | Same 4 of 6 caption coverage as TranscriptAPI, slower; 403 on captionless in the older adapter | Plans below | Captions ≈ US$0.002 to US$0.006; Whisper ≈ US$0.09 to US$0.34 | Standby only |
| Tapline, BibiGPT, YouTube.js | Same coverage, slower, or 0 of 5 | n/a | n/a | Removed |

Google native costs roughly 20 to 40 times TranscriptAPI per video, so it is not the default. It is the only route in the primary path that does not depend on YouTube's caption track, and the only one that can verify captions against audio. Blended source cost for 100 videos is about US$5.50.

**Supadata, evaluated as a backup.** Its documented features that matter here:

| Feature | Detail | Useful to us? |
|---|---|---|
| Caption transcript with per-segment `offset` and `duration` in milliseconds, `lang`, `text`, `chunkSize` | Same YouTube caption track as TranscriptAPI; typically under a second | As a vendor-outage fallback only. It does not add coverage, because it reads the same track. |
| `mode=generate` (Whisper) and `mode=auto` | AI transcript when captions are absent, 2 credits per minute, same endpoint; `lang` ignored, output in the video's language; videos over 20 minutes return HTTP 202 and a job to poll at `/transcript/{jobId}` with statuses queued, active, completed, failed | Yes, in two narrow roles: a third opinion when captions and the Gemini transcript disagree on a cited span, and an ASR fallback when Gemini is unavailable. Not as the primary reference: it cannot be requested per window, so timestamps are not bounded by construction, and long videos add a polling loop. |
| Batch endpoint `POST /youtube/transcript/batch`, results at `/youtube/batch/{jobId}`; playlist and channel batches skip Shorts and live streams; 1 credit per video | Bulk caption pulls | Yes, for the historical replay backfill, where it saves Data API quota and the Shorts filter is what we want. |
| `GET /youtube/channel/videos`, `GET /youtube/playlist/videos` | Video ID listing without the Data API | Useful for the backfill; the Data API stays the source of truth for metadata. |
| Error `transcript-unavailable` (206), `not-found` (404), `limit-exceeded` (429) | Distinguishes "no captions" from "vendor down" | Required for the circuit breaker: only vendor errors trigger the caption fallback. |
| Plans: Free 100 credits/month at 1 request/s; Basic US$5/300; Pro US$17/3,000; Mega US$47/30,000 at 50 requests/s; overage US$10 per 1,000 (Basic, Pro) or per 5,000 (Mega) | | Pro covers standby use; Mega only if Whisper tie-breaks become routine. |

Cost per 30-minute video for a Whisper transcript is 60 credits: about US$0.34 on Pro, about US$0.094 on Mega. That is comparable to Gemini batch, which is why it is a credible fallback and not a replacement.

**Plan, as decided.** Start on the free plan (100 credits a month, 1 request per second) and decide on a paid plan only once standby use has been observed. When Supadata answers `limit-exceeded` (429) or the credit balance reaches zero, the portal shows a clear error: a banner on Today's pipeline panel and on Settings → Sources reading "Standby provider out of credits since <time>; captions fall back to none on vendor error until credits are added", plus the circuit-breaker state. The error is a stored event, so it also appears in the Lab cost history.

**Proposed update.** Keep the existing Supadata adapter, extend it with explicit `mode=native` and `mode=generate` (never `auto`, which would spend without our consent), the 202 polling loop, and the batch endpoint. Add a per-vendor circuit breaker: TranscriptAPI vendor errors (5xx, 429, timeout) route captions to Supadata for the next fifteen minutes; "no captions" never does. Add a tie-break rule: when caption-to-Gemini span agreement falls below the L2 threshold on a promoted claim, request one Whisper transcript and take the two-of-three agreement. Settings: `sources.standby = supadata | none`, default `supadata` when a key is present; `sources.standbyPlan` records the plan so the credit alert can state the monthly allowance.

### 4.11 Computed, never copied

**Decision.** No product table is ever populated by import. Every figure on every surface is produced by a metric function evaluated over stored rows and the viewer's settings when the page is requested (or by a materialised view keyed on those settings and refreshed on every settlement sweep, which is the same computation cached).

**Metrics registry.** `src/features/youtube-intelligence/metrics/registry.ts` holds one entry per displayed metric: `id`, `label`, `definition` (one plain sentence), `steps[]` (plain-language calculation steps), `inputs[]` (tables and columns), `implementation` (the SQL or TypeScript function), `settingsUsed[]`. The UI reads hover text from the registry, the Methodology page renders the registry, the CSV export names the registry id in each column header, and a CI test runs every entry against a fixture database and asserts that the rendered value equals the computed value and that every table column in the UI maps to a registry id.

**Where imported data was about to enter, and what happens instead.**

| Proposal | Static risk | Ruling |
|---|---|---|
| TrueAlphaData Track A: re-score their 26,646-row sheet | Their rows become our history | Lab only, as an optional oracle for settlement arithmetic; never stored in product tables, never displayed. Deferred. |
| TrueAlphaData "ingest their prediction sheet as a cold-start reference" | Same | Rejected. Cold start is solved by the historical replay (section 4.16), which runs our own pipeline. |
| TrueAlphaData creator style summary templates | Prose generated from stats | Allowed, because the templates read the same computed rollup; the hover on the summary lists which figures it used. |
| LeapEdge leaderboard figures | Comparison only | Never imported; cited in this document for parity, not in the product. |
| Current repo scoreboard snapshots in `yi_documents(kind="scoreboard")` | Frozen JSON that cannot be recomputed for a different benchmark or horizon | Replaced by query-time computation over `settlements` and `prices`. |
| Mockup figures (209 calls, 66.5%, and so on) | Illustrative | Placeholders in the artboards; in production every one of them is a registry metric. |

Market prices from FMP are external but not static: each fetched bar is stored with its fetch time and source, so any figure can be recomputed and reproduced.

### 4.12 Leaderboard: by ticker and by creator

**Priority, as confirmed.** Build in this order: (1) consensus and disagreement per ticker, (2) which tickers creators' calls have done best on, (3) which creators are most reliable on a given ticker. By ticker is the default tab.

**Benchmark, user-chosen.** Excess return is the call's return minus the benchmark's return over the same days. The benchmark is an account setting: SPY (default), QQQ, IWM, the SPDR sector ETF matched to each ticker's sector from its FMP profile, a custom ticker, or none (absolute return). Settlement rows store the ticker's entry and exit adjusted closes and dates; benchmark series are stored per benchmark ticker; excess is computed at query time for whichever benchmark the viewer selected. Changing the benchmark changes nothing stored.

**What a benchmark is, in plain words.** A benchmark is the yardstick a call is measured against. If a creator's NVDA long gained 10% over 90 days and SPY gained 8% over the same days, the call's excess return is +2%. Without a benchmark, a creator looks skilled in any rising market. The hover on every excess-return column carries this sentence.

**Sector benchmark options considered.** (a) The SPDR sector ETF matched to the ticker's FMP sector, such as XLK for technology: cheap, liquid, well understood; the proposal. (b) An equal-weight index ETF such as RSP: removes mega-cap dominance but is not sector-aware. (c) An industry peer average computed from FMP's peer list for the ticker: closest comparison, but peers change and the series must be built by us. (d) A custom ticker or list the team maintains. (e) None, absolute return. All five are offered. The team sets the default (SPY unless changed); each account may override it, and Settings shows the override with a "Reset to team default" action. The sector option uses (a).

**Markets and instrument filter.** Extraction never drops an instrument because of its market. Hong Kong, China A-share and other non-US names are extracted, graded and shown on the per-video report and the channel page like any other. The ticker boards and both leaderboards carry a market filter, default "US stocks and ETFs", with options for US stocks, US ETFs, Hong Kong, China A-shares and other markets. A call in a market without a price series in FMP is listed with the label "not settleable, no price source" rather than hidden; the settlement sweep picks it up automatically if a price source is added later.

**Statistics.** Per creator and per ticker: settled count, win rate with a Wilson 95% interval, mean and median excess, standard deviation, one-sample t and p against zero, Benjamini–Hochberg q across all creators, badges "supported" (n ≥ 20 and q < 0.05), "negative", "not yet". Horizons 90, 180 and 365 days. Forward record (from follow date) and historical replay are never mixed; the record selector states which is shown. Scoring convention follows the repo's `scoreCall`: adjusted close on the video date to the horizon date, sign flipped for shorts, medium and high creator-conviction long/short calls only, audio-agreed or better.

**By-ticker columns (in the mockup order).** Ticker · Sentiment shift for the viewer's period · Consensus now (open calls by stance, labelled agree, lean, split) · Creators · Settled calls · Median excess vs the chosen benchmark · Most reliable creator on this ticker (n ≥ 10 on that ticker, ranked by win rate, badge from the creator-level q).

**Every column** has a hover from the registry and a sort control; the default sort is stated in the table footer.

**Changes over a period.** A third tab, Changes, shows what moved on either board between two dates. The viewer picks the change window (7, 14, 30, 90 or 180 days, or a custom start date); the default is an account setting with a team default of 30 days. Because settlement rows are append-only and dated, the board "as of" any date is the same computation with a cut-off, and a change is the difference between the two cut-offs; no snapshots are stored. The tab shows:

- rank movement per creator and per ticker, with the number of places moved;
- the underlying figures then and now: settled calls added, win rate, median excess against the viewer's benchmark;
- status changes: crossed into or out of "supported" or "negative", reached the n ≥ 20 gate for the first time;
- new entrants and drop-outs, with the reason (first settled call, benchmark or market filter change);
- on the ticker side, consensus shifts (for example split → agree long) alongside the sentiment shift.

Each change is a registry metric: the hover reads, for example, "rank as of today minus rank as of 30 days ago, both computed from settlements settled on or before each date". Clicking a change opens the settlement rows that caused it. Changes where n is below 20 on either date are labelled "not yet meaningful" and sorted below the rest, so early forward-record noise is not mistaken for movement.

### 4.13 Sentiment engine and sentiment shift

**Gap today.** The repository has no sentiment logic. Claims carry a stance (long, short, neutral, avoid, watch, hold, conditional) and nothing else is graded. This section is a build.

**What is graded.** Every stance-tagged mention of an instrument, whether or not it is an actionable call, receives a sentiment of bullish, neutral or bearish. For actionable calls the sentiment is derived deterministically from the stance (long → bullish; short and avoid → bearish; neutral, watch and hold → neutral; conditional → the direction of the condition). For non-call mentions the extraction model assigns the sentiment under a `responseSchema` and must return a one-sentence rationale that quotes or paraphrases the cited segment; the application copies the exact span text as with claims (section 4.2). A mention without a span pointer is rejected.

**Persistence and traceability.** Each `mentions` row stores ticker, market, sentiment, rationale, `span_id`, `video_id`, `channel_id`, `published_at`, `is_call`, `claim_id` when it is a call, the trust level and the config hash. Every aggregate a user sees links back to the rows: clicking a sentiment count opens the mention list with the rationale, the creator and a play-from link to the cited moment. Sentiment is never stored as an aggregate; the aggregates are registry metrics computed over the rows.

**Trust.** Mentions go through the same deterministic checks and the same batched critic as claims, so they carry L1 to L3. Sentiment aggregates count L1 or better by default; the viewer can raise the bar.

**Sentiment shift.** For a ticker and a period length P chosen by the viewer (7, 14 or 30 days; default 7): count mentions and distinct creators by sentiment in the latest P days and in the P days before that. Show the counts, the change and the direction. Both mentions and calls are displayed, side by side, with calls as the stricter subset.

**Where it appears.** A panel on Today for the biggest movers, a column on the by-ticker leaderboard, the ticker drill-down, and a `youtube` observation in the Finradar briefing (section 4.17).

**Evaluation.** The gold set gains a sentiment label per mention. Sentiment agreement with the gold labels is a promotion gate like the others.

### 4.14 Context check: time-matched external evidence

**Purpose.** Give a short, sourced statement of what the market, the company's filings and the news said in the days around the video, so a reader can judge the call against what was knowable then. Never against what happened later, unless labelled "since then".

**The window, in plain words.** "At the time" has to mean something exact. The context window is the span of dates whose news, filings and prices count as what the creator could have known: by default from 14 days before the video was published to 2 days after it, the 2 days allowing for late-indexed articles about the same event. Anything dated outside that span is not shown as context. Both numbers are settings on Settings → Context check, with a "Reset to default" action that restores 14 and 2.

**Sources, gathered deterministically before any model runs.**

| Source | How | Window |
|---|---|---|
| Prices | Stored FMP adjusted closes for the ticker and the viewer's benchmark | Video date, and the distance of each stated level from that close |
| Filings and results | FMP filings and earnings calendar, latest report dated on or before the video date | Up to 90 days before publication |
| News | FMP stock news with `from` and `to` bounds | Default 14 days before publication to 2 days after |
| Web, optional | Exa's search API called directly with `startPublishedDate` and `endPublishedDate` | Same window; off by default, for instruments FMP does not cover |

OpenRouter's own web plugin is not used for this: it has no publication-date filter, and Perplexity's date filters are rejected on the OpenRouter path (and its Sonar API is being retired on 27 September 2026). The model never searches; it only summarises sources we already validated.

**Validation.** Every source carries a publication date. Any source outside the window is discarded before the prompt is built. The model (through OpenRouter, any vendor, default the same model as the critic) returns at most 60 words plus citations by source id, under a `responseSchema`. A citation to an id not supplied fails validation; the call is retried once and otherwise shows "no dated sources found". The stored `context_checks` row keeps the window, the source list with dates, the summary and the config hash.

**Display.** One line under the call on the Analysis page. Clicking it opens the source list with dates. For settled calls, a second, separately labelled section "since then" is generated at settlement time with the window moved to the settlement period.

**Cost.** About 3,000 to 6,000 input tokens and 120 output tokens per call, roughly US$0.02 with a Sonnet-class model; batch for channel uploads, immediate for pasted links. Setting: `context.enabled`, `context.windowDaysBefore`, `context.windowDaysAfter`, `context.webSearch`.

### 4.15 Default channel seed

**Decision.** On first run the team's channel list is seeded with, deduplicated by YouTube channel ID: the 47 creators on LeapEdge's public leaderboard and the TrueAlphaData Tier 1 to Tier 3 creators from the handoff (about 20). Known overlaps include Joseph Hogue, Financial Education, Daniel Pronk, Ticker Symbol: YOU, Invest with Henry, Business With Brian, Stealth Wealth Investing, Everything Money and Joseph Carlson, so the seed is about 60 channels, roughly a third of them Chinese-language. Any team member can add channels by URL at any time.

**Selection, as decided.** All seeded channels are listed on the Channels page with a "Process" checkbox. Tier-1 TrueAlphaData channels and LeapEdge's top 20 are selected by default; the rest are followed but not processed. Any user can change the selection and save it; the saved selection is the team's list and is versioned like other configuration. Unselected channels still receive push notifications, and every new upload is listed on the Channels page unanalysed with a one-click "Analyse this one". Using it analyses that video and switches the channel's Process checkbox on, so from then on the channel is analysed and counts against the budget; the page says so on the button. The LeapEdge top-20 default is taken from their public ranking at seed time; once our own forward record has n ≥ 20 for enough creators, the default selection follows our record instead, and the change is versioned like any configuration.

**Budget.** The monthly budget is a setting with a default of US$150 that the team can raise, below the environment hard ceiling. The Channels page shows the projected monthly cost of the current selection (uploads per month per channel from the last 90 days times the measured cost per video) so a change to the selection shows its cost before it is saved. When the projection exceeds the budget the page says so; nothing is blocked, because the cap itself stops spend. Each channel row shows the trust distribution of its calls, its record against the viewer's benchmark, its discovery and processing mode and its tier.

### 4.16 Historical replay

**Decision, as approved.** Replay the Tier-1 channels' uploads from 1 January 2026 to each channel's follow date through the full pipeline in batch mode, at an estimated US$60 to US$120. Every settlement from it is labelled `historical` and shown only under the "Historical replay" record selector. Video IDs for the backfill come from Supadata's channel listing or the Data API uploads playlist; Shorts are skipped.

### 4.17 Finradar integration as a source

YouTube becomes a fourth source in the existing `briefing-read-v1` contract alongside x, reddit and podcast. Each ticker item gains a `youtube` observation with `metricUnit: "creator mentions"`, `mentions`, `prior`, `change` (computed per section 4.13 with the edition's period), `state`, a `why` sentence, `evidenceCount`, and links to claim IDs with their trust level. Editions remain immutable and dated.

### 4.18 Multi-user, sharing and scopes

Team members have their own Finradar accounts, so:

- **Account scope, each with a "Reset to team default" action:** benchmark, sentiment comparison period, change window, market filter, default horizon, Today trust filter. Account-only: saved calls, digest delivery, display language and theme.
- **Team scope (administrator):** channel selection and automation, monthly budget, providers and models, trust thresholds, context check on or off and its window, team defaults for the account-scope settings, sharing policy.
- **Reviews** are signed with the account identity; the review table is append-only.
- **Sharing:** links are indefinite until revoked, matching LeapEdge. Each share is an immutable snapshot with a revoke action and an optional expiry.

### 4.19 Languages

Output is always English. Chinese-language videos are supported end to end: caption language preference `zh, zh-Hans, zh-Hant, en`; Gemini transcription in the source language; extraction in the source language with pointer evidence; English translation of each copied span in a separate call; the trust ladder applies unchanged. Chinese company names resolve to tickers through the reviewed entity registry; unresolved names stay as text and never become a ticker without review.

---

## 5. Google capabilities to adopt

| Capability | Use | Why | Setting |
|---|---|---|---|
| Gemini Developer API via `@google/genai` | All production text and media stages | Direct access to every feature below; already proven in `native-google-core.ts` | `transport.default = google-native` |
| Batch API | Channel auto-analysis, critique, translation, context checks, backfills | 50% price, higher rate limits, no client-side queue for these jobs | `processing.mode` per trigger |
| Explicit context caching | Transcript held once per run for critique and repair | 90% discount on cached input tokens; removes the per-claim transcript re-send | `processing.contextCaching` |
| Implicit caching | All calls | Free when the prefix matches; requires source before claim in the payload | Always on; payload order fixed in code |
| YouTube URL media input with `videoMetadata` offsets | Windowed reference transcription | No download; timestamps bounded per window | `sources.asr = gemini-windowed`, `sources.windowSeconds` |
| Files API audio upload | Lab alternative now that download is permitted | Removes the YouTube-URL fetch path and its limits | `sources.asr = gemini-file` (Lab) |
| `mediaResolution: LOW` | Transcription | Audio is 32 tokens per second; frames are 100 to 300 per second and irrelevant to transcription | `sources.mediaResolution` |
| Agentic video understanding | Audio review of cited spans | Navigates to cited moments; up to 88% fewer tokens than static ingestion | `sources.agenticAudioReview` |
| `responseSchema` structured output | Every stage | Schema-enforced JSON; removes the runtime Zod-only failure | Always on |
| Thinking configuration | Critic only | Bounded reasoning budget where it helps, none where it does not | `models.critique.thinkingBudget` |
| File Search | Cross-video corpus search and trend questions | Managed retrieval with chunk-level grounding metadata; no vector database to run | `corpus.fileSearch` |
| YouTube Data API v3 | Metadata, uploads playlist, channel resolution | Correct use today; caption download requires owner authorisation and stays out | `YOUTUBE_API_KEY` |
| YouTube push notifications (PubSubHubbub) | New-upload events | Free, near real-time, no quota | `channels.discovery = push` |
| Gemini Embedding 2 (through File Search) | Multilingual retrieval | One embedding space for English and Chinese | Implicit in File Search |
| Speech-to-Text v2 Chirp 3 | Word-level timestamps, Lab | Download is now permitted; promote only if it beats windowed Gemini on the anchor gate | `sources.asr = chirp3` (Lab) |

Not adopted: Vertex AI for the YouTube URL path, because it does not accept YouTube URLs. NotebookLM as a pipeline component, for the reasons recorded in the architecture review; it remains a manual analyst surface. Google Search grounding for the context check, because it cannot be bounded by publication date.

---

## 6. Settings

Three layers. Server environment holds credentials and hard limits. Team preferences hold what an administrator sets for everyone. Account preferences hold what each user may change for their own view. Every setting has a safe default and a one-line explanation in the UI.

### 6.1 Server environment

```
GEMINI_API_KEY=            # required; production transport
OPENROUTER_API_KEY=        # required; critic and context check
YOUTUBE_API_KEY=           # required; metadata and discovery
TRANSCRIPTAPI_API_KEY=     # required; caption draft
SUPADATA_API_KEY=          # optional; standby provider
FMP_API_KEY=               # required; prices, filings, news
EXA_API_KEY=               # optional; date-bounded web sources for the context check
DATABASE_URL=              # required; Postgres
YTI_PUSH_CALLBACK_SECRET=  # required when channels.discovery=push
YTI_HARD_BUDGET_USD_MONTH= # absolute ceiling the UI cannot raise
RESEND_API_KEY=            # optional; digest delivery
```

### 6.2 Team preferences (schema)

```jsonc
{
  "transport": {
    "default": "google-native",          // google-native | openrouter
    "fallbackToOpenRouter": false,       // on Google 5xx or quota
    "allowOpenRouterInLab": true
  },
  "models": {
    "transcription": { "id": "gemini-3.8-flash", "transport": "google-native" },
    "extraction":    { "id": "gemini-3.8-flash", "transport": "google-native" },
    "critique":      { "id": "anthropic/claude-sonnet-5", "transport": "openrouter",
                       "requireDifferentFamily": true, "thinkingBudget": "low" },
    "context":       { "id": "anthropic/claude-sonnet-5", "transport": "openrouter" },
    "translation":   { "id": "gemini-3.1-flash-lite", "transport": "google-native" },
    "audioReview":   { "id": "gemini-3.8-flash", "transport": "google-native" }
  },
  "sources": {
    "captionProvider": "transcriptapi",  // transcriptapi | none
    "standby": "supadata",               // supadata | none
    "standbyPlan": "free",               // free | basic | pro | mega; drives the credit alert
    "standbyCooldownMinutes": 15,
    "asr": "gemini-windowed",            // gemini-windowed | gemini-file | chirp3 | off
    "asrPolicy": "when-captions-missing",// always | when-captions-missing | on-demand
    "windowSeconds": 300,                // 120–600
    "mediaResolution": "low",            // low | default
    "agenticAudioReview": true,
    "agreementThreshold": 0.92,          // span agreement for L2
    "tieBreakWithStandby": true,         // Whisper third opinion below threshold
    "captionLanguages": ["zh", "zh-Hans", "zh-Hant", "en"]
  },
  "context": {
    "enabled": true,
    "windowDaysBefore": 14,              // user-editable, reset to default available
    "windowDaysAfter": 2,
    "webSearch": "off",                  // off | exa
    "sinceThenAtSettlement": true
  },
  "processing": {
    "userSubmitted": "immediate",        // immediate | batch
    "channelUploads": "batch",
    "contextCaching": true,
    "maxRetriesPerStage": 3,
    "parallelVideos": 4,
    "chunkAboveTokens": 700000
  },
  "budget": {
    "monthlyUsd": 150,
    "alertAtPercent": 70,
    "perVideoMaxUsd": 1.50,
    "unknownOutcomeHoldMinutes": 60
  },
  "channels": {
    "discovery": "push",                 // push | poll
    "pollIntervalMinutes": 60,
    "seedDefaults": true,                // LeapEdge + TrueAlphaData
    "defaultSelection": ["tier1", "leapedge-top20"],
    "selection": [],                     // channel IDs the team chose to process; saved and versioned
    "autoAnalyzeNewChannels": false,
    "historicalReplay": { "tiers": ["tier1"], "from": "2026-01-01" }
  },
  "accountDefaults": {                   // team defaults; each account may override and reset
    "benchmark": "SPY", "sentimentPeriodDays": 7, "changeWindowDays": 30, "marketFilter": ["us-stock", "us-etf"], "defaultHorizonDays": 90
  },
  "leaderboard": {
    "markets": ["us-stock", "us-etf", "hk", "cn-a", "other"],   // all extracted; none suppressed
    "minSettledForRank": 20,
    "fdrQ": 0.05,
    "minSettledPerTicker": 10,
    "convictionIncluded": ["high", "medium"],
    "minimumTrust": "audio-agreed"
  },
  "trust": {
    "minimumLevelForToday": "audio-agreed", // text-checked | audio-agreed | human-verified
    "showExtractedInLab": true
  },
  "sharing": { "expiry": "never", "allowRevoke": true },
  "corpus": { "fileSearch": true, "retentionDays": 365 }
}
```

### 6.3 Account preferences (schema)

```jsonc
{
  "benchmark": "SPY",                    // SPY | QQQ | IWM | sector-etf | custom:<ticker> | none; null = team default
  "sentiment": { "periodDays": 7, "minimumTrust": "text-checked" },   // 7 | 14 | 30
  "changeWindowDays": 30,                // 7 | 14 | 30 | 90 | 180 | custom start date; null = team default
  "marketFilter": ["us-stock", "us-etf"],   // default view on ticker boards; any market can be added
  "defaultHorizonDays": 90,              // 90 | 180 | 365
  "todayTrustFilter": "audio-agreed",
  "digest": { "enabled": true, "hourLocal": 7, "timezone": "Pacific/Auckland",
              "deliverTo": ["finradar-briefing", "email"] },
  "display": { "language": "en", "theme": "system" }
}
```

Rules:

- Every setting has a default that is safe on cost and cannot exceed `YTI_HARD_BUDGET_USD_MONTH`.
- Changing a model, transport, prompt or provider creates a new immutable configuration hash; runs record which hash produced them.
- Settings that affect trust (`agreementThreshold`, `minimumLevelForToday`, `requireDifferentFamily`) show an inline note explaining what changes on Today.
- Account settings change only how stored rows are computed for that viewer; they never write results.

---

## 7. Front-end updates

### 7.1 Placement inside Finradar

Finradar's top navigation is: **Daily briefing · Intelligence ▾ · Research ▾ · Settings**. The Intelligence menu lists X intelligence, Reddit intelligence, Podcast intelligence, News intelligence and YouTube intelligence. The Research menu lists Company & financials, Insider and Politicians, and AI supply chain. YouTube intelligence opens as its own page with a side panel scoped to the module:

Today · Channels · Leaderboard · Saved calls · Lab · Settings

The top navigation is Finradar's and is not changed by this module.

### 7.2 Functional updates required by the backend changes

- Trust badge component with four states and a hover explanation; used on every claim card, table row and share snapshot.
- Creator conviction chip, visually distinct from trust, always labelled.
- **Column headings** on every table read their hover text (definition and steps) from the metrics registry and expose a sort control. Default sort is stated in the footer. Applies to Today, Channels, both leaderboards, Saved calls and every Lab table.
- Evidence viewer shows the copied span, the English translation, the agreement score for that span, and "what the creator said" versus "what we heard" when they differ.
- **Context check** line under each call on the Analysis page, with the source list and dates on click, and a separately labelled "since then" section after settlement.
- **Sentiment shift** panel on Today and column on the by-ticker leaderboard, showing the viewer's period.
- **Benchmark selector** on the Leaderboard and Channels pages, bound to the account setting.
- **Changes tab** on the Leaderboard with a change-window selector, bound to the account setting.
- Processing state simplified to four user-facing states: Queued, Analysing, Ready, Needs review. Stage detail moves to a collapsible diagnostics panel.
- Cost display becomes a monthly meter in Settings and a per-video line in diagnostics; it leaves the report header.
- Settings screen rebuilt from the schemas in section 6, grouped as Leaderboard and sentiment (account), Sources, Models and transport, Context check, Processing and budget, Channels, Trust, Digest and sharing (team).
- Lab gains a "Promote" action that is disabled until the gold-set evaluation passes the configured gates.
- Channel cards show discovery mode, processing mode, tier and the trust distribution of their calls.

### 7.3 Surfaces

| Surface | Purpose | What it hides |
|---|---|---|
| **Today** | Ranked trusted calls across followed creators, agreement and disagreement, sentiment shift, items needing review; one URL box to analyse anything now | Runs, stages, providers, cost |
| **Channels** | Followed creators with call count, trust distribution, excess return against the viewer's benchmark with significance, discovery and processing mode | Playlist cursors, quota, pull history |
| **Leaderboard** | By ticker (default), by creator, and Changes over a user-chosen window; benchmark, horizon, market and record selectors; methodology and row export | Settlement mechanics |
| **Saved calls** | The user's saved calls, direction changes, notes, forward observations | Snapshot mechanics |
| **Lab** | Prompts, experiments, gold set, provider diagnostics, cost history, shares | Everything technical |
| **Settings** | Sections 6.2 and 6.3 | Environment |

Mapping from the current UI:

| Current | Target |
|---|---|
| Today's research, Watchlist, Digest history | Today |
| Channels, Discover, Follow, Creator performance | Channels and Leaderboard |
| Saved ideas, Search your evidence, Direction history | Saved calls |
| Evaluation lab, Experiments, Prompts, Provider comparisons, Tokens and cost, Shared snapshots, Improvement journal | Lab |
| Research preferences | Settings |

### 7.4 Decision-first report

The Analysis page leads with a trust strip (source basis, agreement, counts by level, reviewer), then claim cards ordered by trust level and creator conviction. Each card shows instrument, stance, thesis, levels with their roles, horizon, conditions, creator conviction and trust badge. Selecting a card plays the cited moment, shows the evidence pair and the context check. Everything about how the result was produced is behind "Processing details".

### 7.5 Visual theme

Finradar tokens are used exactly: surface `#ffffff`, page `#f7f9fc`, ink `#262626`, muted `#626b7b`, line `#e5e9f0`, primary `#194df4`, selected `#edf3ff`, radius 14px, Inter or system font. Stance colours are additive to the theme and always paired with text. Dark mode uses the existing dark token set in `globals.css`.

---

## 8. Data contract changes

- `claims`: id, run_id, video_id, channel_id, instrument, ticker, ticker_explicit, stance, thesis_en, horizon_en, conditions_en[], risks_en[], creator_conviction, trust_level, trust_basis (json), config_hash, published_at, created_at.
- `mentions`: id, run_id, video_id, channel_id, ticker, stance, is_call, claim_id (nullable), trust_level, span_id, published_at.
- `evidence_spans`: claim_id, start_id, end_id, start_seconds, end_seconds, text_original, text_hash, translation_en, agreement_score, anchor_error_seconds, tie_break_source (nullable).
- `transcripts`: video_id, kind (caption | asr-window | whisper | merged), provider, language, hash, segments (jsonb), created_at; immutable.
- `reviews`: claim_id, reviewer_account_id, verdict, note, listened_span, signed_at; append-only.
- `prices`: ticker, date, adjusted_close, source, fetched_at; benchmarks are rows here too.
- `settlements`: claim_id, horizon_days, entry_date, entry_price, exit_date, exit_price, return, status, record (forward | historical); append-only. Excess is never stored; it is computed against the viewer's benchmark.
- `context_checks`: claim_id, window_start, window_end, sources (jsonb: id, kind, date, title, url), summary, kind (at_the_time | since_then), model, config_hash, created_at.
- `channels`: id, handle, title, tier, seed_source[], discovery, processing, auto_analyze, followed_at.
- `metrics_registry` is code, not a table; a CI test asserts UI column ids ⊆ registry ids.
- `shares`: snapshot_id, created_by, revoked_at (nullable), expires_at (nullable).
- `briefing_observations`: edition_id, ticker, source = youtube, mentions, prior, change, state, why, evidence_count, claim_ids[].

---

## 9. Delivery plan and gates

| Phase | Work | Gate to exit |
|---|---|---|
| 0 | Gold set of 50 verified claims; `ModelTransport` interface; metrics registry skeleton; settings schemas | Evaluation harness reports precision, recall, anchor accuracy and cost per accepted claim for the current v5 configuration |
| 1 | Native transport for all stages; pointer evidence with `responseSchema`; mentions with sentiment and rationale; batched critique with explicit caching; low media resolution; realistic reservations with retries; Supadata standby with circuit breaker | Gold-set precision and recall not below v5; cost per accepted claim at least 40% lower; zero structural rejections on the gold set; standby engages on an injected vendor error and not on a missing-captions case |
| 2 | Always-on worker with Postgres queue; Postgres-only with PGlite tests; relational tables and migrations; prices and settlements; default channel seed with selection and cost projection | Four videos processed in parallel end to end; restart during a run resumes without duplicate spend; CI runs on the production dialect; seed produces the deduplicated channel list |
| 3 | Windowed ASR, agreement scoring and Whisper tie-break; trust ladder; Today, Channels, Leaderboard (by ticker, then by creator), Saved calls, Lab surfaces inside the Finradar shell; hover definitions and sorting on every table; benchmark and period settings; push notifications; batch mode; historical replay from January 2026 | At least 95% of L2 anchors within two seconds on the gold set; a new upload appears on Today within the batch window without manual action; registry CI test passes with every column mapped; the leaderboard recomputes for a benchmark change without a write; the Changes tab reproduces a hand-computed diff between two dates on the fixture database |
| 4 | Context check with dated sources; Finradar `youtube` observation; File Search corpus; sharing with revoke; digest | A context check cites only sources inside its window on 100% of a 50-call sample; a Finradar edition renders a youtube observation with evidence links; a cross-video question returns cited spans |

Rollback: each phase is behind a flag; phase 1 can run alongside the OpenRouter path for a comparison week before the old path is removed.

The feature-level breakdown of these phases, with dependencies, lanes, test plan and delivery strategy, is in `youtube-intelligence-v2-build-plan.md`.

---

## 10. The two handoffs, evaluated

### TrueAlphaData handoff (`handoff.md`, commit d341270)

| Proposal | Verdict | Reason |
|---|---|---|
| Statistics layer: Wilson interval, t, p, FDR-adjusted q, gates n ≥ 20 | **Keep, phase 3** | Cheap, pure code, and the only way to say "supported" honestly. LeapEdge shows win rate with no sample gate; this is our edge. |
| Scoreboard rollup and creator profiles | **Keep, phase 3**, computed at query time | Required for leaderboard parity. Their snapshot-in-a-document approach is replaced by registry metrics over rows. |
| Leaderboard UI with per-horizon boards | **Keep, phase 3** | Side-panel item; by ticker first as confirmed. |
| Methodology page rendered from the same constants | **Keep**, generalised | Becomes the metrics registry that also feeds every hover. |
| Per-year alpha buckets, bull/bear accuracy split, best/worst call | **Keep, low priority** | Small additions to the same rollup. |
| CSV export via share tokens | **Keep** | Columns carry registry ids. |
| Track A: re-score their 26,646 rows with about 1,400 FMP series fetches | **Defer, Lab only** | Validates our arithmetic against a third party's internally inconsistent data. Never product data. |
| Track B: replay Tier-1 videos | **Approved: Tier 1 from 1 January 2026, batch** | Stops the leaderboard being empty. Every row labelled historical. |
| Track C: forward record with daily settlement | **Keep, essential** | The only record that proves anything. |
| Cold-start ingestion of their prediction sheet | **Rejected** | Violates "computed, never copied". |
| Creator correlation matrix, rolling decay | **Drop for now** | No user has asked; adds explanation burden. |

### VideoConviction handoff (`handoff-videocviction.md`, commit c0a0fb6)

Revision 3 decision (17 September 2026): the design does not use the VideoConviction data, so nothing from this handoff is adopted and its benchmark, fixture, scripts and mockups were removed from the repository. The earlier verdicts are kept for the record.

| Proposal | Verdict | Reason |
|---|---|---|
| A. Benchmark harness over 760 expert-labelled segments | **Dropped** | Evaluation-only dependency with a licence question; the gold set measures ticker, stance and conviction directly. |
| B. Conviction rubric prompt v7 | **Keep, gated on the gold set** | Conviction decides which calls the leaderboard scores, so inflation biases the leaderboard. |
| C. Video-attached extraction arm | **Drop** | Was a Lab experiment on the benchmark rows. |
| D. Title-keyword ordering signal | **Drop** | Push notifications plus batch processing make ordering irrelevant. |
| E. Backtrader oracle | **Drop** | Duplicate of the settlement math with worse hygiene, as the handoff itself says. |
| Benchmark panel UI in Lab | **Dropped** | No benchmark to show. |
| Its 22 channels | **Dropped from the seed** | The channel list came from the dataset's metadata; teams add channels by URL instead. |

---

## 11. LeapEdge feature comparison

| Feature | LeapEdge | This repo today | Target |
|---|---|---|---|
| Per-video analysis, timestamped quotes | Yes; not for audio-only inputs | Yes; timestamps unverified estimates | Yes, with a trust level per call, bounded timestamps and a dated context check |
| Morning read / daily synthesis with stance and conviction | Yes | Yes (briefing) | Today view plus a `youtube` observation in the Finradar briefing |
| Trend tracking, top tickers, mood | Pro | Trends panel | Sentiment shift per ticker on a user-chosen period, plus corpus search |
| Creator leaderboard: calls, return, alpha vs SPY, win rate, 90 days | Yes, 47 creators, recomputed quarterly | Per-channel vs SPY in a frozen snapshot | Ranked with confidence intervals and significance gates; 90/180/365; forward and historical separated; benchmark chosen by the user; recomputed on request |
| By-ticker leaderboard | Not on their public page | No | Yes: consensus and disagreement first, then where calls worked, then who is reliable per ticker |
| Column definitions | Methodology page only | Partial | Hover on every column from the registry, plus Methodology |
| Custom creator channels | Pro, 10 to 50 channels | Yes, hourly poll | Seeded with about 80 channels; push notifications; batch analysis |
| Captionless videos | "Works for most" | Experimental flag | Standard route via windowed Gemini, Whisper standby |
| Long videos | Observed failure on a 38-minute video | Windowed mode, opt-in | Windowed by default |
| Chinese-language creators | Yes | Partial | Yes, with translated evidence spans |
| Shared reports | Indefinite until revoked | 7-day expiry | Indefinite until revoked, with optional expiry |
| Search | Yes | Yes | Yes, plus cross-video questions with citations |
| External context per call | No | No | Yes, dated to the video window |
| Free plan limit | 3 videos a day | n/a | Monthly budget the team sets |
| Cost per report shown to user | US$0.03 to US$0.10 | US$0.19 to US$0.93 | Target US$0.10 to US$0.25 all-in |

Where we exceed LeapEdge: trust level per call, agreement score against audio, sample-size gates, user-chosen benchmark, by-ticker consensus, sentiment shift, context check, immutable forward record, versioned configuration, visible rejections, hover definitions everywhere. Where we match: everything else above, including indefinite sharing.

---

## 12. Target process flow, each step justified

| Step | What happens | Why it exists | Could it be removed? |
|---|---|---|---|
| Arrive | Push notification or pasted link enqueues a job | Free, near real-time; removes hourly polling and quota use | Poll stays as fallback for hub renewal failures only |
| Queue | Postgres queue, always-on worker, 4 in parallel | Cron ran one job a minute under a global lock | No; it is the throughput fix |
| Metadata | One Data API call | Duration, channel and publication date are needed for windows, settlement and the context window | No |
| Captions | TranscriptAPI; Supadata on vendor error | Half a cent, fastest, 80% coverage | No |
| Audio transcript | Gemini native, 5-minute windows, low resolution, batch; Whisper tie-break below threshold | Only route independent of captions; windows bound timestamp error | Runs only when needed, so it removes itself for most videos |
| Align and score | Edit distance per span | Turns "audio unverified" into a number | No; it is the trust signal |
| Extract | One native call, full transcript, returns segment IDs for calls and mentions | Chunking and quote-copying caused most rejections; mentions feed sentiment | No |
| Copy and check | App copies spans; price role, ticker, comparator checks | Deterministic, free, catches "under $20 → entry $20" | No |
| Critic | One batched call, other model family, cached transcript | Per-claim critique cost was linear in claims; same-family critic missed errors | Could be skipped for L2 calls if the benchmark shows it adds nothing; decide with data |
| Context check | Dated FMP sources validated, then one OpenRouter call | The reader needs what was knowable then | Optional by setting; skipped for macro items without a ticker |
| Trust level | Computed from checks, agreement, review | What the user filters on | No |
| Human review | Optional, signed by account, append-only | Only path to L3 | Optional by design |
| Store | Relational tables, prices with fetch time | Every served number must be recomputable | No |
| Settle | Daily sweep writes entry and exit prices per horizon | The forward record | No |
| Serve | Today, Leaderboard, Finradar briefing, digest, all computed on request | The product | Digest is optional per user |
| Lab | Gold set gates promotions | Without it no change can be shown to help | No |

### What is dropped, and why

| Dropped | Why |
|---|---|
| Supadata, Tapline, BibiGPT, YouTube.js as routine caption routes | Same coverage as TranscriptAPI, slower, and fail together. Supadata survives only as a standby with distinct roles. |
| Model-written quotes and substring matching as a gate | Caused most false rejections |
| Per-claim critique with full transcript | Cost linear in claims, no measured benefit |
| Same-family critic as default | Correlated errors let three real mistakes through |
| Cron dispatcher, global advisory lock, JSON-blob store, scoreboard snapshots | Serial, unqueryable, untestable on the production dialect, and frozen |
| Never-retry ledger with context-window reservations | Locked the budget at 60× real cost |
| Source-repair stage | Superseded by windowed reference transcription |
| LLM audio review as a trust input | Another model opinion, not evidence; kept in Lab only |
| Title-keyword ordering, backtrader oracle, correlation matrix, cold-start sheet ingestion | No user value, or violates "computed, never copied" |
| OpenRouter web plugin and Google Search grounding for context | No publication-date bound |
| Six-tab research app, 7-day share expiry | Replaced by the module side panel and indefinite links |

---

## 13. Risks and open questions

Risks:

- **Budget versus seed size.** Eighty channels in batch is US$150 to US$250 a month before context checks. The cap protects spend but will leave videos unanalysed at month end unless the budget is raised or channels are tiered.
- **Supadata Whisper on Chinese audio.** Quality is unmeasured; the tie-break must be evaluated on the gold set's Chinese items before it can raise a claim to L2.
- **FMP news coverage.** Thin for small caps and non-US names; the context check must say "no dated sources found" rather than reach outside the window.
- **Push hub renewals.** Subscriptions expire and must be renewed by the worker; poll remains as fallback.
- **Finradar contract drift.** The handoff pins a commit that has moved; the `youtube` observation shape must be re-checked against the current contract before phase 4.
- **Sonar retirement.** Not used, but any Lab experiment on Perplexity through OpenRouter must move to the Agent API after 27 September 2026.

Decisions taken from the review round (recorded so they are not reopened):

- Seed about 80 channels; process Tier 1 and LeapEdge's top 20 by default; the team edits and saves the selection; budget US$150, raisable.
- Sentiment is bullish, neutral or bearish per mention, with a cited rationale, persisted and traceable to video, channel and segment; mentions and calls both displayed.
- Context window default 14 days before publication to 2 days after.
- Sector benchmark uses SPDR sector ETFs; the other options remain selectable.
- Historical replay limited to what fits under US$150 alongside forward processing; Tier 1 from January 2026 first.
- US stocks and ETFs are the default filter on ticker boards; Hong Kong, A-share and other instruments are extracted and displayed everywhere else and can be added to the boards.
- Benchmark and market filter are per account; the team can set the defaults.
- Supadata on the free plan until standby use is observed; a clear out-of-credit error on the portal.

- Context window numbers are user-editable in Settings with a reset to 14 and 2.
- Benchmark, period, market filter and horizon: team default with per-account override and a "Reset to team default" action.
- LeapEdge top-20 default: their public ranking at seed time, our own forward record once it exists.
- Unselected channels list every new upload; "Analyse this one" analyses the video and switches the channel on, with its cost stated.

No open questions remain from the review round.

---

## 14. Decision record

| Question | Decision | Rejected alternative | Why |
|---|---|---|---|
| Transport | Native Gemini in production, OpenRouter for critic, context and flexibility | OpenRouter everywhere | Loses batch, caching, media resolution, schema, agentic mode |
| Evidence | Pointer with app-side copy | Model-written quotes with substring match | Formatting rejections dominated failures |
| Critique | One batched call, different family, cached transcript | One call per claim | Cost linear in claims; correlated errors |
| Queue | Always-on worker with Postgres queue | Per-minute cron | Serial, lock-bound, no parallelism |
| Storage | Postgres only, relational | SQLite plus Postgres via rewriting | Production dialect untested; blobs unqueryable |
| Timestamps | Windowed Gemini ASR, agreement score | Full-video ASR | 97-second drift observed |
| Captions | TranscriptAPI, Supadata on standby | Five-provider fallback chain | Same track; correlated failures; standby needs distinct roles |
| Audio fallback | Supadata Whisper as tie-break and outage fallback | Whisper as primary reference | Cannot be windowed; long videos need polling |
| Leaderboard | Computed from settlement rows on request, benchmark per viewer | Snapshot documents, SPY only | Snapshots cannot be recomputed; users asked for other benchmarks |
| By-ticker priority | Consensus first, then where calls worked, then reliability per ticker | Creator-first | Confirmed by the team |
| Sentiment | Per-mention bullish/neutral/bearish with cited rationale, computed aggregates | Aggregate-only score | Must be traceable to video, channel and words |
| Leaderboard changes | Diff of two as-of computations over a user-chosen window | Stored daily snapshots | Snapshots cannot follow a benchmark or filter change; the diff can |
| Channel processing | Team-editable selection with cost projection under a raisable US$150 budget | Process all 80 | Budget |
| Markets | Extract everything, filter boards to US by default | Hard-code US only | Nothing suppressed; filter is a setting |
| Sentiment | Mentions with trust levels, period per account | Calls only | Calls too sparse to show movement |
| Context check | Dated FMP sources, validated, summarised through OpenRouter | Model web search | No provider search can be bounded by publication date on OpenRouter |
| Metric definitions | One registry feeding hover, Methodology and CI | Hand-written help text | Drift between text and code |
| External datasets | Evaluation fixtures only | Product data | "Computed, never copied"; licences |
| Cross-video | File Search | Self-hosted vector DB | Managed, cited, no infrastructure |
| NotebookLM | Analyst surface only | Pipeline component | No API, caption-only, 72-hour delay |
| Channel discovery | Push hub, batch analysis | Hourly polling, immediate analysis | Free, faster, half the model cost |
| Sharing | Indefinite until revoked | 7-day expiry | Matches LeapEdge; confirmed by the team |
