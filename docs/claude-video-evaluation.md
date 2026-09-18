# Evaluation: `bradautomates/claude-video` against YouTube Intelligence

**Date:** 18 September 2026. **Status:** desk evaluation. Nothing was installed, executed or benchmarked; no model calls or credits were spent. Every performance figure attributed to claude-video below is a repository claim, not a measurement made here.

**Subject:** https://github.com/bradautomates/claude-video — MIT, ~2,900 lines of Python 3 standard library plus pytest, distributed as an Agent Skill (`/watch`) for Claude Code, Codex, Cursor, Gemini CLI and claude.ai.

**Question asked:** can it solve the problems we have, what can and cannot be replaced, and has any of its underlying technology already been tried here?

---

## 1. Decision in brief

**It does not address our problems, and it cannot replace any part of the production path.** claude-video is an ingestion front-end for an interactive agent. It solves "Claude has no video input." Our problems are downstream of ingestion: evidence anchoring, timestamp accuracy, absent audio ground truth, cost per accepted claim, and operability. claude-video has no evidence layer, no persistence, no queue, no budget control, and no multilingual path.

**Two components are worth harvesting, and one of them has real money in it.** Its Whisper client chunks audio into bounded windows and shifts each chunk's timestamps back into absolute source time. That is precisely the construction spec 4.5 wants and precisely the property spec 4.10 rejects Supadata's managed Whisper for lacking. Paired with a direct Groq key instead of Supadata credits, the ASR tie-break falls from about US$0.34 to about US$0.02 per 30-minute video. The second is `yt-dlp` as a caption and audio-acquisition route, which this repository has never tested in any form.

**Nothing here changes the architecture.** Estimated harvest is on the order of 200–400 lines ported into `transcripts.ts` and a worker, gated on the unresolved hosted-egress question in `free-caption-benchmark.md`.

---

## 2. What claude-video actually is

| Stage | Mechanism | Notes |
|---|---|---|
| Acquisition | `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs en.* --sub-format vtt` | Captions first; video downloaded only when frames are requested |
| Caption parsing | `transcribe.py` regex VTT parser, with a rolling-duplicate collapse | YouTube auto-subs repeat each line 2–3× as it scrolls; `_dedupe` merges them and extends the time range |
| ASR fallback | `ffmpeg -vn -ac 1 -ar 16000 -b:a 64k` → Groq `whisper-large-v3`, else OpenAI `whisper-1` | Pure stdlib multipart upload; no vendor SDK |
| Chunking | `plan_chunks` splits on a 24 MB ceiling; `shift_segments` adds each chunk's offset back | Constant-bitrate mono mp3, so an even time split yields evenly sized chunks |
| Frames | `ffmpeg` scene-change selection or `-skip_frame nokey`, deduplicated on grayscale thumbnail delta, capped 50/100/uncapped | 512 px default; claimed ~19,700 image tokens for 100 frames |
| Synthesis | Claude `Read`s the JPEGs and answers freely from frames plus transcript | **No validation of any kind** |

The last row is the whole gap. There is no quote checking, no segment identifier, no critic, no rejection path, no trust grade. The model is asked a question and trusted with the answer.

---

## 3. Our problems, and whether it touches them

| Our problem, as recorded | Source | Does claude-video help? |
|---|---|---|
| Quote validation rejected everything — the validator joined caption fragments without spaces, so English runs accepted zero items | `free-caption-benchmark.md` | **No.** Already fixed by `segment_separator`. claude-video has no validator to learn from. |
| Residual anchoring failures: model-selected start IDs land one or more cues after the quote begins; quotes are not exact contiguous spans | `free-caption-benchmark.md` | **No.** Spec 4.2 "evidence by pointer" is the fix. claude-video copies text into a prompt, which is the failure mode we are leaving. |
| Gemini full-video transcription drifted 97 s; clips agreed to 0.06 s. Gate is 95% of anchors within 2 s | spec 4.5, `transcript-accuracy-benchmark.md` | **Indirectly.** Not by insight — spec 4.5 already windows. But `shift_segments` is a working reference implementation of offset stitching. Forced alignment (WhisperX) remains the untested option for sub-second anchors; claude-video does not do it. |
| No independent audio ground truth; every gold case sits at `pending_audio_review` | `transcript-accuracy-benchmark.md` | **No.** This needs a human reviewer, not a tool. Note the protocol's own rule: an LLM-generated transcript may not serve as a human reference. |
| Caption coverage: TranscriptAPI 40/50; YouTube.js 0/5; ~1 in 5 videos captionless | spec 4.10, `free-caption-benchmark.md` | **Possibly** — `yt-dlp` is a distinct retrieval mechanism, untested here. See §5. |
| ASR tie-break priced at US$0.094–0.34 per 30-minute video, and cannot be requested per window | spec 4.10 | **Yes.** This is the one material win. See §4. |
| Cost per report US$0.19–0.93 against LeapEdge's US$0.03–0.10 | spec §11 | **Marginally**, via the ASR line only. The dominant cost is synthesis and critique, which claude-video does not address. |
| Serial cron, terminal transient errors, reservations locking budget at ~60× real cost | spec §1, 4.4, 4.7 | **No.** claude-video has no queue, no retry policy, no ledger, no idempotency. |
| Mandarin corpus with original-language evidence retention | spec §11 | **No — actively worse.** `download.py` hardcodes `--sub-langs en.*` and `_pick_subtitle` prefers `.en.`/`.en-US.`/`.en-GB.`/`.en-orig.`. On `CMjt6f4eVdA` or `J25UuUqHT3Y` it returns nothing and silently falls through to ASR. |

