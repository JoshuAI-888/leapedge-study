import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { get } from "../src/server/youtube-intelligence/store.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
import { gradeRun, CHECK_VERSION } from "../evaluations/checks.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
// Keep Promptfoo local and prevent model spend: the only provider below replays frozen runs.
process.env.PROMPTFOO_DISABLE_TELEMETRY = "1";
process.env.PROMPTFOO_DISABLE_UPDATE = "1";
process.env.PROMPTFOO_CONFIG_DIR = resolve("data/promptfoo");
const promptfoo = createRequire(resolve("evaluations/tooling/package.json"))(
  "promptfoo",
).default;
const ids = process.argv.slice(2);
const runs = await Promise.all(
  (ids.length
    ? ids
    : [
        "b97f8aa8-472e-4ef1-bad1-ba5c0ad965dc",
        "22a99713-f00a-4a2f-b98e-bf66d3438ce7",
        "b62875da-5c4f-4e15-8e4b-ef89dcfcfff6",
        "22b54768-4e4b-4602-82d0-03f1486f9f1d",
        "85c3f64f-ed06-4664-b219-34ae97680eca",
      ]
  ).map(async (id) => {
    const r = await get(id);
    if (!r) throw Error(`Run not found: ${id}`);
    return r;
  }),
);
const snapshots = new Map(runs.map((r) => [r.id, r]));
const provider = {
  id: () => "youtube-intelligence:retained-output",
  callApi: async (
    _: string,
    context?: {
      vars?: Record<string, unknown>;
    },
  ) => {
    const run = snapshots.get(String(context?.vars?.runId));
    if (!run) return { error: "Frozen run not found." };
    return {
      output: JSON.stringify(run),
      cost: 0,
      metadata: {
        originalGenerationCostUsd: run.cost,
        model: run.model,
        promptVersion: run.promptVersion,
        sourceHash: run.output.sourceHash,
      },
    };
  },
};
const result = await promptfoo.evaluate(
  {
    description: CHECK_VERSION,
    prompts: ["Evaluate frozen run {{runId}}"],
    providers: [provider],
    tests: runs.map((r) => ({
      description: `${r.videoId} · ${r.model} · ${r.promptVersion}`,
      vars: { runId: r.id },
      assert: [
        {
          type: "javascript" as const,
          value: (output: string) => gradeRun(JSON.parse(output) as Run),
        },
      ],
    })),
    writeLatestResults: false,
    sharing: false,
  },
  { maxConcurrency: 1, cache: false },
);
const summary = await result.toEvaluateSummary();
const id = randomUUID(),
  at = new Date().toISOString();
mkdirSync("data/evaluations", { recursive: true });
const artifact = {
  id,
  at,
  checkVersion: CHECK_VERSION,
  checkHash: createHash("sha256")
    .update(readFileSync("evaluations/checks.ts"))
    .digest("hex"),
  checkSource: readFileSync("evaluations/checks.ts", "utf8"),
  mode: "retained-output replay",
  newModelCostUsd: 0,
  runs,
  summary,
};
writeFileSync(`data/evaluations/${id}.json`, JSON.stringify(artifact, null, 2));
const rows = runs.map((r) => ({
  runId: r.id,
  videoId: r.videoId,
  model: r.model,
  promptVersion: r.promptVersion,
  sourceHash: r.output.sourceHash,
  originalCostUsd: r.cost,
  ...gradeRun(r),
}));
await put("evaluation", id, {
  id,
  at,
  checkVersion: CHECK_VERSION,
  checkHash: artifact.checkHash,
  mode: artifact.mode,
  newModelCostUsd: 0,
  rows,
  stats: summary.stats,
  limitation:
    "Replay checks do not measure new generation latency or audio accuracy. Video-specific expectations are provisional retained-text review criteria.",
});
console.log(
  JSON.stringify(
    {
      id,
      checkVersion: CHECK_VERSION,
      newModelCostUsd: 0,
      rows,
      stats: summary.stats,
    },
    null,
    2,
  ),
);
// Preserve failures and make regressions actionable in CI.
if (rows.some((r) => !r.pass)) process.exitCode = 1;
