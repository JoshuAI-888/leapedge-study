// VideoConviction benchmark (spec 4.9; build plan F07).
//
//   node --experimental-strip-types scripts/vc-benchmark.ts --offline [--out path] [--save]
//   node --experimental-strip-types scripts/vc-benchmark.ts --extraction path/to/extraction.json [--model m] [--prompt-version v]
//
// --offline scores the committed fixture against a deterministic fake extraction
// (no keys, no network) to prove the harness end to end; its numbers are not a
// result. --extraction scores a real extraction result, a JSON object mapping
// fixture row id to the claims extracted for that segment as
// { ticker, tickerExplicit, stance, conviction }[] (see predictionsFromClaims).
// --live is reserved for the promotion gate (F08), which runs the extraction
// prompt through the model transport and feeds the result here.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  loadFixture,
  benchmark,
  fakeExtraction,
  writeVcBenchmark,
  FIXTURE_PATH,
  type VcExtraction,
} from "../src/server/youtube-intelligence/vc-benchmark.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const offline = flag("--offline");
const extractionPath = opt("--extraction");
if (flag("--live"))
  throw Error(
    "--live is not implemented here; the promotion gate runs the extraction and passes --extraction <file>.",
  );
if (!offline && !extractionPath)
  throw Error("Usage: scripts/vc-benchmark.ts --offline | --extraction <file> [--fixture path] [--out path] [--save]");

const fixture = loadFixture(opt("--fixture", FIXTURE_PATH));
if (fixture.placeholder)
  console.warn("warning: the fixture is a placeholder, not dataset rows; run scripts/vc-benchmark-fixture.mjs");

const Extraction = z.record(
  z.string(),
  z.array(
    z.object({
      ticker: z.string().nullable(),
      tickerExplicit: z.boolean(),
      stance: z.string(),
      conviction: z.string(),
    }),
  ),
);
const extraction: VcExtraction = extractionPath
  ? Extraction.parse(JSON.parse(readFileSync(resolve(extractionPath), "utf8")))
  : fakeExtraction(fixture);

const report = benchmark(fixture, extraction, {
  model: opt("--model", offline ? "fake" : undefined) ?? null,
  promptVersion: opt("--prompt-version") ?? null,
  arm: opt("--arm", "text") === "video" ? "video" : "text",
  label: offline ? "offline fake extraction" : opt("--label"),
});

const out = opt("--out", `data/evaluations/${report.id.replace(":", "-")}.json`)!;
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(resolve(out), JSON.stringify(report, null, 2) + "\n");

if (flag("--save")) {
  await writeVcBenchmark(report);
  const { db } = await import("../src/server/youtube-intelligence/store.ts");
  await db().close();
}

const pct = (r: { agree: number; total: number; rate: number | null }) =>
  r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}% (${r.agree}/${r.total})`;
const matrixLines = (m: { labels: string[]; counts: Record<string, Record<string, number>> }) => {
  const w = Math.max(9, ...m.labels.map((l) => l.length + 1));
  const cell = (s: string) => s.padStart(w);
  return [
    cell("exp \\ pred") + m.labels.map(cell).join(""),
    ...m.labels.map((e) => cell(e) + m.labels.map((p) => cell(String(m.counts[e][p]))).join("")),
  ];
};
console.log(
  [
    `${report.id} (${report.version}) ${offline ? "[offline fake extraction]" : ""}`,
    `fixture: ${report.fixture.dataset}/${report.fixture.split} rows=${report.fixture.rowCount} placeholder=${report.fixture.placeholder}`,
    `config: model=${report.config.model ?? "-"} promptVersion=${report.config.promptVersion ?? "-"} arm=${report.config.arm}`,
    `rows: scored=${report.counts.scored} missing=${report.counts.missing} rec=${report.counts.rec} noRec=${report.counts.noRec} predictions=${report.counts.predictions}`,
    `ticker agreement:     ${pct(report.agreement.ticker)}`,
    `stance agreement:     ${pct(report.agreement.stance)}`,
    `action agreement:     ${pct(report.agreement.action)}`,
    `conviction agreement: ${pct(report.agreement.conviction)}`,
    `no-rec respected:     ${pct(report.agreement.noRec)}`,
    "",
    "action confusion:",
    ...matrixLines(report.confusion.action),
    "",
    "conviction confusion:",
    ...matrixLines(report.confusion.conviction),
    "",
    `wrote ${out}${flag("--save") ? " and saved vcBenchmark document" : ""}`,
  ].join("\n"),
);
