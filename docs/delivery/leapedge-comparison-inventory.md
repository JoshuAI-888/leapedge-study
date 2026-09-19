# Existing LeapEdge comparison evidence

Inspected locally on 19 September 2026. No browser sessions, new analyses or paid requests were used. These are historical rendered-page captures, **not current LeapEdge outputs or accuracy evidence**.

Of the nine IDs in `comparison-video-candidates.json`, three have retained claim-level reports, one has a retained terminal failure, two have summary observations only, and three have no matching LeapEdge output found in the inspected archives.

Raw files are outside this checkout under `/Users/joshmini/Documents/ChatGPT/Finradar Enhancements/youtube-intelligence/data/`. They contain signed-in navigation/account text; comparison exports should retain report content and provenance while omitting account/navigation details.

| Candidate video | Available reference | Observation time (UTC) | Local evidence relative to the data directory |
|---|---|---|---|
| `hYAnAtEqzI0` | Complete rendered report: SOFI long/high; one supporting quote, entry/target/stop, action, risks, catalysts, horizon, summary and nine key points. Displayed $0.030, 87.7k tokens. | 2026-09-15 11:48:33.759714 | `browser-parity-20260915/leap-short-report.json` |
| `9nb3fp76Rz0` | Complete rendered report: DELL long, SOX long, SPY neutral; three original-language supporting quotes and card fields. English summary and ten key points. Displayed $0.030, 81.8k tokens. | 2026-09-15 11:51:40.165327 | `browser-parity-20260915/chinese-poll1.json` |
| `3u24qyWjSVM` | Complete rendered report: VOO long/high, COIN long/medium, RDDT avoid/medium, QQQ long/medium; four quotes, numerical roles, conditions, actions and risks. 111.7k displayed tokens. | 2026-09-15 10:47:48.022 | `parity-browser-20260915/mandarin-leapedge.json` |
| `Q6G8pXFkKLk` | Terminal failure only: stopped because the video was too long to transcribe in one pass. Displayed $0.100. No generated claims to compare. | 2026-09-15 11:51:26.378136 | `browser-parity-20260915/long-poll4.json` |
| `v824SHV6COE` | Summary observation only: zero trade ideas, nine key points, selected topics, displayed $0.05 and 141.2k tokens. Full individual cards/quotes were not found. | 2026-09-13 17:50:41.527 | This checkout: `docs/archive/leapedge-reference-observations.json`; duplicate summary in `backups/research-2026-09-13T18-16-55.927Z.json` |
| `J25UuUqHT3Y` | Summary observation only: zero trade ideas, eleven key points, selected topics, displayed $0.06 and 195.4k tokens. Full individual cards/quotes were not found. | 2026-09-13 17:50:41.527 | Same reference-observations file and backup as above |
| `skc2T5fcoLY` | Candidate URL only; no matching LeapEdge report found. | — | `docs/archive/completion-cohort-20260915.json` identifies the candidate |
| `1_JCqHluJ9U` | Candidate URL only; no matching LeapEdge report found. | — | Same cohort file |
| `kXYvRR7gV2E` | Candidate URL only; no matching LeapEdge report found. | — | Same cohort file |

## What a post-build comparison can reuse

Run the current local pipeline on the three report-bearing candidate URLs, subject to the authorized API budget and video availability. Compare tickers/instruments, stance, creator conviction, conditions, entry/target/stop roles, actions, risks, exact quoted text, key-point coverage and omissions against these frozen references. Record model/prompt/configuration identifiers and capture dates on both sides. No new LeapEdge analysis is necessary for that **historical-reference** pilot.

The long-video failure can test current local report availability against that specific historical outcome. It cannot score extraction agreement. The two summary-only observations support topic and trade-idea-count comparisons, not quote-level completeness or precision. Missing-reference candidates need a separately authorized new LeapEdge capture before paired comparison.

No timestamp links or numeric quote anchors were retained in these report captures. `browser-parity-20260915/leap-short-citation-dom.json` additionally records inspected links/buttons at 11:57:39 UTC and contains only untimed YouTube links. Do not derive timestamp accuracy from this material. Quote agreement between products is not independent source verification.

All reports show `keypoints.v1-insights.v3-critique.v1`; the displayed middle model differs (3.7 Flash for the two fresh short cases, 3.6 Flash for the Mandarin development case). Internal prompts, transcript ingestion, accounting and provider latency are not exposed. The archived browser-parity results contain polling-based elapsed upper bounds, not backend latency. Some development lookups appeared to reuse reports without a credit decrement; cached behavior remains an inference from the earlier observation.

## Additional retained reports outside the nine-candidate list

- `CMjt6f4eVdA`: `parity-browser-20260915/alpha-leapedge.json`, captured 2026-09-15 10:46:02.454 UTC; four idea cards/quotes, 88.6k displayed tokens. `docs/archive/leapedge-captionless-result.json` adds an earlier 14 September observation, not a new run in this task.
- `wkAqHlYL7bQ`: `parity-browser-20260915/long-leapedge.json`, captured 2026-09-15 10:46:59.272 UTC; five idea cards/quotes, 267.4k displayed tokens. This is a different video from the failed long-video candidate above.

These may expand a historical-reference pilot if the scope owner adds them explicitly. The retained v5/v8/v9 outputs discussed by the old comparison documents are not outputs of the current build.

## Capture integrity

SHA-256 of the unmodified raw files:

| File | SHA-256 |
|---|---|
| `leap-short-report.json` | `70b04a8cce07ad1a0da2e587d180aa8db1e6de9ae4e1bc7517b8e728149975b9` |
| `chinese-poll1.json` | `3066d9efd88f7dde86d57b2cbc295e296d5a62a47a57708c7e61d846e2184417` |
| `mandarin-leapedge.json` | `9388943122bd3b353eed3603bfe6e4386b596e8d7ba444f3d8691c415c648c00` |
| `long-poll4.json` | `c27f2754e73c5332f9be08da36992925bf6605095af69c804e2d1b6e0dbdba26` |

No claims in this inventory establish present video availability, current product behavior, correctness, accuracy or a population-level quality score.
