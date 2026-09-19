import {
  processNext,
  sweep,
  dispatchOpenRuns,
} from "../src/server/youtube-intelligence/runner.ts";
import { teamPreferences } from "../src/server/youtube-intelligence/research-store.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
mkdirSync("data", { recursive: true });
writeFileSync("data/worker.pid", String(process.pid));
let stop = false,
  lastSweep = 0;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
const active = new Set<Promise<unknown>>();
console.log(
  "YouTube Intelligence worker ready; shutdown drains active stages.",
);
try {
  await dispatchOpenRuns();
  while (!stop && !existsSync("data/worker.stop")) {
    if (Date.now() - lastSweep > 60000) {
      await sweep();
      lastSweep = Date.now();
    }
    const capacity = (await teamPreferences()).processing.parallelVideos;
    while (!stop && active.size < capacity) {
      let work: Promise<unknown>;
      work = processNext()
        .then((job) => {
          if (job) console.log(JSON.stringify(job));
        })
        .catch((error) =>
          console.error(
            "Worker job failed:",
            error instanceof Error ? error.message : String(error),
          ),
        )
        .finally(() => active.delete(work));
      active.add(work);
    }
    if (process.argv.includes("--once")) break;
    await Promise.race([
      Promise.allSettled([...active]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally {
  await Promise.allSettled([...active]);
  await database.close();
  if (existsSync("data/worker.stop")) unlinkSync("data/worker.stop");
  if (existsSync("data/worker.pid")) unlinkSync("data/worker.pid");
}
