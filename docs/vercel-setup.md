# Getting Vercel working

The short version of `deploy.md` Parts 1 and 4: ten steps, about an hour, most of it
waiting. Do them **in order** — several depend on the one before.

Terms, once:

- **Vercel** hosts the website and runs the scheduled job that does the analysis.
- **Neon** is the Postgres database. It lives separately from Vercel; the two are
  joined by an integration you switch on in step 4.
- **Environment variable** is a named secret or setting you type into Vercel's
  dashboard. The code reads them by name. Nothing is in the repository.
- **Production / Preview** are Vercel's two worlds. Production is the real site
  on `main`. Preview is a throwaway copy built for every other branch.

---

## 1. Create the Vercel account and put it on Pro

Sign up at vercel.com. Open **Settings → Billing** for the team and upgrade to
**Pro** (about US$20/month).

**Why:** the whole design rests on a job that runs **every minute**. The free
Hobby plan silently caps cron jobs at roughly **once a day** — it does not warn
you, it just quietly changes your schedule. The site would work, the database
would work, and about one video a day would be analysed instead of hundreds.

---

## 2. Import the repository

**Add New → Project → Import Git Repository →** `JoshuAI-888/leapedge-study`.
Accept the defaults and let the first deploy run. It will succeed and the site
will not work yet — that is expected; it has no database.

Then **Settings → Git** and set **Production Branch** to `main`.

**Why:** from phase 2 onward the database migration runs inside the build.
Vercel has to know which branch is the real one, so the `main` build migrates the
real database and every other build migrates a throwaway copy.

---

## 3. Turn on Fluid Compute

**Settings → Functions → Fluid Compute → Enable.**

**Why:** one analysis can take over thirteen minutes. The code asks for an
800-second ceiling, and only Fluid Compute allows it. Without it every
invocation is killed part-way through a video. Nothing is charged twice — the
resume logic handles that — but each video is started, killed, restarted, and
never finishes, while the model bill keeps growing.

---

## 4. Connect Neon

1. **Integrations → Browse Marketplace → Neon → Add Integration.**
2. Connect it to your Neon project and to this Vercel project.
3. In the integration settings, turn **on** *create a database branch for each
   preview deployment*.
4. Go to **Settings → Environment Variables** and confirm two new entries
   appeared: **`DATABASE_URL`** and **`DATABASE_URL_UNPOOLED`**.

**Why two URLs for one database.** They are two doors into the same data:

| | Host contains | Used by | Because |
|---|---|---|---|
| `DATABASE_URL` | `-pooler` | the website, the worker | serverless functions start and stop constantly; without a pooler they exhaust the connection limit |
| `DATABASE_URL_UNPOOLED` | no `-pooler` | migrations, backups, checks | creating tables and taking locks **do not work** through the pooler |

**The trap worth knowing:** through the pooled URL, the forbidden operations do
not raise an error. They appear to succeed and are then thrown away. A migration
run down the wrong URL can look perfect and change nothing.

**Why per-preview branches:** a Neon branch is an instant copy of the database.
Each preview gets its own, migrates it, and deletes it. Without this, every
preview build migrates **production** — a half-finished schema change from
somebody's branch, landing in the live database, unreviewed.

---

## 5. Check the Neon region

In the Neon console, read the project's **region**. It must be
**`AWS us-east-1`** (Vercel calls it `iad1`).

**Why:** one analysis makes hundreds of small database queries. Same region, a
round trip is about a millisecond; different continents, over a hundred. That
multiplies out into far fewer videos per run.

**If it is wrong, tell me — do not move it.** It means creating a new project and
copying the data, not flipping a setting.

While you are there, run `SELECT version();` and send me the major version.
Neither of these is a secret.

---

## 6. Record production's database host

1. Open the **production** `DATABASE_URL_UNPOOLED` and copy only the **host** —
   the part between `@` and the next `/`. It looks like
   `ep-something-123456.us-east-1.aws.neon.tech` and has **no** `-pooler` in it.
