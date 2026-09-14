import type { ClaimData, SourceData } from "./contracts.ts";

// Experimental serialization only: split exact text separated solely by a cue boundary.
// Never edit source words, punctuation, numbers, negations or invent per-fragment translations.
export function splitExactBoundaryQuotes(claim: ClaimData, source: SourceData) {
  const repairs: {
    evidenceIndex: number;
    originalQuote: string;
    groupTranslation: string;
    segmentIds: string[];
  }[] = [];
  const evidence = claim.evidence.flatMap((e, evidenceIndex) => {
    const start = source.segments.findIndex((s) => s.id === e.segment_id);
    if (
      start < 0 ||
      e.end_segment_id ||
      source.segments[start].text.includes(e.quote_original)
    )
      return [e];
    const cues = source.segments.slice(start, start + 12);
    const offsets: number[] = [];
    let length = 0;
    for (const cue of cues) {
      offsets.push(length);
      length += cue.text.length + 1;
    }
    const joined = cues.map((s) => s.text).join(" ");
    const at = joined.indexOf(e.quote_original);
    if (
      at < 0 ||
      at >= cues[0].text.length ||
      joined.indexOf(e.quote_original, at + 1) >= 0
    )
      return [e];
    const end = at + e.quote_original.length;
    const pieces = cues.flatMap((cue, i) => {
      const a = Math.max(at, offsets[i]),
        b = Math.min(end, offsets[i] + cue.text.length);
      return b > a
        ? [
            {
              segment_id: cue.id,
              quote_original: cue.text.slice(a - offsets[i], b - offsets[i]),
              quote_translation_en: "",
            },
          ]
        : [];
    });
    if (
      pieces.length < 2 ||
      pieces.map((p) => p.quote_original).join(" ") !== e.quote_original
    )
      return [e];
    repairs.push({
      evidenceIndex,
      originalQuote: e.quote_original,
      groupTranslation: e.quote_translation_en,
      segmentIds: pieces.map((p) => p.segment_id),
    });
    return pieces;
  });
  return { claim: { ...claim, evidence }, repairs };
}
