import { z } from "zod";
import { event, teamPreferences } from "./research-store.ts";
import {
  release,
  retainedResponse,
  settle,
  unknownCalls,
  type UnknownCall,
} from "./store.ts";
import { usageOf } from "./transport/google-native.ts";
/**
 * Reconciliation of unknown outcomes (spec 4.4).
 *
 * A call whose outcome is unknown — a timeout after response bytes had already
 * arrived, or a failure the provider gave no status for — may or may not have
 * been billed, so the ledger keeps its reservation. It keeps it for
 * budget.unknownOutcomeHoldMinutes and no longer: after that the row is
 * reconciled rather than blocking the run for ever, which is what the old
 * ledger did (NZ$37.86 held against US$0.60 of known cost).
 *
 * Reconciling means one of two things. If the response for that call id was
 * retained, the call did happen and its own usage settles it. If nothing was
 * retained, there is no evidence it was ever billed, so the reservation is
 * given back. Either way an event records what was decided, because a released
 * reservation is money the monthly total can no longer see.
 */
export type ReconcileSummary = {
  /** Rows whose hold had expired when this sweep ran. */
  checked: number;
  settled: number;
  released: number;
};
/** OpenRouter reports the price of a call; Google reports the tokens it billed. */
const RetainedUsage = z.looseObject({
  usage: z.looseObject({ cost: z.number().nonnegative().optional() }).optional(),
  usageMetadata: z.looseObject({}).optional(),
});
/**
 * What the retained response says the call cost: the provider's own price
 * where it reported one, otherwise the price table applied to the tokens it
 * reported. Null when the payload says neither, and the reservation stands as
 * the best estimate the ledger has.
 */
export function costFromRetained(
  payload: unknown,
  model: string,
): number | null {
  const parsed = RetainedUsage.safeParse(payload);
  if (!parsed.success) return null;
  const reported = parsed.data.usage?.cost;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0)
    return reported;
  if (!parsed.data.usageMetadata) return null;
  // usageOf owns the cached/audio slicing rule; it reads usageMetadata only.
  const usage = usageOf(model, payload as Parameters<typeof usageOf>[1]);
  return usage.costUsd;
}
function modelOf(call: UnknownCall): string {
  const model = call.metrics.model;
  return typeof model === "string" && model ? model : "";
}
function millis(now: Date | number) {
  return now instanceof Date ? now.getTime() : now;
}
/**
 * Process the reconciliation queue: every attempt of unknown outcome whose
 * hold has expired at `now`. `holdMinutes` defaults to the team's
 * budget.unknownOutcomeHoldMinutes. Called by runner.sweep(), so an unknown
 * outcome is resolved by the worker that is already running rather than by the
 * run that hit it.
 */
export async function reconcileUnknown(
  now: Date | number = Date.now(),
  holdMinutes?: number,
): Promise<ReconcileSummary> {
  const hold =
    holdMinutes ?? (await teamPreferences()).budget.unknownOutcomeHoldMinutes;
  const at = millis(now);
  const cutoff = new Date(at - Math.max(0, hold) * 60000).toISOString();
  const queue = await unknownCalls(cutoff);
  const summary: ReconcileSummary = {
    checked: queue.length,
    settled: 0,
    released: 0,
  };
  for (const call of queue) {
    const retained = await retainedResponse(call.id);
    const reconciledAt = new Date(at).toISOString();
    if (retained !== undefined) {
      const reported = costFromRetained(retained, modelOf(call));
      const amount = reported ?? call.amount;
      await settle(call.id, amount, {
        ...call.metrics,
        reconciled: {
          at: reconciledAt,
          from: reported === null ? "reservation" : "retained response",
          heldUsd: call.amount,
        },
      });
      summary.settled += 1;
      await event("reconciled", call.runId, {
        call: call.id,
        stage: call.stage,
        attempt: call.attempt,
        outcome: "settled",
        amountUsd: amount,
        heldUsd: call.amount,
        unknownSince: call.unknownSince,
        at: reconciledAt,
      });
      continue;
    }
    await release(
      call.id,
      `Outcome unknown for ${hold} minutes and no response was retained; the reservation of US$${call.amount.toFixed(4)} was given back.`,
    );
    summary.released += 1;
    await event("reconciled", call.runId, {
      call: call.id,
      stage: call.stage,
      attempt: call.attempt,
      outcome: "released",
      amountUsd: 0,
      heldUsd: call.amount,
      unknownSince: call.unknownSince,
      at: reconciledAt,
    });
  }
  return summary;
}