2. Add an environment variable `YTI_PRODUCTION_DB_HOST` with that host, ticked
   for **all three** environments: Production, Preview *and* Development.

**Why all three, including the ones that must never touch production:** this is
how the code *recognises* production. A preview build checks "is the database I
am about to migrate the production one?" — and a preview that has never been
told production's host cannot answer. Unset is treated as failure, not
permission: the migration refuses rather than guesses.

---

## 7. Add the provider keys

**Settings → Environment Variables.** Tick **Production and Preview** for each.
Use Vercel's **Sensitive** option, which lets builds read a value but stops
anyone reading it back out of the dashboard — including you, so keep your own
copy.

| Key | From | Without it |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | nothing runs at all |
| `OPENROUTER_API_KEY` | openrouter.ai | no second model checks any claim |
| `YOUTUBE_API_KEY` | Google Cloud → YouTube Data API v3 | no analysis can start |
| `TRANSCRIPTAPI_API_KEY` | transcriptapi.com | every video falls through to paid audio — roughly 20× the cost |
| `FMP_API_KEY` | financialmodelingprep.com | no settlement, no leaderboard |

---

## 8. Add the settings that stop it costing you money

Production only, unless the table says otherwise.

| Variable | Value | What it does |
|---|---|---|
| `CRON_SECRET` | `openssl rand -base64 48` | the worker's URL is public; this is the only thing stopping a stranger from running your paid pipeline. **Must be 32+ characters** — shorter is rejected |
| `YTI_ACCESS_TOKEN` | a long passphrase (Production + Preview) | the site passcode. There are no user accounts yet |
| `YTI_APP_ORIGIN` | your exact site URL | sign-in compares against it **character for character** |
| `YTI_PREVIEW_READ_ONLY` | `true` — **Preview only** | stops preview deployments spending real money. Without it every open pull request quietly runs the paid pipeline |
| `YTI_HARD_BUDGET_USD_MONTH` | your real ceiling | a cap the settings screen cannot raise |
| `YTI_TRANSCRIPT_CREDIT_BUDGET` | e.g. `90` | caption credits for the whole campaign, not per month |
| `YTI_POOL_MAX` | `4` | database connections per instance. Raise only with evidence |
| `YTI_QUEUE_PAUSED` | leave **unset** | the worker's off switch, for type-changing migrations only |

---

## 9. Redeploy and check three things

**Deployments → ⋯ → Redeploy** on the latest one, so it picks up everything above.

1. **Settings → Cron Jobs** — one job for `/api/cron/intelligence`, schedule
   `* * * * *`, with a recent last run.
2. Visit `/api/intelligence/status` — it reports health and lists any hosted
   variable still unset, **by name, never by value**.
3. Confirm the worker shows as online.

**The failure to watch for** is a site that loads perfectly and processes
nothing. That is what a missing `CRON_SECRET` looks like, and it is the most
common way this setup goes wrong.

---

## 10. Send me two things

- The Postgres major version from step 5.
- The output of the concurrency check below.

```sh
# In the Neon console, create a branch from production.
# Copy that branch's POOLED connection string (the host WITH -pooler).
DATABASE_URL="<the pooled branch URL>" YTI_ISOLATED_DB=true \
  node --experimental-strip-types scripts/postgres-check.ts
# Delete the branch afterwards.
```

**Why I cannot run this:** it needs a real database, and I must not have your
connection string. **Why it matters:** the test suite runs on an in-process
database that allows only one connection at a time. It can prove the queue's
logic and nothing whatever about two workers reaching for the same job at the
same moment — which is exactly the failure that costs money, and only appears
when the system is busy.

`YTI_ISOLATED_DB=true` is you confirming this is a throwaway branch; the script
refuses to run without it. The output contains no secrets.

---

## Timing

Steps 1–8 must be done **before the phase-2 code merges**. That code moves the
database migration into the build, so from then on a deployment with no
`DATABASE_URL_UNPOOLED` fails at build time — and because the last good
deployment keeps serving, the symptom is "my changes never appear" rather than
an outage.
