import type { SourceData, ClaimData } from "./contracts.ts";
// Only caption formatting spaces adjacent to Han characters are ignored for locating
// a quote. Punctuation, Latin word boundaries, digits and negations are preserved.
function indexed(text: string) {
  const offsets: number[] = [];
  let normalized = "";
  for (let i = 0; i < text.length; i++) {
    if (
      /\s/u.test(text[i]) &&
      (/\p{Script=Han}/u.test(text[i - 1] || "") ||
        /\p{Script=Han}/u.test(text[i + 1] || ""))
    )
      continue;
    offsets.push(i);
    normalized += text[i];
  }
  return { normalized, offsets };
}
export function alignCaptionEvidence(
  e: ClaimData["evidence"][number],
  source: SourceData,
) {
  if (
    !source.source_kind.includes("captions") ||
    source.segment_separator === undefined
  )
    return e;
  const starts: number[] = [];
  let cursor = 0;
  for (const s of source.segments) {
    starts.push(cursor);
    cursor += s.text.length + source.segment_separator.length;
  }
  const text = source.segments
    .map((s) => s.text)
    .join(source.segment_separator);
  const raw = indexed(text),
    wanted = indexed(e.quote_original).normalized;
  if (!wanted.length) return e;
  const at = raw.normalized.indexOf(wanted);
  if (at < 0 || raw.normalized.indexOf(wanted, at + 1) >= 0) return e;
  const lo = raw.offsets[at],
    hi = raw.offsets[at + wanted.length - 1] + 1;
  const start = starts.findLastIndex((n) => n <= lo),
    end = starts.findLastIndex((n) => n < hi);
  if (start < 0 || end < start || end - start >= 100 || hi - lo > 4000)
    return e;
  const a = source.segments[start],
    b = source.segments[end];
  if (
    lo >= starts[start] + a.text.length ||
    (a.start_seconds !== null &&
      b.end_seconds !== null &&
      b.end_seconds - a.start_seconds > 120)
  )
    return e;
  // The stored quote becomes the exact retained substring, never a model rewrite.
  return {
    ...e,
    segment_id: a.id,
    end_segment_id: end > start ? b.id : undefined,
    quote_original: text.slice(lo, hi),
  };
}
