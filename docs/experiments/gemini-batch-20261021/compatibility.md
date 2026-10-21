# API compatibility, checked 21 October 2026

Evidence labels: **documented** means current primary documentation or metadata; **verified** means this experiment executed the exact workload; **rejected** means that request failed, not that every form of the feature is unsupported; **unknown** means no qualifying test. Google documentation is evidence, never a substitute for execution. Source URLs, retrieval status, last-update labels and content hashes are in [documentation-sources.json](results/documentation-sources.json).

| Workload / capability | Google contract | Repository / experiment | Verdict |
|---|---|---|---|
| GenerateContent text, structured extraction | Batch accepts GenerateContent requests | Flash 3.8 frozen Planet extraction submitted, retrieved and parsed through existing batch transport | Verified for exact request |
| Direct public YouTube, synchronous static video | GenerateContent video guide supports `fileData.fileUri`, optional `videoMetadata` offsets | Three 0–30 second financial-video intervals; original-language JSON, bounds checked | Verified access/structure; accuracy unverified |
| Direct YouTube in Batch | Batch guide says interactive modalities apply; video guide documents YouTube in GenerateContent, but no specific Batch YouTube example | Same Planet request rejected HTTP 400 before resource name; old adapter discarded detail | Exact request rejected; general URL-in-Batch support unresolved. Branch stopped |
| Media bytes / uploaded File URI in Batch | General multimodal GenerateContent support; inline bytes or `fileData` in Content | ModelRequest currently exposes a video URL, not arbitrary audio/inlineData; no new upload adapter | Documented generally; not executed here |
| Audio-only transcription | Audio is a multimodal model input, not a workflow stage | Current windowed fallback sends video; `gemini-file`/`chirp3` settings do not implement those transports | Not verified; no alternative downloader introduced |
| Inline one request | Under 20 MB total; list of GenerateContent requests | Existing single-item `src` with stable metadata key and 19 MiB guard | Text verified; wire schema tested |
| Inline grouped independent requests | Same-model requests in one provider batch | Pinned SDK serializes 1 and 3 requests with keys, offsets, schema, system prompt, thinking and LOW resolution | Offline SDK contract verified; production grouping and live throughput unknown |
| JSONL input/output | Up to 2 GB input; each keyed line a request; output lines success or status | Not implemented by current batch orchestration; output reader handles inline only | Documented, not implemented/tested |
| Dependent stage DAG in a provider batch | No workflow graph contract | Extraction must finish before translation/critique; synthesis depends on accepted evidence | Unsupported architectural assumption; stage barriers required |
| Flash 3.8, Flash-Lite 3.1, Pro 3.1 Preview | All three live metadata responses advertise `batchGenerateContent`; 1,048,576 input and 65,536 output limits | Pinned `@google/genai` 2.22.0 handles current inline wire shape; only Flash 3.8 generated content here | Availability metadata verified; quality/model interchangeability unverified |
| Non-Gemini critic / OpenRouter | Gemini Batch cannot run another model family | Default critic is Sonnet 5 through OpenRouter; 401 expired key in bounded audit attempt | Keep synchronous critic; no Google substitution to claim independence |
| Explicit caching in Batch | Guide permits cached_content; model pricing determines cached-read/storage charges | Pipeline already skips explicit caches in batch mode; adapter now rejects cache handles rather than silently dropping source | Not live-tested; implicit cache hit observed |
| Implicit caching | Usage can include cached input tokens | Planet Batch returned 9,030 cached of 10,715 prompt tokens | Verified; important confounder |
| Interactions background/agentic processing | Separate endpoint, conversation/state/tool semantics | Not used or wrapped in Batch | No compatibility assumption |
| GenerateContent agentic video | Current GenerateContent guide also documents `mediaProcessing: AGENTIC`; pinned SDK serializes that field | Not requested; whole-video static window used | Batch agentic behavior/charges unknown |
| Timestamps | Model may describe timestamps; offsets bound input, not output truth | `parseWindow` rejects invalid bounds/order/density; no independent listened anchors | Structural checks verified; alignment accuracy unknown |

