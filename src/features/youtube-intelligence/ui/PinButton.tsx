"use client";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
import { PINNABLE } from "../watchlist.ts";

/**
 * The pin toggle (F68): ☆ / ★ beside an instrument label. It writes the team
 * watchlist through the existing `research/watch` action, so a pin is shared
 * by everyone on the passcode, not a personal favourite; the accessible name
 * says so. Renders nothing for an instrument without a pinnable ticker
 * (a macro theme or an unresolved name). For the Analysis header, Search rows,
 * the report's In focus rows and quick search.
 */
export function PinButton({
  ticker,
  className = "",
}: {
  ticker: string | null | undefined;
  className?: string;
}) {
  const { data, busy, perform } = useWorkspace();
  const symbol = ticker?.trim().toUpperCase() ?? "";
  if (!data || !PINNABLE.test(symbol)) return null;
  const pinned = data.snapshot.watchlist.some(
    (w) =>
      String((w as { ticker?: unknown }).ticker ?? "").toUpperCase() === symbol &&
      (w as { enabled?: unknown }).enabled === true,
  );
  return (
    <button
      type="button"
      className={`yi-pin ${className}`.trim()}
      aria-pressed={pinned}
      aria-label={`Pin to team watchlist: ${symbol}`}
      title={pinned ? `${symbol} is on the team watchlist. Select to unpin.` : `Pin ${symbol} to the team watchlist`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void perform(
          () => action("research", "watch", { ticker: symbol, enabled: !pinned }),
          pinned
            ? `${symbol} removed from the team watchlist.`
            : `${symbol} pinned to the team watchlist.`,
        );
      }}
    >
      <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
    </button>
  );
}
