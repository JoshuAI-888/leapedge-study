# Supabase and Vercel: exact setup for this app

Updated 9 October 2026. The GitHub repository is `JoshuAI-888/leapedge-study`, but the **live Vercel project is `youtube-intelligence` in team `joshu-ai`**. The separate Vercel project called `leapedge-study` has no environment variables and its earlier deployments failed; it is not the live app and now skips redundant Git builds. Apply the instructions below to `youtube-intelligence`.

The correct Supabase account is **joshuafang@gmail.com**. Its project is **youtube-intelligence**, project reference **twidbzmqhvqpuakkzobf**, in us-east-1. Do not use the TradingAgents project from the other account.

## What is already set up

Production has valid database credentials and a CA certificate. Its saved serving URL used session pooling and reached Supabase’s 15-client session limit; the serving code now switches a shared Supabase session-pooler URL to transaction port 6543, preserving the credentials. Migration connections remain on session port 5432. Preserve those values unless a connection actually fails. The production identity guard is `db.twidbzmqhvqpuakkzobf.supabase.co`. The optional monitoring feature now requires `YTI_CRON_ENABLED=true` in Production and Vercel Cron Jobs enabled, running every 15 minutes. The Channels page toggle defaults off and controls new automatic work. The user explicitly selected the small periodic check remaining while off; see [channel monitoring and cost controls](channel-monitoring.md).

An environment variable is a named setting, such as `DATABASE_URL`, whose value Vercel gives the app. **Production** means the live app. **Preview** means a test deployment of a branch. **Development** means your local computer. Secret values being hidden after saving is normal; do not replace them just because you cannot reveal them.

## 1. Open the correct dashboards

