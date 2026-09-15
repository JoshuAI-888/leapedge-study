// Authorized research persistence; no generation, email or routing change.
// node --env-file=.env --env-file=.env.local --experimental-strip-types scripts/save-native-google-research.ts
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  put,
  doc,
  promptVersions,
  addPrompt,
} from "../src/server/youtube-intelligence/research-store.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
import { shadowPrompts } from "../evaluations/native-google/shadow-prompts.ts";
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const report = load("docs/native-google-live-results.json");
const shadow = load("docs/native-google-shadow-results.json");
const comparison = load("docs/native-google-comparison-results.json");
const paper = readFileSync(
  "docs/native-google-findings-white-paper.md",
  "utf8",
);
const reference = {
  path: "docs/native-google-findings-white-paper.md",
  sha256: createHash("sha256").update(paper).digest("hex"),
  url: "https://github.com/JoshuAI-888/leapedge-study/blob/feat/youtube-intelligence/docs/native-google-findings-white-paper.md",
};
const candidate = shadowPrompts(true);
const actualHash = createHash("sha256")
  .update(JSON.stringify(candidate))
  .digest("hex");
if (!shadow.shadows.some((s: any) => s.promptHash === actualHash))
  throw Error("Candidate prompt changed since recorded experiment");
// Catalog IDs use a restricted alphabet. Preserve the exact execution ID/hash separately.
const alias = "evidence-first.web.v5-single-segment-quotes.v1";
const versions = await promptVersions();
if (!versions.some((p: any) => p.id === alias))
  await addPrompt({
    ...candidate,
    id: alias,
    rationale:
      "Experimental single-segment quotation guidance: 8 versus 1 text-accepted items on one native source. Not promoted; audio, semantic and recall issues remain. Execution ID uses a plus sign and is retained in the experiment.",
  });
await put("captionBenchmark", report.id, {
  ...report,
  runtime: "Native Google ingestion: requests and outcomes",
  whitePaper: reference,
});
await put("captionBenchmark", shadow.id, {
  ...shadow,
  runtime: "Native Google v5 quotation A/B",
  whitePaper: reference,
  catalogPromptAlias: alias,
});
await put("captionBenchmark", "native-google-caption-disagreement-20260915", {
  ...comparison,
  id: "native-google-caption-disagreement-20260915",
  runtime: "Native Google versus historical captions; not audio accuracy",
  whitePaper: reference,
});
const improvement = {
  id: "native-google-single-segment-quotes-20260915",
  title: "Single-segment quotes on native Google transcripts",
  status: "proposed",
  proposal:
    "Copy exact evidence from individual source segments to avoid boundary-space alterations.",
  outcome:
    "Baseline 1/9 and candidate 8/9 passed deterministic checks and model text critique. One accepted candidate has an added closes-below condition; SPY evidence and QQQ/IWM recall remain concerns. No audio verification or production promotion.",
  executionPromptId: candidate.id,
  catalogPromptAlias: alias,
  promptHash: actualHash,
  comparison: shadow,
  whitePaper: reference,
};
await put("improvement", improvement.id, improvement);
await put("researchWhitePaper", "native-google-findings-20260915", {
  id: "native-google-findings-20260915",
  at: new Date().toISOString(),
  ...reference,
  markdown: paper,
  sourceRegister: load("docs/native-google-research-sources.json"),
  scriptManifest: load("docs/native-google-script-manifest.json"),
});
const saved = await doc<any>("captionBenchmark", report.id);
if (
  saved?.attempts?.length !== report.attempts.length ||
  saved?.whitePaper?.sha256 !== reference.sha256
)
  throw Error("Settings readback mismatch");
console.log(
  JSON.stringify({
    savedAttempts: saved.attempts.length,
    shadowRuns: shadow.shadows.length,
    promptAlias: alias,
    whitePaperSha256: reference.sha256,
    defaultPromptUnchanged: true,
  }),
);
await db().close();
