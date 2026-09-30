import { z } from "zod";
import { researchDB, lockedDoc, event } from "./research-store.ts";
import { priceSeries } from "./repos/prices.ts";
import {
  sinceSaved,
  type SinceSaved,
} from "../../features/youtube-intelligence/saved-calls.ts";

/**
 * Saved calls (F75), server side: permanently deleting a removed call, and the
 * small price read behind "since saved". Kept apart from the Watchlist's price
 * reads on purpose; it reads only the stored `prices` table and fetches nothing.
 */
export const DeleteIdeaInput = z.strictObject({
  id: z.string().min(1).max(400),
});
/**
 * Delete a saved call and its note. Only a call already in Removed can go, so
 * one click on an open or reviewed call can never destroy it; the row is read
 * FOR UPDATE and the DELETE repeats the status check, so a concurrent restore
 * wins. An event keeps the fact of the deletion (not the note) in the audit log.
 */
export async function deleteIdea(id: string) {
  const d = researchDB();
  return await d.transaction(async () => {
    const old = await lockedDoc<{ status?: unknown }>("idea", id);
    if (!old) throw Error("Saved call not found.");
    if (old.status !== "dismissed")
      throw Error(
        "Only a removed call can be deleted permanently. Remove it first.",
      );
    const result = await d
      .prepare(
        "DELETE FROM yi_documents WHERE kind='idea' AND id=$1 AND payload::jsonb->>'status'='dismissed'",
      )
      .run(id);
    if (!result.changes) throw Error("Saved call not found.");
    await event("ideaDeleted", id, { id, status: "dismissed" });
    return { id, deleted: true };
  });
}

export const SavedSinceInput = z.preprocess(
  (v) => v ?? {},
  z.strictObject({
    calls: z
      .array(
        z.strictObject({
          ticker: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9.^=-]{1,20}$/),
          session: z.iso.date(),
        }),
      )
      .max(300)
      .default([]),
  }),
);
export type SavedSinceRow = { ticker: string; session: string; since: SinceSaved };
/** One stored-price series read per ticker, from its earliest call session. */
export async function savedSince(
  calls: { ticker: string; session: string }[],
): Promise<SavedSinceRow[]> {
  const earliest = new Map<string, string>();
  for (const c of calls) {
    const seen = earliest.get(c.ticker);
    if (!seen || c.session < seen) earliest.set(c.ticker, c.session);
  }
  const series = new Map(
    await Promise.all(
      [...earliest].map(
        async ([ticker, from]) =>
          [ticker, await priceSeries(ticker, from, "9999-12-31")] as const,
      ),
    ),
  );
  return calls.map((c) => ({
    ticker: c.ticker,
    session: c.session,
    since: sinceSaved(series.get(c.ticker) ?? [], c.session),
  }));
}
