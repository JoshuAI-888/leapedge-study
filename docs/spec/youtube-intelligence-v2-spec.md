# YouTube Intelligence v2 — proposed update specification

**Status:** Proposal for review. Nothing in this document has been implemented, deployed or promoted.
**Scope:** The `feat/youtube-intelligence` codebase in this repository, its hosted lab, and its planned merge into Finradar under Intelligence → YouTube Intelligence.
**Companion:** Target-state mockup canvas (Finradar theme): https://claude.ai/artifact/42c21wSpbiEtPrHJLh7THZ. Artboard sources are kept under `docs/spec/mockups/`.

---

## 1. Summary

The current system is built around two defences: never spend a cent twice, and never trust the model. Both are correct instincts. Applied as blanket rules they now cause most of the observed failures: transient errors become terminal states, reservations lock the budget at roughly sixty times real cost, quotes are rejected over a join space, and each claim costs a full-transcript critique call.

This specification replaces each blanket defence with a measurement, consolidates model traffic on the native Google SDK for proven workloads while keeping OpenRouter for model flexibility, adopts the Google capabilities the workload actually needs, and reshapes the product around one question an investment team asks: **what did credible creators say, how sure were they, and how far can we trust the record?**

Ten changes, in delivery order:

| # | Change | Primary outcome |
|---|---|---|
| 1 | Model transport policy: native Gemini for production stages, OpenRouter for experiments and non-Google critics | Cost, feature access, flexibility |
| 2 | Evidence by pointer, not by copy | Reliability of accepted claims |
| 3 | Three-call pipeline with cached transcript and batched critique | Cost, latency, simplicity |
| 4 | Idempotent retries and realistic reservations | Reliability, operability |
| 5 | Two-tier source: captions as draft, windowed ASR as reference, agreement as the trust signal | Verifiable accuracy |
| 6 | Trust ladder as a first-class data field | Usability for decisions |
| 7 | Always-on worker, Postgres-only, relational core | Throughput, simplicity, Finradar fit |
| 8 | YouTube push notifications and Batch API for channel automation | Cost, freshness |
| 9 | Gold set and measured promotion gates | Confidence in every later change |
| 10 | Front-end revamp: four surfaces, decision-first | Usability |

---

## 2. Outcomes for the investment team

The investment team does not consume transcripts, prompts or provider diagnostics. They consume calls: an instrument, a direction, the creator's stated conviction, the levels and conditions, the horizon, and a reason to trust that the record is faithful. Everything else is plumbing.

| Today | Target |
|---|---|
| A completed run can show zero accepted claims because of a caption join space | Provenance is guaranteed by construction; rejections mean real disagreement, not formatting |
| "Audio unverified" is a permanent disclaimer | Each claim carries a trust level backed by a caption-to-audio agreement score and, where reviewed, a human signature |
| Creator conviction and model confidence share one screen without distinction | Conviction is the creator's word; trust is the system's evidence grade; they are shown separately and never merged |
| Channels are polled hourly, three at a time | New uploads arrive by push and are analysed in batch within hours, automatically, under a monthly budget the user sets |
| Six tabs mixing decisions with lab tooling | Four surfaces: Today, Channels, Ideas, Lab. Diagnostics are one click away, never in the way |
| Cross-video questions require scanning JSON blobs | A searchable corpus with citations for "what have creators said about NVDA since August" |

Why this is the right decision for that user:

- **Usability.** The first screen is a ranked list of trusted calls with agreement across creators, not a run history. Attention goes to decision, conviction and trust.
- **Cost.** Batch pricing halves model spend on automated work. Cached transcripts remove the per-claim transcript re-send. Low media resolution removes frame tokens from a transcription task. Measured on the repo's own runs, the long English retry drops from twelve model stages to three.
- **Simplicity.** One production transport, one database dialect, one queue, three model calls per video, four screens.
- **Flexibility.** OpenRouter stays for cross-vendor comparison and for a critic from a different model family. Every provider, model, transport, processing mode and budget is a user-visible setting with a safe default.

---

## 3. Design principles

