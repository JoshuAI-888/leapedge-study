/** Wait for running work or periodically return to observe stop/settings changes. */
export async function waitForWorkerSlot(active: ReadonlySet<Promise<unknown>>, pollMs = 1500): Promise<void> {
  if (active.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ...Array.from(active, work => work.then(() => undefined, () => undefined)),
      new Promise<void>(resolve => { timer = setTimeout(resolve, pollMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
