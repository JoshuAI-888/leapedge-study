# Completion campaign — 15 September 2026

## Current checkpoint — final update

Production includes the gated native adapter and email-event reconciliation. Native ingestion remains disabled and the default synthesis prompt remains v5. Both CI runs for commit `919c530a612efada1f17be4cb2e4a50bc1930a23` passed (34898044303 and 34898040967). Application tests passed 50/50; native fixtures passed 15/15. Earlier approval-pending and preview-only paragraphs below are chronological intermediate observations, superseded by this checkpoint.

All five priorities are **not yet accepted**: independent audio review has zero scored windows; synthesis omissions persist; hosted live native recovery remains untested; the full fresh discovery-to-email chain and UI scenario matrix remain open; no eligible priced creator cohort exists. Email callback acceptance is complete, but delivery to the user's intended reading mailbox awaits its address.


Status: in progress. Native adapter deployed behind disabled gates; fidelity prompt remains experimental.

## Authorized scope and method

Close synthesis defects; establish source accuracy; productionise a gated native adapter; verify channel-to-email and research workflows; validate creator/SPY cohorts. Preserve failures and raw artifacts. Do not equate schema validity, model agreement or provider submission with audio truth or inbox receipt.

The existing native campaign's NZ$50 / 60-request limits remain in force. Unknown costs retain their reservations. No automatic paid retry of uncertain requests. Existing caption providers remain enabled during observation.

## Baseline findings

- v5 single-segment candidate: 8/9 text-audit accepts versus 1/9 baseline, on Alpha only. Added closing condition, missing ticker evidence and omitted instrument views remain.
- Nine audio-review windows have no independently scored reference. Fresh videos must be separately identified; these development windows cannot become held-out cases retrospectively.
- Resend submission was accepted; actual receipt and live webhook events remain unconfirmed. User receipt confirmation requested.
- Existing feature matrix and historical hosted checks are evidence of prior tests, not new campaign passes.

## New methods and scripts

- `evaluations/native-google/fidelity-prompts.ts`: v7 candidate adds exact ticker support, source-condition fidelity, instrument-view coverage and an adversarial condition critique. Default prompt unchanged.
- Subsequent scripts, commands, artifacts and outcomes will be appended before the check-back.

## Documentation checked

- Google structured output: https://ai.google.dev/gemini-api/docs/structured-output — reviewed 15 September. Valid JSON/schema does not establish semantic correctness; retain application checks and independent evidence review.
- Google GenerateContent video guide: https://ai.google.dev/gemini-api/docs/generate-content/video-understanding — reviewed 15 September. Native media input and interval clipping remain the tested path; no automatic upgrade to a different API or agentic mode.
- Resend event types: https://resend.com/docs/webhooks/event-types — reviewed 15 September. Distinguish submitted, delivered and bounced events; actual inbox observation is separate.

Related issue reports and previous mitigations remain indexed in `native-google-research-sources.json` and the native findings white paper. Similar symptoms are hypotheses, not proof of the cause in this app.

## Recorded results and decisions

| Priority | New work and evidence | Acceptance status |
|---|---|---|
| 1 — synthesis | v7 ran against frozen Alpha, Mandarin and long-English sources. Alpha: 7/8 text-audit accepts; long English: 6/8; Mandarin draft returned but first critique had a transport failure. Exact boundary splitting clears 3 quote failures offline while preserving the Mandarin price rejection. | **Not closed.** QQQ/IWM omissions remain; no matched fresh baseline on the other two sources or independent semantic/audio score. v5 remains default. |
| 2 — accuracy | Prepared a blind version of the nine development windows, without candidate text, and retained existing scoring gates. | **Not established.** Zero independently listened/scored windows; no fresh held-out or new LeapEdge comparison in this campaign. Do not label these runs accuracy results. |
| 3 — native adapter | Shared tested Google transport/validator moved into application server code. Added opt-in Settings field, runtime kill switch, immutable failure records, held spend reservations and at most two 90-second recovery clips. Experimental jobs are excluded from canonical selection. Preview build passes after packaging fix. | **Partially verified.** Controlled adapter/SDK checks pass; native live hosted recovery has not been exercised. Recovery candidates require review; no automatic source replacement. Production native mode remains off. |
| 4 — end-to-end | Seven live hosted checks pass: access, private read, Settings restore, saved-idea transitions, share/revoke, cron authentication and cross-origin rejection. Resend UI confirms earlier digest Delivered; user reports not received. Dedicated delivery webhook created. | **Not closed.** Mailbox routing/receipt remains unresolved. Signing secret approved and configured; live simulated delivery and bounce events reached the app and matched their records. Full fresh channel-to-email run and complete visual/error matrix remain pending. |
| 5 — creator performance | Rechecked six canonical/frozen videos. Prior forward snapshots remained byte-identical across repeated collection reads; no new observations fabricated. All three ticker claims are ineligible under current stance/conviction rules. | **Not closed.** Zero eligible/priced calls, so new real-cohort arithmetic checks = 0. Need a genuinely eligible reviewed cohort and elapsed forward observation time. |

