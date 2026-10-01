/** Fixed-delay fixtures only; run on a new, migrated, disposable local database. */
import { existsSync, writeFileSync } from "node:fs";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { create } from "../src/server/youtube-intelligence/store.ts";
import { processNext } from "../src/server/youtube-intelligence/runner.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
const capacity = 3;
const mode = process.argv[2];
if (!["before", "after"].includes(mode)) throw Error("Expected before or after");
const { waitForWorkerSlot } = await import("../src/server/youtube-intelligence/worker-admission.ts");
const target = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
if (
  process.env.YTI_ISOLATED_DB !== "true" ||
  process.env.YTI_DB !== "postgres" ||
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/yti_perf_/.test(target.pathname)
)
  throw Error("Explicit isolated localhost yti_perf_ database required");
if (!process.argv[3])
  throw Error(
    "Usage: node --experimental-strip-types scripts/worker-admission-benchmark.mjs before|after output.json",
  );
if (existsSync(process.argv[3])) throw Error("Refusing to replace an existing benchmark result");
await database.prepare("SELECT version FROM yi_migrations").all();
await put("teamPreferences", "default", { processing: { parallelVideos: capacity } });
const runs = [];
for (let i = 0; i < 100; i++)
  runs.push(
    await create(
      "fixture-" + i,
      "fixture",
      { origin: i === 99 ? "manual" : "channel" },
      "fixture",
    ),
  );
const times = [],
  start = performance.now();
let active = 0,
  peak = 0;
const execute = async (r) => {
  active++;
  peak = Math.max(peak, active);
  await new Promise((resolve) =>
    setTimeout(resolve, r.videoId.endsWith("0") ? 800 : 100),
  );
  active--;
  let n = Number(r.output.n ?? 0) + 1;
  r.output.n = n;
  r.stage = "fixture-" + n;
  if (n === 4) {
    r.status = "completed";
    times.push({
      id: r.id,
      video: r.videoId,
      seconds: (performance.now() - start) / 1000,
    });
  }
};
const activeWork = new Set();
while (times.length < 100) {
  if (performance.now() - start > 600000) {
    await Promise.allSettled([...activeWork]);
    await database.close();
    throw Error("Benchmark exceeded ten-minute bound");
  }
  while (activeWork.size < capacity) {
    let work;
    work = processNext(execute).then(async job => {
      if (!job) await new Promise(r => setTimeout(r, 250));
    }).finally(() => activeWork.delete(work));
    activeWork.add(work);
  }
  if (mode === 'before') {
    await Promise.race([
      Promise.allSettled([...activeWork]),
      new Promise(resolve => { const timer = setTimeout(resolve, 1500); timer.unref(); }),
    ]);
    await new Promise(resolve => setTimeout(resolve, 250));
  } else await waitForWorkerSlot(activeWork);
}
await Promise.allSettled([...activeWork]);
const verified = await database.prepare("SELECT video_id, status, output FROM yi_runs ORDER BY video_id").all();
if (verified.length !== 100 || verified.some(r => r.status !== 'completed' || JSON.parse(r.output).n !== 4)) throw Error('Output/checkpoint mismatch');
const result = {
  mode: "deterministic stage-latency fixture; real runner/PostgreSQL; actual worker admission loop",
  verifiedOutputs: verified.length,
  phase: process.argv[2],
  n: 100,
  peak,
  seconds: (performance.now() - start) / 1000,
  interactive: times.find((x) => x.video === "fixture-99"),
  times,
};
writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, times: undefined }));
await database.close();
