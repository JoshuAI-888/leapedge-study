# LeapEdge side-by-side: reviewed development videos

## Scope and decision

On 15 September 2026 the unlocked, signed-in browser was used to submit the three previously studied videos through the visible Run form. These are development comparisons, not fresh held-out tests. All returned READY reports. No native ingestion or new synthesis was run during these browser lookups. Do not promote v9 or remove providers: comparisons show mixed strengths and errors, not overall parity.

## Reproducible method

1. Open `/today`, read displayed daily credits and inspect visible controls.
2. Enter the original YouTube URL in the visible Run input and click Run once.
3. Preserve rendered page text, page URL and observation timestamp as private JSON under `data/parity-browser-20260915/{alpha,long,mandarin}-leapedge.json` using Chrome's DOM via AppleScript.
4. Compare only corresponding claims with frozen v8/v9 source-backed outputs and user-reviewed wording. Pause timestamps are not used to calculate timing accuracy.

Run submissions (UTC): Alpha 10:45:39.434; English 10:46:50.815; Mandarin 10:47:38.129. Tool overhead and polling delay mean these are not precise processing latencies. Credits remained 16 before Alpha, after Alpha and after English. Reports may be reused/cached; no fresh-ingestion speed claim follows. Final displayed balance at 10:49:10 UTC was also 16/20: no observed credit decrement across the three lookups. This is consistent with reused reports, but does not prove backend cache behavior.

## Displayed pipeline metadata

| Video | Tokens | Models displayed |
|---|---:|---|
| Alpha CMjt6f4eVdA | 88.6k | Gemini 3.1 Flash-Lite, 3.7 Flash, two further Flash-Lite stages |
| English wkAqHlYL7bQ | 267.4k | Gemini 3.1 Flash-Lite, 3.5 Flash, two further Flash-Lite stages |
| Mandarin 3u24qyWjSVM | 111.7k | Gemini 3.1 Flash-Lite, 3.6 Flash, two further Flash-Lite stages |

All display `keypoints.v1-insights.v3-critique.v1`. Different model versions under the same prompt label prevent treating these reports as a single controlled backend configuration. Displayed metadata does not reveal private prompts or prove how each video was ingested.

## Claim-level comparison

| Case | LeapEdge | Our candidate | Evidence and conclusion |
|---|---|---|---|
| Apple 258–260 | Supporting quote describes resistance; structured ENTRY shows 258–260 | v8 and v9 label the range resistance, with pullback condition | User-reviewed window 3 supports resistance, not a stated entry at that range. Our classification is more faithful on this case. |
| Tesla core position | Hold core; target 500 and potentially above 550 | Core-position handling retained | User-reviewed window 3 supports holding a base position. Agreement on this point does not verify every sentence in either thesis. |
| VOO versus QQQ | VOO primary DCA, QQQ secondary | v9 separates primary VOO and conditional QQQ views | User-reviewed window 9 supports the ranking. Both preserve this recommendation. |
| Coinbase stop | Structured STOP 140; action says just below 140 | v8 loses qualifier; v9 structured value retains slightly below | LeapEdge has an internal field/action inconsistency. The relevant source cue is not in the user's nine reviewed windows; source-audio correctness remains unverified for this claim. |
| 4.75% Treasury yield | Macro observation in summary/key points | v8/v9 assign resistance | LeapEdge avoids our unsupported technical-role assignment. Source audio for this particular passage is not in the nine reviewed windows. |
| English long video | READY, five ideas covering LMB/MELI/NU/MA/META | v8 completed; v9 fails schema on selected source IDs | LeapEdge has better report availability than v9 for this case. This is not a fresh ingestion reliability rate. |
| Mercado Libre trillion-dollar future | Structured target displays a trillion-dollar business | Review wording uses a hedged long-term speculation | The card's terse target omits the hedge. Treat as a presentation concern requiring contextual review, not proof the entire LeapEdge thesis is false. |

LeapEdge's English NU action suggests positions below 20x earnings and labels P/E 18.4 as ENTRY. This is an audit candidate, not a scored error: the user's reviewed windows do not cover that source passage. Do not infer missing context.

## Engineering investigation

The v9 long-video error is an application schema failure: more than 20 selected evidence IDs per claim. The request used JSON MIME output plus runtime Zod validation, not a supplied response schema. Google's [structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output), consulted during this session, describes schema-constrained generation. Supplying the output contract is the next controlled structural experiment; it does not establish that generated field meanings are correct. Preserve the runtime validator and raw failures rather than truncating evidence to make a test pass.

The price-role problem needs field-specific evidence and explicit adjudication; the v9 experiment demonstrates that repeating semantic instructions in generator and critic was insufficient. No external issue report was found or used here to establish a Google service defect. These are application-level observations, not a claim about a documented provider incident.

## Unfinished gates

Fresh English/Chinese/captionless paired tests, repeated recovery trials, independently marked timing landmarks and complete source-grounded omission scoring remain unfinished. Native campaign reservation was NZ$48.56 of NZ$50 before this browser work; a proposed NZ$65 cap is awaiting user approval. No budget cap was changed. Production defaults and provider choices remain unchanged.
