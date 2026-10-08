> **9 October 2026 hosting update:** Production now uses Supabase project `twidbzmqhvqpuakkzobf` (joshuafang@gmail.com), hosted by the existing Vercel `youtube-intelligence` project. This supersedes older Neon hosting instructions below and in AGENTS.md. Cron is defined but stays disabled in Vercel and behind `YTI_CRON_ENABLED=false`. See [the exact environment-variable guide](../deployment/supabase-vercel-setup.md). No paid-provider requests or automatic retries are part of this repair.

# Current state and direction — 28 September 2026

This page replaces the per-run review documents (now under `docs/archive/reviews/`)
and the 27 September handoff. The ledger (`ledger.json`) remains the delivery record.

## Product goal (agreed with the user, 28 September)

An institutional investment team uses the app to track what YouTube creators say:
ideas and themes and why, which tickers are discussed and why, sentiment, which
channels discuss what, their calls, reliability over time (backtest, rank), and
discovery of new creators. Priority: research brief, themes, ticker sentiment and
reasons first; calls and leaderboard second. Improve on LeapEdge for this audience.

| Target | Value |
|---|---|
| Volume | ~50 videos/day now; 1,000/day is a design ceiling, not a test target |
| Cost | ≤ US$0.50 per video all-in; aim ~US$0.15 for a typical video |
| Latency | Ad hoc runs within minutes; subscribed channels may use batch |
| Fidelity | The brief must be true to the source. Whether a creator's claim is right is human judgement, not the tool's |
| Benchmark | Faster and more faithful than LeapEdge on the same fresh videos (up to 20 paired runs) |
| Auth | One shared workspace passcode (`YTI_PASSCODE`); no per-user accounts in the POC |

## Deployment (29 September)

- **Live app:** Vercel project `youtube-intelligence`, https://youtube-intelligence-two.vercel.app,
  deployed from GitHub `main`, with its original Neon database (earlier runs retained). Shared
  passcode `YTI_PASSCODE`; previews read-only; cron verified returning 200 each minute.
- **All-time cap** `YTI_BUDGET_USD` = US$50 (user decision, 29 Sep); monthly budget US$750.
- The second project `youtube-intel` (youtube-intel-delta) was created 20 Sep with blank secrets and
  is to be deleted once `youtube-intelligence` is linked to GitHub.
- `GEMINI_API_KEY` and `EXA_API_KEY` still need values on `youtube-intelligence`.

## Decisions

- **Hosting: Vercel Functions + Neon only; no Mac worker.** The Postgres job queue
  (leases, fencing, per-step checkpoints, paid-call ledger) is the durable layer.
  The per-minute cron and an `after()` drain on submit run `processNext()` on
  Vercel. Vercel Workflows was evaluated and **not adopted**: it would duplicate
  that state machine. Google Cloud migration is cancelled; its preparation is in
  `docs/archive/google-cloud/`.
- **Web research is not in the default path.** The default brief is built from the
  transcript alone. An analyst can request a *news review* on a brief: an AI
  synthesised, cited review of the brief's claims against dated news, where every
  piece of evidence and every reasoning step carries a citation.
- **Targeted-audit experiment is parked.** Its paired runner and review manifest
  are archived (`docs/archive/targeted-audit/`). The pipeline selector stays.
- **Gold set is not required now.** Do not fabricate human-reviewed badges.
  LeapEdge agreement is not ground truth.

## Where it stands (measured, before this direction)

- 20 Sep, 20 videos: 13 completed, 5 failed, 2 needs review; ≈ US$0.11/video.
- 27 Sep research-only rerun: 12/20 published; ≈ US$0.40/video; fidelity errors
  (reversed gold/silver dependence, reversed split ratio, dropped IDIQ qualifier,
  misattribution) found. Recovery of long videos cost up to US$3.13 each.
- The research audit makes ~32–64 sequential critic calls on a long video; it was
  ~92% of research stage time. It checked sentences against web evidence, which is
  now out of the default path.

## Next

1. Cloud processing on Vercel; verify a run end to end with the Mac off.
2. Web research moved to an on-demand, cited news review.
3. Per-stage and end-to-end timing shown in the UI.
4. Pipeline v3 "faithful brief": transcript → one extraction (mentions, themes,
   sentiment, calls with source pointers) → deterministic checks → one cited
   brief synthesis → one cross-family faithfulness check. ~3–5 calls.
5. Up to 20 fresh paired runs against LeapEdge: latency, fidelity, cost; feed
   prompt improvements.

## Added 29 September 2026

The user added 19 LeapEdge-gap features (daily report, search, trends, channel pages, richer calls
and more) as phase 5, F56–F77. See `leapedge-gap-decisions-20260929.md` for scope and
`leapedge-gap-ux-proposals-20260929.md` for the UI/UX requirements. The morning email digest stays
in phase 4 (excluded).
