"use client";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  CONVICTION_RADIUS,
  divergingScale,
  periodLabel,
  placeOnPrice,
  priceScale,
  shortDate,
  timeScale,
  timeTicks,
  type PeriodUnit,
  type TrendBucket,
} from "../trends-series.ts";

/**
 * Hand-written SVG charts for Trends (F65) and the channel page (F66).
 * Responsive through a measured width and a matching viewBox. Every chart:
 * - uses one vertical scale (never two on one plot);
 * - colours marks by sentiment only, with ▲ ● ▼ and text alongside;
 * - has a hover and keyboard tooltip that never gates a value (the page
 *   offers the same data as a table).
 */
export const SENTIMENT_GLYPH = { bullish: "▲", neutral: "●", bearish: "▼" } as const;
type Sentiment = keyof typeof SENTIMENT_GLYPH;

const M = { top: 12, right: 12, bottom: 30, left: 44 };

function useWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x + 14), width - 230);
  return (
    <div className="yi-chart-tooltip" role="status" style={{ left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

function XAxis({ from, to, x, y, width }: { from: string; to: string; x: (d: string) => number; y: number; width: number }) {
  const ticks = timeTicks(from, to, Math.max(2, Math.floor(width / 110)));
  // Over about a year the same month appears twice, so month ticks carry the year.
  const long = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 330 * 86_400_000;
  const text = (t: string) =>
    long
      ? `${new Date(Date.parse(`${t}T00:00:00Z`)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ’${t.slice(2, 4)}`
      : shortDate(t);
  return (
    <g className="yi-chart-axis" aria-hidden="true">
      <line x1={0} x2={width} y1={y} y2={y} />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={y + 18} textAnchor={x(t) < 20 ? "start" : "middle"}>
          {text(t)}
        </text>
      ))}
    </g>
  );
}

/**
 * Calls per period by sentiment: bullish columns above the zero line, bearish
 * below, on one scale. Neutral counts are in the tooltip and the table. The
 * crosshair snaps to the nearest period; a click (or Enter) selects it.
 */
export function SentimentColumns({
  buckets,
  unit,
  from,
  to,
  selected,
  onSelect,
  height = 240,
  label,
}: {
  buckets: TrendBucket[];
  unit: PeriodUnit;
  from: string;
  to: string;
  selected?: string | null;
  onSelect?: (bucket: TrendBucket | null) => void;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const plotW = width - M.left - M.right,
    plotH = height - M.top - M.bottom;
  const x = timeScale(from, to, plotW);
  const scale = divergingScale(buckets, plotH);
  const centre = (b: TrendBucket) => {
    const a = x(b.start),
      z = x(nextDay(b.end));
    return { mid: (a + z) / 2, slot: z - a };
  };
  const nearest = (px: number) => {
    let best = 0,
      dist = Infinity;
    buckets.forEach((b, i) => {
      const d = Math.abs(centre(b).mid - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return buckets.length ? best : null;
  };
  const move = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width - M.left;
    setActive(nearest(px));
    setPointer({ x: ((e.clientX - box.left) / box.width) * width, y: ((e.clientY - box.top) / box.height) * height });
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!buckets.length) return;
    const i = active ?? buckets.length - 1;
    if (e.key === "ArrowRight") setActive(Math.min(buckets.length - 1, i + (active === null ? 0 : 1)));
    else if (e.key === "ArrowLeft") setActive(Math.max(0, i - (active === null ? 0 : 1)));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(buckets.length - 1);
    else if (e.key === "Enter" || e.key === " ") onSelect?.(buckets[i]);
    else if (e.key === "Escape") onSelect?.(null);
    else return;
    e.preventDefault();
    setPointer(null);
  };
  const shown = active === null ? null : buckets[active];
  const tipAt = shown
    ? pointer ?? { x: M.left + centre(shown).mid, y: M.top + scale.y(Math.max(shown.bullish, 0)) }
    : null;
  const tick = (v: number) => Math.abs(v).toLocaleString("en-US");
  return (
    <div className="yi-chart" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`${label}. Use the left and right arrow keys to read each ${unit === "week" ? "week" : "session"}; Enter filters the list to it.`}
        tabIndex={0}
        onKeyDown={key}
        onFocus={() => setActive((a) => a ?? (buckets.length ? buckets.length - 1 : null))}
        onBlur={() => {
          setActive(null);
          setPointer(null);
        }}
      >
        <g transform={`translate(${M.left},${M.top})`}>
          <g className="yi-chart-grid" aria-hidden="true">
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={scale.y(t)} y2={scale.y(t)} className={t === 0 ? "yi-chart-zero" : undefined} />
                <text x={-8} y={scale.y(t) + 4} textAnchor="end">
                  {tick(t)}
                </text>
              </g>
            ))}
          </g>
          {buckets.map((b) => {
            const { mid, slot } = centre(b);
            const w = Math.max(2, Math.min(24, slot * 0.7));
            const up = scale.zero - scale.y(b.bullish);
            const down = scale.y(-b.bearish) - scale.zero;
            const dim = selected && selected !== b.start ? " yi-chart-dim" : "";
            return (
              <g key={b.start} aria-hidden="true">
                {b.bullish > 0 && (
                  <path className={`yi-mark-bullish${dim}`} d={column(mid - w / 2, scale.zero - 1, w, Math.max(1, up - 1), "up")} />
                )}
                {b.bearish > 0 && (
                  <path className={`yi-mark-bearish${dim}`} d={column(mid - w / 2, scale.zero + 1, w, Math.max(1, down - 1), "down")} />
                )}
              </g>
            );
          })}
          {shown && <line className="yi-chart-crosshair" x1={centre(shown).mid} x2={centre(shown).mid} y1={0} y2={plotH} aria-hidden="true" />}
          {scale.top > 0 && (
            <text className="yi-chart-direct" x={4} y={12} aria-hidden="true">
              ▲ bullish
            </text>
          )}
          {scale.bottom > 0 && (
            <text className="yi-chart-direct" x={4} y={plotH - 4} aria-hidden="true">
              ▼ bearish
            </text>
          )}
          <XAxis from={from} to={to} x={x} y={plotH} width={plotW} />
          <rect
            className="yi-chart-hit"
            x={0}
            y={0}
            width={plotW}
            height={plotH}
            onPointerMove={move}
            onPointerLeave={() => {
              setActive(null);
              setPointer(null);
            }}
            onClick={() => shown && onSelect?.(shown)}
          />
        </g>
      </svg>
      {shown && tipAt && (
        <Tooltip x={tipAt.x} y={tipAt.y} width={width}>
          <strong>{periodLabel(shown.start, unit)}</strong>
          {(["bullish", "neutral", "bearish"] as const).map((s) => (
            <span key={s} className="yi-tip-row">
              <i className={`yi-key yi-key-${s}`} aria-hidden="true" />
              <b>{shown[s]}</b> {SENTIMENT_GLYPH[s]} {s}
            </span>
          ))}
          <span className="yi-muted">{onSelect ? "Click to list these calls" : `${shown.calls} calls`}</span>
        </Tooltip>
      )}
    </div>
  );
}
function nextDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
/** A column with a 4px rounded data end and a square base on the zero line. */
function column(x: number, base: number, w: number, h: number, dir: "up" | "down") {
  const r = Math.min(4, w / 2, h);
  if (dir === "up") {
    const top = base - h;
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
  }
  const bottom = base + h;
  return `M${x},${base}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${base}Z`;
}

