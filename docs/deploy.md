# Deployment: every manual step, phase 0 to phase 4

**Who this is for:** the person with the accounts, the cards and the keys. It assumes no prior knowledge of Vercel, Neon, Postgres or this codebase.

**What this document is not:** it is not the build plan. Everything the build agents do — writing code, migrations, tests and gate reports — is in `spec/youtube-intelligence-v2-build-plan.md`. This document lists only the things a **person** has to do, because a machine cannot: create accounts, hold a card, click a dashboard, listen to a video, or decide that a number is good enough.

Each step says what to do, **why it exists**, and **what happens if you skip it**. The "what happens if you skip it" is the important column: most of these steps fail silently rather than loudly, which is exactly why they are written down.

---

## 0. How to read this

### 0.1 The four places things live

| Place | What it is | What you do there |
|---|---|---|
| **GitHub** — `JoshuAI-888/leapedge-study` | The code | Nothing by hand. Branches are pushed for you. You review and approve at each phase gate |
| **Vercel** — the `youtube-intelligence` project | The website and the every-minute worker | Set environment variables, confirm plan settings, promote and roll back deployments |
| **Neon** — the Postgres project | The database | Enable the integration, take branches before migrations, confirm the region |
| **Your own machine** | Where you run the phase-0 and phase-1 input tasks | Run a few commands, watch videos, send files back |

### 0.2 Running a command

Every command in this document is typed into a terminal, from the top folder of the repository. They all look like this:

```sh
node --env-file=.env --experimental-strip-types scripts/<name>.ts
```

- `--env-file=.env` tells Node to read your keys from the `.env` file.
- `--experimental-strip-types` lets Node run TypeScript directly. The warning it prints is normal.
- Anything in `<angle brackets>` is for you to replace.

If a command fails, copy the **whole** output back to me, including the lines before the error. Do not retry a command that spends money until you know why it failed.

### 0.3 Five safety rules

1. **Never commit `.env`.** It is already ignored by git. If you ever see `.env` in a `git status` output, stop and tell me.
2. **Never paste a key, a password or a database connection string into the chat with me.** I never need one. If I ask you to check a value, I will ask you to compare it or to tell me whether it is set — never to show it.
3. **Never put a secret in a variable whose name starts with `NEXT_PUBLIC_`.** Anything with that prefix is compiled into the web page and is readable by anyone who opens it.
4. **Never restore a backup over a live database.** Restore into a new, empty one, check it, then point the app at it.
5. **Lower your budget variables again** after any task that needed them raised. They are the only thing standing between a bug and a large bill.

### 0.4 Every manual step at a glance

| # | Step | When | Blocking? |
|---|---|---|---|
| 1.1 | Install Node 24 and the repository | Once, before anything | Yes, for phases 0–1 tasks |
| 1.2 | Create `.env` and fill the keys | Once | Yes |
| 1.3 | Confirm the Vercel plan, Fluid Compute and the cron | Once, before phase 2 deploys | Yes |
| 2.1 | Produce **A**: 50 verified gold cases | Any time | No — gates 0–1 stay advisory without it |
| 2.2 | Produce **B**: `runs.json` under v5 | After A | No — same |
| 2.3 | Produce **C**: frozen responses | After the keys work | No — same |
| 3.1 | Produce **D**: `runs.json` under v7 | After B | No — same |
| 3.2 | Decide the phase-1 gate | When A–D land | Yes, to close phase 1 |
| 4.1 | Link the Vercel project to GitHub, production branch `main` | Before F22a merges | **Yes** |
| 4.2 | Enable the Neon–Vercel integration with per-preview branches | Before F22a merges | **Yes** |
| 4.3 | Confirm the Neon region and record the Postgres version | Before the phase-2 gate | **Yes** |
| 4.4 | Set `YTI_PRODUCTION_DB_HOST` in all three environments | Before F22a merges | **Yes** |
| 4.5 | Set the remaining hosted variables | Before the phase-2 deploy | **Yes** |
| 4.6 | Run the Neon-branch concurrency check | Before the phase-2 gate | **Yes** |
| 4.7 | The production deploy sequence for a type-changing migration | Every time one ships | **Yes** |
| 4.8 | Review and sign off the phase-2 gate | End of phase 2 | **Yes** |
| 5.1 | Record the phase-3a walk-through | End of phase 3a | **Yes** |
| 5.2 | Enable push notifications | During phase 3b | No — polling is the fallback |
| 5.3 | Raise the budget for the historical replay | During phase 3b | No — replay simply does not run |
| 5.4 | Review and sign off the phase-3b gate | End of phase 3b | **Yes** |
| 6.1 | Supply the `briefing-read-v1` contract file | Before F51 is built | **Yes**, for F51 only |
| 6.2 | Decide on the optional Exa key | Before F50 | No |
| 6.3 | Review and sign off the phase-4 gate | End of phase 4 | **Yes** |
| 7.x | Ongoing operations: budgets, backups, storage | Monthly | Yes, in the sense that neglect is expensive |

---

