# Native Google ingestion: review plan

Status: experiment approved by the user, 15 September 2026. Initial implementation is isolated; live calls require configured native credentials. No production routing change or provider cancellation has occurred. Existing app and saved experiments remain available. Product: YouTube Intelligence; standalone first, later Finradar → Intelligence.

## Decision to make

Can direct Google YouTube ingestion replace our unreliable multimodal fallback, and can it subsequently simplify the wider caption-provider chain without reducing evidence quality? We will test acquisition first, then synthesis. Producing a plausible report is not an acquisition pass.

The primary hypothesis is Google-only source ingestion, retaining all evidence safeguards. The fallback decision, if Google cannot replace ordinary caption retrieval economically and accurately, is YouTube Data API metadata → TranscriptAPI captions → native Google fallback → retained source → existing extraction and audit → Neon/Research UI/Resend. A Google-first route is a separate decision, not the default assumption.

## Existing architecture and possible simplification

Current acquisition uses TranscriptAPI, Supadata, free YouTube.js retrieval, enabled Supadata generation and the existing Gemini/OpenRouter fallback. Experimental window/repair paths are disabled. Tapline and BibiGPT are evaluation adapters, not production dependencies. The app also has durable jobs, budget reservations, source caching, evidence validation, synthesis/critique, research history, market data and email.

| Component | What a successful experiment could change | Evidence needed |
|---|---|---|
| Gemini source acquisition through OpenRouter | Replace this stage with the native Google SDK | Same-video native result improves availability/quality or exposes needed controls; account for model and provider-route differences |
| Supadata generated transcript fallback | Disable and later remove from active routing | Native Google succeeds on captionless cases repeatedly and in hosted runtime |
| Supadata native backup and free YouTube.js path | Remove from the active hot path; preserve fixtures/history | Neither provides material recovery over the proposed two-provider chain in a broader sample and observation period |
| Tapline and BibiGPT production integrations | Avoid adding them | Neither adds necessary coverage or quality over the validated route; existing tests are retained |
| Experimental source repair/window orchestration | Retire failed repair attempts; simplify window strategy if whole-video ingestion passes | Full-video completeness on long videos, not merely a successful API response |
| TranscriptAPI | Keep initially; optionally make backup or remove later | Google must match practical latency, accuracy and effective cost on ordinary captioned videos and pass the broader reliability gate |
| OpenRouter synthesis and critique | Keep initially; optionally consolidate later | Separate same-source, same-prompt/model comparison; verify pricing, model availability and independent audit quality |
| Local media download/transcode/ASR infrastructure | Avoid needing a new service | Native URL input works for supported public videos; this would avoid proposed infrastructure, not remove a deployed media worker |

Never remove source provenance, exact citation checks, incomplete-output rejection, durable jobs, uncertain-spend handling, immutable experiment records, or rollback controls. Google is not independent of YouTube; consolidation increases exposure to one vendor even if it reduces code and accounts.

## Hypotheses and proposed promotion gates

H1 — Captionless access: native Google returns timestamped original-language material for CMjt6f4eVdA and J25UuUqHT3Y where native-caption providers and BibiGPT failed. Gate: both pass acquisition checks in three separated rounds; retained audio checks cover beginning/middle/end and material claims. This establishes success on those cases, not universal access.

H2 — Evidence accuracy: native output preserves issuers, explicit symbols, prices, percentages, negation, conditional language and speaker attribution. Proposed gates: zero material critical-fact errors among accepted reviewed claims; at least 95% of reviewed citation starts within two seconds of independently annotated speech; no worse than the best audio-reviewed existing source on English WER/Chinese CER. Report sample size and error types. Unknown, inaudible and disputed passages remain uncertain. Original-script variants are reported separately; no hidden normalization to improve a score.

H3 — Completeness: native processing does not silently omit long sections. Gate: every submitted interval has a terminal outcome, no unexplained missing tail or speech-bearing gap in reviewed windows, and at least 95% recall of independently annotated material statements in those windows. Timeline coverage is not semantic recall. Speech pauses do not count as missing speech. No whole-video accuracy claim from sampled review.

H4 — Native route benefit: differences are caused by transport/input configuration rather than a different synthesis prompt. Compare native versus retained OpenRouter source attempts first; a fresh matched comparison uses the same model, prompt and video configuration wherever supported. Mark unmatched cases non-causal. Log provider route, exact model version, SDK, input settings and source hashes.

H5 — Better economics and operations: effective cost per accepted result improves, or added captionless functionality justifies the increase. Proposed default-switch target: at least 20% lower effective cost than the route it replaces, with quality gates met; otherwise document a capability benefit and keep native Google as fallback. Include unsuccessful attempts, thought/output tokens, repeat work, audit and cache storage. Measure latency median/p95 and timeout/retry rates; do not infer an SLA from a small sample.

H6 — Additional functionality: selective visual inspection recovers chart-only material without turning resistance into entries or on-screen labels into spoken quotes. Promotion is separate from transcription. Every visual claim has frame/time provenance and review status; chart OCR never masquerades as audio evidence.

All numeric gates above are proposed acceptance criteria, not results or guarantees.

## Experiment sequence

1. Reproducible adapter, no paid requests. Pin an actually published @google/genai release and lockfile in an isolated evaluation harness. Compile against its declarations. Use dependency-injected transport to test connected cancellation, request deduplication, output truncation, absent candidates, provider errors, redaction, bounds, artifact persistence and unknown costs. Read credentials from server-only environment. Confirm the existing YouTube Data API key is not being assumed to be an enabled Gemini credential.

