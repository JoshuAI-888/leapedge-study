import {
  processNext,
  sweep,
} from "../src/server/youtube-intelligence/runner.ts";
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
console.log("YouTube Intelligence worker ready.");
while (!stop && !existsSync("data/worker.stop")) {
  if (Date.now() - lastSweep > 60000) {
    await sweep();
    lastSweep = Date.now();
  }
  const job = await processNext();
  if (job) console.log(JSON.stringify(job));
  if (process.argv.includes("--once")) break;
  if (!job || job.stage === "source")
    await new Promise((r) => setTimeout(r, 1500));
}
if (existsSync("data/worker.stop")) unlinkSync("data/worker.stop");
