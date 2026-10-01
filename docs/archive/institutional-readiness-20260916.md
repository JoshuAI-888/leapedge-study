# Institutional readiness implementation / 16 September 2026

Independent work streams: source playback; upload pagination/backfill; channel discovery; immutable sharing. Dependent work: evidence alignment → trustworthy outcomes → English entity registry → corpus view → source-grounded evaluation. These are acceptance gates, not a claim that the platform is already institutional-grade.

| Task | Success criterion |
|---|---|
| Chinese evidence alignment | Replay retained failing quotes; identify exact mismatch; repair only lossless, unique source alignment. Changed words/numbers/negation and ambiguous matches stay rejected. Original source immutable. |
| Honest outcomes | Zero accepted evidence visibly differs from a usable report; budget failures cannot offer claim-dropping recovery. |
| English entity registry | English category/name display; companies, ETFs, indices and themes distinct; original aliases retained only as evidence; no guessed listing or ticker; corrections persisted with audit history. |
| Corpus | Group aliases by stable entity ID, retain individual claims and disagreements; filter/search by English name/type/topic; link to original report. |
| Playback | Consistent player and timestamped external fallback; referrer configured; failures surfaced, not mistaken for successful verification. |
| Historical discovery | Latest refresh does not reset historical cursor; older pages deduplicated; metadata retrieval separate from paid analysis. |
| New channels | Bounded YouTube search, candidate provenance and English explanation; following remains explicit, no automatic paid analysis. |
| Sharing | Explicit frozen run/claim selection; concurrent new matching results excluded; invalid/rejected selections fail closed; revoke still works. |
| Regression | Relevant deterministic tests, typecheck and build pass; hosted/browser evidence recorded separately from unit tests; no fabricated accuracy score. |

Root causes / results will be appended as work progresses. Human audio review remains necessary for final accuracy certification; model agreement is not ground truth. No automatic prompt promotion or unsupported ticker inference.

## Root causes and implemented interventions

- Chinese retained run has 1,544 very small cues. All ten items contain range strings in `segment_id`; some also change formatting, paraphrase or insert ellipses. New alignment indexes unique contiguous retained text, ignores only formatting whitespace adjacent to Han characters, retains exact source substring and separates start/end IDs. Bounds: 100 cues, 4,000 characters, 120 seconds for inferred matches. Original drafts and transcript remain retained. Replay recovers **3/10 structurally valid items**, not 3 verified claims; no semantic re-audit or audio certification has happened.
- Quote matching alone cannot establish negation or intent: a misleading substring can still exist verbatim. Semantic auditing remains mandatory. Digits, punctuation and Latin word boundaries are not normalized away.
- The authenticated proxy explicitly set `Referrer-Policy: no-referrer`. Changed to `strict-origin-when-cross-origin`, added explicit iframe policy, official YouTube Player API ready/error handling and permanent timestamped source link. Local Chromium successfully played the retained long video after clicking Play; screenshot retained. This is not yet hosted verification.
- Share code recomputed the filter at publish time. It now requires exact run/claim IDs, rejects missing/unpublished/duplicate selections and freezes only those IDs. Regression creates a second matching run between selection and share; it remains excluded, and revocation works.
- Latest discovery previously replaced the history cursor. Separate history-start state now preserves backfill position and exhausted state across latest refreshes. Tests cover deduplication and exhaustion. Existing per-page 50 limit remains; older-page discovery can continue beyond 50 without paid analysis.
- New corpus registry supports Company, ETF, Index, Macro, Sector, Theme, Commodity and Unresolved; English labels and dynamic English topic tags; preserved original aliases; suggested/reviewed status; exchange required for reviewed ticker assignments. Colliding aliases fail closed. Corpus includes accepted contextual points and claims, retains disagreements, and counts distinct videos/channels. It does not claim independent consensus.
- Added bounded, cached YouTube video search to discover candidate channels, with example provenance and explicit Follow. Public search `semiconductor equity research` returned ten candidates locally. No candidates were automatically followed or analyzed.
- Added optional queued English classification for up to 30 entities, with no ticker inference or model overwrite of reviewed identities. Live retained-corpus transfer is awaiting explicit approval after automatic review rejection. Synthetic/runtime tests do not substitute for that live test.
- New publication presentation distinguishes no accepted evidence, no extracted research and usable research with rejected items. Budget/auth/quota errors cannot use drop-a-claim recovery, both client and server.
- Added conservative numeric-entry qualifier guard: quoted under/below/above thresholds cannot be flattened into an exact entry number. Stops and other roles still require semantic review; this is not a universal numerical semantics parser.
- English synthesis, conditions, risk text and translations reject Han-script leakage at schema validation. Original quotations and original names remain available for provenance. No false translation is substituted for an unresolved identity.

## Scripts and evidence

`prepare-institutional-fixtures.ts` copies two retained portal runs into an isolated SQLite DB. `replay-institutional-evidence.ts` reproduces structural recovery; output is `institutional-evidence-replay-20260916.json`. Private raw runs and screenshots are under `data/institutional-20260916/`. The local preview uses port 3016, separate database and US$3 cap; it does not mutate production research.