### 1. Synthesis methodology and failure analysis

`fidelity-synthesis.ts` reuses the native text harness, frozen source hashes, dated rate bounds, raw response journal and existing per-item critic. It adds the immutable `evidence-first.web.v7-fidelity-candidate` prompt from `fidelity-prompts.ts`. Each call reserves spend before submission; no failed or uncertain call is retried automatically.

Alpha now included explicit SPY quote evidence and used “breaks below” in the exit claim, but that claim failed exact source matching. QQQ/IWM views were still absent despite the new inventory instruction. This suggests that another prose instruction alone is insufficient for recall; the next candidate should use an explicit source-view inventory with per-view disposition and compare it against final claims. Do not inflate conviction to manufacture actionable trades.

Inspection of the three failed quotes on Alpha and long English found boundary spaces inserted between otherwise exact adjacent source cues. `splitExactBoundaryQuotes` accepts only that narrow case, starting at the cited segment, within at most twelve cues, and splits it into exact fragments. It does not alter source punctuation, words, tickers, numbers or negatives. The original grouped translation stays in repair provenance; no per-fragment translation is invented. This helper is **experimental and not wired into the default pipeline**.

`boundary-replay.ts` applied this helper to all three retained drafts without new model calls. Alpha structural failures changed 1→0; long English 2→0; Mandarin remained 1→1 because its numeric value lacked verbatim evidence. Negative controlled cases for altered negation, closing condition and price remain rejected. Passing serialization is not a new semantic-critic pass; those items require re-audit before publication.

Mandarin's first critic request failed with `fetch failed`; the raw failure and reservation remain. [SDK issue #938](https://github.com/googleapis/js-genai/issues/938) describes a similar Node symptom on an older SDK. It does not establish the cause here. A useful follow-up is a sanitized nested-error/network trace and an explicit, separately authorized retry only after outcome review—not blanket paid retries or treating this as unavailable media.

### 2. Audio-reference protocol

`completion-blind-audio-review-20260915.json` carries the nine windows and a hash of the original packet but omits candidate transcripts. A reviewer must listen first, record original-language text and critical facts, mark absolute source anchors, and identify themselves/date. Only then should candidate cue boundaries be reviewed and scored using `evaluations/transcript-accuracy.ts`. Provider consensus and a second Gemini transcription cannot substitute for that independent reference.

No raw audio was independently listened to in this campaign. The browser's tab-control entry point initially returned unavailable; native Chrome accessibility and AppleScript UI navigation later worked for Resend. This does not establish audio access or enable a retrospective accuracy claim.

### 3. Adapter, deployment and rollback method

- Root dependency pinned to the same tested `@google/genai` 2.22.0. Shared `native-google-core.ts` retains the exact request/schema checks from the isolated harness; the harness re-exports this core rather than duplicating it.
- `nativeGoogleExperimental` defaults false. When enabled, caption acquisition still tries TranscriptAPI and Supadata native first, then the native stage; it skips the legacy scraping/generated route for that experimental run. Such jobs are marked experimental and do not automatically become canonical research.
- `YTI_NATIVE_GOOGLE_ENABLED` is a separate runtime kill switch. Disabled jobs stop for review before making a native request, including previously queued jobs.
- One full-source request plus at most two diagnostic recovery clips; each request has a 150-second local deadline and no SDK retry. Application reservations remain held because the estimate is not reconciled billing.
- Failed source identity/schema/timing/empty/timeout outcomes remain explicit. Timing failures with a usable start anchor can acquire two bounded windows. The original source is never silently patched; a reviewer must accept a replacement in a later workflow.
- Tests cover raw response retention, spend retention, duplicate-call refusal, disabled-mode behavior and clipped interval bounds. Existing SDK fixtures exercise connected abort and response schema serialization.

