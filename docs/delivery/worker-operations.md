# Standalone worker operations

The web app serves UI/API and dispatches jobs. `scripts/worker.ts` executes them from Postgres. The current user-approved host is this Mac. Three login services are installed and running from `~/Library/Application Support/YouTube Intelligence`; the worker is deliberately paused during acceptance. Keep the Mac awake and connected for continuous work. Sleep or shutdown interrupts processing; this is not unattended hosted uptime.

## Prepare one environment

Use Node 24 and a persistent Postgres database dedicated to this standalone app. The temporary `yti_queue` test database is disposable verification infrastructure, not the application database. Run `npm ci` and `npm run migrate` once from the repository before starting serving processes. `DATABASE_URL_UNPOOLED` is the direct migration endpoint; `DATABASE_URL` is the runtime endpoint. Both may point to the same local Postgres database. Runtime code checks the schema version and does not migrate automatically.

Keep secrets in the ignored `.env`, with restrictive file permissions, or in a host secret store. Do not put secrets in a committed plist, logs or screenshots. The worker's Node `--env-file=.env` reads that file at process startup; editing it does not alter a running process.

Required configuration depends on the work queued:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Runtime/migration Postgres endpoints |
| `GEMINI_API_KEY` | Native immediate and Batch API stages |
| `OPENROUTER_API_KEY` | Independent critic, or enabled fallback |
| `YOUTUBE_API_KEY`, `TRANSCRIPTAPI_API_KEY` | Metadata and captions |
| `SUPADATA_API_KEY` | Optional bounded tie-break ASR |
| `FMP_API_KEY` | Live prices where explicitly requested |
| `YTI_BUDGET_USD` | Cumulative ledger ceiling; default US$2 |
| `YTI_HARD_BUDGET_USD_MONTH` | Hard team monthly cap |
| `YTI_TRANSCRIPT_CREDIT_BUDGET` | Caption-provider request credit ceiling |
| `YTI_QUEUE_PAUSED` | `true` prevents new claims and scheduler dispatch; active stages drain |
| `YTI_POOL_MAX` | Connection pool size, normally at least the desired worker concurrency |
| `YTI_APP_ORIGIN`, `YTI_PUSH_CALLBACK_SECRET` | Reachable HTTPS callback origin and 32+ character push signing secret |

Team settings control `processing.parallelVideos` (default four), per-video caps, model routes and manual/channel processing modes. The task authorization is **at most US$25 total APIs and 20 LeapEdge analyses**. Ledger caps are useful controls but do not measure every external credit purchase; track transcript/ASR charges and LeapEdge analyses separately. Do not treat a monthly application allowance as extra task authorization. Initial verification uses fixtures and spends nothing on providers.

## Run on this Mac

From the repository, `npm run worker` runs in the foreground and loads `.env`. `npm run worker -- --once` executes one concurrent wave, including its scheduler sweep; this can call live services when keys and eligible work are present. Use test commands instead for fixture-only verification.

The worker creates `data/worker.pid`. SIGINT or SIGTERM stops admitting work, waits for active stages and closes the database. A `data/worker.stop` file also requests a drain and is removed when the worker exits. Do not launch two instances into the same directory when relying on this convenience PID/stop file. Database capacity and fencing still coordinate multiple worker processes, but the single PID file is not a process supervisor.

For a future login service, save a reviewed template as `~/Library/LaunchAgents/com.yti.worker.plist`. Confirm the absolute Node path with `command -v node`; this machine currently has Node 24 at `/usr/local/bin/node`. Create the repository's `data` directory first.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.yti.worker</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>--env-file=.env</string>
    <string>--experimental-strip-types</string>
    <string>scripts/worker.ts</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/joshmini/Documents/ChatGPT/Finradar Enhancements/leapedge-study</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ExitTimeOut</key><integer>900</integer>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>/Users/joshmini/Documents/ChatGPT/Finradar Enhancements/leapedge-study/data/worker.log</string>
  <key>StandardErrorPath</key><string>/Users/joshmini/Documents/ChatGPT/Finradar Enhancements/leapedge-study/data/worker-error.log</string>
