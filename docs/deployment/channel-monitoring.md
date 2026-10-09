# Optional channel monitoring and cost controls

The app defaults to monitoring off. On 9 October 2026 the user explicitly selected an app toggle with a small periodic Vercel check remaining while off. Turning off the app toggle is different from disabling the platform scheduler.

## Enable monitoring

1. Open https://youtube-intelligence-two.vercel.app and sign in.
2. Open **Channels**, then add/follow the channels you want. Following discovers metadata; it does not itself authorize automatic analysis.
3. Choose each channel's processing checkbox and save the processing selection. The selection's projected model spend is shown. Unselected channels remain discovery only.
4. In **Channel monitoring**, switch **Enable channel monitoring** on.
5. Choose a schedule. Hourly (`0 * * * *`) is the initial recommendation. Daily (`0 9 * * *`) runs at 09:00 UTC. Custom numeric five-field cron supports lists, ranges and steps, with minute values restricted to 0, 15, 30 and 45. Invalid or more frequent schedules are refused. All schedule times are UTC; convert to your local time, accounting for daylight saving, before choosing a fixed hour.
6. Set **Maximum new analyses per check**. Start with 1. This caps newly queued videos globally for a check, not the dollars spent or the number of model calls within a video. Check now can add checks outside your schedule.
7. Normally only uploads published after enabling are eligible. Optionally choose **Include uploads from the last 24 hours when starting**; this can purchase analyses of recent uploads immediately when a check runs. It is not a historical backfill.
8. Read the cost warning and select **I understand…**, then click **Save monitoring**. No redeployment is needed for app schedule changes.
9. Use **Check now (may incur charges)** if you deliberately want an immediate check. The status shows checked channels, queued analyses and channel errors. New uploads can take longer to appear than the scheduled time.

The platform checks every 15 minutes and starts a due monitoring check once. Missed times are not replayed in a burst. A check refreshes up to three followed channels; larger lists rotate using their saved next-pull times. Push notifications only retain discoveries and cannot bypass the selected schedule or cap. Batch processing, if selected, can take longer and uses later scheduler checks to continue.

## Understand the costs

- The platform makes **2,880 small checks per 30 days**, even while the app toggle is off. Each uses a function invocation and database read. Dollar charges depend on your Vercel/Supabase plan, allowances, active CPU, memory, duration and database usage. A precise hosting bill cannot be inferred from invocation count alone.
- At [Vercel’s published Pro rate](https://vercel.com/docs/functions/usage-and-pricing) of US$0.60 per million invocations (checked 9 October 2026), 2,880 invocations alone cost about **US$0.002 before usage credits**. This excludes CPU, memory, database and network usage and is not an all-in estimate.
- The selected schedule's number of checks is displayed separately. Faster checks improve freshness; uploads determine how many analyses are needed. Every hour is approximately 720 monitoring checks over 30 days; every day approximately 30.
- The UI shows the selected channels' projected monthly model spend and measured analysis-only average per video. Incomplete upload history produces an unknown projection, not a zero estimate. Briefs, transcription and other services can add charges beyond that average.
- Existing monthly and per-video reservation limits remain enforced. An environment cumulative limit (`YTI_BUDGET_USD`) is also shown when configured and can stop processing before the monthly cap. These model limits do not cap hosting, database subscriptions or every external provider's bills.
- Retrying a failed provider billing/access request does not repair that account. Use the retained error and fix the underlying provider account first.

## Pause or stop everything scheduled

1. On Channels, switch **Enable channel monitoring** off and click **Save monitoring**. No cost acknowledgement is needed to pause.
2. Per-channel choices remain saved. No new automatic analyses are queued, and queued automatic video/brief stages do not start. In-flight provider calls can finish and settle. Manually submitted videos and deliberately requested individual analyses continue to work.
3. To eliminate periodic checks entirely, open https://vercel.com/joshu-ai/youtube-intelligence/settings/cron-jobs and disable Cron Jobs. The app cannot remotely change that platform switch; enable it again before expecting scheduled monitoring to work. The app shows server availability, not a live platform-status API result.

Production needs `YTI_CRON_ENABLED=true`; Preview/Development remain false by default. That variable is a server kill switch and changes require a new deployment. Do not change database passwords or API keys just to use the toggle. The normal workflow is entirely on the Channels page.