1. **Measure instead of forbid.** Where the current code forbids retry, spend or trust, the new design measures the risk and lets a setting decide.
2. **Provenance by construction.** The application copies source text; the model only points at it.
3. **Conviction is not confidence.** Creator conviction, system trust level and any market outcome are three fields, never one.
4. **Proven workloads on native APIs, exploration on the aggregator.**
5. **Every automatic action has a budget, a cap and an off switch the user controls.**
6. **Hide complexity, keep it reachable.** Diagnostics, prompts, providers and costs live in Lab and in collapsible panels, never on decision surfaces.

---

## 4. Architecture changes

### 4.1 Model transport policy

**Decision.** Production stages call the Gemini Developer API directly through `@google/genai`. OpenRouter remains available as a second transport for experiments, for non-Google models, and for any stage a user explicitly routes there.

**Rationale.** Today every text call and the video fallback go through OpenRouter pinned to Google AI Studio. That pays a markup to reach the same endpoint and loses batch pricing, explicit context caching, media resolution control, clip offsets on YouTube URLs, agentic video mode and schema-enforced output. The native SDK already exists in the repo and is already proven on the hardest stage. The white paper itself flagged transport as an uncontrolled variable in the A/B.

**Where OpenRouter is the right tool.**

| Scenario | Transport | Why |
|---|---|---|
| Transcription, extraction, batched critique, audio review on Gemini | Native | Batch, caching, media resolution, schema, agentic mode |
| Critic from a different model family (Claude, GPT, Mistral) | OpenRouter | One key, one API shape, no extra SDKs |
| Evaluation lab A/B across vendors | OpenRouter | Same reason; cost is bounded by the experiment |
| A user who wants a non-Google extraction model | OpenRouter, by setting | Flexibility without code change |
| Google outage or quota exhaustion | OpenRouter fallback, if enabled | Continuity; the setting is off by default so cost stays predictable |

**Implementation.** A `ModelTransport` interface with two implementations behind `modelCall`. The ledger, retained responses, prompt snapshots and metrics sit above the interface so production runs and experiments remain comparable. Drop the per-call catalogue download, the `provider.only` pin and the `json_object` response format; replace with a cached price table, direct calls and `responseSchema`.

### 4.2 Evidence by pointer

**Decision.** Extraction returns segment IDs or ID ranges. The application copies the exact retained text into the claim. String matching survives only as a sanity assertion, never as a gate.

**Rationale.** The v8 experiment in `evidence-selection.ts` produced zero structural failures across 29 items where the copy-and-match baseline lost eight of nine. The "more than 20 IDs" schema failure is removed by supplying the output contract as a `responseSchema`.

**Outcome.** Rejections now mean the critic disagreed with the claim, which is information. They no longer mean a caption boundary had a space in it.

**Contract change.** `Claim.evidence[]` gains `source_span: {start_id, end_id, start_seconds, end_seconds, text_hash}`. `quote_original` is derived, never model-written. `quote_translation_en` is produced in a separate cheap call over the copied span, so translation can never alter the evidence.

### 4.3 Three-call pipeline

**Decision.** Per video: one extraction over the full transcript; one batched critique over all claims with the transcript supplied from an explicit context cache; one optional repair or translation pass. Chunking applies only above a configurable token threshold.

**Rationale.** The long English retry ran twelve stages and 594k tokens for about US$0.93. Gemini's context window makes chunking at 64 KB unnecessary, and per-claim critique multiplies transcript cost by claim count. Batched critique also lets the critic see cross-claim consistency, which the per-claim design hid.

**Critic independence.** The default critic is a different model family from the extractor, routed through OpenRouter, so critic and generator errors are less correlated. This is a setting; a Google-only configuration remains valid.

### 4.4 Idempotent retries and realistic reservations

**Decision.** Provider calls are keyed by run, stage and attempt. Retries are permitted for 429, 5xx and timeouts that occurred before any response bytes, with jitter and a per-stage cap. Reservations are estimated from counted input tokens plus the output cap, reconciled from the provider's reported usage, and released on any terminal outcome. Unknown outcomes hold a bounded reservation for a configurable window, then move to a reconciliation queue rather than blocking the run.

