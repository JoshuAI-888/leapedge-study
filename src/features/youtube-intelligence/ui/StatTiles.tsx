import type { ReactNode } from "react";
import { statDelta } from "./foundations.ts";

export type StatTile = {
  label: string;
  value: ReactNode;
  /** Numeric value this period and the prior period, for the change line. */
  current?: number;
  prior?: number | null;
  /** Replaces the computed change line, e.g. "Too few settled calls". */
  note?: string;
  /** Optional visual, usually a Sparkline. */
  children?: ReactNode;
};

/**
 * Headline tile row (F57): at most four tiles, each with a label, a value, the
 * change against the prior period and an optional sparkline. The change is
 * text with a sign, never red or green.
 */
export function StatTiles({
  tiles,
  label,
}: {
  tiles: StatTile[];
  label: string;
}) {
  return (
    <dl className="yi-stat-tiles" aria-label={label}>
      {tiles.slice(0, 4).map((tile) => {
        const change =
          tile.note ??
          (tile.current === undefined
            ? null
            : statDelta(tile.current, tile.prior ?? null).text);
        return (
          <div className="yi-stat-tile" key={tile.label}>
            <dt>{tile.label}</dt>
            <dd className="yi-stat-value">{tile.value}</dd>
            {change && <dd className="yi-stat-delta">{change}</dd>}
            {tile.children && (
              <dd className="yi-stat-visual">{tile.children}</dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
