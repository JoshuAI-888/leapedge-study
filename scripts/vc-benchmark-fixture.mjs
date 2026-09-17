// Development tool: fetches the first rows of the VideoConviction train split
// from the Hugging Face datasets-server rows API and writes the committed
// benchmark fixture (evaluations/vc-benchmark-fixture.json).
//
// Only the label columns and the segment transcript are kept. No media, no
// full-video transcript, no channel statistics, no comments. The fixture is a
// derived sample of a CC BY-NC 4.0 dataset; see docs/videoconviction-dataset.md
// for the licence terms and the attribution that must travel with it.
//
// Usage:  node scripts/vc-benchmark-fixture.mjs [--rows 60] [--out path]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DATASET = "gtfintechlab/VideoConviction";
const SPLIT = "train";
const API = "https://datasets-server.huggingface.co/rows";
const MAX_PAGE = 100; // datasets-server caps `length` at 100 per request

const ATTRIBUTION =
  "Contains a derived sample of the VideoConviction dataset (Galarnyk, Kejriwal, Shah, Bhardwaj, Watney Meyer, Krishnan, Chava - Georgia Institute of Technology, KDD 2025), licensed CC BY-NC 4.0. Used for non-commercial benchmarking of the YouTube Intelligence research lab. Labels are expert annotations; provenance and licence: https://huggingface.co/datasets/gtfintechlab/VideoConviction";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const rowCount = Number(arg("--rows", "60"));
const out = resolve(arg("--out", "evaluations/vc-benchmark-fixture.json"));
if (!Number.isInteger(rowCount) || rowCount < 1)
  throw Error("--rows must be a positive integer");

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function score(v) {
  const n = num(v);
  if (n === null) return null;
  const s = Math.round(n);
  if (s < 1 || s > 3 || s !== n)
    throw Error(`Unexpected conviction_score ${v}; expected 1, 2 or 3`);
  return s;
}
function text(v) {
  return typeof v === "string" && v.trim() ? v : null;
}

async function page(offset, length) {
  const url = `${API}?dataset=${encodeURIComponent(DATASET)}&config=default&split=${SPLIT}&offset=${offset}&length=${length}`;
  const r = await fetch(url);
  if (!r.ok) throw Error(`datasets-server HTTP ${r.status} for offset ${offset}`);
  const body = await r.json();
  if (!Array.isArray(body.rows)) throw Error("datasets-server returned no rows");
  return {
    rows: body.rows.map((x) => ({ ...x.row, row_idx: x.row_idx })),
    total: body.num_rows_total ?? null,
  };
}

const raw = [];
let total = null;
for (let offset = 0; raw.length < rowCount; offset += MAX_PAGE) {
  const want = Math.min(MAX_PAGE, rowCount - raw.length);
  const p = await page(offset, want);
  total = p.total;
  raw.push(...p.rows);
  if (p.rows.length < want) break;
}

// No dataset column is unique per row (id, annotation_id and derived_inner_id
// all identify the annotated video, not the segment), so the row key is the
// position in the split, which is stable for a given dataset revision.
const rows = raw.slice(0, rowCount).map((r) => ({
  id: `${SPLIT}:${r.row_idx}`,
  datasetId: String(r.id),
  videoId: String(r.video_id),
  start: num(r.start),
  end: num(r.end),
  actionSource: text(r.action_source),
  expected: {
    isRecPresent: r.is_rec_present === "Yes" ? "Yes" : "No",
    action: text(r.action),
    convictionScore: score(r.conviction_score),
    ticker: text(r.ticker_name),
  },
  transcript: typeof r.segment_transcript === "string" ? r.segment_transcript : "",
}));

const fixture = {
  dataset: DATASET,
  split: SPLIT,
  license: "CC BY-NC 4.0",
  attribution: ATTRIBUTION,
  source: `${API}?dataset=${encodeURIComponent(DATASET)}&config=default&split=${SPLIT}`,
  fetchedAt: new Date().toISOString(),
  datasetRows: total,
  columns: [
    "row_idx",
    "id",
    "video_id",
    "start",
    "end",
    "action_source",
    "is_rec_present",
    "action",
    "conviction_score",
    "ticker_name",
    "segment_transcript",
  ],
  placeholder: false,
  rows,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n");
const actions = new Map();
for (const r of rows) {
  const k = r.expected.isRecPresent === "Yes" ? `rec:${r.expected.action}` : "no_rec";
  actions.set(k, (actions.get(k) ?? 0) + 1);
}
console.log(`wrote ${rows.length} of ${total ?? "?"} rows to ${out}`);
console.log("label mix:", Object.fromEntries([...actions.entries()].sort()));