**Rationale.** The current ledger reserves context length times the highest rate and holds it forever on an unknown outcome. Held reservations were NZ$37.86 against US$0.60 of known cost across 25 requests. The budget becomes an alert threshold and a hard stop, not a lock that engages after a few video calls.

### 4.5 Two-tier source and the agreement signal

**Decision.** Captions remain the fast draft. A windowed Gemini transcription from the YouTube URL is the reference source, requested in fixed windows with `videoMetadata` offsets so timestamps are bounded by construction. The two are aligned with the edit-distance tooling already in `evaluations/transcript-accuracy.ts`. Per-span agreement is stored with each claim.

**Rationale.** All caption providers read the same YouTube track and fail together (four of six, forty of fifty). The one route independent of captions is model transcription from audio. The full-video run drifted 97 seconds; two 90-second clips agreed to within 0.06 seconds. Windowing fixes drift; the agreement score turns "audio unverified" into a number.

**Policy setting.** ASR runs always, only when captions are missing, or only when a claim's cited span is needed for a trust upgrade. Default: when captions are missing, plus on demand for any claim promoted to Today.

**Alternative retained for a later decision.** Google Cloud Speech-to-Text v2 with Chirp 3 gives word-level timestamps and batch pricing near US$0.003 per minute, but requires an audio file, which means downloading from YouTube. That is a terms-of-service decision for the business, not a technical one. The transport interface leaves room for it.

### 4.6 Trust ladder

Every claim carries one of four levels. The level is computed, stored, filterable and visible everywhere the claim appears.

| Level | Name | Requirement |
|---|---|---|
| L0 | Extracted | Passed schema and deterministic checks only. Never shown on Today. |
| L1 | Text-checked | Pointer evidence, price and ticker checks, batched critic accepted. |
| L2 | Audio-agreed | Caption and ASR agree on the cited span above the configured threshold and the timestamp anchor is within two seconds. |
| L3 | Human-verified | A named reviewer listened to the cited span and signed the claim. Append-only. |

Creator conviction (high, medium, low, unspecified) is a separate field and is always displayed with the label "creator conviction". Nothing in the UI combines the two into a single score.

### 4.7 Always-on worker, Postgres only, relational core

**Decision.** `scripts/worker.ts` becomes the production worker on an always-on host with a Postgres-backed queue (pg-boss or Graphile Worker). Vercel serves the UI and API only. SQLite and the dialect rewriter are removed; tests use PGlite. Claims, evidence spans, transcripts, reviews, channels and settlements get their own tables with additive migrations.

**Rationale.** A per-minute cron running one job at a time under a global advisory lock cannot serve auto-analysed channels. The JSON-blob store forces every cross-video feature to scan everything. The Finradar handoff already requires reviewed migrations and shared platform tasks; this change is the precondition for the merge.

### 4.8 Channel automation: push and batch

**Decision.** Subscribe followed channels to YouTube's push hub. New uploads enqueue a batch job by default; user-submitted URLs run immediately. Users choose per channel.

**Rationale.** Push is free, near real-time and uses no Data API quota. The Batch API is half price with higher rate limits and a turnaround well under a day, which matches an overnight digest.

### 4.9 Gold set and promotion gates

**Decision.** Before any prompt, model or transport change is promoted, it must be evaluated against a frozen set of at least fifty human-verified claims across English and Chinese, with audio-checked anchors. The evaluation reports claim precision and recall, critic precision and recall, anchor accuracy within two seconds, and cost per accepted claim.

**Rationale.** Every reference case today is `pending_audio_review`. Candidates v6, v8 and single-segment-quotes cannot be promoted because nothing measures whether they are better. This is the single highest-leverage task in the repository.

### 4.10 Provider diet

Keep one caption provider (TranscriptAPI, first by measured latency) plus the windowed ASR route. Move Supadata, Tapline, BibiGPT and YouTube.js adapters to `evaluations/providers/` as retained test artefacts. Correlated fallbacks add latency and state machines without coverage.