Local production build passed. First CLI preview deployment lacked usable CLI authentication; a direct project read with the existing intended credential returned HTTP200. Supplying that credential through the environment reached the remote build. The build then failed because `.vercelignore` excluded the native prompt module imported by `save-native-google-research.ts`. Keeping the small evaluation source files fixed this; node_modules and private data remain excluded. The next explicit-preview deployment succeeded.

Preview: `https://youtube-intelligence-2ph2ow8hb-joshu-ai.vercel.app`. Build success is not live native recovery acceptance. The preview predates the later offline-only boundary helper. No production promotion was performed.

An automatic approval review rejected a retry without an explicit preview target; adding `--target preview` addressed its stated concern and was accepted. This is distinct from the pending signing-secret approval below.

### 4. Email and scenario evidence

The send-only Resend key returned HTTP401 for a message-status GET: “This API key is restricted to only send emails.” No webhook signing secret was configured locally. Browser inspection then showed the exact message `aebd2984-81ba-4f33-84d4-18ccf78bc38a` as Sent and Delivered at **Sep 14, 6:06 AM in the displayed UI**, addressed to `welcome@accounts.joshuai.nz`, with subject `[TEST] YouTube Intelligence — 2026-09-14`. Original visible evidence was retained privately in `data/native-google-20260915/resend-test-message.txt`.

