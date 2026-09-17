# Parity evaluation checkpoint: v9 and human wording review

## Decision

Do not promote v9. Do not remove caption providers. Parity with LeapEdge has not been established. No production changes were made. The five-step evaluation remains incomplete, with fresh authenticated LeapEdge comparisons blocked by a locked Mac during this session.

## Methods and artifacts

- Human wording checks: `python3 scripts/score-reviewed-facts.py`; output `docs/reviewed-facts-20260915.json`. Eight targeted, post-inspection fact comparisons against user audio-checked text: seven preserved, one altered. These labels were adjudicated by the assistant, not a second human reviewer. They assess native ingestion text, not synthesis. No overall accuracy or omission rate can be inferred.
- Altered fact: Mandarin native segment s00025 adds “今年” (this year) to the reference's newly emerged risk. This is unsupported by the supplied corresponding passage.
- No timing score: user times are pause/transcription times. Prior timing-error inference remains withdrawn.
- Controlled v8-to-v9 development test: `node --env-file=.env --env-file=.env.local evaluations/native-google/selection-synthesis.ts CASE --v9 --execute`, CASE alpha/long/mandarin. New immutable prompt `semantic-prompts.ts`; same source corpus, synthesis/critic models, batch audit and token limits as v8. No automatic retry, source change, truncation, schema relaxation or hidden promotion. Single run per case; no statistical significance claim.
- Initial sandbox DNS failure occurred before generation. Authorized network retry completed model access. Retained attempts and raw outputs are in the private campaign journal. Public summary: `docs/v9-results-20260915.json`.
- `npm test` and `npx tsc --noEmit` passed. Logs: `docs/v9-tests-20260915.log`, `docs/v9-typecheck-20260915.log`. These tests validate existing mechanics, not semantic model accuracy.

## Outcomes

| Case | v9 outcome | API-stage elapsed time | Interpretation |
|---|---|---|---|
| Alpha Chinese | 10 items, 9 passed structural/model gates | 27.715 seconds | Bitcoin price fails verbatim source validation; no promotion |
| Long English | Schema failure: three claims exceed 20 selected source IDs | 22.730 seconds to failure | No usable report; must count as failure, not fast success |
| Mandarin | 13 model-accepted items | 33.555 seconds | Human inspection still finds observed 4.75% yield labelled resistance |

The Coinbase stop now retains the original “slightly below” qualifier in its structured value. However, explicitly instructing both generator and critic about observed metrics did not eliminate the false resistance classification. Model acceptance is not ground truth. A robust follow-up should require field-level evidence for assigned level roles and test unsupported-role rejection, rather than rely solely on repeating the instruction.

Elapsed times sum generation stages only. They exclude ingestion, model lookup, queueing and browser rendering. They cannot be compared with LeapEdge's end-to-end time or cached responses. No speed-parity claim is justified.

## Remaining work by requested step

1. Human scoring: initial targeted wording checks complete; all-nine passage alignment, full critical-fact and omission scoring remain.
2. Defect fixes: v9 experiment complete and rejected. Stop qualifier improved; yield role still wrong, with new structural failures. Next candidate must constrain level-role evidence and source selection size, then pass the same tests without relaxing validators.
3. Fresh comparison: not run. Browser tool returned “Mac is locked”; user was asked to unlock. Need freeze fresh English/Chinese/captionless cases before looking at candidate results and preserve LeapEdge cache status.
4. Reliability/speed: generation-stage measurements recorded; fresh end-to-end successful-report latency and recovery comparisons remain.
5. Promotion decision: current candidate rejected. Retain production defaults, experimental gate and caption-provider options. Full parity decision remains pending.

## Documentation and known-issue attribution

This checkpoint reports empirical local results. No external documentation or feedback was consulted during these particular runs. The observed semantic and selection-size failures are not attributed to a documented Google outage or SDK defect. Further investigation must distinguish prompt omission, output-contract enforcement and provider behavior before selecting a fix.
