import type { ReactNode } from "react";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SplitBar } from "./SplitBar.tsx";
import {
  NO_IDEAS_TEXT,
  clock,
  convictionText,
  splitShortText,
  verdictLineText,
  verdictOf,
  type KeyPointItem,
  type Verdict,
  type VerdictClaim,
} from "../verdict.ts";

export { verdictOf, verdictLineText } from "../verdict.ts";

/**
 * The compact verdict line (F61) for lists of videos:
 * "4 ideas · 3 ▲ 1 ● · NVDA AVGO TSM". Pass the video's accepted calls, or a
 * verdict already computed with verdictOf().
 */
export function VerdictLine({
  claims,
  verdict,
  maxInstruments = 4,
}: {
  claims?: VerdictClaim[];
  verdict?: Verdict;
  maxInstruments?: number;
}) {
  const v = verdict ?? verdictOf(claims ?? []);
  if (!v.ideas)
    return <span className="yi-verdict-line yi-verdict-none">{NO_IDEAS_TEXT}</span>;
  const shown = v.instruments.slice(0, maxInstruments);
  const more = v.instruments.length - shown.length;
  return (
    <span className="yi-verdict-line" title={verdictLineText(v)}>
      <span>
        {v.ideas} {v.ideas === 1 ? "idea" : "ideas"}
      </span>
      <span aria-hidden="true"> · </span>
      <span>{splitShortText(v.split)}</span>
      <span aria-hidden="true"> · </span>
      <span className="yi-verdict-tickers">
        {shown.map((i) => i.text).join(" ")}
        {more > 0 ? ` +${more}` : ""}
      </span>
    </span>
  );
}

/** The verdict box at the top of an analysis. */
export function VerdictBox({
  claims,
  children,
}: {
  claims: VerdictClaim[];
  children?: ReactNode;
}) {
  const v = verdictOf(claims);
  if (!v.ideas)
    return (
      <section className="yi-verdict yi-verdict-empty" aria-label="Verdict">
        <strong>No investable ideas</strong>
        <span className="yi-muted"> · educational or commentary</span>
        {children}
      </section>
    );
  return (
    <section className="yi-verdict" aria-label="Verdict">
      <div className="yi-verdict-head">
        <strong>
          {v.ideas} {v.ideas === 1 ? "idea" : "ideas"}
        </strong>
        {v.conviction && (
          <span
            className="yi-muted"
            title="The conviction the creator stated most often across accepted calls; a tie goes to the higher one."
          >
            {" "}
            · {convictionText(v.conviction)}
          </span>
        )}
      </div>
      <SplitBar calls={v.split} label="Accepted calls" />
      <div className="yi-verdict-instruments">
        {v.instruments.map((i) => (
          <InstrumentLabel key={i.text} claim={i.claim} />
        ))}
      </div>
      {children}
    </section>
  );
}

/** Numbered key points in video order, each able to seek the player. */
export function KeyPoints({
  points,
  total,
  onSeek,
}: {
  points: KeyPointItem[];
  total: number;
  onSeek: (seconds: number) => void;
}) {
  if (!points.length) return null;
  return (
    <section className="yi-keypoints" aria-label="Key points">
      <h2>Key points</h2>
      <ol>
        {points.map((p) => (
          <li key={p.id}>
            <span>{p.text}</span>
            {p.seconds !== null ? (
              <button
                type="button"
                className="yi-text-button yi-keypoint-seek"
                onClick={() => onSeek(p.seconds!)}
                aria-label={`Play from ${clock(p.seconds)}: ${p.text}`}
              >
                ▶ {clock(p.seconds)}
              </button>
            ) : (
              <span className="yi-muted yi-keypoint-seek">Untimed</span>
            )}
          </li>
        ))}
      </ol>
      {total > points.length && (
        <p className="yi-muted">
          Showing the first {points.length} of {total} points in video order.
          The rest are in the Calls tab and Processing details.
        </p>
      )}
    </section>
  );
}