---

## 4. The one component worth taking: bounded-window ASR on a direct key

Spec 4.10 rejects Supadata `mode=generate` as the primary reference for two stated reasons: *"it cannot be requested per window, so timestamps are not bounded by construction, and long videos add a polling loop."*

`whisper.py` removes both objections. `plan_chunks` produces contiguous `(offset, duration)` windows; `split_audio` cuts them with `ffmpeg -ss`; each chunk is transcribed in isolation and returns 0-based timestamps; `shift_segments` adds the offset back. Bounded by construction, synchronous, no 202 polling, no 20-minute threshold. Timestamp error is bounded within each window rather than accumulating across the video — the same property that took Gemini clips from 97 s drift to 0.06 s.

The cost difference is the reason to act on it:

| Route | Rate | Per 30-minute video | Source |
|---|---|---:|---|
| Supadata Whisper, Pro plan | 2 credits/min on US$17 / 3,000 | ≈ US$0.34 | spec 4.10 |
| Supadata Whisper, Mega plan | 2 credits/min on US$47 / 30,000 | ≈ US$0.094 | spec 4.10 |
| Gemini native windowed, immediate | US$0.75/M in, US$3.75/M out | ≈ US$0.20 | spec 4.10 |
| Gemini native windowed, batch | as above, halved | ≈ US$0.10 | spec 4.10 |
| Google Chirp 3, batch | US$0.003/min | ≈ US$0.09 | spec 4.5 |
| **Groq `whisper-large-v3`** | **US$0.111/hr audio** | **≈ US$0.056** | vendor pricing, unverified here |
| **Groq `whisper-large-v3-turbo`** | **US$0.04/hr audio** | **≈ US$0.02** | vendor pricing, unverified here |

Between 5× and 17× cheaper than the Supadata tie-break, on a route that is windowed where Supadata's is not. If the tie-break ever becomes routine, spec 4.10 says we move to the Mega plan; this is the alternative to that decision.

**Caveats that must be measured before any promotion.** Groq Whisper accuracy on Mandarin financial speech is unmeasured, exactly as spec §13 already flags for Supadata Whisper — the gold set's Chinese items decide it, and the two vendors need separate scores. Whisper segment timestamps are model output, not forced alignment, so they still need the edit-distance agreement scoring in `evaluations/transcript-accuracy.ts`. Billing is a 10-second minimum per request, which penalises many small windows. And this route requires the audio bytes, which is §5.

Second, smaller component: `transcribe.py::_dedupe`. Our `normalizeNative` and `normalizeTranscriptApi` consume provider JSON that is already deduplicated, so this is not a live bug. It becomes one the moment we read a raw VTT track from any route, and the rolling-duplicate behaviour is not obvious until it corrupts a segment index.

---

## 5. `yt-dlp` — genuinely untried, and gated on one unanswered question

`grep -ri 'yt-dlp\|youtube-dl'` across this repository returns nothing. It appears in no benchmark, no comparison table, no rejected-options list. The routes we measured were TranscriptAPI, Supadata, Tapline, BibiGPT and YouTube.js. `yt-dlp` is a different extraction mechanism from `youtubei.js`, which returned 0 of 5.

It also supplies a mechanism the spec has already conditionally approved. Spec 4.5 states *"Audio download is now permitted"* and names two options it keeps in Lab — Chirp 3 for word-level timestamps, and Gemini Files API upload — while noting *"downloading adds an extraction step that breaks whenever YouTube changes."* It does not name a downloader. `yt-dlp` plus `ffmpeg` is that missing extraction step, and it is the same step the Groq route in §4 requires.

