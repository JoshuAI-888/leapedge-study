import { sparklinePoints } from "./foundations.ts";

/**
 * A one-colour sparkline (F57): an ink-coloured line with an emphasised
 * endpoint. Direction is never coloured, so colour keeps its single meaning
 * (sentiment). Zero points draws an empty frame; one point, just the endpoint.
 */
export function Sparkline({
  values,
  label,
  width = 96,
  height = 24,
}: {
  values: number[];
  /** Accessible name, e.g. "Mentions per day over the last 7 days". */
  label: string;
  width?: number;
  height?: number;
}) {
  const inset = 3;
  const points = sparklinePoints(values, width - inset * 2, height, inset).map(
    (p) => ({ x: p.x + inset, y: p.y }),
  );
  const end = points.at(-1);
  const name = points.length ? label : `${label}: no data`;
  return (
    <svg
      className="yi-sparkline"
      role="img"
      aria-label={name}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      <title>{name}</title>
      {points.length > 1 && (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(" ")}
        />
      )}
      {end && <circle cx={end.x} cy={end.y} r={2.75} fill="currentColor" />}
    </svg>
  );
}
