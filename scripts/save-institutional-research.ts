import { readFileSync } from "node:fs";
import { put, doc } from "../src/server/youtube-intelligence/research-store.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
try {
  const id = "institutional-readiness-20260916";
  await put("researchWhitePaper", id, {
    id,
    at: new Date().toISOString(),
    markdown: readFileSync("docs/institutional-readiness-20260916.md", "utf8"),
    scriptManifest: [
      "scripts/prepare-institutional-fixtures.ts",
      "scripts/replay-institutional-evidence.ts",
      "scripts/smoke-entity-classification.ts",
      "scripts/audit-institutional-chinese.ts",
      "scripts/save-institutional-research.ts",
    ],
  });
  await put("improvement", id, {
    id,
    title: "English corpus and independent reliability fixes",
    status: "proposed",
    proposal:
      "English entity registry and corpus; channel discovery; bounded history; exact share selection; source playback repair; conservative CJK alignment and entry qualifier guard.",
    outcome:
      "65 local tests pass. Three of ten Chinese items structurally recover, not semantically or audio verified. Hosted preview built; production unchanged. Retained-corpus model tests await explicit approval.",
    results: JSON.parse(
      readFileSync("docs/institutional-evidence-replay-20260916.json", "utf8"),
    ),
  });
  const prior = "fresh-browser-parity-20260915";
  if (!(await doc("researchWhitePaper", prior)))
    await put("researchWhitePaper", prior, {
      id: prior,
      at: new Date().toISOString(),
      markdown: readFileSync("docs/browser-parity-report-20260915.md", "utf8"),
    });
  console.log(
    JSON.stringify({
      saved: !!(await doc("researchWhitePaper", id)),
      postgres: !!process.env.DATABASE_URL,
    }),
  );
} finally {
  await db().close();
}