## Part 1 — One-time setup

### 1.1 Install Node 24 and get the repository

**Do this:**

1. Install Node.js version 24. On macOS with Homebrew: `brew install node@24`. Otherwise download the 24.x installer from nodejs.org.
2. Check it: `node --version` should print `v24.` followed by something.
3. Clone the repository and install its dependencies:
   ```sh
   git clone https://github.com/JoshuAI-888/leapedge-study.git
   cd leapedge-study
   npm ci --ignore-scripts
   ```

**Why:** `package.json` declares `engines.node: 24.x`, and the code uses Node features that older versions do not have — running TypeScript directly, and the built-in test runner. `--ignore-scripts` skips package install hooks, which is both faster and safer.

**If you skip it:** commands fail with syntax errors that look like bugs in the code but are not. Node 22 will run most things; anything older will not.

### 1.2 Create your `.env` file and fill in the keys

**Do this:**

```sh
cp .env.example .env
```

Then open `.env` in a text editor and fill in the values. Here is every variable, what it is for, and what breaks without it.

| Variable | Required? | What it is for | If it is missing |
|---|---|---|---|
| `GEMINI_API_KEY` | **Required** | The main model: transcription, extraction, translation. From Google AI Studio | Nothing runs. Every analysis fails at the first stage |
| `OPENROUTER_API_KEY` | **Required** | The critic (a deliberately different model family) and the context check. From openrouter.ai | Claims are never checked by a second model, so the trust ladder cannot reach level 1 |
| `YOUTUBE_API_KEY` | **Required** | Video metadata: duration, channel, publication date. From Google Cloud Console, "YouTube Data API v3" | No analysis can start: the pipeline needs the duration to plan its windows and the publication date for settlement |
| `TRANSCRIPTAPI_API_KEY` | **Required** | The cheap first-choice caption source, about half a cent a video | Every video falls through to paid audio transcription, roughly twenty times the cost |
| `FMP_API_KEY` | **Required** | Share prices, filings and news. From financialmodelingprep.com | No settlement and no leaderboard: there is nothing to score a call against |
| `DATABASE_URL` | **Required** | The Postgres connection the app uses | Nothing starts. On Vercel this is set for you by the Neon integration (step 4.2) |
| `SUPADATA_API_KEY` | Optional | Standby caption provider, used when the first one has an outage | An outage at the first provider stops caption retrieval instead of failing over |
| `EXA_API_KEY` | Optional | Date-bounded web sources for the phase-4 context check | The context check uses only FMP news and filings. Fewer sources, still correct |
| `RESEND_API_KEY` | Optional | Email digest delivery | No digest emails. Everything else works |
| `YTI_BUDGET_USD` | Set it | The spend ceiling for the current session. **Default is 2** | A budget of 2 stops a multi-video task after two or three videos, mid-run |
| `YTI_HARD_BUDGET_USD_MONTH` | Set it | An absolute monthly ceiling that the user interface cannot raise | A mistake in the settings screen can raise spending without limit |
| `YTI_TRANSCRIPT_CREDIT_BUDGET` | Set it | Cumulative caption-provider credits for this campaign | Caption credits can be spent without a cap |

**Why the split between required and optional:** the code checks this itself. `src/server/youtube-intelligence/env.ts` holds a list of always-required keys and refuses to run without them, naming the key but never the value. Optional keys simply switch off the feature that needs them.

**If you skip it:** nothing that talks to a provider or the database will run. Note that the **test suite needs none of these** — tests run against an in-process database with fake providers, so `npm test` works on a fresh clone with no keys at all. That is deliberate: it means a broken key can never be mistaken for a broken build.

### 1.3 Confirm the Vercel plan, Fluid Compute and the cron schedule

This is the step most likely to be quietly wrong, because everything appears to work.

**Do this:**

1. Open the Vercel dashboard, choose the `youtube-intelligence` project, and check the **plan on the team that owns it**. It must be **Pro or above**.
2. Go to **Settings → Functions** and confirm **Fluid Compute** is enabled.
3. Go to **Settings → Cron Jobs** after the first deployment and confirm one job is listed for `/api/cron/intelligence`, with the schedule `* * * * *` (every minute), and that its last run is recent.

**Why:** the whole design rests on the every-minute cron being the worker. `vercel.json` asks for `* * * * *`, and `src/app/api/cron/intelligence/route.ts` declares `maxDuration = 800`, which means each invocation may run for up to 800 seconds — over thirteen minutes. Both of those need the Pro plan, and the 800-second ceiling needs Fluid Compute.

**If you skip it:**
- **On a Hobby plan**, a cron job can only fire about once a day. Vercel will not tell you it has downgraded your schedule. The site works, the database works, and roughly one video is analysed per day instead of hundreds. This failure is invisible from inside the app.
- **Without Fluid Compute**, invocations are killed at the lower default ceiling, part-way through a video. The resume logic means you will not be charged twice for the same model call, but each video is started, killed, re-claimed and started again, so nothing ever finishes and the provider bill grows with no output.