### 4.11 Finradar integration as a source

YouTube becomes a fourth source in the existing `briefing-read-v1` contract alongside x, reddit and podcast. Each ticker item gains a `youtube` observation with `metricUnit: "creator calls"`, `mentions` (calls in window), `prior`, `change`, `state`, a `why` sentence, `evidenceCount`, and links to claim IDs with their trust level. Editions remain immutable and dated. This reuses the existing briefing surface instead of porting a second application.

---

## 5. Google capabilities to adopt

| Capability | Use | Why | Setting |
|---|---|---|---|
| Gemini Developer API via `@google/genai` | All production text and media stages | Direct access to every feature below; already proven in `native-google-core.ts` | `transport.default = google-native` |
| Batch API | Channel auto-analysis, critique, translation, backfills | 50% price, higher rate limits, no client-side queue for these jobs | `processing.mode` per trigger |
| Explicit context caching | Transcript held once per run for critique and repair | 90% discount on cached input tokens; removes the per-claim transcript re-send | `processing.contextCaching` |
| Implicit caching | All calls | Free when the prefix matches; requires source before claim in the payload | Always on; payload order fixed in code |
| YouTube URL media input with `videoMetadata` offsets | Windowed reference transcription | No download; timestamps bounded per window | `sources.asr = gemini-windowed`, `sources.windowSeconds` |
| `mediaResolution: LOW` | Transcription | Audio is 32 tokens per second; frames are 100 to 300 per second and irrelevant to transcription | `sources.mediaResolution` |
| Agentic video understanding | Audio review of cited spans | Navigates to cited moments; up to 88% fewer tokens than static ingestion | `sources.agenticAudioReview` |
| `responseSchema` structured output | Every stage | Schema-enforced JSON; removes the runtime Zod-only failure | Always on |
| Thinking configuration | Critic only | Bounded reasoning budget where it helps, none where it does not | `models.critique.thinkingBudget` |
| File Search | Cross-video corpus search and trend questions | Managed retrieval with chunk-level grounding metadata; no vector database to run | `corpus.fileSearch` |
| YouTube Data API v3 | Metadata, uploads playlist, channel resolution | Correct use today; caption download requires owner authorisation and stays out | `YOUTUBE_API_KEY` |
| YouTube push notifications (PubSubHubbub) | New-upload events | Free, near real-time, no quota | `channels.discovery = push` |
| Gemini Embedding 2 (through File Search) | Multilingual retrieval | One embedding space for English and Chinese | Implicit in File Search |
| Speech-to-Text v2 Chirp 3 (deferred) | Word-level timestamps | Only if audio download is approved by the business | `sources.asr = chirp3` (hidden until enabled) |

Not adopted: Vertex AI for the YouTube URL path, because it does not accept YouTube URLs. NotebookLM as a pipeline component, for the reasons recorded in the architecture review; it remains a manual analyst surface.

---

## 6. Settings

Two layers. Server environment holds credentials and hard limits. User preferences hold everything a user may reasonably change, each with a safe default and a one-line explanation in the UI.

### 6.1 Server environment

```
GEMINI_API_KEY=            # required; production transport
OPENROUTER_API_KEY=        # optional; experiments and non-Google critics
YOUTUBE_API_KEY=           # required; metadata and discovery
TRANSCRIPTAPI_API_KEY=     # optional; caption draft
FMP_API_KEY=               # optional; performance
DATABASE_URL=              # required; Postgres
YTI_PUSH_CALLBACK_SECRET=  # required when channels.discovery=push
YTI_HARD_BUDGET_USD_MONTH= # absolute ceiling the UI cannot raise
RESEND_API_KEY=            # optional; digest delivery
```

