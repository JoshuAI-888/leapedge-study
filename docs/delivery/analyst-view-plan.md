# Analyst view plan — 29 September 2026

Goal: beat LeapEdge on actionability and PM clarity, every video, without losing
coverage or fidelity. Baseline and benchmark: `evaluations/analyst-view-13/`.

Principle: the model fills evidence-backed fields; code resolves, merges, ranks
and lays out. Consistency comes from a fixed contract and deterministic checks,
not from prompt wording.

Decisions (29 Sep): tickers resolve by alias table, then a model-proposed
symbol verified against price data, else stay unresolved and flagged. Watch and
research ideas are idea cards labelled `watch` / `research`.

## Checklist

Each PR: read the code it touches first, write failing tests, implement, run the
five verify commands on Node 24, replay against the benchmark, update the
ledger, open the PR, merge only on the user's instruction.

### PR 1 — ticker resolution and one row per instrument
- [x] Map where tickers are set today (extraction, `normalizeReferences`, `tickerProposals`, mentions, `identity.ts`, publish, sentiment aggregation).
- [x] SEC ticker snapshot (10,428 listings, 29 Sep) and curated aliases (US names, Chinese names in both scripts, ETFs, crypto, indices, commodities, Canadian and HK listings, private companies), with uniqueness and SEC-existence tests.
- [x] Resolver: spoken ticker → curated alias → model proposal checked against the SEC name → exact SEC name (two words or more) → unresolved. The literal `ticker` is never rewritten.
- [x] Stored: `claims.resolved_ticker/name/by` (migration 0009); published mentions aggregate under the resolved symbol; a mention links to its call by resolved listing.
- [x] Backfill action `market/resolveListings` republishes completed runs.
- [x] Replay on the 13: 251 of 268 references resolve (94%); the rest are themes ("miners", 中小银行) or ambiguous names (阿波罗, 英特, bare "Artemis").
- Moved to PR 3: one row per instrument and one card per idea, where the analyst view uses them.

### PR 2 — extraction prompt v9 (structured ideas)
- [ ] Read the v8 prompt, the claim schema and its validators.
- [ ] Fields: `action` (bought, adding, holding, trimming, sold, watch, research, avoid), `owner` (creator, guest, third party), typed levels (entry, target, stop, support, resistance, no-sell-below) with condition, option (right, strike, expiry, premium), size, conviction quote, transcription doubts.
- [ ] Every new field is backed by a quote the validators check.
- [ ] Register v9; keep v8 selectable.
- [ ] Live run on 3 benchmark videos before merging.

### PR 3 — AnalystView and the Analysis page
- [ ] Pure `buildAnalystView` with a zod contract: headline, stance, idea cards, ticker sentiment, themes, numbers and catalysts, watch-outs.
- [ ] Pipeline diagnostics out of the brief's omissions; into a collapsed panel.
- [ ] Page order: headline → idea cards → sentiment table → themes → numbers and catalysts → brief (collapsed) → watch-outs → diagnostics (collapsed). Copy-as-note.
- [ ] Browser check at desktop and phone width.

### PR 4 — scorecard
- [ ] Deterministic checks as a test: resolved ≥ 95%, no duplicate instruments, levels typed, no pipeline text, ≤ 10 key points, every card quoted.
- [ ] `scripts/judge-analyst-view.ts`: the review rubric, independent judge model, against the LeapEdge captures.

### Then
- [ ] Rerun the 13 on the new build; judge; compare with the baseline.
- [ ] Fresh paired round with LeapEdge (new videos, both sides timed).
