# LeapEdge product and implementation study

Inspected 13 September 2026. Status: authenticated product reconnaissance, three LeapEdge pilot submissions, portable harness and initial live model comparisons. See the companion benchmark report for measured results.

## Recommendation

Reproduce the research workflow, with a stronger evidence layer. The confirmed scope is personal research now, eventual integration into another repository, multilingual input and English synthesis, with an NZ$500/month ceiling. Start with a portable Python analysis module, local JSON/SQLite persistence and an interchangeable model adapter. OpenRouter video ingestion has worked in a live test. Keep Postgres/Supabase and hosted workers as later options; omit authentication, billing and multi-user setup from this prototype. Neither Firebase nor one particular frontier model is essential.

Do not select the final synthesis model from marketing benchmarks. Compare candidates on the same videos and evidence, then choose the cheapest configuration that meets the quality gate. First build one video → evidence-backed report; expand to subscriptions, cross-video synthesis and creator scoring after that works.

## What was actually inspected

The existing Chrome session was already signed in. I inspected Today, Trade, Trends, Search, Channels, a subscribed channel detail, Settings, the public daily report, changelog and creator leaderboard. I also read public landing, pipeline, pricing and FAQ pages. The supplied GitHub repository was cloned locally; its initial content is only a README.

The account began with three subscribed channels and no personal analyses or saved trades. With authorization, I submitted three pilot videos and inspected their reports and populated search. Quote playback could not be tested because these reports exposed no timestamp links. Failure recovery, scheduled delivery and creator-return calculations remain unverified. No account settings were changed, subscriptions purchased, emails sent or public shares created. Backend code and deployment configuration are unavailable; developer explanations remain claims. Runtime metadata lists synthesis model versions 3.6, 3.5 and 3.7 across the three reports.

## Feature map

| Area | Observed behavior or documented capability | Implementation implication |
|---|---|---|
| Today | YouTube URL input; current-day stream; daily narrative; watchlist; network ticker counts; creator activity; remaining quota | Separate user feed, shared analysis and daily report entities |
| Individual report | Observed key points, theses, ticker/direction/conviction/horizon, entry/target/stop, catalysts, actions, risks, quotes and metadata | Structured output plus immutable evidence references |
| Trade | Save an insight; open/done/dismissed/all filters; grouping by call date | User-owned saved idea referencing a particular analysis version |
| Trends | Dimension and date filters; direction mix; conviction summary; top ticker; chronicle; sharing | Indexed structured claims and reproducible aggregates |
| Search | Tested COIN facet: returns the matching analysis and aggregates all four ideas in that analysis | Faceted queries over claims, not just semantic search |
| Channels | URL/handle/channel-ID subscription; favorite and activity sorting; quota; detail pages | Canonical channel IDs, subscription records and ingestion status |
| Daily synthesis | Public example combines multiple creators, themes, ticker highlights and disagreements | Second synthesis layer over verified claims with source lineage |
| Settings | Timezone, display name, digest opt-in, theme, password, billing, revocable shared links, account deletion | Account lifecycle and scheduling are substantial parts of parity |
| Creator scoring | Public table with call counts, returns, SPY-relative return and win rate | Separate market-data and evaluation subsystem |