**What to record:** the plan name and the date you checked. Plan limits change; this is worth re-checking whenever throughput looks wrong.

---

## Part 2 — Phase 0 inputs: making the quality gate real

Phase 0 built the evaluation harness. It already produces numbers — precision, recall, anchor accuracy, cost per accepted claim — but they are **advisory**, because the harness is grading the model against a truth it does not yet have. Only a person who has listened to the videos can supply that truth.

The full, detailed procedure for these three inputs is in `spec/phase-0-human-inputs.md`, including the exact JSON shape, the field rules and the conviction rubric. This section says what each one is, why it matters, and what happens without it. **Follow the detailed document when you actually sit down to do the work.**

Before you start, raise your budget for the session:

```
YTI_BUDGET_USD=30
```

and lower it again afterwards. Expect roughly **US$0.20 to US$0.95 per video** for the run tasks — that is the measured range on this pipeline, not an estimate.

### 2.1 Input A — fifty verified gold cases (`gold-cases.json`)

**What it is:** fifty videos, each annotated by a person who watched it **with the captions turned off**, recording every actionable call and every stance-tagged mention, the exact seconds where the words are spoken, and — just as importantly — the things that must **not** be extracted.

**The shape of the set matters:** at least 20 English and at least 15 Chinese videos; at least 10 videos over 25 minutes; and at least **10 videos containing no actionable call at all** (news round-ups, educational pieces). Those ten carry only `expectedRejections`.

**Why:** two different reasons, and both are load-bearing.
- The videos **with** calls measure whether the model finds what is there (recall) and whether what it finds is real (precision), and whether its timestamps land within two seconds of the words.
- The videos **with no calls** measure the opposite failure, which is far more dangerous in a product like this: a model that invents a call from macro commentary or a sponsor read. Nothing else in the system catches that.

**Check your work before sending:**
```sh
node --experimental-strip-types scripts/gold-validate.ts --cases gold-cases.json
```
This reads one file, needs no keys and no database, and prints per case why it is not yet counted as verified. Add `--strict` for a non-zero exit code until fifty are verified.

**When F06a lands** (it is being built now), you will be able to draft cases from runs you already have instead of starting from a blank file:
```sh
node --experimental-strip-types scripts/gold-draft.ts --runs runs.json --out gold-draft.json
```
Every drafted case comes out marked `pending` with `anchorVerified: false`. **A draft is not a gold case.** You still have to listen to each span and promote it by hand; the tool only saves you the typing.

**If you skip it:** the four gate thresholds — precision ≥ 0.90, recall ≥ 0.80, anchors within two seconds ≥ 0.95, cost per accepted claim ≤ US$0.25 — stay advisory for ever. Concretely, that means a future prompt change that makes extraction *worse* will pass the gate, because there is nothing to compare against. You can still ship; you simply have no evidence, and no way to get evidence later without doing this work anyway.

### 2.2 Input B — `runs.json` for every gold video, under prompt v5

**What it is:** one completed analysis run for every video in your gold set, produced by the current default prompt version (`evidence-first.web.v5`).

**Do this:** first export what the database already has —
```sh
DATABASE_URL="postgres://..." node --experimental-strip-types scripts/export-runs.ts --cases gold-cases.json --out runs.json
```
It prints one line per gold video: either the run it found, or `MISSING`. Then produce the missing ones by queueing each video through the running app, and re-export until nothing says `MISSING`. The exact commands are in `spec/phase-0-human-inputs.md`.

**Why:** the gold set is the answer key; these runs are the exam paper. Without both you cannot mark anything. This is also the only input that makes **cost per accepted claim** measurable, because the cost comes from the runs, not from the gold set.

**If you skip it:** identical to skipping A — all four checks stay advisory. A and B are only useful together.

### 2.3 Input C — frozen responses (`frozen-model.zip`)

**What it is:** one recorded provider response per pipeline stage, saved to `tests/fixtures/model/`, with all key material scrubbed out.

**Do this:**
```sh
node --env-file=.env --experimental-strip-types scripts/freeze-responses.ts \
  --url "https://www.youtube.com/watch?v=<videoId>" \
  --stages transcribe,synthesis,critique-0
```

**Two cautions, both of which cost money if ignored:**
- Run it with `DATABASE_URL` **unset**, so it uses a fresh local file. The script steps the oldest queued run in whatever database it can see, so pointed at the live database it would first spend money finishing somebody else's queued video.
- `--dry-run` is **not free**. It still runs the video through the paid pipeline; it only sends the output files somewhere temporary.

**Why:** with frozen responses, the whole evaluation can be replayed offline, in CI, with no keys and no spend. That is what lets an automated check catch a regression on every commit.

**If you skip it:** the evaluation can only ever be run by a person with live keys, which means in practice it is run rarely, and a regression is found late.

### 2.4 What happens when you send A, B and C

Send them as attachments in the chat. I then validate each file against its schema, place them in the branch, and run:

```sh
node --experimental-strip-types scripts/promotion-gate.ts --offline \
  --cases evaluations/gold-set/cases.json --runs runs.json \
  --out docs/gates/phase-0-live.json
```

