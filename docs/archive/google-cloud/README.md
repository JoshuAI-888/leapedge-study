> CANCELLED PREPARATION: the user selected Vercel + Neon + Vercel Workflows on27September2026. Do not deploy these Google Cloud commands or act on old approvals. Retained only for provenance; see `docs/handoffs/2026-09-27-claude-handoff.md`.

# Google Cloud packaging and release checklist

This is the cloud-only production target. It supersedes the historical Mac/Vercel
hosting instructions. Packaging is not deployment or acceptance evidence. The
current research pipeline remains the default; this release does not promote the
experimental audit path. No new runtime package dependency is introduced.

## Components and limits

- Cloud Run service: the existing Next.js portal and API, listening on `0.0.0.0:$PORT`.
- Cloud Run Job: bounded worker using the same durable Postgres queue, admission
  cap, lease fencing, paid-response ledger and checkpoint recovery as today.
- Cloud SQL PostgreSQL in the same region: shared durable application database.
- Secret Manager: numbered secret versions injected at runtime; no keys in image,
  build arguments or config JSON. Separate web, worker and migration identities.
- Artifact Registry: immutable image digest used for every component of a release.

The worker stops admitting after 45 minutes and normally drains before the
60-minute task deadline. It exits after about 12 idle seconds per worker slot.
Cloud Run can terminate a task with only a 10-second SIGTERM grace period;
**normal drain is not a guarantee on infrastructure interruption**. Lease expiry,
retained responses and unknown-outcome reservations remain authoritative. Never
clear paid holds or force a lease reset to accelerate a retry. Job-level retries
are zero until cloud restart/reconciliation acceptance passes; durable queue retry
rules still operate. The job does not erase failed application outcomes merely
because its container exits successfully.

Cloud Run Jobs are not an automatic queue listener. Initially launch the worker
explicitly for acceptance. For continuous processing configure authenticated Cloud
Scheduler invocation every minute, and enable the implemented authenticated on-enqueue job
launcher after its IAM permissions and recovery path pass acceptance. Scheduler-only launch adds up to a minute of
queue latency; it is not an acceptable claim of immediate responsiveness. Repeated
job executions can overlap; Postgres global admission limits remain binding, but
connection/idle resource usage still grows. Before scale acceptance verify the bounded
launcher and 100-video burst behaviour. `parallelism=1` limits tasks within
one execution, not the number of overlapping executions.

## Operator preparation

1. Choose the billing project and a region supporting the required Cloud Run and
   Cloud SQL services. Check the deployment account's IAM access. Price the chosen
   database tier, backup/HA, minimum instances, egress and logging retention before
   provisioning; these files deliberately do not create a project, billing account,
   database, IAM policy or subscription.
2. Enable the required Cloud Run, Artifact Registry, Cloud Build, Cloud SQL Admin,
   Secret Manager and (if used) Scheduler APIs. Create the registry and database.
   Enable automated backups and point-in-time recovery; prove a restore before
   production cutover. Keep the database and services in the same region.
3. Create separate runtime service accounts. Grant `roles/cloudsql.client` and
   secret access only to the specific secrets each component needs. The migration
   account needs migration database privileges; runtime accounts should not.
   Grant the deployment/build identities only their documented resource-scoped
   permissions. Do not grant project Owner to a runtime identity.
4. Create pinned Secret Manager versions. Runtime needs `DATABASE_URL`; migration
   needs both it and `DATABASE_URL_UNPOOLED` pointed at the direct endpoint.
   Existing provider environment names remain unchanged. Web needs a strong
   `YTI_ACCESS_TOKEN` (at least 32 characters) and an HTTPS `YTI_APP_ORIGIN`.
   Use the Cloud SQL attachment's Unix socket; for the existing pg URL interface,
   a reviewed connection string can use a placeholder hostname `cloudsql` and an
   encoded `host=/cloudsql/PROJECT:REGION:INSTANCE` query parameter. Percent-encode
   username/password and socket path, and verify this through the migration job.
   Do not enable SSL inside an already protected Unix socket connection by copying
   a remote TCP URL's `sslmode` blindly. No public database authorized network is
   needed for the Cloud SQL Auth Proxy attachment. Do not log connection strings.
5. Verify the effective workspace settings and pause queue admission before moving
   data. Inventory and preserve runs, normalized evidence/transcripts, briefs,
   searches, raw responses, attempts, reservations, notes and settings. Import all
   required records into the one shared cloud database; compare counts, hashes and
   aggregate costs. The migration job only applies schema—it does **not** perform
   this data transfer. Preserve a restorable source backup.

## Build and deployment

Run full repository verification first. Build the Linux image using Cloud Build
or a Linux Docker builder from the repo root:

```sh
gcloud builds submit --project=PROJECT --region=REGION --tag=REGION-docker.pkg.dev/PROJECT/REPOSITORY/yti:RELEASE .
```

Both `.gcloudignore` and `.dockerignore` are allowlists: `.env*`, local data,
Git internals and the user-owned `ResearchBrief (1).tsx` are excluded. Inspect
Cloud Build's source manifest before upload. No Docker daemon is needed on the
user's Mac. Record the resulting image digest and build provenance; deployment
uses the digest, not this movable build tag.