### 6.2 User preferences (schema)

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
    "translation":   { "id": "gemini-3.1-flash-lite", "transport": "google-native" },
    "audioReview":   { "id": "gemini-3.8-flash", "transport": "google-native" }
  },
  "sources": {
    "captionProvider": "transcriptapi",  // transcriptapi | none
    "asr": "gemini-windowed",            // gemini-windowed | off
    "asrPolicy": "when-captions-missing",// always | when-captions-missing | on-demand
    "windowSeconds": 300,                // 120–600
    "mediaResolution": "low",            // low | default
    "agenticAudioReview": true,
    "agreementThreshold": 0.92           // span agreement for L2
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
    "autoAnalyzeNewChannels": false,
    "backfillDepthDays": 0
  },
  "trust": {
    "minimumLevelForToday": "audio-agreed", // text-checked | audio-agreed | human-verified
    "showExtractedInLab": true
  },
  "corpus": { "fileSearch": true, "retentionDays": 365 },
  "digest": { "enabled": true, "hourLocal": 7, "timezone": "Pacific/Auckland",
              "deliverTo": ["finradar-briefing", "email"] },
  "display": { "language": "en", "theme": "system" }
}
```

Rules:

- Every setting has a default that is safe on cost and cannot exceed `YTI_HARD_BUDGET_USD_MONTH`.
- Changing a model, transport or prompt creates a new immutable configuration hash; runs record which hash produced them.
- Settings that affect trust (`agreementThreshold`, `minimumLevelForToday`, `requireDifferentFamily`) show an inline note explaining what changes on Today.

---

## 7. Front-end updates

### 7.1 Functional updates required by the backend changes

- Trust badge component with four states and a hover explanation; used on every claim card, table row and share snapshot.
- Creator conviction chip, visually distinct from trust, always labelled.
- Evidence viewer shows the copied span, the English translation, the agreement score for that span, and "what the creator said" versus "what we heard" when they differ.
- Processing state simplified to four user-facing states: Queued, Analysing, Ready, Needs review. Stage detail moves to a collapsible diagnostics panel.
- Cost display becomes a monthly meter in Settings and a per-video line in diagnostics; it leaves the report header.
- Settings screen rebuilt from the schema in section 6 with grouped sections and inline explanations.
- Lab gains a "Promote" action that is disabled until the gold-set evaluation passes the configured gates.
- Channel cards show discovery mode (push or poll), processing mode (immediate or batch) and the trust distribution of their calls.

### 7.2 Information architecture revamp

Four surfaces replace the current six tabs.

| Surface | Purpose | What it hides |
|---|---|---|
| **Today** | Ranked trusted calls across followed creators, grouped by instrument with agreement and disagreement; one URL box to analyse anything now | Runs, stages, providers, cost |
| **Channels** | Followed creators with call count, trust distribution, forward record versus SPY with significance, discovery and processing mode | Playlist cursors, quota, pull history |
| **Ideas** | The user's saved calls, direction changes, notes, forward observations | Snapshot mechanics |
| **Lab** | Prompts, experiments, evaluation, provider diagnostics, cost history, shares | Everything technical |

Settings opens from the shell, not a tab. The Analysis page is reached from Today, Channels or Ideas and never from a run list.

Mapping from the current UI:

| Current | Target |
|---|---|
| Today's research, Watchlist, Digest history | Today |
| Channels, Discover, Follow, Creator performance | Channels |
| Saved ideas, Search your evidence, Direction history | Ideas |
| Evaluation lab, Experiments, Prompts, Provider comparisons, Tokens and cost, Shared snapshots, Improvement journal | Lab |
| Research preferences | Settings |

### 7.3 Decision-first report

The Analysis page leads with a trust strip (source basis, agreement, counts by level), then claim cards ordered by trust level and creator conviction. Each card shows instrument, stance, thesis, levels with their roles, horizon, conditions, creator conviction and trust badge. Selecting a card plays the cited moment and shows the evidence pair. Everything about how the result was produced is behind "Processing details".

### 7.4 Visual theme

Finradar tokens are used exactly: surface `#ffffff`, page `#f7f9fc`, ink `#262626`, muted `#626b7b`, line `#e5e9f0`, primary `#194df4`, selected `#edf3ff`, radius 14px, Inter or system font. Stance colours are additive to the theme and always paired with text. Dark mode uses the existing dark token set in `globals.css`.

---

## 8. Data contract changes

