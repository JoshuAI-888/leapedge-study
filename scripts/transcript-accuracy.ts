import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  scoreAccuracy,
  ACCURACY_VERSION,
} from "../evaluations/transcript-accuracy.ts";

const path = process.argv[2];
if (!path || path.startsWith("--"))
  throw Error("Usage: npm run eval:transcripts -- path/to/cases.json [--save]");
const raw = readFileSync(resolve(path), "utf8");
const cases: unknown = JSON.parse(raw);
if (!Array.isArray(cases) || !cases.length)
  throw Error("Supply a nonempty array of accuracy cases");
const rows = cases.flatMap(scoreAccuracy);
const inputHash = createHash("sha256").update(raw).digest("hex");
const id = `transcript-${ACCURACY_VERSION}-${inputHash.slice(0, 20)}`;
const artifact = {
  id,
  at: new Date().toISOString(),
  version: ACCURACY_VERSION,
  inputHash,
  scored: rows.filter((r) => r.status === "scored").length,
  pending: rows.filter((r) => r.status !== "scored").length,
  limitation:
    "Excerpt-level scores only. Audio verification is reviewer-attested, not automatically established. Missing anchors count as unmeasured. These scores do not establish full-video accuracy or synthesis quality.",
  rows,
};
mkdirSync("data/evaluations", { recursive: true });
writeFileSync(`data/evaluations/${id}.json`, JSON.stringify(artifact, null, 2));
if (process.argv.includes("--save")) {
  const { put } = await import(
    "../src/server/youtube-intelligence/research-store.ts"
  );
  const { db } = await import("../src/server/youtube-intelligence/store.ts");
  await put("transcriptAccuracy", id, artifact);
  await db().close();
}
console.log(
  JSON.stringify({
    id,
    scored: artifact.scored,
    pending: artifact.pending,
    saved: process.argv.includes("--save"),
  }),
);