and report the result against the thresholds. **Phase 0 is done** when the verdict is `pass` with no advisory checks — or when you have made and recorded a written decision about any check that fails. "Recorded" matters: a threshold that is quietly lowered is worse than one that is openly missed.

---

## Part 3 — Phase 1 input and gate

### 3.1 Input D — `runs.json` under prompt v7

**What it is:** the same export as input B, but with the runs produced under prompt version v7 instead of v5.

**Why:** phase 1 rebuilt the extraction pipeline — pointer-based evidence, batched critique, cached transcripts, low media resolution. Its gate claims two things: quality did not fall, and **cost per accepted claim fell by at least 40%**. Both are comparisons. v5 alone cannot prove either.

**If you skip it:** the phase-1 gate stays advisory. The 40% saving remains a design intention rather than a measured fact, and if it did not actually materialise you will find out from the monthly bill instead of from the gate.

### 3.2 Decide the phase-1 gate

When A–D are in, I run the gate and report. Your decision is one of three, in writing:
- **Pass** — the numbers meet the thresholds. Nothing to do.
- **Accept with a recorded reason** — a check misses but you judge it acceptable, and the reason is written into the gate artefact.
- **Fix first** — send it back.

**Why a person decides:** the thresholds encode a judgement about how wrong the product may be, which is a business decision, not a technical one.

---

## Part 4 — Phase 2: Neon and Vercel

This is the part with real consequences. Phase 2 moves the database from "whatever was there" to a properly migrated, Postgres-only, relational schema, and turns the every-minute cron into the real worker. Several of these steps must happen **before the code that needs them merges**, or every deployment breaks.

### 4.1 Link the Vercel project to GitHub, with `main` as production

**Do this:** in the Vercel project, **Settings → Git**. Connect `JoshuAI-888/leapedge-study`. Set the **Production Branch** to `main`.

**Why:** from phase 2 onward the migrations run inside the Vercel build. That only makes sense if Vercel knows which branch is production: the build for `main` must migrate the production database, and the build for any other branch must migrate a throwaway copy (step 4.2). If Vercel does not know which is which, it cannot tell them apart, and neither can the safety guard.

**If you skip it:** deployments have to be pushed by hand, which means the migration step is skipped or run manually, which is exactly the situation the design is trying to eliminate.

### 4.2 Enable the Neon integration, with one branch per preview

**Do this:**

1. In Vercel, go to the **Integrations** marketplace and add **Neon**.
2. Connect it to the existing Neon project (the one the workspace already uses) and to the `youtube-intelligence` Vercel project.
3. In the integration's settings, turn on **create a database branch for each preview deployment**. Neon names them `preview/<git-branch>` and deletes them when the git branch goes away.
4. Confirm in **Vercel → Settings → Environment Variables** that the integration has added both `DATABASE_URL` **and** `DATABASE_URL_UNPOOLED`.

**Why two variables, not one:** they are different doors into the same database and they can do different things.

| Variable | Which endpoint | Who uses it | Why it must be this one |
|---|---|---|---|
| `DATABASE_URL` | **Pooled** — the host contains `-pooler` | The website and the cron worker | Serverless functions come and go constantly. Without a pooler in front, they exhaust the database's connection limit |
| `DATABASE_URL_UNPOOLED` | **Direct** — no `-pooler` in the host | Migrations, the concurrency check, export and restore | Creating tables, taking a session-level lock, and setting session state are **all unavailable** through a pooled connection |

The pooled endpoint runs in "transaction mode", and the trap is that the forbidden operations **do not raise an error** — they succeed and are then silently discarded when the transaction ends. A migration run through the pooled endpoint can appear to work and leave the database untouched.

**Why one branch per preview:** a Neon branch is an instant, copy-on-write clone. Every preview deployment gets its own, migrates it, and throws it away. That is what makes it safe to test a schema change before it reaches production.

**If you skip it:**
- **No integration at all:** once F22a merges, every single deployment fails during the build, because there is no `DATABASE_URL_UNPOOLED` for the migration step to use. The last successful deployment keeps serving the site, so the symptom is "my changes never appear" rather than an outage. This is the reason F22a must not merge first.
- **Integration but no preview branches:** every preview build points at the production database and migrates it. A half-finished schema change on a feature branch lands in production, in the middle of the day, with no review.

### 4.3 Confirm the Neon region and record the Postgres version

**Do this:**

1. In the Neon console, open the project and read its **region**. It must be the same region as the Vercel functions: **`iad1`** — which Neon calls `AWS us-east-1`.
2. Connect to the database and run `SELECT version();`. Write down the major version.
3. Tell me both. Neither is a secret.

**Why the region:** one analysis makes many small database queries per stage. Every query pays the round trip twice. If the database is in one continent and the functions in another, that round trip grows from about a millisecond to over a hundred, and the per-video time inflates with it — so each 800-second invocation processes far fewer videos. This was flagged in an earlier planning document and never actually verified, which is why it is a step here rather than an assumption.

