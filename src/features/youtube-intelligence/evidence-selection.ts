import { z } from "zod";
import { Claim, deriveEvidence, type SourceData } from "./contracts.ts";

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

/**
 * Range selection (spec 4.2). The model returns segment ranges only; the
 * application copies the source text with deriveEvidence and records the
 * pointer as source_span, so quote_original is derived and a stale source is
 * detectable by its hash. Bad ranges throw inside deriveEvidence.
 */
export const RangeSelectedClaim = Claim.omit({ evidence: true }).extend({
  evidence_ranges: z
    .array(z.object({ start_id: z.string().min(1), end_id: z.string().min(1) }))
    .min(1)
    .max(20),
});
export type RangeSelectedClaimData = z.infer<typeof RangeSelectedClaim>;
export function materializeEvidenceRanges(raw: unknown, source: SourceData) {
  const { evidence_ranges, ...fields } = RangeSelectedClaim.parse(raw);
  const seen = new Set<string>();
  const evidence = evidence_ranges.map((range) => {
    const key = JSON.stringify(range);
    if (seen.has(key)) throw Error("Duplicate evidence range");
    seen.add(key);
    const derived = deriveEvidence(source, range);
    return {
      segment_id: range.start_id,
      end_segment_id:
        range.end_id === range.start_id ? undefined : range.end_id,
      quote_original: derived.quote_original,
      quote_translation_en: "",
      source_span: {
        start_id: range.start_id,
        end_id: range.end_id,
        start_seconds: derived.start_seconds,
        end_seconds: derived.end_seconds,
        text_hash: derived.text_hash,
      },
    };
  });
  return Claim.parse({ ...fields, evidence });
}

/** Split an overlong pointer at real cue boundaries. No text is rewritten or
 * omitted. Invalid/missing/reversed pointers still fail at the claim boundary. */
export function recoverEvidenceRanges(raw: unknown, source: SourceData) {
  const selected = RangeSelectedClaim.parse(raw);
  const ranges: { start_id: string; end_id: string }[] = [];
  for (const range of selected.evidence_ranges) {
    const start = source.segments.findIndex((s) => s.id === range.start_id);
    const end = source.segments.findIndex((s) => s.id === range.end_id);
    if (start < 0 || end < start)
      throw Error("Unknown or reversed evidence pointer");
    let from = start;
    for (let i = start; i <= end; i++) {
      const first = source.segments[from],
        last = source.segments[i];
      if (
        i > from &&
        (i - from >= 100 ||
          (first.start_seconds !== null &&
            last.end_seconds !== null &&
            last.end_seconds - first.start_seconds > 120))
      ) {
        ranges.push({ start_id: first.id, end_id: source.segments[i - 1].id });
        from = i;
      }
    }
    ranges.push({
      start_id: source.segments[from].id,
      end_id: source.segments[end].id,
    });
  }
  return materializeEvidenceRanges(
    { ...selected, evidence_ranges: ranges },
    source,
  );
}
