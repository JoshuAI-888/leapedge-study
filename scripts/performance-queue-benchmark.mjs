/** Fixed-delay fixtures only; run on a new, migrated, disposable local database. */
import { writeFileSync } from "node:fs";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { create } from "../src/server/youtube-intelligence/store.ts";
import { processNext } from "../src/server/youtube-intelligence/runner.ts";
import { put } from "../src/server/youtube-intelligence/research-store.ts";
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
    "Usage: node --experimental-strip-types scripts/performance-queue-benchmark.mjs before|after output.json",
  );
await database.prepare("SELECT version FROM yi_migrations").all();
await put("teamPreferences", "default", { processing: { parallelVideos: 8 } });
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
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (times.length < 100) {
      const job = await processNext(execute);
      if (!job) await new Promise((r) => setTimeout(r, 10));
    }
  }),
);
const result = {
  mode: "deterministic stage-latency fixture; real runner/PostgreSQL; rolling harness",
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