**Why the Postgres version:** the tests run against PGlite, an in-process Postgres. PGlite 0.5 is Postgres 17. The tests only prove that our SQL works in production if production is the same major version. If they differ, a passing test suite is weaker evidence than it appears.

**If you skip it:** a cross-region pairing looks like "the pipeline is slow" and gets misdiagnosed as a model problem for weeks. A version mismatch looks like nothing at all until one query behaves differently in production than in CI.

**If the region is wrong:** do not move it casually. Tell me, and we plan a migration — it means creating a project in the right region and moving the data, not flipping a setting.

### 4.4 Set `YTI_PRODUCTION_DB_HOST` in all three environments

**Do this:**

1. Find the value of the **production** `DATABASE_URL_UNPOOLED`. Take only the **host** out of it — the part between `@` and the next `/`. It will look like `ep-something-123456.us-east-1.aws.neon.tech`, with **no** `-pooler` in it.
2. In **Vercel → Settings → Environment Variables**, add `YTI_PRODUCTION_DB_HOST` with that host as its value, and tick **all three** environments: Production, Preview **and** Development.

**Why all three, including the ones that must never touch production:** because this variable is how the code *recognises* production. The migration script refuses to run when it sees that it is a preview deployment **and** the database it is about to migrate has this host. A preview that does not know production's host cannot tell that it is about to migrate it.

The guard is deliberately built to fail **loudly**: if the deployment is a preview and `YTI_PRODUCTION_DB_HOST` is not set at all, the migration refuses anyway. An unset guard is treated as a failure, not as permission.

**If you skip it:** preview builds fail at the migration step with a clear message — which is annoying but safe, and by design. The dangerous case is setting it in Production only: previews then have no guard, and the sole thing standing between a feature branch and the production schema is the preview branch from step 4.2 being configured correctly.

### 4.5 Set the remaining hosted variables

**Do this:** in **Vercel → Settings → Environment Variables**, set the following. Everything marked *secret* should be created with Vercel's "Sensitive" option so it cannot be read back out of the dashboard.

| Variable | Environments | Value | Why it exists | If it is missing or wrong |
|---|---|---|---|---|
| `CRON_SECRET` *(secret)* | Production | A random string of **at least 32 characters**. Generate with `openssl rand -base64 48` | The cron endpoint is a public URL. This is the only thing stopping anyone from triggering your paid pipeline | The route returns 401 to **every** request, including Vercel's own. Nothing is ever processed. The only visible symptom is the worker showing as offline. **A secret shorter than 32 characters is rejected outright** — the check is explicit |
| `YTI_ACCESS_TOKEN` *(secret)* | Production, Preview | A long random passphrase | The workspace passcode. This is a private research tool with no user accounts yet | The site is open to anyone with the URL |
| `YTI_APP_ORIGIN` | Production | The exact deployment URL, e.g. `https://youtube-intelligence-two.vercel.app` | Signed sessions and cross-origin checks compare against it | If it does not match the URL you actually visit **character for character**, sign-in appears to succeed and then immediately fails |
| `YTI_PREVIEW_READ_ONLY` | **Preview only** | `true` | The cron route checks this first and returns immediately | Preview deployments run the paid pipeline. Every open pull request quietly spends money on models |
| `YTI_POOL_MAX` | Production | `4` to start | How many database connections each function instance keeps | The default is used. Raise it only with evidence; too many connections across many instances exhausts the pooler |
| `YTI_QUEUE_PAUSED` | Production | Leave **unset** normally | An off switch for the worker, used during a type-changing migration (step 4.7) | Nothing, until you need step 4.7 and have no way to stop the queue |
| `YTI_HARD_BUDGET_USD_MONTH` | Production | Your real monthly ceiling | An absolute cap the settings screen cannot raise | A mistake in the user interface can raise spending without limit |
| `YTI_TRANSCRIPT_CREDIT_BUDGET` | Production | e.g. `90` | Cumulative caption-provider credits for this campaign. **Not** a rolling monthly reset | Caption credits are uncapped |
| `YTI_PUSH_CALLBACK_SECRET` *(secret)* | Production | A random string | Signs YouTube's push notifications. Only needed once push discovery is switched on (step 5.2) | The app reports it as missing when you enable push, and falls back to polling |
| Provider keys | Production, Preview | The same keys as your `.env` | As in the table in step 1.2 | As in that table |

**Why "Sensitive" for secrets:** a Vercel sensitive variable can be written and used by builds and functions, but never read back through the dashboard or the API. It removes a whole class of accidental disclosure. It also means **you** must keep your own copy somewhere safe — nobody can recover it for you.

**If you skip the whole step:** the deployment builds and serves pages, and processes nothing. That combination — a healthy-looking site with an idle worker — is the single most common way this system fails.

### 4.6 Run the Neon-branch concurrency check

This is a step only you can run, because it needs a real Neon database and I must not have your connection string.

**Do this:**

