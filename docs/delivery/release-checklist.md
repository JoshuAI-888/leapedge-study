# Standalone release checklist

Use this checklist for **every release**, including optimisation flags. A merge,
Vercel `READY`, and an installed Mac worker are three separate facts. Record each
in `docs/delivery/ledger.json` with a dated report. Never mark a pending step done.
No Finradar deployment is included.

## Before promotion

- [ ] Record baseline commit, Mac installed revision, Vercel production deployment,
  profile, capacity, queue state, schema and rollback deployment.
- [ ] Run `npm test`, `YTI_DB=pglite npm test`, `npm run typecheck`, `npm run build`
  and `node --experimental-strip-types scripts/promotion-gate.ts --offline`.
  The final command is advisory, not a certified accuracy gate.
- [ ] If queue/concurrency changed, run isolated real PostgreSQL checks.
- [ ] Capture before/after stage wall time, total measured wall time, provider
  calls, known charges and unknown reservations. Label fixtures as fixtures.
- [ ] Compare accepted evidence, exact spans/hashes, numbers, conditions, company
  coverage, confidence, independent audit and historical/current separation.
  Hold an optimisation off if the live experiment shows no benefit or a quality
  regression. Do not skip critique to meet a speed target.
- [ ] Browser-check desktop/mobile result, evidence drill-down and timestamp link.
- [ ] Push PR, verify CI and preview, then merge the reviewed version.

## Mac web and worker

Runtime: `/Users/joshmini/Library/Application Support/YouTube Intelligence`.
The repository is **not** the running installation. Its old database copy must
never overwrite or replace the active runtime database.

- [ ] Keep `YTI_QUEUE_PAUSED=true`, drain and confirm zero active leases and zero
  unfinished runs before changing paid request identity. Preserve unknown charges.
- [ ] Back up active database, protected `.env.live`, installed revision and code.
  Record backup path privately; do not commit credentials or a database dump.
- [ ] Build verified merged source. Stop `com.joshuai.yti.worker` and
  `com.joshuai.yti.web` through launchctl; leave PostgreSQL running.
- [ ] Copy `src`, `scripts`, `evaluations`, `docs`, `.next`, package/config files.
  Run `npm ci` in the installation if dependencies changed. Preserve `.env.live`,
  `data/postgres`, all retained data and other runtime state.
- [ ] Run required migrations through the direct endpoint (none for this release).
- [ ] Set `CODE_REVISION` and `installed-revision.txt` to the merged source SHA.
  Set `YTI_EFFICIENCY_PROFILE=conservative` unless overlap separately passes its
  measured release decision. Existing queued flags stay frozen.
- [ ] Confirm team `processing.parallelVideos` and connection/provider limits.
  Capacity three is the current bounded setting, not a 1,000/day certification.
- [ ] Restart web/worker. Verify fresh heartbeat (<120 seconds), correct marker,
  no new worker errors, schema, unchanged retained-run count, and HTTP 200 on
  Today, `/api/intelligence/status`, `/api/intelligence/activity`, and research
  snapshot. Inspect the browser and evidence drawer against this installation.
- [ ] Record queue state explicitly. Keep automatic intake paused unless a
  bounded canary or automatic workload has been intentionally activated.

## Vercel web/API

Project `youtube-intel`, team `joshu-ai`. This is separate from Finradar.

- [ ] Inspect the **Production** deployment for the merged SHA, not the PR preview:
  `vercel ls` then `vercel inspect <deployment-url>`.
- [ ] Review Production environment variable names with `vercel env ls production`.
  Ensure `YTI_EFFICIENCY_PROFILE=conservative` is set for new admissions. Preserve
  secrets and integration-managed database variables. Do not rotate or delete them.
- [ ] Environment changes require a new deployment; redeploy Production if the
  change happened after its build. Do not promote an environment-mismatched preview.
- [ ] Verify deployment READY, correct Git SHA and production aliases; record URL.
- [ ] Authenticate and check Today/status/activity/snapshot, evidence drill-down,
  desktop/mobile and error logs. A protection/login response is not app success.
- [ ] Separately establish which database the web app and worker use. The Mac
  installation currently uses local `yti_live`; Vercel's Neon database is a
  different environment. A local heartbeat does **not** certify a worker serving
  Vercel jobs. Do not switch databases or copy live datasets as a release shortcut.
- [ ] If Vercel has no worker on its database, report web deployment as ready but
  processing as not activated. Record the hosted-worker cutover as a separate
  operation using `worker-operations.md` (same database, matching revision,
  pause/drain, secrets, fresh heartbeat and a bounded canary).

## Rollback and closeout

- [ ] If code health fails, keep admission paused. Restore previous verified code,
  `.next`, revision marker and profile; restart and smoke-check. Never restore an
  older database over newer paid-call records merely to roll back code.
- [ ] For Vercel, use `vercel rollback <previous-production-url>` when appropriate;
  verify aliases and authenticated health again. Environment rollback must be
  considered separately from deployment rollback.
- [ ] Update ledger/report with exact revisions, profiles, queue state, costs,
  browser evidence, remaining limitations and whether live processing is active.

References: [Vercel deployments](https://vercel.com/docs/deployments) and
[environment variables](https://vercel.com/docs/environment-variables).