2. Captionless feasibility: maximum six native requests. Start with the two known failures and one English captioned control. Use gemini-3.8-flash as the initial matched model family already present in our experiments; verify account access before submission. Request source segments only in explicit static mode, without trading synthesis or claim selection. Fetch duration independently. For nonzero-offset clips, verify absolute versus clip-relative timestamp behavior against recognizable speech; never silently add an offset. If full video truncates, record failure and use a deliberately bounded window experiment, not recursive auto-repair. An inability to retrieve either target is a stop-and-diagnose result.

3. Bounded acquisition evaluation: maximum 24 requests, prioritized adaptively. Corpus: existing six-video set (two captionless, English short, Mandarin control, long Pronk, AI-debt) plus two held-out videos selected before prompt changes, including actual Cantonese and a 60–90-minute input. If those overlap, include another held-out language/length case. Verify languages from audio. Repeat key configurations in three separated rounds; budget may require prioritizing hard cases over a complete factorial matrix. Compare static whole video, static bounded windows, and agentic processing only where it answers an identified acquisition/completeness question. Do not multiply every video by every model and mode. Retained provider data provides historical comparison; use a small fresh matched control set before a routing decision.

4. Independent evidence review and synthesis comparison. Reuse the existing audio-reference harness and expand pending windows. Freeze manually corrected references, blind candidate labels where practical, and report reviewer identity/time and adjudication. Minimum: early/middle/late windows for each corpus video plus targeted ticker/number/negation examples; expand when errors cluster. Keep held-out results separate from development. Freeze the selected source and run our existing v5 extraction/critique unchanged to isolate ingestion effects. Keep v6 as a separate experiment. Compare accepted factual content, omissions, false trades, quote/price-role correctness, latency and all-in cost with saved LeapEdge reports. Matching LeapEdge counts is not success. Use at most two new LeapEdge analyses if a missing reference is essential, verify current daily balance, and preserve at least four credits.

5. Hosted shadow evaluation. Run the candidate behind an experimental flag on Vercel with existing Neon jobs. No automatic replacement of user reports. Use bounded job stages and polling/background execution where supported rather than relying on a long browser request. Record API errors and uncertain charges; retry only classified retryable failures within the campaign cap. Verify settings visibility, source retention and rollback before promotion.

6. Promotion decision. Select caption-first/native fallback, Google-first/caption backup, or retain current routing based on results. Keep old adapters disabled but recoverable through at least seven days of observation and 100 representative eligible videos before deleting code or canceling providers. Those are operational review gates, not proof of 100% reliability; if normal volume is lower, extend observation rather than generating artificial traffic. A detected material published-evidence error triggers rollback/review. Retain historical artifacts after retiring integrations.

## Evidence and state handling

Application-level outcomes distinguish request not sent, explicit API rejection, transport uncertainty, policy blocking, output truncation, malformed response, empty transcript, structurally valid but unverified source, incomplete source, and accepted source. Model assertions about audio access remain separate from SDK/API telemetry. Neither HTTP200, STOP, nor nonzero total tokens proves successful video decoding. Where available retain modality usage and agentic processing records without overclaiming their meaning.

Raw responses and source versions are immutable, private and referenced by attempt IDs. Do not store keys or signed media URLs in public reports. Every language needs audio verification; English is not an exemption. Structural checks require useful evidence for each declared modality. Metadata/cache absence is recorded as unknown. Submitted calls remain potentially billable until resolved; SDK-internal retries must be understood and bounded.

## Budget and scope for approval

Proposed new experiment allocation: NZ$50 maximum, inside the NZ$500 monthly budget, and at most 60 new model requests across native acquisition, any fresh OpenRouter controls, and synthesis/audit combined. The old US$15 experiment ledger is not reset or silently reused. Stage allowance: NZ$10 feasibility, NZ$25 acquisition/repeats, NZ$15 review-related model calls and hosted verification. Bound inputs/output/thinking and reserve a conservative request cost before submission; include currency conversion with dated rate, fees and a buffer. Stop before a reservation would exceed the remaining allocation. If exact billing is not observable, retain a conservative unresolved reservation. No auto-top-ups or new subscriptions. Existing provider calls use remaining allowances within their established caps.

Human audio review time is separate from API spend. No reliability or savings result will be claimed before measurement. A wider production observation phase must remain within the existing monthly budget and record its actual traffic/cost; this initial cap does not authorize unbounded benchmark traffic.

Required before live calls: an enabled native Gemini API credential with suitable quota/billing, stored locally without pasting it into reports. The model list/access and current limits must be checked. The user approved proceeding through results for the next decision. Promotion/removal decisions will be presented with evidence; no Finradar merge is included.

## Deliverables

- Pinned native adapter and meaningful controlled tests.
- Frozen corpus and independent reference windows with clear review coverage.
- Settings records for hypotheses, exact configurations, attempts, modality telemetry, source hash, tokens, cost/uncertainty, latency, completeness, accuracy, A/B outcomes and next recommendations.
- Side-by-side source and synthesis report, including every failure.
- Architecture decision documenting which active paths are disabled, retained or eligible for removal, savings per accepted video and vendor-dependence tradeoffs.
- Finradar handoff update only after a proven stable boundary; Vercel, Neon, YouTube metadata, market data, Resend and product workflows are otherwise unaffected.

## Documentation basis

Google documents structured YouTube inputs, static/agentic processing and interval metadata; these capabilities motivate the experiment, not its result. Public-video support and preview constraints must be checked at execution. Pricing depends on exact model, modality and cache behavior.

- https://ai.google.dev/gemini-api/docs/generate-content/video-understanding
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content
- Existing evidence: docs/three-provider-repeat-results.json, docs/bibigpt-live-assessment.md, docs/leapedge-captionless-result.json, docs/transcript-accuracy-benchmark.md.
