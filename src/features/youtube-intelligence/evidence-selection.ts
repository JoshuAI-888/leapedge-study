import { z } from "zod";
import { Claim, type SourceData } from "./contracts.ts";

// Experimental: model selects IDs; application copies original text. Selection
// proves provenance only, never interpretation, completeness or audio accuracy.
export const SelectedClaim = Claim.omit({ evidence: true }).extend({
  evidence_segment_ids: z.array(z.string().min(1)).min(1).max(20),
});
export function materializeSelectedClaim(raw: unknown, source: SourceData) {
  const { evidence_segment_ids, ...fields } = SelectedClaim.parse(raw);
  if (new Set(evidence_segment_ids).size !== evidence_segment_ids.length)
    throw Error("Duplicate evidence selection");
  const evidence = evidence_segment_ids.map((id) => {
    const segment = source.segments.find((s) => s.id === id);
    if (!segment) throw Error(`Unknown evidence segment: ${id}`);
    return {
      segment_id: id,
      quote_original: segment.text,
      quote_translation_en: "",
    };
  });
  return Claim.parse({ ...fields, evidence });
}

// Experimental range selection: copy full source spans, never retrofit a model's
// paraphrase into a verbatim quote. Requires a NEW semantic audit before use.
export const RangeSelectedClaim = Claim.omit({ evidence: true }).extend({
  evidence_ranges: z
    .array(z.object({ start_id: z.string().min(1), end_id: z.string().min(1) }))
    .min(1)
    .max(20),
});
export function materializeEvidenceRanges(raw: unknown, source: SourceData) {
  const { evidence_ranges, ...fields } = RangeSelectedClaim.parse(raw);
  const seen = new Set<string>();
  const evidence = evidence_ranges.map((range) => {
    const key = JSON.stringify(range);
    if (seen.has(key)) throw Error("Duplicate evidence range");
    seen.add(key);
    const start = source.segments.findIndex((s) => s.id === range.start_id),
      end = source.segments.findIndex((s) => s.id === range.end_id);
    if (start < 0 || end < start || end - start >= 100)
      throw Error("Unknown, reversed or excessive source range");
    const a = source.segments[start],
      b = source.segments[end];
    if (
      a.start_seconds !== null &&
      b.end_seconds !== null &&
      b.end_seconds - a.start_seconds > 120
    )
      throw Error("Evidence range exceeds two minutes");
    const text = source.segments
      .slice(start, end + 1)
      .map((s) => s.text)
      .join(source.segment_separator || "");
    if (text.length > 4000) throw Error("Evidence range exceeds text limit");
    return {
      segment_id: a.id,
      end_segment_id: b.id === a.id ? undefined : b.id,
      quote_original: text,
      quote_translation_en: "",
    };
  });
  return Claim.parse({ ...fields, evidence });
}
