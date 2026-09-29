/**
 * Unblind one judging round and print the scorecard.
 *
 *   node --experimental-strip-types evaluations/analyst-view-13/score-round.ts <round dir> <key file>
 *
 * Reads every <id>.judged.json in the round dir, maps A and B back to ours and
 * LeapEdge with the key, and prints per-video verdicts and the average of each
 * dimension, plus must-know items captured and fidelity error counts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [roundDir, keyFile] = process.argv.slice(2);
if (!roundDir || !keyFile) throw Error("Usage: score-round.ts <round dir> <key file>");
const key = JSON.parse(readFileSync(keyFile, "utf8")) as Record<string, { A: string; B: string }>;
const dims = ["coverage", "fidelity", "actionability", "clarity", "overall"] as const;
const total = { ours: {} as Record<string, number>, leapedge: {} as Record<string, number> };
const captured = { ours: 0, leapedge: 0 }, errors = { ours: 0, leapedge: 0 };
let items = 0, n = 0;
const rows: string[] = [];
for (const f of readdirSync(roundDir).filter((f) => f.endsWith(".judged.json")).sort()) {
  const j = JSON.parse(readFileSync(join(roundDir, f), "utf8"));
  const k = key[j.videoId];
  if (!k) throw Error(`No key for ${j.videoId}`);
  const side = (letter: "A" | "B") => k[letter] as "ours" | "leapedge";
  n++;
  for (const letter of ["A", "B"] as const) {
    for (const d of dims) total[side(letter)][d] = (total[side(letter)][d] ?? 0) + Number(j.scores[letter][d]);
    errors[side(letter)] += (j.fidelityErrors?.[letter] ?? []).length;
  }
  for (const m of j.mustKnow ?? []) {
    items++;
    for (const letter of ["A", "B"] as const) if (m[letter] === "captured") captured[side(letter)]++;
  }
  const verdict = j.verdict === "tie" ? "tie" : `${side(j.verdict.startsWith("A") ? "A" : "B")} better`;
  const o = k.A === "ours" ? "A" : "B", l = o === "A" ? "B" : "A";
  rows.push(`| ${j.videoId} | ${verdict} | ${j.scores[o].overall} | ${j.scores[l].overall} | ${j.scores[o].actionability} / ${j.scores[l].actionability} | ${j.scores[o].clarity} / ${j.scores[l].clarity} |`);
}
console.log("| Video | Verdict | Ours overall | LeapEdge overall | Actionability (ours / LE) | Clarity (ours / LE) |");
console.log("|---|---|---|---|---|---|");
console.log(rows.join("\n"));
console.log("");
console.log("| Average (1-5) | Ours | LeapEdge |");
console.log("|---|---|---|");
for (const d of dims) console.log(`| ${d} | ${(total.ours[d] / n).toFixed(2)} | ${(total.leapedge[d] / n).toFixed(2)} |`);
console.log(`\nMust-know captured: ours ${captured.ours}/${items}, LeapEdge ${captured.leapedge}/${items}. Fidelity errors: ours ${errors.ours}, LeapEdge ${errors.leapedge}. Videos: ${n}.`);