Create a private reviewed config JSON **outside the build context** with these
fields (values below are metadata placeholders, not usable credentials):

```json
{
  "project": "YOUR-PROJECT",
  "region": "YOUR-REGION",
  "image": "REGION-docker.pkg.dev/PROJECT/REPOSITORY/yti@sha256:DIGEST",
  "webService": "yti-web",
  "workerJob": "yti-worker",
  "migrationJob": "yti-migrate",
  "webServiceAccount": "yti-web@PROJECT.iam.gserviceaccount.com",
  "workerServiceAccount": "yti-worker@PROJECT.iam.gserviceaccount.com",
  "migrationServiceAccount": "yti-migrate@PROJECT.iam.gserviceaccount.com",
  "cloudSqlInstance": "PROJECT:REGION:INSTANCE",
  "origin": "https://YOUR-HOST",
  "budgetUsd": 100,
  "monthlyBudgetUsd": 500,
  "transcriptCredits": 100,
  "webIapEnabled": false,
  "wakeEnabled": false,
  "webSecrets": {"DATABASE_URL": "yti-runtime-db:1", "YTI_ACCESS_TOKEN": "yti-access:1"},
  "workerSecrets": {"DATABASE_URL": "yti-runtime-db:1", "GEMINI_API_KEY": "yti-gemini:1", "OPENROUTER_API_KEY": "yti-openrouter:1", "YOUTUBE_API_KEY": "yti-youtube:1", "TRANSCRIPTAPI_API_KEY": "yti-transcript:1", "EXA_API_KEY": "yti-exa:1"},
  "migrationSecrets": {"DATABASE_URL": "yti-migration-db:1", "DATABASE_URL_UNPOOLED": "yti-migration-db:1"}
}
```

Budget numbers are example guardrails, not spending authorization or cost
estimates; set reviewed values suitable for the planned bounded acceptance.
Include additional provider/push secrets only for enabled features. Some portal
features request metadata or provider previews directly and need the corresponding
web-scoped key; validate those flows rather than blindly copying every worker key.

Generate the reviewable commands without making any cloud changes:

```sh
node --experimental-strip-types deploy/cloud/plan.ts /PRIVATE/reviewed-config.json
```

The JSON result contains `gcloud` argument arrays for private web, worker job and
migration job definitions. Execute the reviewed arrays through a process API or
copy their arguments as separately quoted shell arguments; do not concatenate
untrusted values into a shell command. These commands keep `YTI_QUEUE_PAUSED=true`
and do not execute jobs. Run schema migration explicitly after backup verification:

```sh
gcloud run jobs execute yti-migrate --project=PROJECT --region=REGION --wait
```

Keep web IAM-private for initial acceptance. Browser access requires an approved
IAM/IAP access arrangement; simply visiting a private `run.app` URL is not proof
of application availability. If ordinary browser access is required, separately
configure the approved access route and verify the app's `/access` authentication
before changing unauthenticated invocation. Never expose the service with missing
origin/access configuration: container startup rejects that state.

After configuration/data checks, unpause the worker and web explicitly, launch a
bounded job, and inspect result and ledger:

```sh
gcloud run jobs update yti-worker --project=PROJECT --region=REGION --update-env-vars=YTI_QUEUE_PAUSED=false
gcloud run services update yti-web --project=PROJECT --region=REGION --update-env-vars=YTI_QUEUE_PAUSED=false
gcloud run jobs execute yti-worker --project=PROJECT --region=REGION --wait
```

Do not enable scheduled automatic discovery or open-ended channel processing as a
side effect of acceptance. Review existing persisted settings and job backlog.

## Portal identity, callbacks and queue wakeups

Prefer direct Cloud Run IAP for the portal, using `webIapEnabled=true` after the
IAP service agent has Cloud Run Invoker and approved users have IAP access. Direct
IAP protects the `run.app` endpoint without a load balancer. The existing app
`/access` session is retained; it uses a strong shared secret, exact origin checks,
timing-safe comparison and a Secure/HttpOnly/SameSite-Strict cookie. It is not a
replacement for individual identity/revocation. Google IAP authentication and app
access must both pass browser acceptance; do not merely grant allUsers invoker.

IAP also intercepts callback paths before application routing. YouTube WebSub and
external email callbacks therefore need a separate narrowly routed public ingress
that retains their existing signature/token verification. **Those callback
features are not cloud accepted by the portal deployment.** No public callback
service is created by this packaging.

The coordinator's post-commit enqueue hook calls `requestCloudWorkerWake()`. With
`wakeEnabled=true`, the web service account needs permission to list executions
and run only the designated worker job. The helper obtains a short-lived metadata
credential, takes a 60-second database lease, and checks up to ten pages of job
executions before launching. It has a 12-second overall HTTP deadline and records
unknown launches without blindly repeating POST. Tokens are never stored. Existing
unfinished executions suppress another launch; excessive/incomplete history is a
recorded failure, not a false running status. Worker containers cannot recursively
launch themselves. Failure leaves the analysis durably queued.

