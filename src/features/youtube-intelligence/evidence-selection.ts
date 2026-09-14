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
    return { segment_id: id, quote_original: segment.text, quote_translation_en: "" };
  });
  return Claim.parse({ ...fields, evidence });
}
