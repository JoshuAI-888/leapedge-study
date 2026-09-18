import { readFileSync } from "node:fs";
import {
  put,
  doc,
  addPrompt,
  promptVersions,
} from "../src/server/youtube-intelligence/research-store.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
import { fidelityPrompts } from "../evaluations/native-google/fidelity-prompts.ts";
const report = JSON.parse(
  readFileSync("docs/completion-results-20260915.json", "utf8"),
);
const p = fidelityPrompts();
if (!(await promptVersions()).some((x) => x.id === p.id)) await addPrompt(p);
await put("captionBenchmark", report.id, {
  ...report,
  runtime: "Completion campaign: fidelity, boundary replay and acceptance",
});
await put("improvement", "fidelity-v7-20260915", {
  id: "fidelity-v7-20260915",
  title: "Exact quote boundaries and original conditions",
  status: "proposed",
  proposal:
    "Single-cue quote guidance, instrument coverage and exact condition auditing; deterministic boundary splitting tested separately.",
  outcome:
    "Alpha 7/8 and long English 6/8 text-accepted. Mandarin audit transport failed. Offline boundary replay clears three serialization failures but not price mismatch. QQQ/IWM omissions remain; no promotion.",
  results: report.outcomes,
});
await put("researchWhitePaper", report.id, {
  id: report.id,
  at: report.at,
  markdown: readFileSync("docs/completion-campaign-20260915.md", "utf8"),
  scriptManifest: report.scriptManifest,
  sourceRegister: report.sources,
});
if (!(await doc("captionBenchmark", report.id)))
  throw Error("Settings readback failed");
console.log(
  "Completion findings and experimental prompt saved; default preferences unchanged.",
);
await db().close();
