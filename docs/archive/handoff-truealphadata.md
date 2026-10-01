# Handoff — TrueAlphaData study → Finradar YouTube Intelligence

Date: 2026-09-17 · Branch: `feat/youtube-intelligence` · Status of PR #1 at writing: draft

This document captures a full reverse-engineering of [truealphadata.com](https://truealphadata.com/) (methodology, data, statistics, UI) and converts it into a concrete plan for Finradar YouTube Intelligence (YTI): what to copy, what to fix, what to build, which creators to follow first, and where each piece lands in this repo.

---

## 0. TL;DR

- TrueAlphaData is a public leaderboard grading ~83–88 finance YouTube creators on the realized performance of their stock picks vs the S&P 500. The website is a **static GitHub Pages renderer over two published Google Sheets** — no backend.
- The **real asset is not the leaderboard tab but their second sheet**: 26,646 per-prediction rows with video IDs, transcript quotes, direction, confidence, horizon, entry/exit prices, returns, SPY alpha and outcome. That is exactly the shape of data YTI already produces automatically from its claim pipeline.
- **Their public aggregates do not reconcile with their own prediction data** (e.g. Tom Nash: 51.0% accuracy / +57.3% alpha on the leaderboard vs 43.2% / +25.9% computed from the prediction rows) and the leaderboard tab is missing the statistics columns the site's own JS expects (p-value, t-stat, N). Their numbers cannot be trusted without re-derivation — which is the opportunity.
- From their prediction-level data, recomputed cleanly: **only 9 of 87 creators show positive alpha significance at N ≥ 20 (|t| > 1.96)**. The strongest named, equity-focused creator is **Jose Najarro Stocks** (N=209, 66.5% win rate, +23.7% avg alpha, t=4.88). A prioritized follow list for YTI is in §6.
- Everything needed to reproduce and beat this product exists in YTI today except four things: a horizon ladder, a statistics layer, a scoreboard/scorecard aggregation, and the profile/leaderboard UI. Plan in §8. Estimated heavy lifting is ~4 modules + 3 UI panels, no new data vendors.
- **Regeneration plan (§10–§12):** Track A re-scores their 26.6K-row sheet deterministically (~1,400 FMP series fetches, no LLM) as an independent oracle for `performance.ts`; Track B replays ~573 Tier-1 videos through our full extraction pipeline vs their labels; Track C is the forward record. Their row-level math is self-consistent (returns 100%, dates 99.8%) but 27.4% of alpha values contradict their own columns — our aggregation layer replaces theirs in code. All three artifacts (leaderboard, data export, creator profiles) render from one append-only settlement store so they can never diverge.

---

## 1. Source inventory (what was inspected)

| Artifact | Location | Notes |
|---|---|---|
| Methodology page | https://truealphadata.com/methodology.html | Scoring rules, badge gates (see §3) |
| FAQ | https://truealphadata.com/faq.html | Fixed intervals, skill-vs-luck, distribution shape |
| Leaderboard page | https://truealphadata.com/leaderboard/ | Top/bottom by alpha & accuracy, commonly mentioned assets, alpha by horizon |
| Creator profile example | https://truealphadata.com/creators/daniel-pronk/ | 34 profile pages live (of ~88 tracked creators) |
| Picks page | https://truealphadata.com/picks.html | "Top Picks" |
| Public leaderboard sheet | Google Sheet `1JFZaZ_jC9PR7EKucweHkkO-vdCPXiWSk_6-ey02T2RE`, gid `1723289430` | 83 creators × 17 aggregate columns, values only, one tab |
| **Per-prediction sheet ("MVP Data Sheet")** | Published CSV, gid `890061946` (URL in `/js/creator-insights.js`) | **26,646 rows × 23 columns — the real database** |
| Front-end data layer | `/js/sheet-data.js` (431 lines) | CSV fetch + fuzzy header matching + leaderboard transforms, all client-side |
| Profile insights renderer | `/js/creator-insights.js` (632 lines) | Risk match, style summary, bull/bear, open predictions with quotes + countdowns |

Prediction-sheet schema (verbatim columns):
`Prediction ID, Creator ID, Video ID, Type, Target, Direction, Timeframe, Prediction Date, Prediction Year, Confidence, Evidence / Quote, Ticker, Asset Class, Horizon (Days), Evaluation Date, Start Price, End Price, Return %, S&P 500 Return, Alpha Generated, Outcome, Score, Scorable?`

Dataset shape (computed 2026-09-17):

- 26,646 predictions across **88 creator IDs** (34 mapped to names/channels via profile pages; the rest resolvable via video ID → oEmbed).
- Scorable: 19,116 (71.7%). Completed: 12,717 (Win 5,056 / Loss 7,661 → **overall win rate 39.8%**). Pending 7,995. "No Data" 5,927. Four `#DIV/0!` cells — Excel formula artifacts leaking into a published dataset.
- Type mix: Stock 15,134 · Macro 4,177 · Crypto 2,832 · Commodity 1,483 · Sector 1,142 · Market Sentiment 855 · ETF 432 · Real Estate 288 · Bond 29.
- Direction: Bullish 18,241 · Bearish 6,530 · Neutral 610, plus a long tail of free-text variants ("Rise", "Bullish (Emerging)", "Overvalued", "Neutral to Slightly Bearish", …).
- Confidence: Medium 18,448 · High 8,129 · Low 70.
- Horizon: 180d 10,093 · 90d 6,014 · 365d 5,381 · blank 4,176 (mostly Macro) · oddballs (120d, 270d, 19–51d).
- Prediction dates 2019-03-08 → 2050-12-08 (multi-year stated timeframes push evaluation dates decades out).
- Top mentioned tickers: NVDA 1,062 · TSLA 724 · SPY 527 · PLTR 486 · AMD 456 · AMZN 435 · GOOGL 378 · META 376 · MSFT 332 · AAPL 293 · SOFI 247 · NFLX 198 · QQQ 194 · MU 147 (plus 156 rows with the literal string "EMPTY" — another hygiene failure to avoid).

---

## 2. Where the magic actually is (and isn't)

The site renders client-side from the sheets; the sheet is a cache of conclusions, not a method. Evidence that the "spreadsheet magic" is unreliable:

1. **Leaderboard ≠ prediction rows.** Recomputed from the 26.6K rows (Scorable=Yes, Outcome ∈ {Win,Loss}):
   - Tom Nash (C01): leaderboard 51.02% accuracy / +57.32% avg alpha → recomputed **43.2% / +25.9%** (N=111, α SD 97).
   - Daniel Pronk (C32): leaderboard 51.52% / +17.01% → recomputed **40.6% / +4.2%** (N=106).
   - Chit Chat Stocks Podcast (C40): leaderboard +0.01% avg alpha → recomputed **+31.7%** (N=37, t=2.95).
   The two sheets are different cuts (different inclusion rules, stale refresh, or different horizons). Nobody can say which is right — there is no methodology of record tying rows to aggregates.
2. **The published leaderboard tab lacks the stats columns the site's own parser expects** ("Total Scorable Predictions", "Alpha Std Dev", "T-Statistic", "P-Value", "Significance Flag", "Sample Size Met?"). Every significance badge on the live site currently parses `NaN` and silently disables. The methodology page describes gates the published data cannot enforce.
3. **Impossible values in the aggregates**: Bearish Accuracy of 250% and 200% (an accuracy rate above 100% is not a rate); zero-padding where no data exists (several creators at `0.00%` with blank tickers); missing values as `-`; percent formats inconsistent.
4. **Apples-to-oranges scoring**: best calls include BTC, ETH, XRP, GOLD, VIX and literal "USD", all alpha-scored against the S&P 500 over the same windows. Crypto/macro calls are ~30% of the dataset and are all benchmarked against an equity index.
5. **Provenance gaps**: early rows of some creators use placeholder video IDs (`V4`, `V5`) instead of real YouTube IDs; 5,927 rows have outcome "No Data"; evaluation dates run to 2050 from stated "10 years" timeframes.

Conclusion for YTI: the defensible product is the **claim-level, point-in-time, auditable database** — which YTI already builds — plus a statistics layer that is *generated by code from the same rows it scores*, never pasted. The leaderboard is a view; the moat is the per-claim audit trail down to the video timestamp, which TrueAlphaData cannot produce from a spreadsheet.

---

## 3. Their methodology in depth — and how YTI achieves each step

What they say (methodology.html + FAQ) and do (observed in the prediction sheet), mapped to YTI's existing capabilities:

| # | TrueAlphaData method | Observed in data | YTI implementation |
|---|---|---|---|
| 1 | Track creators' videos; extract predictions with evidence quote | 26.6K rows, each with `Evidence / Quote` and `Video ID` | **Already built.** `pipeline.ts` extracts `Claim`s (contracts.ts) with ticker, stance, conviction, quotes anchored to timestamps; source hashes + deterministic evidence checks; blind audio review to catch hallucinated quotes (stronger than theirs) |
| 2 | Only "scorable" predictions counted | `Scorable?` column: 71.7% yes | **Already built.** `scoreCall` eligibility gate (stance long/short + conviction medium/high); add: instrument-verified requirement via `resolveInstrument` (market.ts) |
| 3 | Entry = close on publish date | `Start Price` on `Prediction Date` | **Deliberately improve.** YTI `scoreCall` forward mode enters at first common session *after* the analysis date — removes same-day look-ahead they have |
| 4 | Benchmark = S&P 500 over same window | `S&P 500 Return` column (SPY) | **Already built.** FMP dividend-adjusted SPY series; provider + adjustment basis stored on every series |
| 5 | Fixed time intervals to prevent cherry-picking (FAQ: 1/3/12 months) | `Horizon (Days)`: 90/180/365 dominate regardless of stated `Timeframe` | **Gap.** Add horizon ladder: score every eligible claim at 30/90/180/365 by calling `scoreCall` per horizon; ignore stated timeframes for scoring, store them separately |
| 6 | Alpha = pick return − SPY return; Win if positive | `Alpha Generated`, `Outcome` | **Already built.** `performance.ts` excessReturn / win / beatsSpy |
| 7 | Per-year alpha buckets (2023–2026) | Leaderboard columns | **Gap, easy.** Bucket completed settlements by entry year in the scoreboard rollup |
| 8 | Bullish vs bearish accuracy split | Leaderboard columns (with impossible >100% values) | **Gap, easy.** Split `summarizeScores` by `Claim.stance`; constrain to 0–100 by construction |
| 9 | Best/worst call per creator | Leaderboard + profile section | **Gap, easy.** Top/bottom settlement per channel by alpha |
| 10 | Skill vs luck: t-test, p<0.05, N≥20 gate ("Verified" / "Stat Sig" badges) | Methodology text; columns missing from published tab; recomputation shows 9/87 creators positively significant | **Gap, core.** New `significance.ts` (§4). Include multiple-comparison control (Benjamini–Hochberg) which they lack entirely |
| 11 | Equal weighting of calls; short/long term tags | FAQ | Adopt equal weighting v1; keep stance/horizon tags so users can filter |
| 12 | Open predictions with quotes and countdown | Profile section, live from prediction sheet | **Gap, high-value.** YTI already stores pending claims with quotes + timestamps; render as "open calls" with days-to-settlement and a click-through to the exact video moment (SourcePlayer) — impossible for their sheet-based site |
| 13 | Commonly mentioned assets | Leaderboard section, from free-text "Recommended Assets" | **Gap, easy.** Aggregate reviewed tickers across all claims (entities.ts registry), not free text |
| 14 | Auto-generated "Creator Style Summary" (6-sentence narrative) | `creator-insights.js`: hardcoded sentence templates keyed on stats thresholds | **Gap.** Template it deterministically from the scoreboard (their approach) rather than free-form LLM text, so narratives can't drift from numbers |

Their pipeline's weak steps — exactly where YTI's automation wins:

- Steps 1–2 are manual for them (humans watching videos and pasting quotes into a sheet); YTI does this continuously via channel follows + caption ingestion + claim extraction, multilingually (their Korean-channel rows are all zeros/blank; YTI's multilingual → English synthesis is a real advantage).
- Steps 3–9 live in spreadsheet formulas with no immutable record; YTI's settlement model (append-only forward observations, explicit `pending/ongoing/completed/unpriced/stale` statuses) makes completed records immutable.
- Step 10 is computed off-row and out of sync; YTI computes stats in code from the same rows it displays.

---

## 4. The statistics: what they are, and why they matter to an investment team

**What the data contains.** The published leaderboard tab exposes: Accuracy, Short/Long-term Accuracy, Average Alpha, per-year Alpha (2023–2025), Short/Long-term Alpha, Best/Worst Call (+ticker), Bullish/Bearish Accuracy, Recommended Assets. The *statistics* their methodology describes — N, alpha std dev, std error, t-stat, p-value, significance flag — are referenced by their own JS but are **absent from the published tab**, so the public site currently shows no working significance badges.

**Recomputed from their prediction-level data** (Scorable=Yes, completed only, one-sample t-test of alpha vs 0):

- Overall: 12,717 completed calls, 39.8% win rate. Distribution of creator alpha is **negatively skewed with a fat right tail** (their FAQ says the same): most creators cluster slightly below zero; a small group is genuinely positive.
- Only **9 of 87 creators** clear N ≥ 20 with |t| > 1.96 positively. That scarcity *is* the product: a screen that separates the few reproducible callers from noise.

**Why this matters to an investment team** (the section to socialize internally):

1. **Skill vs luck is a sample-size and variance question, not a vibes question.** With 87 creators tested at p<0.05, ~4 would pass by chance alone; without multiple-comparison control, "statistically significant" is marketing. An allocation decision needs t-stats *and* FDR control.
2. **Average alpha without variance is unfundable.** Tom Nash's +25.9% avg alpha (t=2.80) arrives with α SD ≈ 97 and a 43% win rate — a lottery-ticket distribution. Jose Najarro's +23.7% at 66.5% win rate, SD ≈ 70, is a different (more actionable) animal. Position sizing and monitoring both key off the second moment.
3. **Horizon decay tells you *how* to consume a creator.** Per-horizon win rates in the data (e.g. Najarro 65% @90d, 65% @180d, 84% @365d; several creators positive only at 365d) determine whether a creator is a trade signal or a portfolio-construction input.
4. **Direction split reveals one-sided skill.** Most creators are bullish-only (their data: 18.2K bullish vs 6.5K bearish calls). A creator whose bearish calls actually work is rare and valuable as a hedge input; the >100% "bearish accuracy" rows in their sheet show what happens when this is computed by hand.
5. **Crowd/consensus overlay.** Commonly-mentioned tickers (NVDA mentioned 1,062 times across creators) is a sentiment/crowding indicator — useful as a contrarian filter and for risk-factor awareness when the whole creator cohort leans one name.
6. **Monitoring and decay.** Rolling-window stats and per-year buckets detect regime drift ("their 2024 alpha was real, 2025 isn't") — the difference between a static guru ranking and an investable signal with an expiry.

**Proposed implementation — `src/features/youtube-intelligence/significance.ts`** (pure functions, unit-testable, no new deps):

```
meanAlpha, stdDev, stdError, tStat, pValue (t-distribution, two-sided),
wilsonInterval(winRate, n), benjaminiHochberg(pValues[]) → qValues,
gate(n, pValue, qValue) → { verified: n>=20, significant: p<0.05, fdrSignificant }
```

Consumed by `scoreboard.ts` (§8) which produces per-creator rollups; snapshots persisted via the existing `yi_documents` store (`kind="scoreboard"`, dated, immutable) consistent with the forward-record philosophy.

---

## 5. UI: what's worth copying, the data behind it, and where it lands in YTI

### 5.1 Leaderboard page (their sections: Top+Bottom by Alpha, Top+Bottom by Accuracy, Commonly Mentioned Assets, Alpha by Time Horizon)

Underlying data needed: per-creator rollup (N, avg alpha, win rate, p-value/q-value, badges) + cross-creator ticker mention counts + per-horizon boards. All derivable from settlements; zero new ingestion.

**Where in YTI:** new `LeaderboardPanel` alongside `TrendsPanel` in the research app (`src/features/youtube-intelligence/`), fed by a `GET /api/intelligence/scoreboard` route reading the latest `scoreboard` document. Public read-only distribution reuses the existing expiring share snapshots (`yi_shares`). Add CSV export (their sheet→CSV pattern, inverted: DB→API).

### 5.2 Creator profile page (e.g. `/creators/daniel-pronk/`)

Their page anatomy, the data each section needs, and YTI placement — all inside a new `CreatorProfilePanel` (route: `/research?channel=<id>` or `/creators/<channelId>`):

| Their section | Underlying data | YTI source |
|---|---|---|
| Hero + verdict + pills (N, accuracy, avg alpha, badge) | Rollup stats | `scoreboard` doc for channel |
| Performance overview (`perfOverview`) | Aggregate card grid | same |
| Time horizon (`timeHorizon`) | Per-horizon win rate + alpha | settlements at 90/180/365 |
| Best/worst calls (`bestWorstCalls`) | Top/bottom completed calls | settlements sorted by alpha |
| Bullish vs Bearish bars (`insightBullBear`) | Stance-split win rates | claims grouped by `stance` |
| **Open Predictions (LIVE)** with expandable quotes + days-until countdown (`insightOpenPredictions`) | Pending predictions + quote text + eval date | **YTI's showcase**: pending scored calls (`status=ongoing`) + claim quote + **SourcePlayer deep-link to the timestamp** — the audit trail their sheet cannot offer |
| Investor Risk Match (`insightRiskMatch`) | Risk badge from α spread; suitability text from alpha/accuracy matrix | derived in scoreboard |
| Creator Style Summary (`insightStyleSummary`) | 6-sentence template narrative from stats | deterministic template from scoreboard (see §3 step 14) |
| Recommended assets (`recAssets`) | Per-creator ticker mention counts | claims × reviewed entities |

### 5.3 What to skip or do differently

- Their email funnel/GTM/Reddit pixel — out of scope for a research module.
- Their "Risk Level" heuristic (best+worst call spread > 300 ⇒ high risk) is crude; prefer α SD and down-capture later.
- Their template narratives mislead when stats are NaN (live examples read "averaging +NaN% alpha"); YTI templates must degrade to "insufficient data" explicitly.

---

## 6. Creators to follow in YTI — prioritized outperformers

Basis: recomputed per-creator stats from their prediction-level data (N≥20 completed scorable calls; win rate; avg alpha; α std dev; t-stat; equity share of calls; per-horizon win rates). Channel URLs resolved from video IDs via YouTube oEmbed. These are follow targets for `channels.ts follow()` (accepts channel URL/handle) with `autoAnalyze` on for Tier 1.

### Tier 1 — statistically significant, equity-focused, follow first

| Creator | Channel | N | Win | Avg α | SD | t | Eq% | 90d / 180d / 365d win | Why |
|---|---|---|---|---|---|---|---|---|---|
| Jose Najarro Stocks | [@JoseNajarroStocks](https://www.youtube.com/@JoseNajarroStocks) | 209 | 66.5% | +23.7% | 70 | **4.88** | 98% | 65 / 65 / 84 | Best overall: largest N, highest significance, consistent across horizons |
| Jeremy Lefebvre Clips | [@jeremylefebvre-clips](https://www.youtube.com/@jeremylefebvre-clips) | 168 | 49.4% | +12.8% | 69 | 2.41 | 95% | 50 / 42 / 61 | High volume, all-horizon positive |
| Ticker Symbol: YOU | [@TickerSymbolYOU](https://www.youtube.com/@TickerSymbolYOU) | 167 | 56.9% | +9.3% | 55 | 2.20 | 74% | 50 / 58 / 57 | Large N, balanced horizons, mostly equities |
| Let's Talk Money! (Joseph Hogue, CFA) | [@josephhogue](https://www.youtube.com/@josephhogue) | 127 | 52.8% | +10.5% | 51 | 2.32 | 94% | 35 / 55 / 64 | CFA, positive at 180/365d |
| YT Finance | [@ytfinance](https://www.youtube.com/@ytfinance) | 129 | 49.6% | +14.9% | 84 | 2.03 | 92% | 46 / 49 / 63 | Solid mid-tier with equity focus |
| Bullmarket Lifestyle (Daniel Wilhelmi) | [@BullmarketLifestyle](https://www.youtube.com/@BullmarketLifestyle) | 73 | 61.6% | +11.1% | **31** | 3.03 | 32% | 66 / 58 / — | Lowest variance in dataset; note: only ~⅓ equity calls |
| Chit Chat Stocks Podcast | [@ChitChatStocks](https://www.youtube.com/@ChitChatStocks) | 37 | 59.5% | +31.7% | 66 | 2.95 | 92% | 20 / 64 / 67 | Highest named alpha; smaller N, short-term weak |
| Invest with Henry | [@InvestwithHenry](https://www.youtube.com/@InvestwithHenry) | 152 | 48.0% | +6.6% | 37 | 2.21 | — | — | Volume caller, low variance |

### Tier 2 — positive but conditional; monitor in YTI before acting

| Creator | Channel | N | Win | Avg α | t | Caveat |
|---|---|---|---|---|---|---|
| Tom Nash | [@TomNashTV](https://www.youtube.com/@TomNashTV) | 111 | 43.2% | +25.9% | 2.80 | Highest named alpha but lottery distribution (SD 97, 43% WR); ~46% of calls are macro/crypto/sector — as much a macro caller as a stock picker |
| BWB – Business With Brian | [@BusinessWithBrian](https://www.youtube.com/@BusinessWithBrian) | 57 | 56.1% | +12.0% | 1.83 | Below significance bar |
| Jeremy Lefebvre Makes Money | [@jeremylefebvremakesmoney7934](https://www.youtube.com/@jeremylefebvremakesmoney7934) | 28 | 53.6% | +17.8% | 1.63 | Small N |
| 미국주식에 미치다 TV | [@LikeUSStock](https://www.youtube.com/@LikeUSStock) | 72 | 50.0% | +15.3% | 1.81 | Korean-language — YTI's multilingual pipeline is an advantage here; TrueAlpha's own tracking of it is all zeros |
| 미과장 | [@MIGWAJANG](https://www.youtube.com/@MIGWAJANG) | 41 | 43.9% | +10.2% | 1.07 | Korean, small N |

### Tier 3 — well-known names worth tracking for coverage/contrast, not for alpha

Joseph Carlson ([@JosephCarlsonShow](https://www.youtube.com/@JosephCarlsonShow)), Mr. FIRED Up Wealth ([@FiredUpWealth](https://www.youtube.com/@FiredUpWealth)), Stealth Wealth Investing ([@StealthWealthInvesting](https://www.youtube.com/@StealthWealthInvesting)), Daniel Pronk ([@danielpronk](https://www.youtube.com/@danielpronk)), Meet Kevin, Graham Stephan, Everything Money, Fundstrat. Recomputed stats put most of these at or below zero excess return; their value to YTI is (a) popular names users will search for, (b) negative-alpha reference points that validate the methodology's honesty. Clear example: Patrick Boyle recomputes at −33.3% avg alpha — his picks are illustrations, not advice, which is itself a lesson in why claim-type classification matters.

**Sequencing note:** YTI scores *forward from follow date* (immutable record). Tier-1 channels will take months to accumulate N; to show anything useful earlier, also run the historical-replay mode on backfilled uploads (leakage caveats documented, statuses `historical` vs `forward` already separated in `scoreCall`).

---

## 7. Domain caveats (theirs, and ours) — and how YTI handles each

| Caveat | Evidence | YTI mitigation |
|---|---|---|
| **Asset-class mismatch** — crypto/commodity/macro calls alpha-scored vs SPY | BTC/ETH/GOLD/USD/"VIX" as best calls vs SPY | Formalize: non-US-equity instruments route to `excluded` with reason `no_matching_benchmark` (market.ts already refuses non-US-listed USD equities); crypto benchmark matching is a Phase-5 extension, not a default |
| **Stale/unreconciled aggregates** | Leaderboard vs prediction rows disagree (Tom Nash 51% vs 43.2%) | Stats computed in code from settlements at render time; scoreboard snapshots dated + immutable; no hand-entered aggregates anywhere |
| **Look-ahead entry** | Entry at publish-date close | `scoreCall` forward mode: first common session strictly after publish |
| **Free-text direction chaos** | "Bullish (Emerging)", "Overvalued", "Neutral to Slightly Bearish"… | Zod enum on `stance` at claim extraction; anything ambiguous → review queue, not silently scored |
| **Stated timeframes ignored or absurd** | "10 years" → evaluation dates in 2035–2050; actual horizons are 90/180/365 | Score on the fixed ladder; store stated timeframe as metadata only |
| **Sample-size / multiple comparisons** | 9/87 significant; ~4 expected by chance | N≥20 gate + BH-FDR q-values in `significance.ts`; badge shows both |
| **Home-run skew** | Tom Nash +531% best call vs 43% win rate | Report median alongside mean; Wilson interval on win rate; risk badge from α SD |
| **One-sided calls** | 18.2K bullish vs 6.5K bearish; bearish accuracy >100% in their sheet | Stance is a constrained enum; bearish win rate computed only when bearish N ≥ minimum, else "insufficient data" |
| **Creator duplication** | "Jeremy Lefebvre Makes Money" vs "Clips"; "Joseph Carlson" vs "After Hours" | YTI `Channel.id` is the canonical YouTube channel ID; rollups are per channel ID, alias display names allowed |
| **Quote provenance** | Early rows use placeholder video IDs (`V4`,`V5`) | YTI claims carry source hash + timestamp anchors by construction; unanchored claims can't enter scoring |
| **Excel leakage into published data** | `#DIV/0!` cells, literal "EMPTY" tickers | Types + validators at the boundary; no spreadsheet in the loop |
| **Backtest vs forward honesty** | Their numbers are a historical cut, rules unknown | Keep `historical` vs `forward` mode separation (already in `scoreCall`); methodology page states which mode every number came from |
| **"Not financial advice" scope** | Their disclaimer is boilerplate | Keep YTI's research-only framing; performance module reports on *creators*, doesn't recommend trades |

---

## 8. Implementation plan on this branch

### Reuse (no new code needed)
`channels.ts` follow/autoAnalyze/discovery · `pipeline.ts` claim extraction with anchored quotes · `contracts.ts` Claim schema (ticker, stance, conviction) · `entities.ts` reviewed ticker registry · `market.ts` FMP adjusted prices + instrument verification · `performance.ts` `scoreCall`/`summarizeScores` · `research-store.ts` document store · cron `/api/cron/intelligence` + `worker.ts` · `yi_shares` public snapshots · `SourcePlayer` timestamp playback · prompt versioning + A/B replay.

### Phase 1 — Statistics + scoreboard (core, pure functions)
1. `src/features/youtube-intelligence/significance.ts` — mean/SD/SE/t/p (t-distribution), Wilson interval, BH-FDR, gates. + unit tests (`tests/significance.test.ts`).
2. `src/features/youtube-intelligence/scoreboard.ts` — group completed settlements by channel: N, win rate (+ Wilson CI), mean/median alpha, SD, t, p, q, verified/significant badges, bullish/bearish split, per-horizon (90/180/365) boards, per-year buckets, best/worst call, ticker mention counts (per-creator and cross-creator), horizon-ladder scoring by calling `scoreCall` per horizon.
3. Persist snapshot: `put("scoreboard", <date>, …)` via `research-store.ts`; settlement rows appended per claim×horizon (append-only).

### Phase 2 — Settlement scheduler
4. Cron/worker step: daily sweep of `ongoing` scored calls; when horizon target date passes, settle via `scoreCall(..., "forward")` and append. No repaints; missed prices → explicit `unpriced`/`stale`, excluded and counted.

### Phase 3 — API + UI
5. `GET /api/intelligence/scoreboard` (latest snapshot) + `GET /api/intelligence/creators/[id]/scoreboard`.
6. `LeaderboardPanel` (ranked table + badges + commonly-mentioned-assets + horizon boards) next to `TrendsPanel`.
7. `CreatorProfilePanel` — hero/pills, horizon section, best/worst, bull/bear bars, **Open Calls** (pending claims + quotes + days-to-settlement + SourcePlayer deep-link), risk match, style-summary template.
8. Share-snapshot page renders leaderboard/creator views read-only (existing `yi_shares` flow); CSV export endpoint.

### Phase 4 — Methodology page (trust surface)
9. `/methodology` rendered **from the same constants the code uses** (entry rule, adjustment basis, gates, exclusion reasons, mode labels) so documentation cannot drift from implementation — the failure mode TrueAlphaData is in right now.

### Phase 5 — Optional extensions
10. Benchmark routing per asset class (crypto vs BTC benchmark etc.); Korean/JP creator coverage (multilingual advantage); rolling-window decay monitoring; creator correlation matrix (do two creators add diversification?); ingest their prediction sheet as a cold-start *reference* dataset for calibration only (never as our own record — provenance would be theirs, and their rows fail our validators in places).

### Explicitly out of scope
Email funnels, ads/pixels, "Guru Report Card" newsletters, public guru-branding.

---

## 9. Field mapping — their prediction row ↔ YTI claim

| TrueAlpha column | YTI equivalent | Status |
|---|---|---|
| Prediction ID | claim id (run + claim index) | exists |
| Creator ID | `Channel.id` (YouTube channel ID) | exists (canonical, theirs isn't) |
| Video ID | `Run.video_id` | exists |
| Type (Stock/Macro/Crypto/…) | entity type + instrument master | partial → drives benchmark routing |
| Target | `Entity.name` | exists |
| Direction | `Claim.stance` (enum) | exists, stricter |
| Timeframe (free text) | stored as metadata; scoring uses fixed ladder | **new (metadata only)** |
| Prediction Date | claim `analysisAt` / run `publishedAt` | exists |
| Confidence | `Claim.creator_conviction` | exists |
| Evidence / Quote | anchored claim quotes + timestamps + source hash | exists, stronger |
| Ticker | `Claim.ticker` + reviewed `Entity` (exchange-verified) | exists, stricter |
| Asset Class | entity type / instrument | partial |
| Horizon (Days) | fixed ladder 30/90/180/365 | **new** |
| Evaluation/Start/End/Return/SPY/Alpha | `scoreCall` outputs | exists |
| Outcome | explicit statuses: completed/ongoing/unpriced/stale/ineligible | exists, stricter |
| Score / Scorable? | eligibility gate in `scoreCall` + instrument verification | exists |

---

## 10. Regenerating & backtesting the results with Finradar

Three distinct tracks, in order of dependency. Track A needs no LLM and no ingestion — it is pure re-scoring and should ship first, because it doubles as an **independent oracle for `performance.ts`** against ~12.7K real outcomes.

### Track A — Re-score their published claims (deterministic reconciliation)

**Purpose:** reproduce their aggregates from their own row-level data with our scoring engine; every delta becomes either a documented rule difference or a proven defect on their side.

1. **Snapshot their CSV** (26,646 rows) into `eval/fixtures/` (or external storage pending the licensing answer in §13). Provenance: TrueAlphaData MVP sheet, gid `890061946`, fetched 2026-09-17. Internal calibration only — never served as our own record.
2. **Normalize:** mixed date formats (`2025-01-02` and `7/1/2025` both appear), `$`/`%`-prefixed numerics, `Direction` free-text → stance enum, eligibility = `Scorable? = Yes` and `Outcome ∈ {Win, Loss, Pending}`.
3. **Re-price:** FMP dividend-adjusted EOD series for ticker + SPY. ~**1,409 distinct tickers** → ~1,400 cached series fetches (24h cache already in `market.ts`), one sweep. Score each row twice — **their rule** (entry at close on prediction date) and **our rule** (first common session after) — to quantify the look-ahead effect on their alpha figures.
4. **Re-aggregate** every key figure per creator (spec in §11) and diff against their leaderboard tab.
5. **Output:** `scripts/regress-truealpha.ts` → `docs/truealpha-reconciliation.md` + machine-readable diff JSON, with row-level examples for every mismatch class (rule difference / stale aggregate / their error).

Their sheet's **measured self-consistency** (computed from the 10,076 scorable rows with parseable prices) tells us what to expect:

| Internal check | Pass rate | Reading |
|---|---|---|
| `Return % = End/Start − 1` | **100.0%** | Price/return math is mechanical and sound |
| `Alpha = Return − SPY return` | **72.6%** | **2,700+ rows where alpha ≠ simple subtraction** — benchmark window or vintage inconsistency; our recomputation supersedes |
| `Win ⇔ Alpha > 0` | 99.9% | 14 rows self-contradictory |
| `EvalDate − PredDate ≈ Horizon (±10d)` | 99.8% | Date bookkeeping is sound |

So their *row-level* pipeline is mostly coherent and their *aggregation layer* is where trust breaks — exactly the layer we replace with code.

### Track B — Full-pipeline historical replay (validates extraction end-to-end)

**Purpose:** prove YTI's automatic pipeline can regenerate claims of their quality from raw video — the thing their humans did by hand.

- Follow the 12 Tier-1 channels (§6), backfill their tracked window: **573 distinct videos, 1,951 completed calls** in their data. Run captions → claims → evidence → `scoreCall(mode="historical")`.
- Compare against Track A's row set on the same videos: claim **recall** (did we find the calls they found), **precision** (ticker + direction agreement), evidence-anchoring rate, and cost per video. Treat their labels as a *fuzzy* reference — they demonstrably contain errors and their own recall is unknown, so measure agreement and sample-audit by ear (blind audio review already exists).
- Budget: LLM spend gated by `YTI_BUDGET_USD`; pilot 2 channels, then batch the rest. YouTube quota and caption availability are the practical constraints (Gemini video fallback for captionless).

### Track C — Forward record (the actual product)

- Tier-1 channels on `autoAnalyze`; daily settlement sweep scores each claim at 30/90/180/365 via `scoreCall(mode="forward")`, append-only. After one quarter there is a fully self-produced N; after a year, an independent, leakage-free track record no spreadsheet can produce. The leaderboard's `mode` label always states which track every number came from.

---

## 11. Validation & recalculation spec for every key figure

Each figure must be derivable from stored settlements by one documented function in `scoreboard.ts`/`significance.ts`, with these definitions and checks. Anything not computable renders as "insufficient data" — never zero-padded (their failure mode).

| Figure | Definition (ours) | Validation |
|---|---|---|
| N (scorable) | Count of claims passing eligibility (stance + conviction + instrument verified + priced) | Eligibility reasons logged per exclusion; their own N is undocumented — profile page says Daniel Pronk N=66 while their sheet holds 106 completed rows; ours is auditable by construction |
| Accuracy / win rate | Wins ÷ completed; Wilson interval always shown | Binomial sanity bounds; cross-check vs Track A; their sheet: Win⇔α>0 at 99.9% |
| Average alpha | Mean of per-call `stockReturn − spyReturn`, both legs dividend-adjusted, same entry/exit sessions | Row-level recompute must match `Return % = End/Start − 1` (their sheet passes 100% — engine check); alpha column theirs vs ours reconciled with deltas classified |
| Median alpha + α SD | Std stats over the same completed set | Headline = median (home-run skew); mean secondary with SD |
| Short-term (90d) / long-term (365d) accuracy & alpha | Same formulas, horizon-stratified | Per-horizon N reported; no value when stratum N < 5 |
| Per-year alpha | Mean alpha bucketed by **entry** calendar year | Cross-check vs Track A per-year columns |
| Best / worst call | Max/min alpha settlement with ticker + link to claim evidence | Tie-handling deterministic (earliest date wins) |
| Bullish / bearish accuracy | Win rate conditioned on stance, min N per direction | Direction is a closed enum (impossible values like their 250% cannot exist); "insufficient data" below min-N |
| Commonly mentioned assets | Count of eligible claims per reviewed ticker, deduped per video (counting rule documented) | Tickers must resolve to reviewed entities; junk symbols ("EMPTY") cannot enter |
| t-stat / p-value | One-sample two-sided t-test of alpha vs 0, SD with n−1 | Reproduce on synthetic fixtures; cross-check Track A creators |
| Badges | `Verified` = N≥20; `Significant` = q<0.05 (BH-FDR across creators), p<0.05 shown alongside | Never displayed when inputs are NaN; FDR is the gate for the word "significant" |
| Open calls | Pending settlements with quote, timestamp, horizon target date, days-to-settlement | Countdown derived from stored target date, not client clock drift |

**Acceptance gates for the Track A harness:** (a) every row-level return/alpha we compute matches mechanical checks at ~100%; (b) aggregate diffs vs their leaderboard each carry a `cause` label; (c) the reconciliation report renders entirely from the diff JSON (no hand-written numbers); (d) `npm test` covers significance + scoreboard against fixture edge cases (single-row creator, missing prices, stale exits, direction enum violations).

---

## 12. Data required on Finradar to produce the leaderboard, the spreadsheet, and creator profiles

All three artifacts draw from **one store** — claim-level settlements — so the UI, the export, and the stats can never diverge (their core defect).

**Base data (already flowing in YTI):**
- Channels: `Channel` records via `follow()` — id, title, handle, uploads playlist, `autoAnalyze` (channels.ts).
- Claims: extracted per video with ticker (reviewed entity), stance, conviction, quotes + timestamp anchors, source hash (pipeline.ts + entities.ts).
- Market data: FMP dividend-adjusted EOD per ticker + SPY, cached in `yi_documents` (`kind="prices"`), provider + adjustment basis stamped (market.ts).
- Settlements: one row per claim × horizon from `scoreCall` — entry/exit dates + prices, SPY entry/exit, stock/SPY returns, excess, win, beatsSpy, status, mode, `asOf` (performance.ts; persisted as append-only documents).

**Per artifact:**

| Artifact | Required data | Produced by |
|---|---|---|
| **Leaderboard** | Latest `scoreboard` snapshot: per-channel rollups (N, accuracy + Wilson CI, median/mean alpha, SD, t, p, q, badges), cross-creator ticker mentions, per-horizon (90/180/365) boards, per-year buckets | `scoreboard.ts` on cron after each settlement sweep → `yi_documents(kind="scoreboard")` → `GET /api/intelligence/scoreboard` → `LeaderboardPanel` |
| **The spreadsheet (export)** | Claim-level settlement export (their 23-column analog, plus provenance they lack: source hash, quote, timestamps, mode, provider, adjustment basis) + aggregate export (leaderboard analog); published column dictionary | Server-side CSV from the same stored rows; versioned; share-snapshot for read-only external access |
| **Creator profiles** | Per channel: rollup slice, open calls (pending settlement + quote + timestamp + horizon target + days-to-settlement + `SourcePlayer` deep-link), horizon section, best/worst call, bull/bear split, per-year trend, per-creator mentions, channel meta (title/avatar/handle) | `GET /api/intelligence/creators/[id]/scoreboard` → `CreatorProfilePanel` |

**Volumes & cost (grounded in their dataset as the upper bound):**
- Distinct tickers for full Track A re-scoring: **1,409** (~1,400 FMP series fetches, cached; one-off sweep, then incremental). Our Tier-1 forward scope is a subset (US equities only).
- Track B replay: 12 channels ≈ 573 videos ≈ 1,951 expected completed calls; est. 2–4K extracted claims → ×4 horizons ≈ 8–16K settlement rows — trivial for SQLite/Neon.
- Recurring: daily settlement sweep (cron), scoreboard snapshot after sweeps, zero LLM cost for scoring; LLM cost only for new video analysis (Track B/C), gated by `YTI_BUDGET_USD`.

---

## 13. Open questions

1. **Cold-start calibration**: ingest their 26.6K-row prediction sheet as a read-only reference to calibrate our extractor precision (their quotes are free training/validation pairs)? Licensing/ToS check needed before committing any of it into the repo.
2. **Backfill depth** per Tier-1 channel for historical replay (cost: captions + LLM tokens against `YTI_BUDGET_USD`); suggest last 18 months for Tier 1, none for Tier 3.
3. **Creator ID completeness**: 34/88 of their IDs are mapped to channels; finish via video-ID → oEmbed sweep (~30 min) if we want the full comparison set.
4. **Badge policy**: do we show `significant` (p<0.05) alone, or require FDR q<0.05 too? Recommendation: show both, gate the word "significant" on q.
5. **Median vs mean** as the headline alpha figure (recommend: headline median, mean secondary with SD shown — home-run skew is material in this data).
6. **FMP plan sizing** for the one-off Track A sweep (1,409 distinct tickers in ~1,400 cached series calls within a short window) — confirm rate limits on the current key or stagger the sweep.
7. **Licensing** for committing their prediction CSV into `eval/fixtures/` as a permanent regression fixture vs keeping it external with a fetch script.

---

### Appendix — key computed numbers (for reference)

- Overall completed scorable calls: 12,717 · overall win rate 39.8% · pending 7,995 · no-data 5,927.
- Positively significant creators (N≥20, |t|>1.96): **9 of 87**.
- Top mentioned tickers across all creators: NVDA (1,062), TSLA (724), SPY (527), PLTR (486), AMD (456), AMZN (435), GOOGL (378), META (376), MSFT (332), AAPL (293), SOFI (247), NFLX (198), QQQ (194), MU (147).
- Recomputation script outputs (per-creator tables) are reproducible from the published prediction CSV; numbers cited here: Tom Nash 43.2%/+25.9% (N=111), Daniel Pronk 40.6%/+4.2% (N=106), Jose Najarro 66.5%/+23.7% (N=209, t=4.88), Chit Chat Stocks 59.5%/+31.7% (N=37), Bullmarket Lifestyle 61.6%/+11.1% (N=73, SD 31), Patrick Boyle −33.3% (N=73).
- Their sheet's internal consistency (10,076 scorable rows with parseable prices): `Return % = End/Start − 1` 100.0% · `Alpha = Return − SPY` 72.6% (2,700+ contradicting rows) · `Win ⇔ Alpha > 0` 99.9% · `EvalDate − PredDate ≈ Horizon` 99.8%.
- Track volumes: 1,409 distinct tickers in their sheet; Tier-1 (12 channels) = 573 distinct videos, 1,951 completed calls; pending open calls: 3,800 at 365d + 4,176 blank-horizon (macro-type) rows.
