# YouTube Intelligence v2.1 — addendum after review of the latest handoffs

**Date:** 17 September 2026. **Supersedes** sections 4.11, 7.2 and the mockup reference of `youtube-intelligence-v2-spec.md` where they differ. Everything else in the v2 spec stands.
**Inputs reviewed:** `handoff.md` (TrueAlphaData, commit d341270), `handoff-videocviction.md` and `docs/mockups/videocviction/*` (commit c0a0fb6), `docs/implementation-checklist.md`, LeapEdge public feature page, provider pricing pages.
**Mockup canvas (updated):** https://claude.ai/artifact/42c21wSpbiEtPrHJLh7THZ

---

## 1. Navigation correction

Finradar keeps its own top navigation. YouTube Intelligence is one entry under the **Intelligence** dropdown and opens as its own page with a **side panel** scoped to the module:

Today · Channels · Leaderboard · Saved calls · Lab · Settings

The v2 spec's left-hand global nav is withdrawn. The canvas now shows the Finradar top bar with the Intelligence dropdown open on every desktop board.

## 2. Provider decision and cost

**Decision.** TranscriptAPI for captions, Gemini native for the audio transcript. Nothing else in the production path.

| Route | Measured in this repo | Price | Per 30-minute video | Role |
|---|---|---|---|---|
| TranscriptAPI | Fastest of three, median 768 ms; 40 of 50 videos | US$5 per 1,000 credits, 1 credit per successful transcript, failures free | ≈ US$0.005 | Draft for every video |
| Supadata, Tapline | Same 4 of 6 coverage, slower; Supadata 403 on captionless | Similar | Similar | Removed: correlated with TranscriptAPI |
| BibiGPT | Empty subtitles on captionless cases, debited anyway | Credit packs | n/a | Removed |
| YouTube.js | 0 of 5 in the free benchmark | Free | 0 | Removed |
| Gemini native, YouTube URL, windowed | Structurally valid on 4 of 5; 97 s drift on full video, 0.06 s in 90 s clips | US$0.75 per M input, US$3.75 per M output; batch halves both | ≈ US$0.20 immediate, ≈ US$0.10 batch | Reference transcript when captions are missing (about 1 in 5 videos) and on demand for calls promoted to Today |

Google native costs roughly 20 to 40 times TranscriptAPI per video, so it is not the default. It is the only route that does not depend on YouTube's caption track, and the only one that can verify captions against audio. Blended source cost for 100 videos is about US$5.50, or US$0.055 per video.

Extraction plus critic: the repo measured US$0.19 for a short video and US$0.93 for a long one under the twelve-stage design. The three-call design with batch pricing and a cached transcript is estimated at US$0.05 to US$0.15. Phase 1 must report the real number.

## 3. The two handoffs, evaluated

### TrueAlphaData handoff (`handoff.md`)

| Proposal | Verdict | Reason |
|---|---|---|
| Statistics layer: Wilson interval, t, p, FDR-adjusted q, gates n ≥ 20 | **Keep, phase 3** | Cheap, pure code, and the only way to say "supported" honestly. LeapEdge shows win rate and alpha with no sample gate; this is our edge. |
| Scoreboard rollup and creator profiles | **Keep, phase 3** | Required for leaderboard parity with LeapEdge. |
| Leaderboard UI with per-horizon boards | **Keep, phase 3** | Now a side-panel item. Added a by-ticker view (section 4). |
| Methodology page rendered from the same constants | **Keep** | Cheap, and it is what makes the numbers trustworthy to a reader. |
| Per-year alpha buckets, bull/bear accuracy split, best/worst call | **Keep, low priority** | Small additions to the same rollup. |
| CSV export via share tokens | **Keep** | Cheap; investment teams export. |
| Track A: re-score their 26,646 rows with about 1,400 FMP series fetches | **Defer** | Validates our settlement arithmetic against a third party's internally inconsistent data. Useful once, not a product feature. Licensing of their sheet is unresolved. Do it only if phase 3 settlement math needs an external oracle. |
| Track B: replay 573 Tier-1 videos, 1,951 calls | **Do in batch, Tier 1 only, after phase 1** | This is what stops the leaderboard being empty for 90 days. At batch prices it is roughly US$60 to US$120 of model spend. Label every row "historical replay"; never mix with the forward record. |
| Track C: forward record with daily settlement | **Keep, essential** | The only record that proves anything. |
| Creator correlation matrix, rolling decay | **Drop for now** | No user has asked; adds explanation burden. |

