# Completion and verification record

14 September 2026. Standalone **YouTube Intelligence** deployed at https://youtube-intelligence-two.vercel.app using Vercel and a separate Neon database. Finradar is unchanged; integration boundaries are documented for its Intelligence menu.

## Delivered scope

The feature matrix in `implementation-checklist.md` covers analysis, citations, channels/discovery, saved ideas/watchlist, search/trends, daily synthesis/archive/email, public snapshots, SPY performance, prompt settings and evaluation/improvement history. Account/subscription/credits/billing management is excluded as agreed.

## Verification

- All 35 application unit/integration tests, route type generation, type checking and production build pass in a clean checkout without private environment files.
- Hosted seven-check suite passes: anonymous/private access, signed database reads, preferences, saved-idea transitions, public share/revocation, authenticated dispatcher and cross-origin rejection.
- Isolated Postgres tests cover concurrent deduplication, exclusive claims, budget reservations, rollback, Unicode and stale lease fencing.
- A real Neon export restored successfully into isolated SQLite and Postgres with matching row counts and checksum.
- Scheduled digest tests cover concurrent sweeps, waiting for audited synthesis, and exactly one provider submission under simultaneous send attempts.
- Browser inspection covers desktop and 400px layouts, empty search/clear filters, channel detail and evaluation navigation. Browser extension warnings are distinguishable from application failures.
- App and production dependency audits report zero vulnerabilities. Optional Promptfoo tooling is isolated and excluded from deployment; its seven transitive high advisories remain documented.
- Promptfoo replay correctly classified two known passes and two known failures. A subsequent six-report selected-candidate replay passed all six strengthened checks, with zero new model requests and no evaluation errors.

## Model findings

Provisional synthesis default: **Gemini 3.8 Flash**, separate **Gemini 3.5 Flash critique**, prompt **evidence-first.web.v5**. This is a small engineering corpus, not a population-level accuracy ranking.

| Same-source case | 3.8 synthesis pipeline USD | 3.5 synthesis pipeline USD | Finding |
|---|---:|---:|---|
| Plain Bagel educational methodology, v3 | 0.091922 | 0.191931 | Both preserved zero trade ideas. |
| Plain Bagel AI-debt explanation, v5 | 0.129428 | 0.201438 | Both corrected the earlier false watch idea to zero trade ideas, matching LeapEdge's classification. |
| Pronk VST analysis, v5 | 0.159653 | 0.163596 | 3.8 retained the explicit avoid decision; 3.5 dropped it. |
| NaNa Chinese commentary, v5 | 0.199676 | 0.302087 | Both passed the targeted retained-text checks; 3.8 retained eight ideas/three key points, 3.5 six ideas/six key points. Different counts are a coverage tradeoff, not accuracy scores. |

These are fresh source-reuse pipeline costs, including their critique calls, excluding shared original transcription. They are not directly comparable with LeapEdge's displayed totals because its accounting and caching are unpublished.

The earlier 3.5 Chinese run truncated a 3,000-token critique. A fresh run with a 6,000-token critique budget and low reasoning completed. The old failure remains visible. Numeric-boundary validation was corrected to allow sentence punctuation without accepting numeric substrings.

## Source and quality limits

Free YouTube.js retrieval did not succeed on the sampled paths, so the live runs used multimodal fallback or retained sources. The optional Supadata adapter has controlled-response tests but no live paid account configured. YouTube Data API metadata access is working; that API key does not grant arbitrary channel-caption downloads.

Flash-Lite's long-video source covered only about 85% of declared duration. A missing-tail repair failed, and a stronger single-response transcription also exceeded output limits. Checkpointed absolute-time windows were implemented and tested; that candidate also failed, assigning closing speech to 1800 seconds and returning an end timestamp of 2447 seconds beyond the 2423-second video. The experiment is disabled by default. The app never rescales timestamps to fabricate complete coverage. Long-video source fidelity remains a genuine acceptance gap requiring a reliable timed transcript or ASR source.

The stronger model recovered a complete timed Chinese macro source. Its first draft exposed a citation-boundary bug: exact quotes crossing adjacent segments were rejected. Exact start/end segment anchoring is implemented; the original quote text and failed result are retained, with a separate re-audit. That re-audit recovered all five original key points for US$0.1139685, without a new source or synthesis call.

The AI-debt v5 output has five supported key points versus LeapEdge's nine and still omits some concluding revenue-risk context. No claim of full semantic parity is justified. Macro/key-point recall remains separately reviewable from quote precision.

Audio audit attempts included a timeout (reservation retained), a truncated response and a response claiming support but omitting explanations. The latter was recovered from retained data at zero additional model cost as seven **needs-review** items. None is described as human audio verification.

## Daily synthesis and email

A live three-video daily synthesis produced five draft points; critique accepted four and rejected one unsupported interpretation. The final audited digest was submitted through Resend to the authorized test recipient. Provider acceptance is recorded separately from mailbox delivery, which has not been independently confirmed. Live delivery-event tracking requires the Resend webhook signing secret; signature/replay tests pass.

## Performance and operational limits

FMP adjusted-price retrieval and matching-SPY arithmetic were verified, and live issuer lookup verified VOO/SPY as USD AMEX listings. All three hosted performance modes were exercised. The current selected collection has three explicit-symbol calls, all ineligible under its direction/conviction rules, so every aggregate is null rather than a fabricated zero return. A populated live creator cohort is not yet demonstrated. Historical replay, analysis-date comparison and first-observed forward tracking are separate modes. Unsupported instruments, low/unspecified conviction, conditional/avoid calls, missing common sessions and stale prices do not become zero-return wins.

A mature forward 90-day creator record requires actual accumulation; it cannot be manufactured during this build. The comparison is per-call descriptive performance, not a tradeable portfolio or a replication of unpublished LeapEdge rules.

The live test ledger has a cumulative US$15 ceiling within the agreed NZ$500/month budget. Reservations for ambiguous requests are not reported as confirmed charges. Production model keys provided for testing may expire; replace them through encrypted deployment settings before ongoing use. Automated discovery and daily sending remain opt-in.

## Handoff

Source, tests, CI, prompt bundles, runbook and integration mapping are prepared for `JoshuAI-888/leapedge-study`. Private databases, provider responses, environment files and signed-in screenshots are excluded from the public repository. See `finradar-module-handoff.md` before merging into the destination application.

## Final delivery evidence

- Draft PR: https://github.com/JoshuAI-888/leapedge-study/pull/1
- Implementation commit: `eb0cc22`; both push and PR CI runs passed.
- Final Vercel deployment: `dpl_HC8JYGERH2MLSEFokuKRSH6piFH1`.
- Hosted collection: six selected videos; final prompt v5; experimental windows disabled.
- Test campaign ledger: US$6.1012774 confirmed provider cost plus US$3.199728 reserved for an ambiguous audio request. These are not combined into a claimed actual charge.
- Final backup: 35 runs, 200 call records, 178 retained responses, 250 discoveries; SHA-256 `8c0d5450eefb1dd4c021cf21cd960a7843adff8c4db355560b3647fab1c9fc8f`.
- Browser-native YouTube check exposed the transcript button but its panel remained loading in this session; no independent transcript was obtained. Creator chapter links identify META at 32:26, reinforcing the need to verify long-video source completeness separately from declared timestamp coverage.

Remaining external acceptance gates: connect and test a reliable timed transcript source for the long-video case; confirm mailbox receipt and configure live signed delivery events. These are not claimed complete. The user has been asked to configure the existing Supadata adapter while the implementation and handoff are finished.