1. Open [Supabase projects](https://supabase.com/dashboard/projects). Check the signed-in account is `joshuafang@gmail.com`; switch accounts if necessary.
2. Open **youtube-intelligence**. Check its browser address contains `twidbzmqhvqpuakkzobf`.
3. In another tab, open [the live Vercel environment variables](https://vercel.com/joshu-ai/youtube-intelligence/settings/environment-variables). Confirm the project name at the top is **youtube-intelligence** and the team is **joshu-ai**.

## 2. Prepare the two database URLs, only if they need repair

1. In the Supabase project, click **Connect**. Select the PostgreSQL connection-string/URI view.
2. Select **Transaction pooler**. Copy the URI. Its port should be **6543**. This becomes `DATABASE_URL`, used by web requests.
3. Select **Session pooler**. Copy its URI. Its port should be **5432**. This becomes `DATABASE_URL_UNPOOLED`, used by migrations and maintenance. The name is historical: a session pooler is permitted because it preserves a connection's session and advisory lock. It also works on IPv4 networks such as a Vercel build environment.
4. Replace the password placeholder with the **database password** for this Supabase project. This is not your Gmail password, Supabase login password, anon key or service-role key. If you do not know it, preserve the currently working Vercel secrets; do not reset the database password merely to inspect them.
5. If composing the URI yourself, percent-encode special characters in the password: for example `@` becomes `%40`, `#` becomes `%23`, and `%` becomes `%25`. Do not encode an already encoded password a second time. Keep the copied host exactly as shown in Connect.

The resulting shapes are:

```text
DATABASE_URL=postgresql://postgres.twidbzmqhvqpuakkzobf:<ENCODED_DATABASE_PASSWORD>@<HOST_FROM_SUPABASE_CONNECT>:6543/postgres?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://postgres.twidbzmqhvqpuakkzobf:<ENCODED_DATABASE_PASSWORD>@<HOST_FROM_SUPABASE_CONNECT>:5432/postgres?sslmode=require
```

Replace the angle-bracket placeholders; do not paste them literally. Do not guess the pooler host from the region. Both URLs must identify the same Supabase project and database. A direct `db.twidbzmqhvqpuakkzobf.supabase.co:5432` URI also works on networks with IPv6; use the session-pooler option for Vercel if a direct connection is unreachable.

## 3. Prepare the SSL certificate, only if it needs repair

1. In Supabase, open **Database → Settings → SSL Configuration** and download the project's CA certificate.
2. Open the downloaded certificate in a plain-text editor.
3. Copy all its text, starting with `-----BEGIN CERTIFICATE-----` and ending with `-----END CERTIFICATE-----`, including the actual line breaks.
4. That complete text is the value of `YTI_DB_SSL_CA`. It is not the filename, a file path, or text with literal `\n` characters. Keep the existing certificate if the connection already works. You do not need to change Supabase's SSL-enforcement switch.

The app verifies TLS with this certificate. Do not fix a certificate error by disabling verification.

## 4. Save or check these Vercel settings

On the Environment Variables page, find an existing name and choose its menu → **Edit**, or choose **Add Environment Variable** if it is absent. Enter the name and value in separate fields, select the environments indicated below, then **Save**. For a URL, paste just the URI, without `DATABASE_URL=` or surrounding quotation marks.

| Name | Value | Environments |
| --- | --- | --- |
| `DATABASE_URL` | Transaction-pooler URI from step 2, port 6543; keep existing working secret | Production |
| `DATABASE_URL_UNPOOLED` | Session-pooler URI from step 2, port 5432; keep existing working secret | Production |
| `YTI_DB_SSL_CA` | Complete CA certificate from step 3; keep existing working secret | Production |
| `YTI_PRODUCTION_DB_HOST` | `db.twidbzmqhvqpuakkzobf.supabase.co` | Production, Preview, Development |
| `YTI_CRON_ENABLED` | `true` | Production |
| `YTI_CRON_ENABLED` | `false` | Preview, Development |
| `YTI_APP_ORIGIN` | `https://youtube-intelligence-two.vercel.app` | Production |
| `YTI_PREVIEW_READ_ONLY` | `true` | Preview |

Use Secret/Sensitive for database URLs and existing secrets where offered. `YTI_PRODUCTION_DB_HOST` is a hostname only: no scheme, password, port or path. It always identifies **production**, even in Preview or Development, so safety checks can refuse accidental production writes.

Also preserve existing `YTI_ACCESS_TOKEN`, `YTI_PASSCODE`, `CRON_SECRET`, provider API keys, spending limits and transcript limits. `YTI_ACCESS_TOKEN` and `CRON_SECRET` must each be at least 32 characters. Do not rotate them just for this repair. The passcode is what you type into the workspace access page; the token is used to sign the session.

The app uses `DATABASE_URL` explicitly. Old Neon `PG*`, `POSTGRES*` and `NEON*` integration variables are not required by the new code. Leaving them does not make the app switch back to Neon. Do not delete the old database or its integration before confirming backups and completing your retention decision.

## 5. Choose the monitoring state

1. For the new app toggle to work, Vercel Cron Jobs stays enabled and Production `YTI_CRON_ENABLED` is `true`.
2. Open Channels in the app. Leave **Enable channel monitoring** off for manual-only operation. It defaults off; enabling it requires acknowledging costs and saving the settings.
3. The platform definition is `/api/cron/intelligence`, schedule `*/15 * * * *`. App schedules are UTC and can be edited without deployment.
4. Off stops new automatic analyses, including queued automatic stages. In-flight requests can finish. Manual submission and explicit individual analysis continue to work.
5. Even while off, a small Vercel invocation/database check remains every 15 minutes: 2,880 over 30 days. Hosting/database charges depend on your plan and actual resources. To stop those checks completely, disable Cron Jobs in Vercel; then the app cannot receive scheduled checks until you re-enable it.
6. See [the exact monitoring workflow](channel-monitoring.md) for schedule choices, projections, caps and how to check now.

## 6. Deploy once after any future environment change

Saved environment changes apply to **new deployments**, not the deployment that is already running.

1. Open the project's **Deployments** tab.
2. Find the newest successful **Production** deployment of the fixed `main` branch.
3. If you changed any values after that deployment, choose its menu → **Redeploy**, keep Production selected, and confirm once. Do not repeatedly redeploy.
4. Open its build log. It should finish with **Ready**. The migration step should apply `0011_append_only_search_path.sql` once or say the database is up to date on subsequent deploys.
5. Open [the app](https://youtube-intelligence-two.vercel.app), enter your usual workspace access code, and open an existing analysis. Do not submit a paid video just to check the deployment.
6. Recheck that the app monitoring state matches your intention and the platform schedule is every 15 minutes.

This repair's deployment is handled as part of the fix; you do not need another redeployment unless you subsequently change a value.

## Preview and local development

The live project's corrected ignored-build command is `[ "$VERCEL_GIT_COMMIT_REF" != "main" ]`: it builds main and skips other Git branches to save compute. The previous VERCEL_ENV-based command unexpectedly skipped main too; it has been replaced. Leave the corrected setting alone. Its older Development/Preview Neon credentials are not the production Supabase credentials. Before intentionally enabling preview builds or running a local worker, use an isolated non-production database, set both connection URLs and its CA, and keep `YTI_PRODUCTION_DB_HOST` pointing at the production reference above. A preview pointed at production is intentionally refused. There is no need to create another paid database for this repair.

## Recognizing errors

| Error or symptom | Meaning and action |
| --- | --- |
| Missing `DATABASE_URL_UNPOOLED` in Vercel `leapedge-study` | The empty duplicate project was deployed. Use `youtube-intelligence`; do not troubleshoot the live app through the duplicate. |
| URLs are not two endpoints of one database | The project reference or database path differs. Copy both URLs from the same Supabase project's Connect panel. |
| Transaction-pooled endpoint rejected for migrations | Set `DATABASE_URL_UNPOOLED` to session-pooler port 5432, not transaction-pooler port 6543. |
| `28P01` / password authentication failed | Wrong database password or URI encoding. Recheck the project and password; preserve working secrets unless repair is necessary. |
| Certificate / self-signed chain error | Recheck the full `YTI_DB_SSL_CA` PEM from this project. Keep TLS verification enabled. |
| `ENETUNREACH` on the direct host | Use the IPv4-compatible session pooler for migration/maintenance. |
| `EMAXCONNSESSION` / max clients reached in session mode | The serving connection used session port 5432 and exhausted its 15-client pool. The repaired code uses transaction port 6543 for web requests without replacing the saved password. For future manual configuration, save the transaction URI as `DATABASE_URL`; keep session 5432 only for `DATABASE_URL_UNPOOLED`. Do not increase paid compute to mask this configuration error. |
| GitHub dependency audit failure | The old lockfile contained vulnerable `sharp` and `source-map-js`; the repair updates their patched versions. |
| Historical Google provider `402` / insufficient credits | Provider billing failed before the migration. Database changes cannot replenish AI credits. If you later want paid analysis, inspect billing for the Google AI Studio project associated with `GEMINI_API_KEY`. No credits are purchased or failed jobs retried by this repair. |

## References

[Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement), [Vercel environment variables](https://vercel.com/docs/environment-variables), and [Vercel disabling cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
