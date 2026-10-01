/**
 * Prepare one blind judging round for the analyst-view benchmark.
 *
 *   node --experimental-strip-types evaluations/analyst-view-13/prepare-judging.ts \
 *     <our run details dir> <round dir> <key file outside the round dir>
 *
 * <our run details dir> holds one run-detail JSON per video (as the run API
 * returns it, with analystNote). For each benchmark video the round dir gets
 * the transcript and two notes, A and B: ours and LeapEdge's capture rendered
 * in the same plain layout. Which is which is decided by a fixed hash of the
 * video id and round name and written only to the key file, which judges must
 * not be given. LeapEdge's pipeline metadata is left out because it names the
 * product. Formats still differ (our notes carry timestamps), so blinding is
 * partial; both sides are scored in the same pass with the same rubric.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";

const [oursDir, roundDir, keyFile] = process.argv.slice(2);
if (!oursDir || !roundDir || !keyFile) throw Error("Usage: prepare-judging.ts <ours dir> <round dir> <key file>");
const here = new URL(".", import.meta.url).pathname;
mkdirSync(roundDir, { recursive: true });

type Idea = {
  ticker: string | null; instrument: string | null; stance: string; conviction: string | null;
  entry: string | null; target: string | null; stop: string | null; horizon: string | null;
  action: string | null; rationale: string | null; catalysts: string[]; risks: string[]; conditions: string[];
  quotes: string[] | { text: string }[];
};
function leapedgeNote(title: string, le: { summary: string; keyPoints: string[]; tradeIdeas: Idea[] }) {
  const lines = [`# ${title}`, "", "## Summary", le.summary, ""];
  if (le.tradeIdeas.length) {
    lines.push("## Ideas");
    for (const i of le.tradeIdeas) {
      lines.push(`### ${i.ticker ?? i.instrument ?? "Unnamed"} · ${i.stance}${i.conviction ? ` · conviction ${i.conviction}` : ""}`);
      if (i.action) lines.push(i.action);
      if (i.rationale) lines.push(i.rationale);
      const facts = [
        i.entry && `Entry: ${i.entry}`, i.target && `Target: ${i.target}`, i.stop && `Stop: ${i.stop}`,
        i.horizon && `Horizon: ${i.horizon}`,
        i.conditions?.length && `Conditions: ${i.conditions.join("; ")}`,
        i.catalysts?.length && `Catalysts: ${i.catalysts.join("; ")}`,
        i.risks?.length && `Risks: ${i.risks.join("; ")}`,
      ].filter(Boolean);
      lines.push(...facts.map((f) => `- ${f}`));
      for (const q of i.quotes ?? []) lines.push(`> ${typeof q === "string" ? q : q.text}`);
      lines.push("");
    }
  }
  if (le.keyPoints.length) lines.push("## Key points", ...le.keyPoints.map((k) => `- ${k}`), "");
  return lines.join("\n").trim() + "\n";
}

const key: Record<string, { A: string; B: string }> = {};
const round = basename(roundDir);
for (const f of readdirSync(join(here, "leapedge")).filter((f) => f.endsWith(".json"))) {
  const id = f.replace(".json", "");
  const le = JSON.parse(readFileSync(join(here, "leapedge", f), "utf8"));
  let ours: { analystNote?: string | null; run?: { title?: string; status?: string } };
  try {
    ours = JSON.parse(readFileSync(join(oursDir, f), "utf8"));
  } catch {
    ours = {};
  }
  const title = ours.run?.title ?? id;
  const oursNote = ours.analystNote ?? `# ${title}\n\n(No output: the analysis did not complete${ours.run?.status ? `, status ${ours.run.status}` : ""}.)\n`;
  const theirs = leapedgeNote(title, le);
  const oursIsA = createHash("sha256").update(`${round}:${id}`).digest()[0] % 2 === 0;
  writeFileSync(join(roundDir, `${id}.A.md`), oursIsA ? oursNote : theirs);
  writeFileSync(join(roundDir, `${id}.B.md`), oursIsA ? theirs : oursNote);
  copyFileSync(join(here, "transcripts", `${id}.txt`), join(roundDir, `${id}.transcript.txt`));
  key[id] = oursIsA ? { A: "ours", B: "leapedge" } : { A: "leapedge", B: "ours" };
}
writeFileSync(keyFile, JSON.stringify(key, null, 2) + "\n");
console.log(`Prepared ${Object.keys(key).length} videos in ${roundDir}; key in ${keyFile}.`);