1. In the Neon console, create a **branch** from production and call it something like `check-2026-09-20`.
2. Copy that branch's **pooled** connection string — the host with `-pooler` in it. This is the configuration production actually uses.
3. Run:
   ```sh
   DATABASE_URL="<the pooled branch URL>" YTI_ISOLATED_DB=true \
     node --experimental-strip-types scripts/postgres-check.ts
   ```
4. Send me the output. It contains no secrets.
5. Delete the branch afterwards.

**Why a real branch and not the test suite:** PGlite, which the tests use, is single-connection. It can prove that the queue's **logic** is right and absolutely nothing about what happens when two workers reach for the same job at the same moment, or about how a pooled connection behaves. Those are precisely the failures that only appear in production.

The check asserts the awkward truths directly: that a second client's session-level lock request **succeeds** while the first client believes it holds the lock; that a temporary table created in one transaction is **gone** in the next; that a session setting does not persist. Note the shape of those assertions — the operations do not fail, they are silently ignored. That is why they must be tested rather than reasoned about.

It also asserts that jobs are handed to exactly one of several competing claimants, that the concurrency cap is never exceeded, and that the number and date types come back in the shapes the code expects.

**Why `YTI_ISOLATED_DB=true`:** the script refuses to run without it. It writes test rows, and that flag is you confirming this is not your real database.

**If you skip it:** phase 2 ships on the strength of tests that structurally cannot detect its main risks. The likely outcome is duplicate work and double provider charges under load — a failure that appears only when the system is busy, which is the worst time to debug it.

### 4.7 The production deploy sequence

**For an ordinary deployment** — new features, new tables, new indexes — you do nothing. Push to `main`, Vercel builds, the build migrates, the new version goes live. This is safe because the migrations are **additive**: they only add. The previous version of the code keeps running happily against a schema that has grown.

**For a deployment that changes the type of an existing column**, follow this sequence exactly. In phase 2 there is exactly one such migration, `0004`, which turns text timestamps into real timestamps, floating-point money into exact decimals, and text payloads into `jsonb`.

1. **Take a Neon branch** from production and name it for the migration, e.g. `pre-0004-2026-09-25`. This is your rollback. It is instant and costs almost nothing.
2. **Record the recovery window.** Note the point-in-time-recovery retention on your Neon plan. Do not assume a number.
3. **Set `YTI_QUEUE_PAUSED=true`** in Production and redeploy so it takes effect. The worker stops claiming new work.
4. **Wait for the queue to drain.** Check that no run is still in progress:
   ```sql
   SELECT count(*) FROM yi_runs WHERE status = 'running';
   ```
   Wait until it is `0`. A long video can take over ten minutes, so this wait is real.
5. **Deploy the migration.** The migration script itself refuses to apply `0004` while any run is `running`, so a mistake here fails safely rather than corrupting data.
6. **Unset `YTI_QUEUE_PAUSED`** and redeploy. The worker resumes.
7. **Check the health endpoint** and confirm the worker comes back online and jobs start completing.

**Why all this ceremony for one migration:** Vercel has no "release phase" — no moment where the old version is stopped, the migration is run, and the new version is started. The build migrates while the **previous** deployment is still serving requests. For an additive change that is fine. But if a column is being changed from text to a timestamp while the old code is part-way through writing text into it, that write fails in the middle of a video, leaving a half-finished run.

**If you skip it:** runs that happen to be in flight break in ways that are tedious to untangle, and — because money is already committed to those runs — the failure has a direct cost. The migration script's refusal will stop the worst of it, but only if the queue actually happens to be empty at that moment.

**To roll back code:** promote the previous deployment in the Vercel dashboard. This is immediate and does not touch data.

**To roll back data:** restore from the branch you took in step 1, into a **new** database. Check it. Then point the app at it. Never restore over the live database.

### 4.8 Review and sign off the phase-2 gate

When the code is done I run the gate and write `docs/gates/phase-2-<date>.json`. It covers: four videos processed end to end at the same time; a run killed at each dangerous moment and resumed without paying a provider twice; the channel seed producing a correctly deduplicated list; migrations that can be run twice with no effect; and the Neon-branch results from step 4.6.

**Your job:** read it and decide. Look for one thing in particular — the check that a run **killed between paying for a stage and recording that it moved on** does not pay again. That is the failure that costs money, and it is the reason the resume logic exists.

**Why a person signs off:** the gate reports facts. Whether those facts are good enough to put in front of users is a judgement.

---

## Part 5 — Phase 3

Phase 3 is split into two. **3a** is a thin vertical slice: the shell, the shared components, the trust ladder's first two levels, and a working Today and Analysis page over text-checked calls. **3b** is everything else. The split exists so you get a usable screen roughly ten items earlier and can tell me it is wrong while it is still cheap to change.

### 5.1 Record the phase-3a walk-through

**Do this:** when 3a is ready, open the module and walk through it while recording your screen. Say out loud what you expected and what you got. Send me the recording or your notes.