The changelog additionally describes hourly RSS polling, shared analysis caching keyed by video/prompt version, durable retries without duplicate quota charges, frozen public report snapshots and a restricted operations console. These are documented behaviors, not exercised tests. It describes search facets for ticker, conviction, direction, channel and time; trends plot individual calls on direction lanes with conviction-sized markers. [Product changelog](https://leapedge.app/changelog).

Public pricing describes Free/Pro/Max with 3/20/100 daily analyses, different archive and saved-item allowances, and 10/50 channel allowances on paid plans. Actual billing state and promotions must be read at checkout before any purchase; none is needed for this study. [Pricing](https://leapedge.app/pricing).

## What the pipeline appears to do

The published walkthrough describes URL normalization and oEmbed metadata, three sequential caption-library attempts, remote multimodal transcription when captions fail, cheap key-point extraction, stronger synthesis, cheap-model critique, then substring matching of quotes to timed transcript segments. [Pipeline walkthrough](https://leapedge.app/how-it-works).

The developer material supplied with this task reports Firebase Auth, Firestore, App Hosting, Cloud Functions v2 and email infrastructure. The original model references are internally inconsistent: a Product Hunt badge is not proof of the runtime model. The changelog dated May 19 says insight and daily synthesis moved from Gemini 2.5 Pro to Gemini 3.5 Flash. The June 5 entry says audio-only analyses have no timestamps. Thus “every quote timestamped” should be tested, particularly on fallback inputs. [Changelog](https://leapedge.app/changelog).

The FAQ says analyses are user-initiated, whereas the newer app and changelog describe automatic channel ingestion. Treat this as documentation drift. [FAQ](https://leapedge.app/faq).

## Assessment of the output we could see

The public example is a daily synthesis dated June 4, with 25 sources, a direction mix, six highlights, thematic narratives and three disagreement topics. It combines English and Chinese creator material into English prose. This is a useful target for cross-video research organization. [Example report](https://leapedge.app/share/d/L8c35hQcElqP).

In the accessible public rendering, the narrative references video titles as text and links to a creator directory. I did not find per-claim timestamp links there. This does not establish that signed-in individual reports lack citations; it does mean the publicly shared synthesis did not expose the full verification chain during inspection. We should preserve clickable claim → source passage → video time links in every derived report.

I have not verified the example's trading statements, numerical prices or alleged events against the source videos. They are source-app output, not established facts or investment recommendations.

The leaderboard's published method uses adjusted close on the analysis date and up to 90 days later, reverses the return sign for shorts, and compares with a long SPY hold. My assessment: this is a descriptive scoring convention, not a reproduction of creator strategy returns. A day-trade call and a long-term thesis should not automatically share a 90-day horizon. Late analysis can move the entry date; repeated calls can overweight one thesis; unfinished windows differ in duration. Preserve the original call time, horizon, duplicate grouping and evaluation rule. Display completed and unfinished cohorts separately before offering rankings. [Published methodology](https://leapedge.app/creators).

## YouTube and model access

Use the YouTube Data API for channel resolution, metadata and upload discovery. `channels.list` supports handles and exposes the uploads playlist; `playlistItems.list` retrieves its entries. Both are documented as one-unit requests. Poll each unique channel once, then distribute new videos to its subscribers. [Channels API](https://developers.google.com/youtube/v3/docs/channels/list), [Playlist API](https://developers.google.com/youtube/v3/docs/playlistItems/list).

The official caption download endpoint requires permission to edit the video. It is **not** a general transcript API for arbitrary subscribed creators. Caption-library reliability and any third-party transcript service need separate practical evaluation. [Caption download API](https://developers.google.com/youtube/v3/docs/captions/download).

Google documents direct public YouTube URL input to Gemini. This differs from uploading a media file through the Files API. The URL feature remains documented as preview and excludes private/unlisted videos. Current documentation also describes selective video processing for supported models; benchmark coverage before using it for exhaustive extraction. [Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding).

OpenRouter supports video input, but YouTube URL support depends on the upstream provider: Google AI Studio supports it; the documented Vertex route does not. Pin compatible routing for ingestion and test provider fallback deliberately. OpenRouter can also compare text synthesis models against identical evidence. It does not inherently make the same model more accurate or faster. [OpenRouter video inputs](https://openrouter.ai/docs/guides/overview/multimodal/videos), [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

My initial candidates are Gemini 3.1 Flash-Lite for inexpensive extraction, Gemini 3.8 Flash for the balanced synthesis lane, and Gemini 3.1 Pro Preview as a quality challenger. These appear in Google's current model catalogue; superiority on this task is unmeasured. Add a non-Google text model after checking the actual available endpoint and price. [Model catalogue](https://ai.google.dev/gemini-api/docs/models).

## Proposed evidence pipeline

1. **Identify and deduplicate.** Validate the URL, canonicalize video ID, capture publication time and source metadata. Reserve usage atomically. Use an idempotency key to prevent duplicate jobs.
2. **Acquire source evidence.** Prefer available authorized timed captions; otherwise use tested direct video ingestion or authorized uploaded audio. Store provenance, language, transcript version, timestamps and uncertainty. Fail visibly if source content cannot be obtained.
3. **Extract comprehensively.** Split long sources with overlap and retain a coverage ledger. Extract candidate claims with segment IDs. A fixed ten-point summary must not become the only evidence supplied to synthesis: it can discard the qualifications we most need.
4. **Synthesize structured claims.** Include instrument identity, creator stance, conditions, horizon, thesis, risks and explicitly stated levels. Preserve “watch,” “avoid,” “already own” and conditional entry distinctions. Missing target or stop stays null.
5. **Validate in code.** Resolve quote spans against source text; preserve raw text alongside any normalization. Check numerical fields, time bounds, schema and evidence references. An invented quote must fail even if a model critic likes it.
6. **Audit meaning independently.** Give the critic the claim and surrounding source context. Check negation, attribution, conditionality, ticker identity and unsupported implications. Return accept/revise/reject with reasons. Escalate ambiguous cases to a stronger model; cap retries.
7. **Publish with evidence status.** Distinguish exact caption match, machine-transcribed evidence and human-verified audio. Original-language quotes and translations are separate fields. Separate creator conviction from our confidence that extraction is correct.
8. **Aggregate verified claims.** Compute counts in SQL; let the model write the narrative. Every summary assertion references claim IDs. Count distinct creators as well as claims; preserve disagreement by horizon rather than manufacturing consensus.

A quote can be an exact match to an incorrectly transcribed sentence. Therefore transcript matching alone cannot certify audio accuracy. Ticker and price disputes require listening or a separately validated transcription pass. Model self-critique reduces some errors; it is not a guarantee.

## Alternative infrastructure

| Option | Suggested components | Why consider it | Main trade-off |
|---|---|---|---|
| Managed Postgres — later hosted option | Supabase database/Auth/Storage; portable web/API service; Render worker; durable queue; transactional email | Relational evidence, filters, user data and aggregates fit Postgres naturally | Multiple vendors; queue and worker operations still need design |
| Google-centered | Cloud Run, Cloud Tasks, managed Postgres or Firestore, managed auth, scheduler, Gemini | Strong fit for Google media ingestion and managed asynchronous execution | More cloud configuration; Firestore aggregation needs careful planning |
| Small self-hosted deployment | Containerized web/API/worker, Postgres, durable jobs, object storage and external model APIs | Portable and useful for a personal installation | You operate backups, upgrades, monitoring and recovery |

Supabase supplies Postgres plus integrated auth and storage; use owner-scoped access policies for private records. [Database](https://supabase.com/docs/guides/database/overview), [Auth](https://supabase.com/docs/guides/auth).

Cloud Tasks can dispatch asynchronous work to Cloud Run. Render offers background workers; Inngest is another durable-workflow candidate if we prefer application-level step retries. Select one orchestration approach for the MVP rather than stacking them. [Cloud Run tasks](https://docs.cloud.google.com/run/docs/triggering/using-tasks), [Render workers](https://render.com/docs/background-workers), [Inngest](https://www.inngest.com/docs).

Long video processing should survive a browser disconnect and run outside the request that renders the page. Persist stage status, retry only transient failures, record per-stage cost, and checkpoint completed extraction. Cache by source/transcript version, model, prompt, schema and language configuration. Shared public-video evidence must never carry another user's notes or private preferences.

Suggested core records: videos, channels, subscriptions, transcript versions/segments, analysis runs, claims, evidence spans, instrument mappings, user analyses, saved ideas, daily reports/report claims, share snapshots, jobs, usage events and model-call metrics. Add price bars and evaluation runs later. Start with structured filters and suitable multilingual text search; embeddings are optional for conceptual retrieval.

## Performance and cost

The largest early wins are deduplication, resumable work, evidence reuse, bounded output and selective escalation. Compare cold analysis latency separately from cached delivery. Measure queue delay, ingestion, extraction, synthesis, validation, retries and total cost; report median and p95 after sufficient runs.

Illustrative text-only arithmetic: 20,000 input tokens and 3,000 output tokens on Gemini 3.1 Flash-Lite cost $0.0095 at $0.25/$1.50 per million. The same token counts on Gemini 3.8 Flash cost $0.02625 at its currently listed $0.75/$3.75 rates through December 2026. These are single-call illustrations, not full-video estimates: exclude media, extra passes, thinking beyond the assumed output, retries, storage and hosting. [Current Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

Budget formula: fixed hosting + unique uncached videos × measured mean ingestion/analysis cost + daily report calls + retries + email/storage/market-data costs. Your ceiling is NZ$500/month; sustained video volume remains unspecified. Initial live experiments have a separate US$5 cumulative local guard. A defensible monthly forecast still requires a representative volume and measured fallback/retry rates.

## Implementation and evaluation plan

**Step 1 — capture a baseline.** With permission to use the site's credits, inspect up to three videos: captioned English, Chinese/mixed-language, and a difficult audio/chart-dependent input. Record rendered output, citation behavior, latency and quota behavior. Three are smoke tests, not enough to rank models reliably.

**Step 2 — build the evaluation harness in leapedge-study.** Add provider adapters, versioned extraction/synthesis/audit prompts, source fixtures, an evidence schema, deterministic quote validation and machine-readable run records. Use the same evidence across text models; evaluate ingestion separately. Do not let each model grade only itself.

**Step 3 — establish a reference set.** Manually annotate 12–20 representative videos, including negation, conditional entries, Chinese ticker aliases, option legs, chart-only levels, repeated opinions, livestreams and non-actionable commentary. Measure ticker precision, numerical precision, claim support, critical-claim recall, quote accuracy and timestamp error. Score usefulness with blinded human comparisons. Proposed gate: zero fabricated tickers/prices/quotes in the acceptance set, and no unsupported published trade claim; agree recall and timing targets after the baseline.

**Step 4 — ship the core vertical slice.** URL → durable job → verified report → timestamp playback → save idea. Add archive/search and explicit failure states. Verify restart recovery, duplicate-job handling and private data isolation.

**Step 5 — add research automation.** Channel ingestion, daily cross-video synthesis, timezone-aware digest, trend views and revocable snapshots. Keep US market-day selection separate from Auckland delivery date, including daylight-saving changes.

**Step 6 — add optional product scope.** Billing and entitlements for a multi-user product; creator scoring after entry/horizon methodology and market-data access are agreed. Build original interface and code while matching the useful workflows.

## Confirmed scope and remaining decisions

Confirmed: personal use first; eventual multi-user product in another repository; NZ$500/month ceiling; English synthesis from multilingual inputs. Up to 20 LeapEdge credits were authorized, with a reserve for later tests; only three initial submissions were made. A temporary OpenRouter key was supplied and used after the user funded the account. It is stored only in an ignored local file, not in deliverables or Git.

Remaining: expected sustained video volume, final acceptance thresholds, and integration details of the destination repository. Direct Gemini access is an optional later benchmark, not a prerequisite for the OpenRouter pilot.

This study does not yet establish production-grade output parity, statistically robust model superiority or verified creator trading performance. The comparison report distinguishes observed improvements from remaining failures.
