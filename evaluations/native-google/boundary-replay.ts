// Offline replay of all three v7 drafts, preserving original artifacts. No model calls.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Source,
  validateClaim,
} from "../../src/features/youtube-intelligence/contracts.ts";
import { splitExactBoundaryQuotes } from "../../src/features/youtube-intelligence/evidence-boundaries.ts";
const directory = "data/native-google-20260915";
const results = [];
for (const caseName of ["alpha", "mandarin", "long"]) {
  const run = JSON.parse(
    readFileSync(`${directory}/${caseName}-v7-fidelity-shadow.json`, "utf8"),
  );
  const original = JSON.parse(
    readFileSync(`${directory}/${run.sourceAttempt}.json`, "utf8"),
  ).assessment.data;
  const source = Source.parse({
    video_id: original.video_id,
    source_kind: "native_google_generated_transcript",
    segment_separator: "",
    segments: original.segments.map((s: any, i: number) => ({
      id: `s${String(i + 1).padStart(5, "0")}`,
      text: s.text,
      start_seconds: s.start_seconds,
      end_seconds: s.end_seconds,
    })),
  });
  const items = run.items.map((item: any) => {
    const split = splitExactBoundaryQuotes(item.claim, source);
    return {
      id: item.id,
      before: validateClaim(item.claim, source),
      after: validateClaim(split.claim, source),
      ...split,
      semanticAudit: "NOT_RERUN",
      audioVerified: false,
    };
  });
  writeFileSync(
    `${directory}/${caseName}-boundary-replay.json`,
    JSON.stringify({ sourceHash: run.sourceHash, items }, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  results.push({
    caseName,
    sourceHash: run.sourceHash,
    draftHash: createHash("sha256").update(JSON.stringify(run)).digest("hex"),
    items: items.map(({ claim, ...rest }: any) => rest),
  });
}
writeFileSync(
  "docs/completion-boundary-replay-20260915.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      method:
        "Exact adjacent-cue space split only; translations retained at group level in repair provenance, not invented per fragment.",
      results,
      defaultChanged: false,
      limitation:
        "Offline deterministic gate improvement; no semantic or audio accuracy claim.",
    },
    null,
    2,
  ),
);
console.log(
  results.map((r) => ({
    case: r.caseName,
    beforeFailures: r.items.filter((i: any) => i.before.length).length,
    afterFailures: r.items.filter((i: any) => i.after.length).length,
  })),
);
