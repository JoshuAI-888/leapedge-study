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
- [x] Read the v8 prompt, the claim schema, the extraction and recall response schemas and the validators.
- [x] Fields: `action` (bought, sold, holding, plan_buy, plan_sell, watch, research, avoid, view), `owner` (creator, guest, third_party) with `owner_name`, levels gain `threshold` and `condition_en`, `option` (right, side, strike, expiry, premium), `size_original`, `catalysts`; top-level `transcription_doubts`.
- [x] Every copied value must appear verbatim in the cited evidence; otherwise it is removed and recorded and the idea kept (`normalizeIdeaDetail`). Doubts are kept only when their range contains the misheard words.
- [x] Registered `evidence-first.web.v9`; v8 and its schema unchanged; the default stays v8 until the live check.
- [x] Live run on 3 benchmark videos (U32FPvvBaNI, 1WNowIoNgtg, 78RL-h4FB3s): fields correct; workspace switched to v9 on 29 Sep.

### PR 3 — AnalystView and the Analysis page
- [x] Pure `buildAnalystView` with a zod contract: summary, stance, idea cards (one per instrument and owner), ticker sentiment (one row per instrument), themes, key points (≤ 10), numbers, not-stated gaps, watch-outs. Code only, no model call; the headline call was dropped in favour of the audited brief's top sentences.
- [x] Pipeline notes and name-spelling doubts out of the page, into a collapsed processing panel (allowlist: only gaps in what the creator said are shown).
- [x] Page order: summary and stance → idea cards → sentiment table → key points → numbers → watch-outs → processing notes; the full brief collapsed below. Copy as note.
- [x] Browser check at 1366 and 390 px on a local copy of a v9 run.
- [x] Critic ids left unanswered are re-asked twice, then withheld with the reason, instead of failing the run.

### Iteration 2 candidates (from the live check; confirm against scorecard #1)
- The critic rejects a whole call when only its conviction is overstated (1WNowIoNgtg QQQ and MSFT short puts): lower the conviction and keep the call.

### PR 4 — scorecard
- [ ] Deterministic checks as a test: resolved ≥ 95%, no duplicate instruments, levels typed, no pipeline text, ≤ 10 key points, every card quoted.
- [ ] `scripts/judge-analyst-view.ts`: the review rubric, independent judge model, against the LeapEdge captures.

### Then
- [ ] Rerun the 13 on the new build; judge; compare with the baseline.
- [ ] Fresh paired round with LeapEdge (new videos, both sides timed).