export type ChartCall = {
  id: string;
  session: string;
  sentiment: Sentiment;
  conviction: string;
  stance: string;
  thesis: string;
  channel: string | null;
  href: string;
};

function Dot({
  call,
  cx,
  cy,
  onFocus,
  onBlur,
  onOpen,
}: {
  call: ChartCall;
  cx: number;
  cy: number;
  onFocus: () => void;
  onBlur: () => void;
  onOpen: (call: ChartCall) => void;
}) {
  const r = CONVICTION_RADIUS[call.conviction] ?? 4;
  return (
    <g
      className="yi-chart-dot"
      tabIndex={0}
      role="link"
      aria-label={`${shortDate(call.session)}, ${call.channel ?? "unknown channel"}: ${call.stance}, ${call.conviction} conviction. ${call.thesis}`}
      onPointerEnter={onFocus}
      onPointerLeave={onBlur}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={() => onOpen(call)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(call);
        }
      }}
    >
      <circle cx={cx} cy={cy} r={12} className="yi-chart-dot-hit" />
      <circle cx={cx} cy={cy} r={r} className={`yi-mark-${call.sentiment} yi-chart-ring`} />
    </g>
  );
}
function CallTip({ call, x, y, width, extra }: { call: ChartCall; x: number; y: number; width: number; extra?: string }) {
  return (
    <Tooltip x={x} y={y} width={width}>
      <strong>
        {SENTIMENT_GLYPH[call.sentiment]} {call.stance} · {shortDate(call.session)}
      </strong>
      <span>{call.thesis}</span>
      <span className="yi-muted">
        {call.channel ?? "Unknown channel"} · {call.conviction} conviction{extra ? ` · ${extra}` : ""}
      </span>
    </Tooltip>
  );
}

/**
 * The adjusted close as a line, with each call as a dot on the line at its
 * session: size is conviction, colour is sentiment. Its own vertical scale;
 * the x axis matches the columns chart above it.
 */
