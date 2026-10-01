import Link from "next/link";
import { describeInstrument, type ClaimLike } from "../instrument-kind.ts";

/**
 * The instrument label (F59): a ticker ("NVDA", "BTC"), or a vocabulary theme
 * ("MACRO · RATES", "SECTOR · SEMIS") drawn with a dashed outline so it reads
 * as a different kind of thing without extra colour. Every resolved label
 * links to Search for that instrument. A genuinely unknown name stays muted
 * with a "Suggest a ticker" hint instead of a link.
 */
export function InstrumentLabel({
  claim,
  link = true,
}: {
  claim: ClaimLike;
  link?: boolean;
}) {
  const d = describeInstrument(claim);
  if (d.kind === "unresolved")
    return (
      <span
        className="yi-instrument yi-instrument-unresolved"
        title={
          d.spoken
            ? `No ticker was spoken for "${d.spoken}". Suggest a ticker if you know the listing.`
            : "The creator did not name an instrument. Suggest a ticker if you know it."
        }
      >
        {d.text}
        <small className="yi-instrument-hint">Suggest a ticker</small>
      </span>
    );
  const theme = d.kind === "macro" || d.kind === "sector";
  const className = `yi-instrument yi-instrument-${d.kind}${theme ? " yi-instrument-theme" : ""}`;
  const title = theme
    ? `${d.canonical}${d.spoken && d.spoken !== d.canonical ? ` · said as "${d.spoken}"` : ""}`
    : d.spoken && d.spoken !== d.text
      ? `Said as "${d.spoken}"`
      : undefined;
  if (!link || !d.href)
    return (
      <span className={className} title={title}>
        {d.text}
      </span>
    );
  return (
    <Link className={className} href={d.href} title={title}>
      {d.text}
    </Link>
  );
}
