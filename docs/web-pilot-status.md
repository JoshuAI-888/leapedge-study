> Earlier research snapshot. For the deployed app and latest verification, see [completion report](completion-report.md).

# YouTube Intelligence: local pilot status

13 September 2026. Working code is in the separate `leapedge-study` checkout; no Finradar changes,
GitHub push, deployment or database migration was performed.

## Implemented

Next.js interface aligned with Vital's light/blue design and Finradar-compatible tokens; Intelligence
menu; URL submission; optional timed transcript import; model selection; persistent library; report
URLs; original quotes and English translation; timestamp player; JSON export; two-run comparison;
version/model/cost metadata. Node/SQLite worker checkpoints stages, gates low timestamp coverage,
validates evidence, audits each claim and enforces a cumulative local spend reservation cap.

## Verification

- `npm test`: 9 TypeScript behavioural tests passed.
- `python3 -m unittest discover -s tests -v`: 12 original Python tests passed.
- TypeScript checking and Next.js production build passed.
- Chrome: desktop home, saved report and comparison inspected; report dismissed with Escape.
  400px responsive homepage inspected. Source-language text and English synthesis rendered together.
- Browser console: Scribe-injected root attribute caused hydration warning; MetaMask injected
  listener warnings. A missing favicon was found and an app icon was added. No application error
  overlay blocked the tested flow. This is not a clean-profile, fully automated accessibility audit.
- Live API submission and worker execution: two completed runs using identical saved Chinese source
  hash `99492ab116220d56cc576279dfe35ae90df199beb6d9ea95a2883ec192b3872a` and prompt
  `evidence-first.web.v1`. Metadata was freshly fetched from YouTube.

| Model (synthesis and critic) | Accepted / rejected | Provider time sum | Actual model cost |
|---|---:|---:|---:|
| Gemini 3.8 Flash | 5 / 0 | 27.895s | US$0.051351 |
| Gemini 3.5 Flash | 6 / 0 | 79.815s | US$0.1997475 |

New tests cost US$0.2510985 in total, excluding the earlier study costs. These are single-run
pipeline observations, not model quality scores or representative latency statistics. The generated
source itself is not human verified, and the two models audited their own outputs. Accepted count
is not recall or factual accuracy. Source acquisition cost was avoided by explicitly reusing the
existing transcript. No additional LeapEdge credits were spent in this build.

## Next refinement priorities

1. Reliable timed captions and segment-by-segment fallback; independent source coverage checks.
2. Human-labelled English/Chinese benchmark cases for conditional advice, historical prices,
   omissions, conviction and unresolved instrument identity.
3. Persist model result bodies atomically with call receipts so interrupted results can be recovered.
   Current recovery fails closed if a stage already has a paid call record.
4. Prompt registry and independent critic selection; reviewed annotation and outcome comparison.
5. Finradar Postgres/auth/task/budget adapters and production release tests.

The local storage and request guard deliberately reject Vercel hosting. This app remains a local
personal lab until those adapters exist. Channel monitoring, daily digests and Save to Ideas are
future integration work, not currently implemented features.