**Why this is a required gate item and not a nicety:** automated checks can prove that every column on Today maps to a defined metric and that the page renders from fixture data. They cannot tell whether the ranking is sensible, whether the trust badge means what you think it means, or whether the page answers the question you actually open it to ask. This is the only step in the whole plan that tests the product rather than the code.

One thing to know while you look at it: during 3a, Today is deliberately configured to show **text-checked** calls, a lower trust level than the design's default. That is because audio agreement does not exist until 3b. The 3b gate restores the stricter setting. So Today in 3a shows more, and less reliable, calls than Today in 3b will.

**If you skip it:** the remaining twelve items of phase 3b get built on top of a layout nobody has used, and a layout mistake is discovered when it is twelve items expensive rather than one.

### 5.2 Enable push notifications (during 3b)

**Do this:**

1. Set `YTI_PUSH_CALLBACK_SECRET` in Vercel Production to a fresh random string (step 4.5).
2. Once F39 has shipped, switch the channel discovery setting to `push` in Settings.
3. Confirm in the app that channels show as subscribed, and that a new upload appears without you doing anything.

**Why:** YouTube can tell us about a new upload the moment it happens, free, through a standard subscription protocol. The alternative is asking every channel every hour, which costs API quota and finds uploads up to an hour late. The secret is how the app verifies that an incoming notification really came from YouTube and not from someone who guessed the URL.

**If you skip it:** everything still works through the hourly polling fallback. New uploads appear later and use more quota. Nothing breaks. This is genuinely optional — which is why polling was kept.

### 5.3 Raise the budget for the historical replay (during 3b)

**Do this:** before the historical replay runs, work out roughly what it will cost — number of Tier-1 channels, times uploads since January 2026, times the measured per-video cost — and raise `YTI_BUDGET_USD` and your monthly ceiling deliberately to cover it. Then lower them again.

**Why:** the replay is the largest single piece of spending in the project. It exists to give the leaderboard a history on day one instead of waiting months for a forward record to accumulate.

**If you skip it:** the replay stops part-way through when it hits the budget, leaving a partial history. That is not harmful — the forward record is the one the design actually trusts — but a leaderboard with a lopsided backfill is misleading in a way an empty one is not.

### 5.4 Review and sign off the phase-3b gate

The 3b gate checks anchor accuracy on the gold set (at least 95% of audio-agreed anchors within two seconds), a push notification arriving and reaching Today end to end, that changing your benchmark writes nothing to the database, that the leaderboard's Changes tab matches a hand-computed diff, and that the main board queries have a sensible query plan against a realistically-sized database.

**Two things need your attention:**
- **Anchor accuracy needs input A.** Without the gold set this check stays advisory, like gates 0 and 1.
- **The query-plan check** is the one that decides whether the leaderboard stays fast as data accumulates, since those queries will dominate database time. A plan that scans a whole table is fine at a thousand rows and unusable at a million.

---

## Part 6 — Phase 4

### 6.1 Supply the `briefing-read-v1` contract file

**Do this:** find the **current** contract file that defines the `briefing-read-v1` item shape in Finradar, and send it to me. Current, not remembered: if it has changed, the version in my head is wrong.

**Why:** F51 makes this module emit an observation that appears inside a Finradar briefing. That is a shared interface between two systems. Building an adapter against a guessed shape produces something that passes its own tests and breaks the real briefing on first contact.

**If you skip it:** F51 does not get built. The plan says so explicitly. Everything else in phase 4 proceeds; only the Finradar hand-off waits.

### 6.2 Decide on the optional Exa key

**Do this:** decide whether to add `EXA_API_KEY`.

**Why:** the phase-4 context check answers "what else was happening around this claim, at the time?" It always uses FMP news, filings and prices, all of which can be date-bounded properly. Exa adds date-bounded web search on top.

**If you skip it:** the context check works with fewer sources. This is a deliberate design choice, not a compromise: the OpenRouter web plugin and Google Search grounding were both **rejected** for this job because neither can be bounded to a publication date, and an undated source is worse than no source — it lets hindsight leak into a claim about what was knowable at the time.

### 6.3 Review and sign off the phase-4 gate

The gate checks that a sample of fifty context checks cites **only** sources inside its window, that a Finradar edition renders the observation with working evidence links, and that a cross-video question comes back with cited spans.

**The one to read carefully** is the first. "All fifty inside the window" is the whole basis of the claim that this tool shows what was knowable at the time rather than what turned out to be true. One leaked source undermines the feature.

---

## Part 7 — Ongoing operations

### 7.1 Monthly

| Check | How | Why |
|---|---|---|
| Model spend against budget | The budget meter in the app; the provider dashboards | The app's ledger is its own accounting. The provider's bill is the authority. They should agree; if they drift, tell me |
| Caption provider credits | The same meter, plus the provider's dashboard | The credit budget is cumulative for the campaign, **not** a monthly reset. It will run out eventually and needs raising deliberately |
| Neon storage and compute | Neon console | Storage grows with every transcript, span and settlement row. This is **not** in the model budget, and the cost metric says so |
| Take an export | See 7.2 | Neon's own recovery window is limited and plan-dependent |

