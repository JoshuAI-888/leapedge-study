"use client";
/**
 * Unread markers (F70), kept in this browser's local storage only.
 *
 * The state is a watermark (`since`), the ids of analyses opened after it, and
 * the time of the last Today visit. A finished analysis is new when it
 * finished after the watermark and has not been opened here. Opening its
 * Analysis page marks it seen; "Mark all as seen" moves the watermark to now
 * and empties the list, which also keeps the list short. On first use the
 * watermark starts at that moment, so an existing library is not all "new".
 *
 * Nothing here is per person: the hover says "Tracked on this browser". When
 * storage is blocked (private mode, a policy, a thumbnailer) every read and
 * write is caught, `available` is false, and callers show no markers.
 */
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

export const UNREAD_KEY = "yi-unread-v1";
/** Seen ids kept after the watermark; older ones cannot be new anyway. */
export const SEEN_LIMIT = 500;
export const TRACKED_HINT = "Tracked on this browser";

const State = z.object({
  since: z.iso.datetime({ offset: true }),
  lastVisit: z.iso.datetime({ offset: true }).nullable(),
  seen: z.array(z.string()),
});
export type UnreadState = z.infer<typeof State>;
export type StorageLike = Pick<Storage, "getItem" | "setItem">;
/** A run as the markers need it: finished analyses only. */
export type UnreadRun = { id: string; status?: string; at?: string | null };

/** The stored state, or null when storage cannot be used. Absent or damaged state starts fresh at `now`. */
export function loadUnread(
  storage: () => StorageLike | null | undefined,
  now: string,
): UnreadState | null {
  try {
    const s = storage();
    if (!s) return null;
    const raw = s.getItem(UNREAD_KEY);
    if (raw) {
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        // Damaged state starts fresh below.
      }
      const parsed = State.safeParse(json);
      if (parsed.success) return parsed.data;
    }
    const fresh: UnreadState = { since: now, lastVisit: null, seen: [] };
    s.setItem(UNREAD_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return null;
  }
}

function save(
  storage: () => StorageLike | null | undefined,
  state: UnreadState,
): UnreadState | null {
  try {
    const s = storage();
    if (!s) return null;
    s.setItem(UNREAD_KEY, JSON.stringify(state));
    return state;
  } catch {
    return null;
  }
}

/** New: a finished analysis, finished after the watermark, not opened here. */
export function isUnread(state: UnreadState | null, run: UnreadRun): boolean {
  if (!state || !run.at) return false;
  if (run.status !== undefined && run.status !== "completed") return false;
  const at = Date.parse(run.at);
  return (
    Number.isFinite(at) &&
    at > Date.parse(state.since) &&
    !state.seen.includes(run.id)
  );
}
export function unreadRuns<T extends UnreadRun>(
  state: UnreadState | null,
  runs: T[],
): T[] {
  return runs.filter((r) => isUnread(state, r));
}

export function markSeen(
  storage: () => StorageLike | null | undefined,
  ids: string[],
  now: string,
): UnreadState | null {
  const state = loadUnread(storage, now);
  if (!state) return null;
  const seen = [...state.seen.filter((id) => !ids.includes(id)), ...ids];
  return save(storage, { ...state, seen: seen.slice(-SEEN_LIMIT) });
}

/** "Mark all as seen": the watermark moves to now and the list empties. */
export function markAllSeen(
  storage: () => StorageLike | null | undefined,
  now: string,
): UnreadState | null {
  const state = loadUnread(storage, now);
  if (!state) return null;
  return save(storage, { ...state, since: now, seen: [] });
}

/** Records a Today visit; returns the previous one (null on the first). */
export function recordVisit(
  storage: () => StorageLike | null | undefined,
  now: string,
): { previous: string | null; state: UnreadState } | null {
  const state = loadUnread(storage, now);
  if (!state) return null;
  const next = save(storage, { ...state, lastVisit: now });
  return next ? { previous: state.lastVisit, state: next } : null;
}

// ---------------------------------------------------------------------------
// React bindings. One module-level store so the sidebar count, the Today group
// and every dot agree the moment anything is marked seen.

const browserStorage = (): StorageLike | null =>
  typeof window === "undefined" ? null : window.localStorage;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
/** The previous Today visit, captured once per page load. */
let visit: { previous: string | null } | undefined;

export function useUnread() {
  const [state, setState] = useState<UnreadState | null>(null);
  useEffect(() => {
    const load = () =>
      setState(loadUnread(browserStorage, new Date().toISOString()));
    load();
    listeners.add(load);
    // Another tab of this browser.
    const onStorage = (e: StorageEvent) => {
      if (e.key === UNREAD_KEY || e.key === null) load();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(load);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const seeAll = useCallback(() => {
    markAllSeen(browserStorage, new Date().toISOString());
    notify();
  }, []);
  return {
    /** False until loaded, and whenever storage is blocked. */
    available: state !== null,
    state,
    isUnread: (run: UnreadRun) => isUnread(state, run),
    unread: <T extends UnreadRun>(runs: T[]) => unreadRuns(state, runs),
    markAllSeen: seeAll,
  };
}

/** Today calls this once: the previous visit (for "last visit" text), then records this one. */
export function useTodayVisit(): string | null {
  const [previous, setPrevious] = useState<string | null>(
    visit?.previous ?? null,
  );
  useEffect(() => {
    if (!visit) {
      const r = recordVisit(browserStorage, new Date().toISOString());
      visit = { previous: r?.previous ?? null };
    }
    setPrevious(visit.previous);
  }, []);
  return previous;
}

/** The Analysis page's one line: opening an analysis marks it seen here. */
export function useMarkSeen(runId: string | null | undefined) {
  useEffect(() => {
    if (!runId) return;
    if (markSeen(browserStorage, [runId], new Date().toISOString())) notify();
  }, [runId]);
}