</dict></plist>
```

After separately choosing to install it, validate with `plutil -lint`, then use `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yti.worker.plist`. Inspect with `launchctl print gui/$(id -u)/com.yti.worker`. Stop the supervisor with `launchctl bootout gui/$(id -u)/com.yti.worker` before maintenance. A keep-alive service restarts an exited worker; creating `worker.stop` alone does not permanently stop that service. Plan log rotation; the template does not rotate files.

## Pause, deploy, restart and recover

1. Stop admission by draining/stopping the worker supervisor. Allow up to the current provider deadline for active work to finish. Set `YTI_QUEUE_PAUSED=true` in every worker/dispatcher environment before maintenance. Restarted paused workers heartbeat but do not claim work.
2. Confirm there are no active unexpired `jobs` leases before schema-changing maintenance. Back up the application database, run migrations through the direct endpoint, and deploy matching code.
3. Set `YTI_QUEUE_PAUSED=false` and restart the worker. Existing open runs are dispatched idempotently. Jobs claim with `FOR UPDATE SKIP LOCKED`; capacity admission is serialized briefly and the database transaction closes before provider work.
4. A running job renews its ten-minute lease every minute. After an ungraceful kill, the replacement waits for lease expiry. The old token cannot checkpoint or finish a re-claimed job. Do not reset lease tokens or reservations manually just to make a stalled job run sooner.
5. Each completed stage saves the run and releases/requeues the job in one transaction. A provider response retained before a crash is replayed at the same stage without a second reservation or provider call. Replay checks a fingerprint of the source, prompt, payload and model configuration. Changed requests receive distinct paid responses; historical rows without a replayable normalized response and fingerprint stop for review. A provider call interrupted before its response was retained may have billed; it is not evidence of zero spend.
6. Native batch stages submit once, retain the resource name and poll every minute for up to 48 hours. The analyze job remains queued between polls. Only a response carrying the matching request key can settle the stage. A completed result missing token usage conservatively settles the reserved estimate and labels it estimated. A definitive failed request releases its hold. Cancellation, missing output, ambiguous submission or an exceeded polling window preserves uncertain spend and requires operator reconciliation. Generic synchronous-call reconciliation never releases these batch holds. Search the provider console by the stored `yti-<request key>` display name before deciding how to recover; do not blindly resubmit.

Health uses the `yi_heartbeat` timestamp; inspect jobs, run status/error, attempt metrics and provider job IDs together. Logs deliberately avoid keys and source payloads. Worker health is not evidence of provider availability. Push discovery requires an independently reachable HTTPS callback; a local-only web server cannot receive YouTube hub delivery.

## Hosted worker later

Use an always-on Node 24 process/container with the same code revision, durable Postgres, secret environment, outbound provider access, a restart policy and a shutdown grace period of at least 15 minutes. Start `node --experimental-strip-types scripts/worker.ts` when secrets are injected directly, or the `.env` variant above when a protected file is provisioned. Set the repository as working directory and make `data` writable. Limit replicas and pool size against the database connection budget; the queue's database capacity cap still applies across replicas. Vercel remains the web/API host and cron dispatches only; do not move provider execution back into a long cron request.

Before switching hosts, pause and drain this Mac, migrate if required, start the hosted worker, verify its heartbeat plus one bounded fixture/live job, and then retire the local service. Preserve one application database and task spend accounting during the cutover. No hosting subscription or production deployment is created by this document.

## Reproducible evidence

`tests/queue.test.ts`, `tests/resume.test.ts`, `tests/batch.test.ts`, `tests/push.test.ts` and `tests/replay.test.ts` use fixture providers/PGlite. `tests/e2e-parallel.test.ts` additionally supports `YTI_QUEUE_REAL_PG=true` and requires `YTI_ISOLATED_DB=true`, a localhost `DATABASE_URL` whose database is exactly `yti_queue`, and its migrations already applied. It truncates only that dedicated fixture database. It proves four concurrent fixture stages through separate PostgreSQL connections and SIGKILL/restart replay with a single charged attempt; it does not demonstrate live-provider quality or hosted uptime.

## This Mac's installed standalone runtime

The build prepared an independent cluster at `data/postgres`, bound only to
`127.0.0.1:57484`, with database `yti_live`. The ignored `.env.live` selects only
provider keys and these local database endpoints; it does not copy a production
connection string. Browser fixtures remain in the separate `yti_browser`
cluster on port 57483.

`scripts/install-mac-services.ts` defaults to preparing and validating three
credential-free plist files in `data/worker/services`. After a production build,
its explicit `--install` mode installs login services for this database, worker,
and the loopback web app on port 3019. The labels are
`com.joshuai.yti.postgres`, `com.joshuai.yti.worker`, and `com.joshuai.yti.web`.
Stop any foreground instance of the same cluster before bootstrapping it.
Installation is separately recorded in the final conformance evidence; merely
preparing these files does not start an always-on service.

The initial local profile is paused and capped at US$24 of model spend plus at
most 25 credits per caption provider (50 combined), conservatively allocated US$0.02 each. Generated
transcription is disabled. These are task controls, not extra authorization
beyond the combined US$25 cap. The one-video pilot temporarily narrows credits
to three and records its accounting under ignored `data/live-verification`.
No automatic processing selection is installed in the live database.


### Verified installation, 20 September 2026 (NZST)

The Documents workspace could not be used reliably by launchd. The installed
runtime is `/Users/joshmini/Library/Application Support/YouTube Intelligence`.
It includes `src`, `scripts`, `evaluations` (a worker import dependency),
`node_modules`, `package.json`, `package-lock.json`, `tsconfig.json`, the verified
`.next` build, and protected `.env.live`. Its `data/postgres` is the active
cluster on port 57484. The original repository cluster is a stopped pre-cutover
copy: **never start it alongside or instead of the active cluster**.

All three labels above are running; the worker heartbeat was verified fresh
with `YTI_QUEUE_PAUSED=true`. The loopback API at
`http://127.0.0.1:3019/api/intelligence/status` returned HTTP 200. PostgreSQL
requires an explicit `LC_ALL=C` in the launchd environment on this Mac; the
installer now includes it. The installed PostgreSQL plist has this value.

For updates, pause/drain the services, build and verify the repository, copy the
runtime code plus `evaluations` and `.next` into this directory, and restart the
worker/web services. Do not overwrite the active database from the repository's
stale copy. Keep runtime `.env.live` protected and update it separately from
source. Use the runtime's installer script when installing afresh so its
calculated working directory points to Application Support. This is a login
service: it needs this user logged in and the Mac awake/network-connected.

To allow jobs after acceptance, set `YTI_QUEUE_PAUSED=false` in the runtime's
`.env.live` and restart its worker. This has not been enabled by the build.
The repo's `.env` remains fixture-only; its `.env.live` connects to the same live
localhost cluster for controlled operational commands.
