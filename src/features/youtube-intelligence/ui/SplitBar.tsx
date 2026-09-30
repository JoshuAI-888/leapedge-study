import {
  splitCountText,
  splitSegments,
  splitTitle,
  type SentimentSplit,
} from "./foundations.ts";

export { sentimentOf, sentimentCounts } from "./foundations.ts";

/**
 * The sentiment split bar (F57): bullish, neutral and bearish segments in that
 * fixed order with 2 px gaps, the counts as text beside it ("12 ▲ · 3 ● · 1 ▼")
 * so colour is never the only cue, and calls and creators in the hover.
 */
export function SplitBar({
  calls,
  creators,
  label,
  noun,
  showCounts = true,
}: {
  calls: SentimentSplit;
  creators?: SentimentSplit;
  /** What is counted, singular; defaults to "call". */
  noun?: string;
  /** What the bar describes, prefixed to the accessible name (e.g. "NVDA"). */
  label?: string;
  showCounts?: boolean;
}) {
  const segments = splitSegments(calls);
  const title = splitTitle(calls, creators, noun);
  return (
    <span
      className="yi-split"
      role="img"
      title={title}
      aria-label={label ? `${label}: ${title}` : title}
    >
      <span className="yi-split-bar" aria-hidden="true">
        {segments.length ? (
          segments.map((s) => (
            <i
              key={s.sentiment}
              className={`yi-split-${s.sentiment}`}
              style={{ flexGrow: s.percent }}
            />
          ))
        ) : (
          <i className="yi-split-empty" />
        )}
      </span>
      {showCounts && (
        <span className="yi-split-counts" aria-hidden="true">
          {segments.length ? splitCountText(calls) : `No ${noun ?? "call"}s`}
        </span>
      )}
    </span>
  );
}