### VideoConviction handoff (`handoff-videocviction.md`)

| Proposal | Verdict | Reason |
|---|---|---|
| A. Benchmark harness over 760 expert-labelled segments | **Keep, phase 0** | This is the external ground truth the v2 spec's gold set was missing for ticker, stance and conviction. Cost is cents. It merges with the gold set: their labels cover ticker/stance/conviction, our 50 human-verified claims cover evidence spans and timestamps. |
| B. Conviction rubric prompt v7 | **Keep, gated** | Conviction decides which calls the leaderboard scores, so inflation biases the leaderboard. Promote only on the benchmark. |
| C. Video-attached extraction arm | **Lab only, 10 rows, then decide** | Reserves full context per call under the current ledger. Under v2's realistic reservations it is affordable to test. If it does not beat text by a clear margin on the benchmark, drop it. |
| D. Title-keyword ordering signal | **Drop** | Push notifications plus batch processing make ordering irrelevant. |
| E. Backtrader oracle | **Drop** | Duplicate of the settlement math with worse hygiene, as the handoff itself says. |
| Benchmark panel UI in Lab | **Keep** | Matches the Lab surface in v2. |

The handoff's own point stands and becomes policy: high creator conviction did not beat SPY in their data. Conviction is displayed, never used as a weight.

## 4. LeapEdge feature comparison

| Feature | LeapEdge | This repo today | Target |
|---|---|---|---|
| Per-video analysis, timestamped quotes | Yes; not for audio-only inputs | Yes; timestamps unverified estimates | Yes, with a trust level per call and bounded timestamps |
| Morning read / daily synthesis with stance and conviction | Yes | Yes (briefing) | Today view plus a `youtube` observation in the Finradar briefing |
| Trend tracking, top tickers, mood | Pro | Trends panel | Leaderboard by ticker plus corpus search |
| Creator leaderboard: calls, avg return, alpha vs SPY, win rate, 90 days, medium and high conviction long/short | Yes, 47 creators, quarterly | Per-channel vs SPY, no ranking | Ranked with confidence intervals and significance gates; 90/180/365 horizons; forward and historical separated |
| By-ticker leaderboard | Not confirmed on their public page | No | Yes: calls, creators, stance mix, median excess of calls, most reliable creator per ticker |
| Custom creator channels | Pro | Yes, hourly poll | Yes, push notifications, batch analysis |
| Captionless videos | "Works for most" | Experimental flag | Standard route via windowed Gemini |
| Long videos | Observed failure "too long to transcribe in one pass" on a 38-minute video | Windowed mode, opt-in | Windowed by default |
| Shared reports | Indefinite until revoked | 7-day expiry | 7-day default, configurable |
| Search | Yes | Yes | Yes, plus cross-video questions with citations |
| Free plan limit | 3 videos a day | n/a | Monthly budget the user sets |
| Cost per report shown to user | US$0.03 to US$0.10 | US$0.19 to US$0.93 | Target US$0.10 to US$0.25 all-in |

Where we exceed LeapEdge: trust level per call, agreement score against audio, sample-size gates on the leaderboard, immutable forward record, versioned configuration, visible rejections. Where we match: everything else above. Where we stay behind by choice: indefinite sharing.

## 5. Target process flow, each step justified