export function PriceCallChart({
  prices,
  calls,
  from,
  to,
  symbol,
  onOpen,
  height = 220,
}: {
  prices: { date: string; close: number }[];
  calls: ChartCall[];
  from: string;
  to: string;
  symbol: string;
  onOpen: (call: ChartCall) => void;
  height?: number;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<string | null>(null);
  const plotW = width - M.left - M.right,
    plotH = height - M.top - M.bottom;
  const inRange = prices.filter((p) => p.date >= from && p.date <= to);
  const y = priceScale(inRange.map((p) => p.close), plotH);
  const x = timeScale(from, to, plotW);
  const { placed, unplaced } = placeOnPrice(calls, inRange);
  if (!y) return null;
  const line = inRange.map((p, i) => `${i ? "L" : "M"}${(x(p.date) + (x(nextDay(p.date)) - x(p.date)) / 2).toFixed(1)},${y.y(p.close).toFixed(1)}`).join("");
  const mid = (d: string) => x(d) + (x(nextDay(d)) - x(d)) / 2;
  const shown = placed.find((c) => c.id === active);
  return (
    <div className="yi-chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-label={`${symbol} adjusted close with ${placed.length} calls placed on the line`}>
        <g transform={`translate(${M.left},${M.top})`}>
          <g className="yi-chart-grid" aria-hidden="true">
            {y.ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y.y(t)} y2={y.y(t)} />
                <text x={-8} y={y.y(t) + 4} textAnchor="end">
                  {t.toLocaleString("en-US")}
                </text>
              </g>
            ))}
          </g>
          <path className="yi-chart-line" d={line} aria-hidden="true" />
          <XAxis from={from} to={to} x={x} y={plotH} width={plotW} />
          {placed.map((c) => (
            <Dot
              key={c.id}
              call={c}
              cx={mid(c.priceDate)}
              cy={y.y(c.close)}
              onFocus={() => setActive(c.id)}
              onBlur={() => setActive((a) => (a === c.id ? null : a))}
              onOpen={onOpen}
            />
          ))}
        </g>
      </svg>
      {shown && (
        <CallTip call={shown} x={M.left + mid(shown.priceDate)} y={M.top + y.y(shown.close)} width={width} extra={`close ${shown.close.toLocaleString("en-US")}`} />
      )}
      {unplaced.length > 0 && (
        <p className="yi-muted yi-chart-note">
          {unplaced.length} call{unplaced.length === 1 ? "" : "s"} fall outside the stored closes and {unplaced.length === 1 ? "is" : "are"} not placed; the columns above count {unplaced.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

/**
 * Calls as dots in three lanes (bullish, neutral, bearish) on the shared date
 * axis, for the channel and sentiment views. Same-session dots step sideways
 * inside their lane so none hides another completely.
 */
export function CallDotTimeline({
  calls,
  from,
  to,
  onOpen,
  label,
}: {
  calls: ChartCall[];
  from: string;
  to: string;
  onOpen: (call: ChartCall) => void;
  label: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<string | null>(null);
  const lanes = (["bullish", "neutral", "bearish"] as const).filter((s) => calls.some((c) => c.sentiment === s));
  const laneH = 44;
  // The same left margin as the columns chart, so the two date axes line up.
  const left = M.left;
  const height = M.top + lanes.length * laneH + M.bottom;
  const plotW = width - left - M.right;
  const x = timeScale(from, to, plotW);
  const mid = (d: string) => x(d) + (x(nextDay(d)) - x(d)) / 2;
  const seen = new Map<string, number>();
  const placed = calls
    .filter((c) => c.session >= from && c.session <= to)
    .map((c) => {
      const key = `${c.sentiment}:${c.session}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const lane = lanes.indexOf(c.sentiment);
      return { call: c, cx: mid(c.session), cy: lane * laneH + laneH / 2 + ((n % 3) - 1) * 9 };
    });
  const shown = placed.find((p) => p.call.id === active);
  if (!lanes.length) return null;
  return (
    <div className="yi-chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-label={label}>
        <g transform={`translate(${left},${M.top})`}>
          <g className="yi-chart-grid" aria-hidden="true">
            {lanes.map((s, i) => (
              <g key={s}>
                <line x1={0} x2={plotW} y1={(i + 1) * laneH} y2={(i + 1) * laneH} />
                <text x={-10} y={i * laneH + laneH / 2 + 4} textAnchor="end">
                  {SENTIMENT_GLYPH[s]}
                </text>
              </g>
            ))}
          </g>
          <XAxis from={from} to={to} x={x} y={lanes.length * laneH} width={plotW} />
          {placed.map((p) => (
            <Dot
              key={p.call.id}
              call={p.call}
              cx={p.cx}
              cy={p.cy}
              onFocus={() => setActive(p.call.id)}
              onBlur={() => setActive((a) => (a === p.call.id ? null : a))}
              onOpen={onOpen}
            />
          ))}
        </g>
      </svg>
      {shown && <CallTip call={shown.call} x={left + shown.cx} y={M.top + shown.cy} width={width} />}
    </div>
  );
}
