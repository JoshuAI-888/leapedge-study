import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
import {
  loadGoldSet,
  DEFAULT_CASES_PATH,
} from "../evaluations/gold-set/schema.ts";
import { goldReport } from "../evaluations/gold-set/report.ts";
/**
 * Gold-set evaluation (spec 4.9).
 *
 *   node --experimental-strip-types scripts/gold-set.ts --offline
 *     [--cases evaluations/gold-set/cases.json] [--runs <runs.json>]
 *     [--hash <config-hash>] [--out data/evaluations]
 *
 * --offline needs no key and spends nothing. Every model call is routed
 * through FakeModelTransport (frozen captures under tests/fixtures/model),
 * so a stage that tries to call a provider fails instead of paying. Runs
 * come from --runs (a JSON array of Run rows) or, like scripts/evaluate.ts,
 * from the stored runs in the research database: the newest completed,
 * non-experiment run per gold video. The report goes to
 * data/evaluations/gold-set-<hash>.json, where <hash> is --hash (the
 * promotion gate passes the config hash) or a digest of the cases file and
 * the replayed run snapshots.
 *
 * --live is reserved for the promotion gate with keys; it is not implemented here.
 */
const args = process.argv.slice(2);
function flag(name: string) {
  return args.includes(`--${name}`);
}
function option(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
if (!flag("offline")) {
  console.error(
    "scripts/gold-set.ts: pass --offline. Live evaluation with keys is not implemented; see the promotion gate.",
  );
  process.exit(2);
}
const casesPath = option("cases") ?? DEFAULT_CASES_PATH;
const outDir = option("out") ?? "data/evaluations";
const set = loadGoldSet(casesPath);
const goldVideos = new Set(set.cases.map((c) => c.videoId));

// No spend, no key: any model call in this process hits the fake transport.
let transport = "none";
let restoreTransport = () => {};
const fakePath = resolve("src/server/youtube-intelligence/transport/fake.ts");
if (existsSync(fakePath)) {
  const [{ FakeModelTransport }, { injectTransport }] = await Promise.all([
    import("../src/server/youtube-intelligence/transport/fake.ts"),
    import("../src/server/youtube-intelligence/transport/index.ts"),
  ]);
  restoreTransport = injectTransport(new FakeModelTransport());
  transport = "fake";
}

const RunRow = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  url: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  title: z.string(),
  status: z.string(),
  stage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  cost: z.number(),
});

async function storedRuns(): Promise<Run[]> {
  const { list } = await import("../src/server/youtube-intelligence/store.ts");
  return list();
}

/** Newest completed, non-task, non-experiment run per gold video (research-store canonicalRuns without its writes). */
function canonical(runs: Run[]): Run[] {
  const seen = new Set<string>();
  return runs
    .filter((r) => goldVideos.has(r.videoId))
    .filter((r) => r.status === "completed" && !r.input.task && r.input.experiment !== true)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .filter((r) => (seen.has(r.videoId) ? false : (seen.add(r.videoId), true)));
}

let runs: Run[];
let mode: string;
try {
  const runsPath = option("runs");
  if (runsPath) {
    runs = canonical(z.array(RunRow).parse(JSON.parse(readFileSync(resolve(runsPath), "utf8"))));
    mode = `offline replay of ${runsPath}`;
  } else {
    runs = canonical(await storedRuns());
    mode = "offline replay of stored runs";
  }
} finally {
  restoreTransport();
}

const report = goldReport(set, runs);
const casesText = readFileSync(resolve(casesPath), "utf8");
const casesHash = createHash("sha256").update(casesText).digest("hex");
const snapshot = runs.map((r) => ({
  runId: r.id,
  videoId: r.videoId,
  model: r.model,
  promptVersion: r.promptVersion,
  sourceHash: typeof r.output.sourceHash === "string" ? r.output.sourceHash : null,
  costUsd: r.cost,
}));
const hash =
  option("hash") ??
  createHash("sha256")
    .update(casesHash)
    .update(JSON.stringify(snapshot))
    .digest("hex")
    .slice(0, 16);
if (!/^[A-Za-z0-9._-]{1,64}$/.test(hash)) throw Error(`Unsafe --hash value: ${hash}`);
const artifact = {
  id: `gold-set-${hash}`,
  at: new Date().toISOString(),
  mode,
  transport,
  newModelCostUsd: 0,
  casesPath,
  casesHash,
  runs: snapshot,
  report,
  limitation:
    "Offline replay measures the stored output against the gold set; it does not re-run extraction, so prompt or model changes need fresh runs (or frozen captures) before this report reflects them.",
};
mkdirSync(resolve(outDir), { recursive: true });
const outPath = resolve(outDir, `gold-set-${hash}.json`);
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(
  JSON.stringify(
    {
      out: outPath,
      mode,
      transport,
      advisory: report.advisory,
      advisoryReason: report.advisoryReason,
      cases: report.cases,
      claims: report.claims,
      critic: report.critic,
      anchors: report.anchors,
      sentiment: report.sentiment,
      cost: report.cost,
      validity: { graded: report.validity.graded, passed: report.validity.passed },
    },
    null,
    2,
  ),
);