| Step | What happens | Why it exists | Could it be removed? |
|---|---|---|---|
| Arrive | Push notification or pasted link enqueues a job | Free, near real-time; removes hourly polling and quota use | Poll stays as fallback for hub renewal failures only |
| Queue | Postgres queue, always-on worker, 4 in parallel | Cron ran one job a minute under a global lock | No; it is the throughput fix |
| Metadata | One Data API call | Duration and channel are needed for windows and settlement | No |
| Captions | TranscriptAPI | Half a cent, fastest, 80% coverage | No |
| Audio transcript | Gemini native, 5-minute windows, low resolution, batch | Only route independent of captions; windows bound timestamp error | Runs only when needed, so it removes itself for most videos |
| Align and score | Edit distance per span | Turns "audio unverified" into a number | No; it is the trust signal |
| Extract | One native call, full transcript, returns segment IDs | Chunking and quote-copying caused most rejections | No |
| Copy and check | App copies spans; price role, ticker, comparator checks | Deterministic, free, catches "under $20 → entry $20" | No |
| Critic | One batched call, other model family, cached transcript | Per-claim critique cost was linear in claims; same-family critic missed errors | Could be skipped for L2 calls if the benchmark shows it adds nothing; decide with data |
| Trust level | Computed from checks, agreement, review | What the user filters on | No |
| Human review | Optional, signed, append-only | Only path to L3 | Optional by design |
| Store | Relational tables | Cross-video features and leaderboard need queries, not blob scans | No |
| Serve | Today, Leaderboard, Finradar briefing, digest | The product | Digest is optional per user |
| Lab | Gold set plus VideoConviction benchmark gate promotions | Without it no change can be shown to help | No |

Removed from the current pipeline: source-repair stage (windowed transcript covers it), audio-review-by-model as a trust source (replaced by the agreement score; agentic spot-check remains a Lab tool), per-claim critique, string-match gate, five caption adapters, SQLite dialect, per-minute cron, OpenRouter as production transport, hourly polling as default, Evaluation-lab panels for provider comparisons and Promptfoo replay (archived as scripts).

## 6. What is being dropped, and why

| Dropped | Why |
|---|---|
| Supadata, Tapline, BibiGPT, YouTube.js adapters | Same coverage as TranscriptAPI, slower, and fail together |
| Model-written quotes and substring matching as a gate | Caused most false rejections |
| Per-claim critique with full transcript | Cost linear in claims, no measured benefit |
| Same-family critic as default | Correlated errors let three real mistakes through |
| Cron dispatcher, global advisory lock, JSON-blob store | Serial, unqueryable, untestable on the production dialect |
| Never-retry ledger with context-window reservations | Locked the budget at 60× real cost |
| Source-repair stage | Superseded by windowed reference transcription |
| LLM audio review as a trust input | Another model opinion, not evidence; kept in Lab only |
| Title-keyword ordering, backtrader oracle, correlation matrix | No user value at this stage |
| Six-tab research app | Replaced by the module side panel |

## 7. Open questions (answers change the design)

1. Finradar top navigation: exact labels and whether "Ideas" is global or per module. The canvas assumes Briefing · Intelligence · Ideas.
2. "By-ticker leaderboard": which of these do you mean, or all three? (a) which creators are most reliable on a given ticker, (b) which tickers creators' calls have performed best on, (c) consensus and disagreement per ticker.
3. Audio download for word-level timestamps (Chirp 3): allowed or not?
4. Critic vendor: is a non-Google critic through OpenRouter acceptable, or Google-only?
5. Will Finradar ever be commercial? This decides whether the VideoConviction dataset (CC BY-NC) and TrueAlphaData rows can be used at all.
6. Historical replay budget: approve roughly US$60 to US$120 in batch for Tier-1 channels, and how far back?
7. Sharing: keep 7-day expiry or match LeapEdge's indefinite links?
8. Multi-user: will team members have their own Finradar accounts? This decides reviewer signatures and saved calls.
9. Languages: English and Chinese only, or more?