Browser checks used agent-browser 0.37.1: open, snapshot, screenshot, errors and visible controls. No browser errors were reported on corpus/player checks. Corpus, discovery and playback screenshots were retained; playback image visibly shows source content after starting the player.

## Pending gates — not completed by unit tests

Live English classification; model semantic re-audit of repaired Chinese items; held-out English/Chinese accuracy evaluation; verified listing lookup beyond analyst-entered registry evidence; hosted playback and UI checks; deployment/promotion review. Existing historical reports are not silently rewritten or re-certified. Institutional suitability and guaranteed reliability remain unproven.

## Validation checkpoint

61/61 tests pass, TypeScript passes and production build passes (logs alongside this report). New regression cases cover exact sharing IDs, revoked access, history cursor preservation, English-only synthesis fields, ambiguous caption alignment, numeric word boundaries, instrument types and preview origin isolation.

A synthetic-only live classifier smoke test completed in 6.9 model seconds, 1,838 tokens and reported US$0.0064785. Its sole input was an invented electronics company; no retained corpus was sent. `scripts/smoke-entity-classification.ts` reproduces the request but refuses to overwrite an existing result. Raw response is retained by the normal model-call ledger in the isolated test database. This does not close the pending retained-corpus classification gate.

Relevant primary documentation: [YouTube iframe error codes and events](https://developers.google.com/youtube/iframe_api_reference), [playlist pagination](https://developers.google.com/youtube/v3/docs/playlistItems/list), [search filters and language relevance](https://developers.google.com/youtube/v3/docs/search/list). Error 153 matches the app's no-referrer policy; this is an application configuration defect with a documented mechanism. The Chinese quote failures are demonstrated application/source-format mismatches, not an established provider outage or publicly documented model incident. Retaining strict text checks and treating semantic/audio verification separately remains necessary.

Additional independent work: historical import is now bounded to three 50-item pages per action (up to 150), resumes its saved cursor and never queues analysis. Re-following an existing channel preserves that cursor. Entity merges archive both prior identities and the merged result, retain claims, reject conflicting listings/types and use the existing transactional store. English entity names also feed report headings, saved-idea headings, search/trend grouping and newly created briefing groups. Original quotations remain unchanged.

Latest test checkpoint: **63/63 passed**. Preview build READY: `https://youtube-intelligence-p0osgggtd-joshu-ai.vercel.app` (first preview; later history/merge refinements remain local until the next deployment). Production was not promoted. Hosted browser verification hit Vercel SSO in the automation profile; existing Chrome had AppleScript disabled and native automation reported the Mac locked. These are environment/access blockers, not successful application tests.

The exact original short-video error-153 case was also imported into the isolated fixture database for direct regression at 11:41. No model call is required for this playback check. `scripts/audit-institutional-chinese.ts` is prepared in preflight mode for items c1, c4, k1 and 1,544 retained source cues. It refuses to overwrite an existing audit artifact; execution requires the pending explicit transfer approval. The five-entity live classification approval and this Chinese re-audit approval remain distinct.

Direct playback regression closed locally: the original Miles Talks Finance citation at 11:41 played through to 12:09/12:10 with the corrected player; screenshot `short-citation-playing.png` shows the final playback position. This establishes playback, not listening-based financial accuracy.

A separate offline candidate, `materializeEvidenceRanges`, copies complete declared source ranges instead of retyping model quotations. `scripts/replay-source-ranges.ts` yields **9/10 structurally valid items** on the Chinese run; c3 still fails a level-evidence check. This is not the conservative three-item repair and must not be conflated with it. Old English translations are deliberately cleared because they do not translate the newly copied excerpts. Fresh semantic and translation audits are required. The range candidate is not wired into the default production pipeline, and no items are promoted. This avoids turning paraphrases into allegedly verified quotations while providing a concrete next experiment.

Final local validation for this checkpoint: **64/64 application tests passed**, TypeScript passed, production build passed. Range materialization is tested but stays offline/experimental. The code is reviewable; this checkpoint does not satisfy the independent source-accuracy or hosted-browser acceptance gates.

Read-only preview hardening: mutating research endpoints, dispatcher and email callbacks are disabled under `YTI_PREVIEW_READ_ONLY`; read paths skip prompt seeding and forward-observation writes. Preview origin comes from the trusted Vercel deployment environment, never the incoming request host. Production retains its configured origin. **65/65 tests, TypeScript and build pass** after this addition.

Final read-only hosted preview is READY: [institutional preview](https://youtube-intelligence-c1n0z19ug-joshu-ai.vercel.app), deployment `dpl_fH3q4fEabvwA2aKwDd9mYMdQZC6D`. It contains the history/merge refinements and preview write protection. The earlier temporary preview is being removed rather than left available with write access. Production remains at the previous deployment. Browser acceptance remains pending access/unlock.

Hosted operational check: Vercel's authenticated `curl` command returned `{"skipped":true,"reason":"Read-only preview"}` from the preview dispatcher. This verifies the deployed read-only guard without invoking model/email work; it is not a browser acceptance pass. The superseded writable preview was confirmed removed. See `institutional-hosted-checkpoint-20260916.json` for the final deployment/check status.