Sources: [Batch guide](https://ai.google.dev/gemini-api/docs/batch-api), [Batch REST reference](https://ai.google.dev/api/batch-api), [GenerateContent video](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding), [Interactions video](https://ai.google.dev/gemini-api/docs/video-understanding), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Files](https://ai.google.dev/gemini-api/docs/files). Model metadata evidence: [model-metadata.json](results/model-metadata.json).

## Input and access limits

Public YouTube only: private and unlisted inputs are excluded by the video guide. Free tier has an eight-hour daily YouTube allowance; paid tier has no length-based daily limit, while token/context and request limits still apply. Models before 2.5 accept one video per request; 2.5+ accept up to ten. That is distinct from many independent single-video requests in a batch. Public availability is not a license to download or redistribute. No media was downloaded, access-controlled content fetched, or replacement upload created.

Static video at LOW uses approximately 66 frame tokens plus 32 audio tokens/second, plus metadata; it does **not** remove visual charges. A 1M context supports approximately three hours at LOW or one hour at high resolution, subject to prompt/output/context use and exact model. Repo window planner permits durations to 24 hours but individual model context and native-core's two-hour guard remain separate constraints. Long-video, no-caption, noisy-audio and multilingual claims are untested in this cohort.

The video input table advertises different paid/free File maxima while the Files guide states 2 GB/file, 20 GB/project and 48-hour storage. The video page also contains both 100 MB and 20 MB inline guidance. Treat these as documentation discrepancies: use the stricter applicable endpoint/model limit until tested. A media file must reach ACTIVE before inference, remain accessible during delayed execution, and outlive the queue delay; its 48-hour lifetime can collide with batch expiry. File-based JSONL input is a different object from uploaded media.

## Lifecycle and operations

Batch creation is **not idempotent**. Display names are correlation labels, not idempotency keys. Persist intent before submission and resource name immediately after; if the connection fails after submission, retain the reservation and reconcile by provider list/displayName, never blindly create again. Get/list/cancel/delete are distinct operations. Cancel is best effort and stops new work; already generated results may exist. Deleting an operation is not cancellation. Per-request failures must be inspected independently of job success; valid keyed successes may be retained even with other errors. Missing or duplicate keys cannot be silently paired by array position, even though the REST reference promises ordered results.

SLO is completion within 24 hours, not an SLA or latency guarantee. Jobs pending/running beyond 48 hours expire without retrievable results according to the guide. Results are retained for six weeks by default; application retention is still necessary. Repo stops automatic polling after 48 hours from local intent and requires operator reconciliation, so its cutoff can precede the provider's processing-based expiry. Google documents webhooks; no webhook registration, polling monitor or cron activation was performed.

Published Batch limits: 100 concurrent batch requests/jobs, 2 GB input file and 20 GB file storage; separately limited enqueued tokens per model/project. Tier 1 tables currently show 3M enqueued tokens for Flash 3.8, 10M for Flash-Lite 3.1 and 5M for Pro 3.1 Preview. Actual account tier/quota is unknown; metadata success is not a capacity test. RPM/TPM/RPD and preview limits are project/model-specific. No quota increase requested.

## Prices used and limitations

USD per million tokens, 21 October published prices:

| Model | Standard input | Standard output including reasoning | Batch input | Batch output | Cached input |
|---|---:|---:|---:|---:|---|
| Flash 3.8 | .75 | 3.75 | .375 | 1.875 | .075 standard / .0375 Batch; storage .50/M-token-hour |
| Flash-Lite 3.1 | .25 text/image/video; .50 audio | 1.50 | .125 text/image/video; .25 audio | .75 | .025/.05 standard; .0125/.025 Batch; storage 1.00/.50 |
| Pro 3.1 Preview ≤200k input | 2.00 | 12.00 | 1.00 | 6.00 | .20; Batch cache remains standard rate; storage 4.50 |
| Pro 3.1 Preview >200k input | 4.00 | 18.00 | 2.00 | 9.00 | .40; storage 4.50 |

Flash 3.8 promotional rates double on 1 January 2027 according to the pricing page. Cache storage, tools, grounding and external services are separate; Batch does not generically halve every fee. The Batch guide's generic standard-cache wording and model-specific discounted-cache tables differ: use the model-specific tariff and invoice reconciliation. Repo Flash 3.8 table matches current generation rates; Pro and fallback rates do not. Native usage contains tokens, not an invoice-confirmed USD charge. Thought tokens count as output. A cache hit lowers price without lowering the reported total prompt count; do not double-count cached tokens or attribute that saving to Batch alone.
