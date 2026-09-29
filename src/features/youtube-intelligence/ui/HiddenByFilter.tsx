import { hiddenByFilterText } from "./foundations.ts";

/**
 * "5 calls hidden by the Audio-agreed trust filter · Show them" (F57). Every
 * filtered view states what its filter removed and offers a one-click reveal.
 * Renders nothing when the filter hides nothing.
 */
export function HiddenByFilter({
  count,
  filter,
  noun,
  onReveal,
  revealLabel = "Show them",
}: {
  count: number;
  /** Names the filter, e.g. "the Audio-agreed trust filter". */
  filter: string;
  noun?: string;
  onReveal: () => void;
  revealLabel?: string;
}) {
  const text = hiddenByFilterText(count, filter, noun);
  if (!text) return null;
  return (
    <p className="yi-hidden-by-filter">
      <span>{text}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="yi-text-button" onClick={onReveal}>
        {revealLabel}
      </button>
    </p>
  );
}
