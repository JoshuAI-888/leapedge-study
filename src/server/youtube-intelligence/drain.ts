import { processNext } from "./runner.ts";
import { teamPreferences } from "./research-store.ts";

export type DrainOptions = {
  /** Wall-clock budget of the host invocation (a function's maxDuration). */
  budgetMs: number;
  /**
   * Stop claiming new steps once less than this remains, so a step that has
   * started normally finishes and checkpoints before the host is stopped.
   * A step cut off anyway keeps its lease until expiry and is then reclaimed;
   * an uncertain paid call is held by the reservation ledger, never repeated.
   */
  reserveMs?: number;
  lanes?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  step?: () => Promise<unknown>;
};

/**
 * Run queued work on a serverless host until the queue is idle or the time
 * budget is spent. Each lane claims one step at a time through processNext, so
 * the Postgres queue's capacity lock, leases and fencing govern concurrency
 * across every concurrent drain (cron, submit) exactly as they did for the
 * long-running worker. A lane stops when nothing is claimable.
 */
export async function drain(options: DrainOptions) {
  const now = options.now ?? Date.now;
  const started = now();
  const reserve = options.reserveMs ?? 300_000;
  const step = options.step ?? (() => processNext());
  const sleep = options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lanes =
    options.lanes ?? (await teamPreferences()).processing.parallelVideos;
  let steps = 0,
    errors = 0;
  const lane = async () => {
    let consecutiveErrors = 0;
    while (now() - started < options.budgetMs - reserve) {
      try {
        const job = await step();
        if (!job) return;
        steps++;
        consecutiveErrors = 0;
        // A delayed checkpoint is work in progress, not an idle queue. Wait
        // only for this lane's known retry, within the host's claim budget.
        const delay =
          typeof job === "object" && "retryAfterMs" in job
            ? Number(job.retryAfterMs)
            : 0;
        if (Number.isFinite(delay) && delay > 0) {
          if (delay >= options.budgetMs - reserve - (now() - started)) return;
          await sleep(delay);
        }
      } catch (error) {
        errors++;
        console.error(
          "Drain step failed:",
          error instanceof Error ? error.message : String(error),
        );
        if (++consecutiveErrors >= 3) return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, lanes) }, lane));
  return { steps, errors, elapsedMs: now() - started };
}

/**
 * Start a drain after the response is sent. Outside a Next.js request scope
 * (tests, scripts) after() throws and nothing is started; the cron drain
 * remains the recovery path either way.
 */
export async function drainAfterResponse(budgetMs: number) {
  if (process.env.YTI_PREVIEW_READ_ONLY === "true") return false;
  if (process.env.YTI_INLINE_DRAIN === "off") return false;
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        await drain({ budgetMs });
      } catch (error) {
        console.error(
          "Inline drain failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    return true;
  } catch {
    return false;
  }
}