- `claims`: id, run_id, video_id, channel_id, instrument, ticker, ticker_explicit, stance, thesis_en, horizon_en, conditions_en[], risks_en[], creator_conviction, trust_level, trust_basis (json), config_hash, created_at.
- `evidence_spans`: claim_id, start_id, end_id, start_seconds, end_seconds, text_original, text_hash, translation_en, agreement_score, anchor_error_seconds.
- `transcripts`: video_id, kind (caption | asr-window | merged), language, hash, segments (jsonb), created_at; immutable.
- `reviews`: claim_id, reviewer, verdict, note, listened_span, signed_at; append-only.
- `settlements`: claim_id, horizon_days, entry_basis, exit_basis, return, excess_vs_spy, status; append-only.
- `briefing_observations`: edition_id, ticker, source = youtube, mentions, prior, change, state, why, evidence_count, claim_ids[].

---

## 9. Delivery plan and gates

| Phase | Work | Gate to exit |
|---|---|---|
| 0 | Gold set of 50 verified claims; `ModelTransport` interface; settings schema and migration of existing preferences | Evaluation harness reports precision, recall, anchor accuracy and cost per accepted claim on the gold set for the current v5 configuration |
| 1 | Native transport for all stages; pointer evidence with `responseSchema`; batched critique with explicit caching; low media resolution; realistic reservations with retries | Gold-set precision and recall not below v5; cost per accepted claim at least 40% lower; zero structural rejections on the gold set |
| 2 | Always-on worker with Postgres queue; Postgres-only with PGlite tests; relational tables and migrations | Four videos processed in parallel end to end; restart during a run resumes without duplicate spend; CI runs on the production dialect |
| 3 | Windowed ASR and agreement scoring; trust ladder; Today, Channels, Ideas, Lab surfaces; push notifications; batch mode for channel uploads | At least 95% of L2 anchors within two seconds on the gold set; a new upload appears on Today within the batch window without manual action |
| 4 | Finradar `youtube` source observation; File Search corpus; channel significance with FDR control | A Finradar edition renders a youtube observation with evidence links; a cross-video question returns cited spans |

Rollback: each phase is behind a flag; phase 1 can run alongside the OpenRouter path for a comparison week before the old path is removed.

---

## 10. Risks and open decisions

- **Audio download.** Chirp 3 word-level timestamps require an audio file. Approve or reject at the business level; the design does not depend on it.
- **Critic vendor.** A non-Google critic adds a second vendor dependency. The setting allows Google-only operation at the cost of correlated errors.
- **Budget.** Defaults are set for the NZ$500 monthly envelope. Actual unit economics are unknown until phase 1 reports cost per accepted claim.
- **Push hub renewals.** Subscriptions expire and must be renewed by the worker; poll remains as fallback.
- **Terms of service for caption providers.** Unchanged from today; TranscriptAPI remains the single provider.
- **Finradar contract drift.** The handoff pins a commit that has moved; the `youtube` observation shape must be re-checked against the current contract before phase 4.

---

## 11. Decision record

| Question | Decision | Rejected alternative | Why |
|---|---|---|---|
| Transport | Native Gemini in production, OpenRouter for flexibility | OpenRouter everywhere | Loses batch, caching, media resolution, schema, agentic mode |
| Evidence | Pointer with app-side copy | Model-written quotes with substring match | Formatting rejections dominated failures |
| Critique | One batched call, different family, cached transcript | One call per claim | Cost linear in claims; correlated errors |
| Queue | Always-on worker with Postgres queue | Per-minute cron | Serial, lock-bound, no parallelism |
| Storage | Postgres only, relational | SQLite plus Postgres via rewriting | Production dialect untested; blobs unqueryable |
| Timestamps | Windowed Gemini ASR, agreement score | Full-video ASR | 97-second drift observed |
| Cross-video | File Search | Self-hosted vector DB | Managed, cited, no infrastructure |
| NotebookLM | Analyst surface only | Pipeline component | No API, caption-only, 72-hour delay |
| Channel discovery | Push hub, batch analysis | Hourly polling, immediate analysis | Free, faster, half the model cost |
