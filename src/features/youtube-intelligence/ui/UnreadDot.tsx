"use client";
import { useWorkspace } from "./workspace.tsx";
import { TRACKED_HINT, useUnread, type UnreadRun } from "./unread.ts";

/**
 * The unread dot (F70): an accent dot beside a video that finished after the
 * watermark and has not been opened on this browser. For Today's activity
 * list, channel pages and Search Videos. `at` is when the analysis finished
 * (a run's updatedAt); pass `status` when known so unfinished runs never get
 * a dot. Renders nothing when storage is blocked.
 */
export function UnreadDot({ run }: { run: UnreadRun }) {
  const { isUnread } = useUnread();
  if (!isUnread(run)) return null;
  return (
    <span className="yi-unread-dot" title={`New · ${TRACKED_HINT.toLowerCase()}`}>
      <span className="yi-sr-only">New</span>
    </span>
  );
}

/** "N new" beside Today in the module sidebar, over the loaded activity. */
export function UnreadCount() {
  const { data } = useWorkspace();
  const { available, unread } = useUnread();
  if (!available || !data) return null;
  const n = unread(runsForUnread(data.runs)).length;
  if (!n) return null;
  return (
    <span className="yi-nav-new" title={TRACKED_HINT}>
      {n} new
    </span>
  );
}

/** Runs as the markers see them: finished time is the run's last update. */
export const runsForUnread = <T extends { id: string; status: string; updatedAt: string }>(
  runs: T[],
) => runs.map((r) => ({ ...r, at: r.updatedAt }));
