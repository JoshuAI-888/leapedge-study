# Process videos without scheduled worker costs

The recommended mode for occasional use is manual processing. Keep Vercel Cron Jobs disabled and `YTI_CRON_ENABLED=false`. Submitting a video starts a bounded worker after the response; it continues through saved stages, waits for known short provider backoffs, and exits when its queue is empty or its invocation budget is spent. Opening a result does not start a worker.

## Everyday use

1. Open https://youtube-intelligence-two.vercel.app and sign in with your workspace code.
2. On Today, paste a YouTube video URL and submit it. Keep the analysis page open to watch progress, or return later.
3. If the run is queued after an interruption, open its analysis and click **Resume processing**. This wakes processing from the saved step. It keeps the existing job and completed paid calls; it does not submit a fresh analysis. A currently running job cannot be retried concurrently. Open or unknown paid outcomes must be settled first.
4. If a provider rejects a request, read the failure message and correct the provider account or key before retrying. Repeated clicks do not fix billing or access errors.
5. Use **Re-run with current pipeline** only when you deliberately want a fresh paid analysis. That creates a new run.

## Keep costs controlled

1. In Vercel, select team **joshu-ai**, project **youtube-intelligence**.
2. In Settings → Cron Jobs, leave scheduling disabled. The cron definition remains available for future use.
3. In Settings → Environment Variables, keep `YTI_CRON_ENABLED` set to `false` for Production. Do not enable automatic channel processing for occasional manual use.
4. Keep `YTI_INLINE_DRAIN` unset (or any value other than `off`). Setting it to `off` prevents submitted videos from processing automatically.
5. The existing `YTI_BUDGET_USD` is a cumulative model reservation/spend cap. Settings also has monthly budget controls. These are model-spend guards; they do not cap Vercel hosting, database subscriptions, or every external provider's separate charges.
6. Use Vercel's billing/spend notifications and the providers' billing limits for those separate costs. Idle scheduled worker invocations are avoided in manual mode; page visits and database hosting can still have costs.

Each worker invocation preserves 300 seconds to finish a claimed stage and stops claiming new steps after 500 seconds of its 800-second route budget. Long batch jobs or runs exceeding that budget can need a manual resume after their backoff or lease expires. Manual mode does not promise unattended batch completion or automatic channel monitoring. Enable scheduling only if that becomes an intended feature of normal use.

No database credential changes are needed for the manual-run repair. The database setup remains documented in [Supabase and Vercel setup](supabase-vercel-setup.md).
