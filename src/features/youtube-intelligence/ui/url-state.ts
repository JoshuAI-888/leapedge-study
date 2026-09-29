"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { z } from "zod";
import { parseUrlState, serialiseUrlState } from "./url-state-core.ts";

/**
 * View state in the URL (decision D4): periods, ranges and filters are read
 * from the query string, parsed with zod, and fall back to `defaults` (usually
 * seeded from a saved setting) when absent or invalid. Setting a value replaces
 * the URL without scrolling and never writes a team or account setting.
 *
 * `useSearchParams` makes a prerendered route render on the client up to the
 * nearest Suspense boundary; the module routes are dynamic, but a component
 * used on a static route must sit inside <Suspense>.
 */
export function useUrlState<S extends z.ZodObject>(
  schema: S,
  defaults: z.output<S>,
) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const key = JSON.stringify(defaults);
  const state = useMemo(
    () => parseUrlState(schema, defaults, params),
    // defaults is compared by value so an inline object does not re-parse.
    [schema, key, params],
  );
  const setState = useCallback(
    (patch: Partial<z.output<S>>) => {
      const query = serialiseUrlState(
        { ...state, ...patch },
        defaults,
        params.toString(),
      );
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [state, key, params, pathname, router],
  );
  return [state, setState] as const;
}
