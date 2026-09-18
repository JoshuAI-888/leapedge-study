import { readFileSync, writeFileSync } from "node:fs";
import { materializeEvidenceRanges } from "../src/features/youtube-intelligence/evidence-selection.ts";
import {
  validateClaim,
  type CheckedClaim,
} from "../src/features/youtube-intelligence/contracts.ts";
const r = JSON.parse(
  readFileSync(
    "data/institutional-20260916/4724a0cb-f419-4328-b331-258f0ccdf875.json",
    "utf8",
  ),
).run;
const rows = (
  [...r.output.claims, ...r.output.keyPoints] as CheckedClaim[]
).map((item) => {
  try {
    const { evidence, ...fields } = item.claim;
    const ranges = evidence.map((e) => {
      const m = /^(s\d+)-(s\d+)$/.exec(e.segment_id);
      if (!m) throw Error("No declared source range");
      return { start_id: m[1], end_id: m[2] };
    });
    const claim = materializeEvidenceRanges(
      { ...fields, evidence_ranges: ranges },
      r.output.source,
    );
    return {
      id: item.id,
      structuralReasons: validateClaim(claim, r.output.source),
      ranges,
      copiedSourceCharacters: claim.evidence.reduce(
        (n, e) => n + e.quote_original.length,
        0,
      ),
    };
  } catch (e) {
    return {
      id: item.id,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
});
writeFileSync(
  "docs/institutional-source-range-replay-20260916.json",
  JSON.stringify(
    {
      experimental: true,
      method:
        "Materialize declared source ranges, NOT repair generated quotes. Translations cleared because old translations do not cover the new excerpts. Fresh semantic and translation audit required.",
      structurallyPassing: rows.filter(
        (r) => "structuralReasons" in r && r.structuralReasons?.length === 0,
      ).length,
      rows,
      published: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passing: rows.filter(
      (r) => "structuralReasons" in r && r.structuralReasons?.length === 0,
    ).length,
    total: rows.length,
    published: false,
  }),
);
