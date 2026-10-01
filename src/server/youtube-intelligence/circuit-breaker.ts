import { z } from "zod";
import { doc, docs, put } from "./research-store.ts";
/**
 * Per-vendor circuit breaker (spec 4.10).
 *
 * One document per vendor, kind "circuitBreaker", id = vendor name, so the
 * state survives a restart and is visible to the portal banner and to the Lab
 * history (put() also appends an event). Only vendor errors open a breaker:
 * HTTP 5xx, HTTP 429 and network or timeout failures. A provider answering
 * "there are no captions for this video" (206 or 404) is a fact about the
 * video, is correlated across every caption provider, and must never open a
 * breaker or cause a fallback.
 */
export const VendorErrorKind = z.enum(["5xx", "429", "timeout", "network"]);
export type VendorErrorKindName = z.infer<typeof VendorErrorKind>;
export const BreakerState = z.object({
  vendor: z.string().min(1).max(60),
  kind: VendorErrorKind,
  reason: z.string().min(1).max(1000),
  cooldownMinutes: z.number().min(0).max(1440),
  openedAt: z.iso.datetime(),
  openUntil: z.iso.datetime(),
  /** How many times this vendor has opened the breaker, for the banner. */
  trips: z.number().int().min(1),
});
export type BreakerStateData = z.infer<typeof BreakerState>;
const KIND = "circuitBreaker";
/** The vendor-error kind an HTTP status reports, or null when the vendor is healthy. */
export function vendorErrorForStatus(
  status: number,
): VendorErrorKindName | null {
  if (status === 429) return "429";
  if (status >= 500 && status < 600) return "5xx";
  return null;
}
/** The vendor-error kind a thrown transport failure reports, or null. */
export function vendorErrorForFailure(
  error: unknown,
): VendorErrorKindName | null {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (/timed? ?out/i.test(message)) return "timeout";
  if (error instanceof TypeError) return "network";
  if (/fetch failed|network|ECONN|EAI_AGAIN|socket/i.test(message))
    return "network";
  return null;
}
/** Open the vendor's breaker for `cooldownMinutes` from `now`. */
export async function trip(
  vendor: string,
  kind: VendorErrorKindName,
  reason: string,
  cooldownMinutes: number,
  now: number = Date.now(),
): Promise<BreakerStateData> {
  const previous = await state(vendor);
  const opened = BreakerState.parse({
    vendor,
    kind,
    reason,
    cooldownMinutes,
    openedAt: new Date(now).toISOString(),
    openUntil: new Date(now + cooldownMinutes * 60000).toISOString(),
    trips: (previous?.trips || 0) + 1,
  });
  await put(KIND, vendor, opened);
  return opened;
}
/** The stored state for a vendor, open or long closed, or null if never tripped. */
export async function state(vendor: string): Promise<BreakerStateData | null> {
  const stored = await doc(KIND, vendor);
  return stored ? BreakerState.parse(stored) : null;
}
/** True while the vendor's cooldown is still running. */
export async function isOpen(
  vendor: string,
  now: number = Date.now(),
): Promise<boolean> {
  const current = await state(vendor);
  return !!current && now < Date.parse(current.openUntil);
}
/** Every vendor's breaker state, newest document first, for the portal banner. */
export async function breakers(): Promise<BreakerStateData[]> {
  return (await docs(KIND)).map((row) => BreakerState.parse(row));
}
