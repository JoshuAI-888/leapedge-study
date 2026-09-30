/**
 * Parse and serialise view state kept in the URL (decision D4). Periods,
 * ranges and filters live here instead of in a saved setting, so changing them
 * never writes team or account preferences. Pure, so node:test covers it; the
 * React hook is in url-state.ts.
 */
import type { z } from "zod";

type Readable = { get(key: string): string | null };

/**
 * One value per key from `defaults`. Each raw string is parsed by that key's
 * schema (so a schema that expects a number should coerce); a missing or
 * invalid value falls back to its default rather than throwing.
 */
export function parseUrlState<S extends z.ZodObject>(
  schema: S,
  defaults: z.output<S>,
  params: Readable,
): z.output<S> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const result: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const raw = params.get(key);
    const field = shape[key];
    if (raw === null || !field) continue;
    const parsed = field.safeParse(raw);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as z.output<S>;
}

/**
 * The query string for `state`, starting from the current params so keys owned
 * by other components survive. A value equal to its default is removed, which
 * keeps URLs short and lets a default seeded from a saved setting follow that
 * setting. Returns the string without a leading "?"; `current` is not mutated.
 */
export function serialiseUrlState(
  state: Record<string, unknown>,
  defaults: Record<string, unknown>,
  current: URLSearchParams | string,
) {
  const next = new URLSearchParams(current.toString());
  for (const key of Object.keys(defaults)) {
    const value = state[key];
    if (value === undefined || value === defaults[key] || value === "")
      next.delete(key);
    else next.set(key, String(value));
  }
  return next.toString();
}
