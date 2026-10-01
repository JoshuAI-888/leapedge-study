import { z } from "zod";
import { TransportError } from "./transport/types.ts";
/**
 * Retry policy for provider calls. Spec section 4.4: a call is retried only
 * when the provider certainly did not bill for it — 429, 5xx, and a timeout
 * that fired before any response bytes arrived. Anything else (an unknown
 * failure, or any 4xx other than 429) is terminal: a paid call may already
 * have happened and the ledger must not reserve a second one automatically.
 *
 * withRetry() owns the waiting only; the caller owns the attempt number, so
 * the ledger can key its rows by (run, stage, attempt) through onAttempt.
 * sleep and random are injectable so tests assert the backoff without waiting.
 */
export const RetryLimits = z.object({
  /** Total calls, not extra calls: 1 disables retrying. */
  maxAttempts: z.number().int().min(1).max(10).default(3),
  baseDelayMs: z.number().int().nonnegative().default(500),
  maxDelayMs: z.number().int().nonnegative().default(20000),
  jitterMs: z.number().int().nonnegative().default(250),
});
export type RetryLimits = z.infer<typeof RetryLimits>;
/** What onAttempt is told immediately before attempt number `attempt` runs. */
export type RetryAttempt = {
  attempt: number;
  /** Milliseconds already waited before this attempt; 0 for the first. */
  delayMs: number;
  /** The failure that caused this retry; undefined on the first attempt. */
  previousError?: unknown;
};
export type RetryOptions = Partial<RetryLimits> & {
  isRetryable?: (error: unknown, attempt: number) => boolean;
  onAttempt?: (attempt: RetryAttempt) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};
export type RetryResult<T> = { result: T; attempts: number };
function property(error: unknown, key: string): unknown {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)[key]
    : undefined;
}
/**
 * Response bytes already received when the error was raised. A transport that
 * does not count them reports nothing, which we read as "none arrived".
 */
export function bytesReceived(error: unknown) {
  const value = property(error, "bytesReceived");
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
/** A timeout whose error.bytesReceived is 0 or undefined: nothing was billed. */
export function timeoutBeforeAnyBytes(error: unknown) {
  return (
    error instanceof TransportError &&
    error.kind === "timeout" &&
    bytesReceived(error) === 0
  );
}
export function isRetryableTransportError(error: unknown) {
  if (!(error instanceof TransportError)) return false;
  // Any 4xx other than 429 is the request's own fault; retrying repeats it.
  if (
    typeof error.status === "number" &&
    error.status !== 429 &&
    error.status < 500
  )
    return false;
  if (error.kind === "rate_limited" || error.kind === "server") return true;
  return timeoutBeforeAnyBytes(error);
}
/** Exponential backoff for the wait after `failures` failed attempts, plus jitter. */
export function backoffDelay(
  failures: number,
  limits: RetryLimits,
  random: () => number = Math.random,
) {
  const exponential = Math.min(
    limits.baseDelayMs * 2 ** Math.max(0, failures - 1),
    limits.maxDelayMs,
  );
  return Math.round(exponential + random() * limits.jitterMs);
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T> | T,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const limits = RetryLimits.parse({
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    jitterMs: options.jitterMs,
  });
  const retryable = options.isRetryable || isRetryableTransportError;
  const sleep = options.sleep || wait;
  const random = options.random || Math.random;
  let previousError: unknown;
  for (let attempt = 1; ; attempt++) {
    const delayMs =
      attempt === 1 ? 0 : backoffDelay(attempt - 1, limits, random);
    if (delayMs > 0) await sleep(delayMs);
    await options.onAttempt?.({ attempt, delayMs, previousError });
    try {
      return { result: await fn(attempt), attempts: attempt };
    } catch (error) {
      previousError = error;
      if (attempt >= limits.maxAttempts || !retryable(error, attempt)) {
        // The caller's own error is rethrown unchanged but for the count, so
        // TransportError.kind stays available to the ledger and the run record.
        if (error && typeof error === "object")
          (error as { attempts?: number }).attempts = attempt;
        throw error;
      }
    }
  }
}
