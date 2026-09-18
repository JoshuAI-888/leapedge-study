import {
  promptVersions,
  addPrompt,
  comparison,
  improvement,
  queue,
  docs,
} from "../src/server/youtube-intelligence/research-store.ts";
import { get, list } from "../src/server/youtube-intelligence/store.ts";
const baseline = (await list()).find(
  (r) =>
    r.status === "completed" &&
    r.model === "google/gemini-3.8-flash" &&
    r.videoId === "3u24qyWjSVM",
);
if (!baseline) throw Error("Expected retained NaNa baseline is missing.");
const base = (await promptVersions()).find(
  (p) => p.id === "evidence-first.web.v1",
)!;
const id = "evidence-first.web.v2";
if (!(await promptVersions()).some((p) => p.id === id))
  await addPrompt({
    ...base,
    id,
    rationale:
      "Separate existing-position risk management from new trade recommendations; preserve price roles and require support for every causal clause.",
    extraction:
      base.extraction +
      "\nBefore output, classify each candidate mentally as new call, existing-position management, hypothetical example, or macro context. Existing-position management MUST use hold or conditional stance unless an independent explicit new recommendation is quoted. Do not assign high/medium creator conviction merely because a speaker is fluent or emphatic. Price support, entry and stop are distinct. Copy only the role explicitly stated.\n",
    critique:
      base.critique +
      "\nReject if any causal explanation or action is supported only by adjacent topic coincidence. A quote that says set a stop does not support an attractive entry or reward/risk thesis. Check the source clause by clause, preserving negation and conditional status.\n",
  });
const other = (await list()).find(
  (r) =>
    r.status === "completed" &&
    r.model === "google/gemini-3.5-flash" &&
    r.videoId === baseline.videoId,
);
if (other && !(await docs("comparison")).length)
  await comparison({
    leftId: baseline.id,
    rightId: other.id,
    hypothesis:
      "Compare Gemini 3.8 and 3.5 on the same retained Chinese source: conditionality, claim coverage, cost and latency.",
  });
if (!(await docs("improvement")).length)
  await improvement({
    title: "Preserve existing-position instructions",
    problem:
      "LeapEdge COIN card displayed entry140 and stop140 although the cited quote describes setting a stop for someone already bottom-fishing.",
    proposal:
      "Explicitly separate position management from new calls and audit every price role and causal clause.",
    status: "testing",
    outcome:
      "v2 queued against the retained Chinese source; original audio review still required.",
  });
const existing = (await list()).find(
  (r) => r.promptVersion === id && r.videoId === baseline.videoId,
);
const run =
  existing ||
  (await queue(baseline.videoId, (await get(baseline.id))!.output.source, {
    promptVersion: id,
    model: "google/gemini-3.8-flash",
    criticModel: "google/gemini-3.8-flash",
  }));
console.log(
  JSON.stringify({ baseline: baseline.id, candidate: run.id, prompt: id }),
);
