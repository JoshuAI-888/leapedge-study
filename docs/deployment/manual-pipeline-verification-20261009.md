# Manual pipeline verification — 9 October 2026

PR [34](https://github.com/JoshuAI-888/leapedge-study/pull/34) merged as `f746ffd94315c8b21cf93a65a9b66e6d12119e96`. Production deployment `dpl_HFs9rTQV3VsGCNdHybbv9wunPL6W` served the primary alias during the following live checks. Both videos completed with cron disabled. The user selected manual videos only.

## What failed and what changed

The Supabase migration exposed a serving connection using session pooling, which exhausted its client limit. PR 33 normalizes serving connections to transaction port 6543; maintenance retains session port 5432. The remaining pipeline failures were application bugs: the rerun client read a wrapped response as though it were unwrapped, and metadata-to-source delay let an inline worker exit before its next checkpoint. PR 34 validates the action response, removes that artificial delay, waits for known short backoffs within the invocation budget, and resumes an existing queued job while retaining completed paid work.

## Live results

| Video | Run | Output | Settled model cost, including brief |
| --- | --- | --- | --- |
| Why I Buy the Strongest Mining Stocks First — Not the Cheapest (20m30s) | `ca8bd03a-daf8-4aff-b6d0-7ce869e39aae` | 9 text-checked calls; brief published | $0.679218844 |
| This Small Palantir Partner Just Unlocked One Billion Dollars in AI Defense Contracts! (10m22s) | `af79ea94-47ba-41bf-9a1c-1daa342ceb42` | 2 text-checked calls; brief published | $0.288184358 |

The first run resumed its previously stalled job at approximately 01:12:35 UTC. Calls completed at 01:14:53; its brief at 01:16:41. The fresh second run began at 01:18:32, navigated to its actual UUID, completed calls at 01:19:29, and published its brief at 01:20:12. Neither needed a cron invocation.

Both analysis and brief runs ended `completed`, stage `complete`, error null. All 43 model-call ledger entries were completed, with no reserved or unknown entries. Total recorded model spend was **$0.967403202**. This excludes hosting, database subscriptions, transcript services and other provider charges. Reloading the second result and opening the first in a fresh tab preserved outputs and left call counts and amounts unchanged. The queue had no queued or running jobs after completion.

## Visual output inspection and limits

Calls retained source quotes and timestamp links. The mining analysis preserved bought/holding/watch/planned actions, the conditional Lundin case, and the New Pacific 20% target. The Ondas analysis retained the pending-merger risk and quoted revenue guidance. The evidence player rendered ready. Calls are text-checked, not audio-agreed or human-verified.

Both published briefs remain **partial research**: first 31/41 retained evidence items represented with 10 unresolved items and two current source-consistency warnings; second 7/11 represented with four unresolved items and one current warning. The second warning concerns a proposed quantity in the border-security context. These are visible content-review limitations, not runtime failures. Publication does not establish factual correctness, completeness or an independently verified investment conclusion.

No error/fatal runtime logs were returned for the deployed application between 01:12 and 01:21 UTC. A fresh result tab's console returned no errors. The original tab recorded two Chrome-style asynchronous listener/channel errors at 01:15:14, without a stack identifying their source; extension warnings were also present. Their origin is not established, so this record does not claim that every original browser console entry was clean.

Local screenshots inspected during verification:

- `pipeline-persisted-calls-20261009.jpg`: persisted mining calls and source quotes.
- `pipeline-completed-brief-20261009.jpg`: first published brief with review warnings.
- `pipeline-second-brief-20261009.jpg`: second published brief with partial-readiness warning.

They are saved under `/Users/joshmini/Dev/youtube-intel/` on the task host.

## Validation and operating mode

Both complete local test suites passed: 1069 passed, zero failed, one skipped each. Typecheck, production build, dependency audit and both final PR-head CI runs passed. Isolated real PostgreSQL checks covered concurrent claims and eight concurrent resume requests retaining three jobs; fixture workers completed with no provider calls. The offline promotion diagnostic remains advisory-only and is not accuracy proof.

Cron is defined but disabled in Vercel, with `YTI_CRON_ENABLED=false`. There are no subscribed channels or enabled channel automation. A worker starts on a successful processing action and stops when work is empty or its bounded invocation budget is reached. Retained result viewing starts no paid work. Use [manual processing](manual-processing.md) for everyday instructions and [Supabase/Vercel setup](supabase-vercel-setup.md) for beginner environment-variable instructions. No additional environment change or redeploy is needed to use the repaired pipeline.
