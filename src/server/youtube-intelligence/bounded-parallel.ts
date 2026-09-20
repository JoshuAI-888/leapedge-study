/** Drain every started sibling before returning; callers retain paid responses on failure. */
export async function boundedSettled<T, R>(
  items: readonly T[],
  concurrency: number,
  action: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw Error("Parallel concurrency must be an integer from 1 to 16.");
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = {
            status: "fulfilled",
            value: await action(items[index], index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}
