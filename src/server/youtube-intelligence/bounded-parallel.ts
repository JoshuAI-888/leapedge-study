import { TransportError } from "./transport/types.ts";

/** Only explicit account/auth failures stop admission; transient rate limits do not. */
export function isFatalAccountError(error: unknown): boolean {
  return error instanceof TransportError &&
    (error.status === 401 || error.status === 402 || error.status === 403);
}

export class AdmissionStoppedError extends Error {
  constructor(cause: unknown) {
    super("Work was not started after a fatal sibling failure; no paid request was made for this item.", { cause });
    this.name = "AdmissionStoppedError";
  }
}

/** Drain every started sibling before returning; callers retain paid responses on failure. */
export async function boundedSettled<T, R>(
  items: readonly T[],
  concurrency: number,
  action: (item: T, index: number) => Promise<R>,
  options: { stopOnError?: (error: unknown) => boolean } = {},
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw Error("Parallel concurrency must be an integer from 1 to 16.");
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  let stopped = false;
  let stopReason: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!stopped && cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = {
            status: "fulfilled",
            value: await action(items[index], index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
          if (!stopped && options.stopOnError?.(reason)) {
            stopped = true;
            stopReason = reason;
          }
        }
      }
    }),
  );
  // Every started action has drained; untouched items never entered action().
  for (; cursor < items.length; cursor++) {
    results[cursor] = { status: "rejected", reason: new AdmissionStoppedError(stopReason) };
  }
  return results;
}
