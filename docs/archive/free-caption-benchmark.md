# Free caption benchmark — 14 September 2026

## Result

Direct local `youtube-transcript-api` 1.2.4 retrieved original-language captions for four of five reference videos. The existing `youtubei.js` 18.0.0 adapter retrieved none of the five. No proxy, cookie, paid transcript provider or YouTube API key was used for retrieval. These results establish local feasibility, not reliability from Vercel or another cloud network.

| Video | Python | Seconds | Caption segments | YouTube.js |
|---|---|---:|---:|---|
| Pronk, 5 Stocks I'm Buying (`wkAqHlYL7bQ`) | English automatic | 1.629 | 1,117 | Failed |
| Plain Bagel, AI debt (`v824SHV6COE`) | English automatic | 1.340 | 650 | Failed |
| Plain Bagel, methodology (`kXYvRR7gV2E`) | English automatic | 2.488 | 602 | Failed |
| NaNa Chinese (`3u24qyWjSVM`) | Chinese, provider marks non-automatic | 1.451 | 278 | Failed |
| Chinese macro (`J25UuUqHT3Y`) | TranscriptsDisabled | 1.053 | — | Failed |

The successful long-video caption track reaches the closing section. Company transitions align with the creator chapter markers: Limbach near 1:31, Mercado Libre near 14:19, Nubank near 20:47, Mastercard near 27:31 and Meta near 32:26. This is metadata/text corroboration, not an independent audio accuracy measurement. Caption end times overshoot metadata duration by about 1.1–1.2 seconds in two videos; originals were preserved, not rescaled. NaNa's final caption ends near 16:31; cue-duration coverage is 91%, with gaps that may include pauses. It must not be interpreted as a measured 9% transcription omission rate.

## Synthesis comparison

Three fresh runs used Gemini 3.8 Flash synthesis, Gemini 3.5 Flash critique and unchanged evidence-first.web.v5 prompts. English source segmentation produced two synthesis chunks; NaNa produced one. Therefore this is a source-and-segmentation comparison, not an isolated model benchmark.

| Video | Earlier Gemini-source output | Free-caption output after boundary re-audit | Saved LeapEdge reference |
|---|---|---|---|
| Long Pronk | Source incomplete (~85% timestamp coverage); stronger/windowed attempts failed | Complete-range source; 0 accepted trade claims, 3 accepted key points | 5 trade ideas |
| AI debt | 0 trade ideas, 5 accepted key points | 0 trade ideas, 3 accepted key points | 0 trade ideas, 9 key points |
| NaNa | v5 candidate: 8 accepted claims, 3 key points | 4 accepted claims, 5 key points | 4 trade ideas, but different contents |

Counts are not accuracy scores. NaNa's accepted claims include two index conditions, VOO allocation and MSTR avoidance; RDDT/COIN candidates were rejected because their exact ticker strings were absent from their cited evidence. Consequently four versus four does not establish parity. The long draft included all five company discussions but duplicated Nubank across chunks and lost trade claims at evidence validation. The AI-debt draft recovered concluding commitment/revenue context, but some of that context failed quote validation.

## Citation failure and bounded correction

The original English runs accepted zero items: the existing validator concatenated caption fragments without spaces. A new explicit `segment_separator` source field permits a single space at caption boundaries while preserving every original caption string. Chinese and existing sources retain their previous behavior. A regression test rejects changed words, negation removal, skipped captions and wrong casing.

Two separate candidates re-audited the unchanged English drafts using that fix. Each recovered three accepted key points. Remaining mismatches include model-selected start IDs one or more cues after the actual quote begins, and quotes that are not exact contiguous source spans. These were not silently corrected or waived. Original runs and re-audits remain stored separately. No candidate replaced the selected production collection.

## Cost and next decision

Free retrieval: US$0. New synthesis and critique including both re-audits: **US$0.8001345 confirmed**. No additional LeapEdge analysis credits used. Existing saved LeapEdge UI observations were reused, not freshly generated or treated as verified audio ground truth.

Recommendation: retain the Python approach as a successful local ingestion candidate. Before production adoption, test retrieval from the intended worker network, improve deterministic citation anchoring for short caption cues, and test paragraph grouping with reversible mappings to the original cues. Keep a fallback for truly absent captions. Supadata is no longer required to obtain this particular long video's captions locally; hosted reliability remains untested.

## Reproduction and artifacts

Create an isolated virtualenv, install `youtube-transcript-api==1.2.4`, and run `scripts/free-caption-benchmark.py`. It writes raw source text and diagnostics under ignored `data/free-caption-benchmark/`. It makes no model calls. Existing `npm run test:captions -- <video IDs>` exercises the YouTube.js adapter.

`free-caption-benchmark.json` contains sanitized retrieval metrics and run IDs/counts/costs. Full original captions, evidence, drafts and failure reasons remain in private test artifacts and the Neon evaluation history. Five completed runs, comparison snapshots and proposed follow-up work are retained. Unit/integration tests: 36 passed; TypeScript check passed. The caption spacing change and Python benchmark script are prepared locally; this experiment does not install Python on Vercel or enable a production Python worker.