The user explicitly reported no inbox receipt. [Resend documents](https://resend.com/docs/webhooks/event-types) that delivered means the receiving mail server accepted the message. The expected mailbox or forwarding destination was requested; spam/quarantine/forwarding remain possibilities, not diagnosed causes. No blind resend was performed.

Resend had only an unrelated existing webhook. A new task-specific endpoint was created for `https://youtube-intelligence-two.vercel.app/api/email/webhook`, selecting delivered, bounced, complained, delivery_delayed and failed. Existing webhooks were untouched. `configure-delivery-webhook.mjs` is ready to capture its visibly revealed secret directly into local and encrypted Vercel configuration without printing/committing it. Automatic approval review rejected this transfer because it requires explicit user approval for the secret egress. Approval requested; secret hidden again; transfer not performed at this checkpoint. Redeployment is required after configuration.

| Scenario | New evidence | Remaining gap |
|---|---|---|
| Settings success | Live change/readback/restore passed | Experimental native option not visually accepted on production |
| Saved idea success | Live done/dismissed/open transitions and restore passed | Fresh generated idea chain not rerun |
| Share success/revocation | Anonymous frozen share 200 then revoked 404 | Full delayed/error UI matrix not rerun |
| Access/error paths | Anonymous read and cron denied; cross-origin mutation denied | Not a complete authorization audit |
| Empty/failed native source | Controlled core/adapter tests | Hosted live native failure/recovery pending |
| Scheduling/digest | Existing tests rerun successfully | Fresh discovery→analysis→digest chain pending |
| Email submission/delivery | Historical submission plus new provider UI Delivered evidence | Inbox receipt and live app webhook event pending |
| Search/archive | Prior feature evidence retained | Fresh browser success/empty/delayed/failure matrix pending |

### 5. Performance cohort methodology

`completion-cohort.ts` reads actual canonical claims, invokes the existing first-observation freeze, checks previously frozen hashes, repeats collection read, and computes historical/forward modes. It independently recomputes signed return and SPY excess for any priced rows. **There were none**, so arithmetic assertions on real creator rows did not run. The six snapshots stayed unchanged, and all three available ticker claims were ineligible. No conviction or stance was changed to force a populated chart.

Existing adapter arithmetic with real FMP prices remains explicitly a synthetic test, not a creator recommendation. Eligibility excludes hold/watch/avoid/unspecified-conviction calls; historical replay is hindsight-sensitive, and equal-weight claim returns exclude trading/borrow costs. A reviewed broader cohort is required for meaningful channel comparison. No 90-day forward outcome is claimed.

## Validation, accounting and reproducibility

- Application suite: 48/48 passed after native adapter integration. Added boundary helper regression: 1/1 passed separately.
- Native fixture suite: initial sandbox run could not bind localhost (`EPERM`); the authorized localhost run passed 15/15. This was not a provider failure.
- TypeScript and local production build passed; remote preview build passed after the packaging fix. Final typecheck includes the boundary helper.
- Hosted acceptance checks: 7/7 passed, on the existing production version, not on the newly built preview.
- New live requests: 17; new held reservations: NZ$5.52. Shared native campaign total: 42 requests, NZ$43.38 held against NZ$50. Estimates are not invoices; uncertain attempts retain reservations. LeapEdge credits used in this campaign: 0.

Machine-readable results, request IDs and script hashes: `completion-results-20260915.json`. Raw model responses stay in the private campaign directory. Public command logs distinguish local tests, fixture-socket failure, CLI authentication failure, remote packaging failure and successful preview build. No default prompt, canonical source or provider subscription was replaced.


## Subsequent email acceptance results

The user explicitly approved secret storage. `configure-delivery-webhook.mjs` successfully stored it in `.env.local` and encrypted Vercel production/preview variables without printing or committing it. The app was deployed to activate verification; native Google remains off by default. The earlier secret-transfer approval block is resolved.

`completion-live-events.ts --send` sent two minimal messages to Resend's documented `delivered+...@resend.dev` and `bounced+...@resend.dev` simulation addresses, not to people. Initial observation preceded callbacks and showed provider acceptance only. A subsequent read-only invocation (without `--send`) found signed `email.delivered` and `email.bounced` events persisted in Neon, and the application delivery records read delivered/bounced. Both passed. The Resend dashboard showed Success for both; the bounce callback had HTTP200, one attempt and `{"received":true,"matched":true}`. Raw visible evidence is retained privately in `resend-webhook-live-events.txt`.

The script refuses repeat submissions when a delivery record already exists. Documentation: https://resend.com/docs/dashboard/emails/send-test-emails. These provider simulations prove webhook routing and application matching, **not** actual human inbox receipt or reputation.

Code inspection identified a separate early-event race: a callback may precede the stored provider ID. Added `reconcileDeliveryEvents` and a regression that replays retained matching events while ignoring older/unrelated events. Application suite now passes 50/50. A temporary TypeScript return-type error introduced during this fix was caught and corrected; final typecheck passed. This race was not established as the cause of the user's missing inbox message.

Public DNS check (`dig +short MX accounts.joshuai.nz`) returned `10 inbound-smtp.ap-northeast-1.amazonaws.com.` This is evidence of Amazon SES inbound routing, not a conventional Gmail destination. Receiving/forwarding still needs confirmation; do not change DNS based on this alone.


### Receiving destination resolved

Browser inspection of `https://resend.com/emails/receiving` found **all three prior test digests**, including the 2026-09-14 subject, from and to `welcome@accounts.joshuai.nz`. Their receipt is now observed in Resend's inbound service; it was not delivery to the user's Gmail inbox. The public MX observation is consistent with that receiving route. Visible evidence: `data/native-google-20260915/resend-receiving-digests.txt`. The user's intended reading address remains to be specified before changing `YTI_EMAIL_TO`; leave the sender unchanged. No DNS or forwarding change was made.

The follow-up production deployment including early-event reconciliation succeeded. Native Google remains behind disabled gates, and v5 remains the selected prompt. Earlier preview-only/approval-pending statements above describe intermediate checkpoints, not the final deployment state.

## LeapEdge macro availability comparison

On 2026-09-15 Pacific/Auckland, entered `https://www.youtube.com/watch?v=J25UuUqHT3Y` in the visible Run form and clicked Run once. LeapEdge displayed READY, an English macro summary, 11 key points and “No trade ideas extracted.” UI metadata: `keypoints.v1-insights.v3-critique.v1`; 195.4k tokens; `gemini-3.1-flash-lite · gemini-3.7-flash · gemini-3.1-flash-lite`; displayed cost $0.060 (currency not established). Daily credits were 19 before and 19 after. This is an available result, potentially cached, **not evidence of fresh successful ingestion**, measured latency or current captionless fallback. No observed credit decrement. Private visible-page evidence: `data/native-google-20260915/leapedge-macro-result.txt`.

Our earlier full native extraction of this 31:59 video failed timestamp validation. LeapEdge's usable summary therefore exposes a user-visible availability difference, but its page supplies no transcript, quote-level evidence or timestamp audit for these macro points. It does not establish that its source timing is more accurate. No trade ideas is an acceptable outcome for a macro-only video; forcing a trading setup would be a defect. A fresh source-grounded audit is still required.
