import { readFileSync, writeFileSync } from "node:fs";
import {
  anchorClaimEvidence,
  validateClaim,
  type CheckedClaim,
  type SourceData,
} from "../src/features/youtube-intelligence/contracts.ts";
const run = JSON.parse(
  readFileSync(
    "data/institutional-20260916/4724a0cb-f419-4328-b331-258f0ccdf875.json",
    "utf8",
  ),
).run;
const source = run.output.source as SourceData;
const rows = (
  [...run.output.claims, ...run.output.keyPoints] as CheckedClaim[]
).map((item) => {
  const repaired = anchorClaimEvidence(item.claim, source);
  return {
    id: item.id,
    baselineReasons: item.reasons,
    afterStructuralReasons: validateClaim(repaired, source),
    alignmentChanged:
      JSON.stringify(repaired.evidence) !== JSON.stringify(item.claim.evidence),
    anchors: repaired.evidence.map((e) => ({
      start: e.segment_id,
      end: e.end_segment_id,
    })),
    semanticAuditRerun: false,
    audioVerified: false,
  };
});
const result = {
  version: "caption-alignment.v2",
  sourceKind: source.source_kind,
  sourceSegments: source.segments.length,
  rootCauses: [
    "Range encoded in segment_id instead of separate start/end IDs",
    "CJK caption formatting whitespace differs from model quotation",
    "Twelve-cue bound too short for densely fragmented captions",
    "Some drafts paraphrase, omit words or insert ellipses; must remain rejected",
  ],
  beforeStructurallyPassing: 0,
  afterStructurallyPassing: rows.filter((r) => !r.afterStructuralReasons.length)
    .length,
  limitations:
    "Structural recovery only. These items have NOT been promoted or counted as verified research. Semantic critique and source audio review remain required.",
  rows,
};
writeFileSync(
  "docs/institutional-evidence-replay-20260916.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    before: 0,
    after: result.afterStructurallyPassing,
    total: rows.length,
  }),
);