**The blocker is not the library.** `free-caption-benchmark.md` established that `youtube-transcript-api` retrieved 4 of 5 locally and recorded the open question exactly: *"test retrieval from the intended worker network."* That question is still open, and it applies identically to `yt-dlp`. YouTube blocks datacenter egress aggressively; Vercel Functions are the worst case. This only becomes testable when spec 4.7's always-on worker lands somewhere with a controllable egress IP, and it must be tested there, not locally.

**For captions alone, the economics do not justify it.** TranscriptAPI is ≈US$0.005 per video against a blended source cost of ≈US$5.50 per 100 videos. `yt-dlp` saves at most a few dollars per thousand videos while adding a binary dependency, a maintenance treadmill, an egress-IP problem and the terms-of-service question that a hosted commercial service raises and a local skill does not. Recommend it as an **audio-acquisition mechanism for the ASR route only**, not as a caption provider.

---

## 6. Already tried, superseded, or knowingly rejected

| claude-video technology | Status here |
|---|---|
| **Frame extraction and vision analysis** | **Tried and explicitly superseded.** `handoff-videocviction.md` records a 0.25 fps / 512 px frame-sampling inference path on GPT-4o and LLaVA, marked *"Superseded: Gemini consumes the YouTube URL directly… No download/storage pipeline to maintain."* We now force `MEDIA_RESOLUTION_LOW`, and `transport/google-native.ts` comments that frames are *"100-300 [tokens] and irrelevant to"* transcription. claude-video's headline feature is a road already walked here, and abandoned for the right reason: our task is speech extraction. |
| Captions-first, ASR-on-failure ordering | Already our architecture, and already the spec's. |
| Whisper as an ASR fallback | Tried as a concept, only ever through Supadata's managed wrapper. Never on a direct vendor key. |
| Free local caption retrieval | Tried via `youtube-transcript-api` in `scripts/free-caption-benchmark.py`: 4 of 5 locally, US$0 retrieval, hosted reliability untested. |
| `ffmpeg` audio extraction | Never used here. No media bytes have ever been handled in this repository. |
| Scene-change detection, keyframe selection, frame dedupe | Never used and not wanted for the current scope. |

**One narrow case where frames are not worthless.** Trading commentary shows tickers, levels and chart annotations on screen that are never spoken — a price on a slide that the creator gestures at. Nothing in the spec asks for this, our evidence model is built entirely on spoken spans, and adding a visual claim source would need its own validation design and its own gold-set items. Recording it as an observation, not a recommendation.

---

## 7. What it cannot replace, stated plainly

Every one of these is load-bearing in our product and absent from claude-video:

- **Evidence validation** — exact-quote checks, price-role and conditionality checks, ticker and index-versus-ETF checks. This is the `08-evidence.png` audit finding (COIN entry/stop 140 from a quote conditioned on someone already bottom-fishing) and the reason the product exists.
- **Evidence by pointer** — segment IDs instead of model-written quotes (spec 4.2).
- **Cross-family critic, trust ladder, human review path** (spec 4.6).
- **Durability** — Postgres, job queue, leases, checkpoints, idempotent retries, circuit breaker.
- **Spend control** — reservations, the `YTI_BUDGET_USD` ledger, per-vendor credit alerts.
- **Multilingual evidence retention** — original-language spans with adjacent English translation.
- **Everything above ingestion** — leaderboards, settlement, sentiment, the metrics registry, the context check, sharing, digests.

It is also not a server component in any sense: it assumes a local filesystem, a temp working directory, `~/.config/watch/.env` at mode 0600, an `AskUserQuestion` setup flow, and an agent that can `Read` JPEG files.

---

## 8. Recommendation

1. **Do not adopt the skill, and do not adopt its frame pipeline.** The frame path is a decision this repository already made and reversed.
2. **Open a Lab item for Groq Whisper as the ASR tie-break**, using `plan_chunks`/`shift_segments` as the reference implementation for bounded windows. Gate it on gold-set scores for English *and* Mandarin, scored separately, against Supadata `mode=generate` and windowed Gemini on identical windows. This is the only item with a measurable cost argument.
3. **Fold `yt-dlp` + `ffmpeg` audio extraction into the hosted-egress test** that `free-caption-benchmark.md` already calls for, once spec 4.7's worker has a controllable egress IP. Test it as audio acquisition, not as a caption provider.
4. **Port the VTT rolling-duplicate collapse** if and when any route returns raw VTT.
5. **Change nothing in the spec.** Sections 4.2, 4.5, 4.6 and 4.10 already contain the correct answers to the problems this repository was examined for. The examination adds one vendor option and one acquisition mechanism to an existing plan.

Attribution: claude-video is MIT-licensed. Any ported logic must carry the licence notice.