**A thing worth understanding about the Neon bill:** a database queried every minute never goes idle, so it never scales down. Neon compute is therefore a **fixed monthly line**, not an occasional burst. Read it that way when you look at the invoice, or the first month will look like a mistake.

### 7.2 Backup and restore

```sh
# Back up:
node --env-file=.env --experimental-strip-types scripts/export-research.ts

# Restore — into an empty, isolated database only:
node --experimental-strip-types scripts/restore-research.ts PATH_TO_BACKUP.json
```

Exports carry a SHA-256 integrity hash and every table row. The restore script refuses a non-empty destination and verifies row counts inside a transaction.

**Two things to know:**
- **Keep exports private.** They contain research, raw provider responses and share snapshots.
- **The old `scripts/backup.ts` is gone.** It only ever worked with the local file database and is deleted in F23, along with the SQLite migration script. If you have a note anywhere that says "run backup.ts", that note is wrong. The Postgres path is export plus restore, with a Neon branch as the pre-migration snapshot.

**For a migration, prefer a Neon branch** over an export: it is instant, copy-on-write, and restores to a known moment.

### 7.3 When something looks wrong

| Symptom | Most likely cause | Where to look |
|---|---|---|
| Site fine, nothing ever processed | `CRON_SECRET` unset or shorter than 32 characters, so every cron call is rejected | Vercel → Settings → Cron Jobs, then the function logs |
| Site fine, nothing processed, cron shows one run a day | Team is on a Hobby plan, so the per-minute schedule was silently downgraded | Vercel plan (step 1.3) |
| Videos start and never finish | Fluid Compute off, so invocations are killed early and restart for ever | Vercel → Settings → Functions |
| "My changes never appear" | The build is failing. Most often `DATABASE_URL_UNPOOLED` missing, so the migration step cannot run | Vercel deployment build logs |
| A deployment errors with a schema version message | The code expects a newer schema than the database has. The migration did not run | Build logs. **Never** fix this by hand-editing the database |
| Everything slow, no obvious cause | The Neon project is in a different region from the functions | Step 4.3 |
| Preview deployments spending money | `YTI_PREVIEW_READ_ONLY` not set on Preview | Vercel environment variables |
| Sign-in succeeds then immediately fails | `YTI_APP_ORIGIN` does not match the URL you are visiting exactly | Vercel environment variables |

**A general rule:** when a deployment fails, read the **build** log before the function log. From phase 2 onward, the migration runs in the build, so schema problems surface there — and they surface as a refusal to start, which is intentional. The app is built to fail loudly on a schema it does not recognise rather than quietly create tables for itself, because a function that repairs its own schema is a function that can invent a different one on every cold start.

---

## Part 8 — Checklists

**Before any phase-2 code merges**
- [ ] Vercel plan is Pro or above, and recorded with today's date
- [ ] Fluid Compute is on
- [ ] Vercel project linked to GitHub, production branch `main`
- [ ] Neon integration added, with a branch per preview deployment
- [ ] `DATABASE_URL` and `DATABASE_URL_UNPOOLED` both present in Vercel
- [ ] `YTI_PRODUCTION_DB_HOST` set in Production **and** Preview **and** Development
- [ ] Neon region confirmed as `iad1`, Postgres major version recorded
- [ ] `CRON_SECRET` set, at least 32 characters
- [ ] `YTI_PREVIEW_READ_ONLY=true` on Preview only
- [ ] `YTI_ACCESS_TOKEN`, `YTI_APP_ORIGIN`, provider keys, budget ceilings all set

**Before the phase-2 gate**
- [ ] `postgres-check.ts` run against a Neon branch through the **pooled** endpoint, output sent to me
- [ ] Check branch deleted afterwards

**Before any migration that changes an existing column's type**
- [ ] Neon branch taken and named for the migration
- [ ] Recovery window recorded
- [ ] `YTI_QUEUE_PAUSED=true` deployed
- [ ] `SELECT count(*) FROM yi_runs WHERE status = 'running'` returns 0
- [ ] Migration deployed
- [ ] `YTI_QUEUE_PAUSED` unset and redeployed
- [ ] Worker back online, jobs completing

**Any time, to make the gates binding**
- [ ] A — `gold-cases.json`, validator clean, 50 verified, 20+ English, 15+ Chinese, 10+ with no calls
- [ ] B — `runs.json` under v5, no `MISSING`
- [ ] C — `frozen-model.zip`, no key material inside
- [ ] D — `runs.json` under v7
- [ ] Budget variables lowered again afterwards

**Phase 3**
- [ ] 3a walk-through recorded and sent
- [ ] `YTI_PUSH_CALLBACK_SECRET` set, push discovery enabled, a new upload arrives by itself
- [ ] Budget raised deliberately before the historical replay, lowered after
- [ ] 3b gate read and signed off

**Phase 4**
- [ ] Current `briefing-read-v1` contract file sent
- [ ] Exa key decided either way
- [ ] Phase-4 gate read and signed off, with the source-window check read carefully