Enqueue is only a wake hint: a worker can begin idle shutdown just as a new enqueue
arrives. Scheduled recovery is mandatory. A direct scheduled Job execution can
overlap an existing job, so retain global Postgres admission and measure this
behaviour. Do not claim exactly-once job launches; the paid stage ledger and lease
fencing protect application processing. Keep both wake and admission disabled
until the configured job and shared database are verified.

## Isolated paid comparison job

The allowlist includes exactly `scripts/targeted-audit-paired.ts` and
`scripts/targeted-audit-experiment.ts` plus the full `evaluations/targeted-audit`
source tree. It excludes the user-owned backup component. Build pruning preserves
package-lock bytes (`--package-lock=false`) so implementation identity can be
checked against the frozen bundle.

Optionally add an `experiment` object to the reviewed config:

```json
{
  "job": "yti-experiment",
  "migrationJob": "yti-experiment-migrate",
  "serviceAccount": "yti-experiment@PROJECT.iam.gserviceaccount.com",
  "bundleBucket": "PRIVATE-FROZEN-INPUT-BUCKET",
  "resultsBucket": "PRIVATE-RESULTS-BUCKET",
  "secrets": {
    "DATABASE_URL": "yti-experiment-db:1",
    "DATABASE_URL_UNPOOLED": "yti-experiment-db:1",
    "GEMINI_API_KEY": "yti-gemini:1",
    "OPENROUTER_API_KEY": "yti-openrouter:1"
  }
}
```

Use a separate empty migrated database named `yti_experiment_NAME`, never the
application database. Grant the experiment identity read-only object access to
the input bucket and appropriate object read/write access only to the results
bucket. Mount input read-only at `/bundle`: it must contain `bundle.json` and the
prepared `evaluation/` directory. The results mount at `/results` is writable;
each Cloud Run execution gets a distinct output filename. PostgreSQL remains the
durable source of run/call/response truth. Test file create/rename/read on the
results mount before spending, since checkpoint exports use rename and Cloud
Storage FUSE is not a general POSIX disk. Preserve bucket versions/retention.

The generated experiment job is disabled with a four-hour task deadline and zero
platform retries. After verifying bundle hash, implementation files, source review
manifest, dedicated database, mounts and declared spending guards, explicitly set
`YTI_CLOUD_EXPERIMENT_ENABLED=true` and execute that job. It runs a maximum
180-minute session with fresh drafts/audits over identical retained source and
retrieval inputs; acquisition/search timing and costs are excluded. It never calls
LeapEdge. Explicit resume requires `YTI_CLOUD_EXPERIMENT_RESUME=true`, the identical
bundle and no unsettled paid outcomes. Do not silently restart an interrupted job
as a fresh experiment. Evaluation output is not automatic permission to promote
the default.

## Required acceptance and rollback

- [ ] Cloud image build succeeds; actual uploaded source and image contain no secrets/local data.
- [ ] Schema migration and full data transfer verified independently; backup restored in isolation.
- [ ] Authenticated web submission reaches the same cloud database as the worker.
- [ ] Source, full transcript, quotes, exact timestamp drill-down and current/experimental identity remain inspectable.
- [ ] Desktop/mobile page matrix passes, including settings save/reset and existing functionality.
- [ ] Interrupt after durable response receipt; resume on a replacement job without another paid call.
- [ ] Interrupt with unknown provider outcome; reservation remains visible and no blind rebilling occurs.
- [ ] Billing/provider failures halt appropriate admission and remain visible; job exit alone is not success.
- [ ] Delayed source/batch polling and queue re-dispatch work across idle exits and scheduler invocations.
- [ ] Measure submitted-to-first-useful/final-visible latency including job launch delays and retries.
- [ ] Bound overlapping executions and connection pools; test peak burst separately from 20-video quality comparison.
- [ ] Alert on stale heartbeat with queued work, expired leases, unknown holds, provider failures and cost thresholds.
- [ ] Retire Mac services only after cloud acceptance. Production rollback uses the previous cloud image and compatible database backup; it must not restore a local worker dependency.

Keep the previous digest and migration compatibility record. Pause all launchers,
drain jobs, deploy the prior compatible digest, verify schema and restart admission.
Do not roll back application code across incompatible schema migrations without a
reviewed database restore plan. Experimental pipeline promotion remains separately
gated by the quality/cost/speed report and user approval.

## Official references checked 27 September 2026

- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract): port binding and termination behaviour.
- [Job timeout](https://docs.cloud.google.com/run/docs/configuring/task-timeout): deadline configuration.
- [Cloud SQL PostgreSQL connectivity](https://docs.cloud.google.com/sql/docs/postgres/connect-run): regional placement, service identity and socket attachments.
- [Job secrets](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets): Secret Manager runtime injection.
- [Scheduled job execution](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule): authenticated Scheduler launch.
- [Job deployment CLI](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/deploy): create/update argument contract.

- [Direct Cloud Run IAP](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run): protected browser access.
- [Job Cloud Storage mounts](https://docs.cloud.google.com/run/docs/configuring/jobs/cloud-storage-volume-mounts): read-only frozen inputs and retained exports.
