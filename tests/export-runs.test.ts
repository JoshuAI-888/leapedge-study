import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { freshDatabase } from "./helpers/db.ts";
import { seedFixture, fixtureSpec } from "./helpers/fixtures.ts";
import { get } from "../src/server/youtube-intelligence/store.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
import {
  EXPORT_RUNS_VERSION,
  FlagError,
  USAGE,
  canonicalRuns,
  defaultOutPath,
  exportRuns,
  formatReport,
  parseOptions,
  runRow,
} from "../scripts/export-runs.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const cli = promisify(execFile);
const GOLD_SET_VERSION = "gold-set.v1";

/**
 * The row shape scripts/gold-set.ts accepts for --runs, replicated here on
 * purpose: this test is the contract between the two scripts, so it must fail
 * if either side drifts.
 */
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
const RUN_ROW_FIELDS = Object.keys(RunRow.shape);

function tempDir() {
  return mkdtempSync(join(tmpdir(), "yti-export-runs-"));
}

const run = (over: Partial<Run> = {}): Run => ({
  id: "run-1",
  videoId: "aaaaaaaaaaa",
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  model: "google/gemini-3.8-flash",
  promptVersion: "evidence-first.web.v5",
  title: "A video",
  status: "completed",
  stage: "complete",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  error: null,
  input: {},
  output: { claims: [] },
  cost: 0.25,
  ...over,
});

/** The baseline fixture plus a second, newer run of its first video. */
function twoRunSpec() {
  const spec = fixtureSpec("baseline");
  const [first, second, third] = spec.runs;
  return {
    ...spec,
    id: "export-runs",
    runs: [
      { ...first, cost: 0.25 },
      {
        ...first,
        key: "mike-nvda-earnings-rerun",
        createdAt: "2026-06-09T04:20:00.000Z",
        promptVersion: "evidence-first.web.v5-rerun",
        cost: 0.5,
      },
      { ...second, cost: 0 },
      { ...third, cost: 0.125 },
    ],
  };
}

async function insertRun(
  d: Awaited<ReturnType<typeof freshDatabase>>,
  over: Partial<Run>,
) {
  const r = run(over);
  await d
    .prepare(
      "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,error,input,output,cost,lease_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
    )
    .run(
      r.id,
      r.videoId,
      r.url,
      r.model,
      r.promptVersion,
      r.title,
      r.status,
      r.stage,
      r.createdAt,
      r.updatedAt,
      r.error,
      JSON.stringify(r.input),
      JSON.stringify(r.output),
      r.cost,
    );
  return r;
}

test("parseOptions needs exactly one selector and rejects anything it does not know", () => {
  const videos = parseOptions(["--videos", "aB1cD2eF3gH,hG4fE5dC6bA"]);
  assert.deepEqual(videos.videos, ["aB1cD2eF3gH", "hG4fE5dC6bA"]);
  assert.equal(videos.all, false);
  assert.equal(videos.casesPath, null);
  assert.equal(videos.out, null);
  assert.equal(videos.includeExperiments, false);
  // Spaces and repeats are a human typing a list, not an error.
  assert.deepEqual(
    parseOptions(["--videos", " aB1cD2eF3gH , hG4fE5dC6bA , aB1cD2eF3gH "]).videos,
    ["aB1cD2eF3gH", "hG4fE5dC6bA"],
  );
  const cases = parseOptions([
    "--cases",
    "evaluations/gold-set/cases.json",
    "--out",
    "data/exports/gold.json",
    "--include-experiments",
  ]);
  assert.equal(cases.casesPath, "evaluations/gold-set/cases.json");
  assert.equal(cases.videos, null);
  assert.equal(cases.out, "data/exports/gold.json");
  assert.equal(cases.includeExperiments, true);
  const all = parseOptions(["--all"]);
  assert.equal(all.all, true);
  assert.equal(all.videos, null);

  const reject = (argv: string[], message: RegExp) => {
    assert.throws(
      () => parseOptions(argv),
      (e: unknown) => {
        assert.ok(e instanceof FlagError, `FlagError for ${argv.join(" ")}`);
        assert.match(e.message, message);
        return true;
      },
    );
  };
  reject([], /exactly one of --videos, --cases or --all/);
  reject(["--videos", "aB1cD2eF3gH", "--all"], /exactly one of/);
  reject(["--cases", "c.json", "--all"], /exactly one of/);
  reject(["--all", "--all"], /--all/);
  reject(["--videos", "aB1cD2eF3gH", "--videos", "hG4fE5dC6bA"], /--videos/);
  reject(["--videos"], /--videos needs a value/);
  reject(["--all", "--out"], /--out needs a value/);
  reject(["--videos", ",, "], /--videos needs at least one video id/);
  reject(["--videos", "https://www.youtube.com/watch?v=aB1cD2eF3gH"], /video id/);
  reject(["--videos", "tooshort"], /video id/);
  reject(["--all", "--dry-run"], /unknown flag: --dry-run/);
  reject(["--all", "extra"], /unexpected argument: extra/);
  assert.match(USAGE, /scripts\/export-runs\.ts/);
});

test("canonicalRuns keeps the newest completed, non-task, non-experiment run per video", () => {
  const runs = [
    run({ id: "new", videoId: "aaaaaaaaaaa", createdAt: "2026-06-03T00:00:00.000Z" }),
    run({ id: "old", videoId: "aaaaaaaaaaa", createdAt: "2026-06-01T00:00:00.000Z" }),
    run({ id: "other", videoId: "bbbbbbbbbbb" }),
    run({ id: "queued", videoId: "ccccccccccc", status: "queued" }),
    run({ id: "failed", videoId: "ddddddddddd", status: "failed", error: "boom" }),
    run({ id: "task", videoId: "eeeeeeeeeee", input: { task: "reprocess" } }),
    run({ id: "experiment", videoId: "fffffffffff", input: { experiment: true } }),
    run({ id: "not-experiment", videoId: "ggggggggggg", input: { experiment: false } }),
  ];
  assert.deepEqual(
    canonicalRuns(runs).map((r) => r.id),
    ["new", "other", "not-experiment"],
  );
  // The input array is never reordered or mutated.
  assert.equal(runs[0].id, "new");
  assert.equal(runs.length, 8);
  assert.deepEqual(
    canonicalRuns(runs, { includeExperiments: true }).map((r) => r.id).sort(),
    ["experiment", "new", "not-experiment", "other"],
  );
  assert.deepEqual(
    canonicalRuns(runs, { videos: ["bbbbbbbbbbb", "zzzzzzzzzzz"] }).map((r) => r.id),
    ["other"],
  );
  assert.deepEqual(canonicalRuns(runs, { videos: [] }).map((r) => r.id), []);
  // Ascending input order must give the same newest-per-video answer.
  assert.deepEqual(
    canonicalRuns([...runs].reverse()).map((r) => r.id).sort(),
    ["new", "not-experiment", "other"],
  );
});

test("runRow is exactly the gold-set RunRow shape and never strips output fields", () => {
  const output = { sourceHash: "abc", source: { segments: [{ id: "s1" }] }, claims: [{ id: "c1" }] };
  const row = runRow(run({ output, input: { promptSnapshot: { id: "v5" }, experiment: false } }));
  assert.deepEqual(Object.keys(row).sort(), RUN_ROW_FIELDS.slice().sort());
  assert.equal(RunRow.safeParse(row).success, true);
  assert.deepEqual(row.output, output);
  assert.deepEqual(row.input, { promptSnapshot: { id: "v5" }, experiment: false });
  assert.equal(defaultOutPath(3), "data/exports/runs-3.json");
});

test("--videos exports the newest run per video, in gold-set's RunRow shape, and lists what is missing", async () => {
  const d = await freshDatabase();
  const seeded = await seedFixture(twoRunSpec());
  const dir = tempDir();
  const out = join(dir, "nested", "runs.json");
  const result = await exportRuns([
    "--videos",
    "aB1cD2eF3gH,zY9xW8vU7tS,mIsSiNgViD0",
    "--out",
    out,
  ]);
  assert.equal(result.version, EXPORT_RUNS_VERSION);
  assert.equal(result.out, out);
  assert.equal(result.count, 2);
  assert.ok(existsSync(out), "the export is written to --out");

  const rows = z.array(RunRow).parse(JSON.parse(readFileSync(out, "utf8")));
  assert.equal(rows.length, 2);
  for (const row of rows)
    assert.deepEqual(Object.keys(row).sort(), RUN_ROW_FIELDS.slice().sort());
  const nvda = rows.find((r) => r.videoId === "aB1cD2eF3gH")!;
  // The rerun is newer, so it wins; the older run of the same video is dropped.
  assert.equal(nvda.id, seeded.runs["mike-nvda-earnings-rerun"]);
  assert.equal(nvda.promptVersion, "evidence-first.web.v5-rerun");
  assert.equal(nvda.createdAt, "2026-06-09T04:20:00.000Z");
  assert.equal(nvda.cost, 0.5);
  assert.equal(nvda.status, "completed");
  assert.ok(!rows.some((r) => r.id === seeded.runs["mike-nvda-earnings"]));
  // Nothing in output is stripped: it round-trips the stored run exactly.
  const stored = (await get(nvda.id))!;
  assert.deepEqual(nvda.output, stored.output);
  assert.deepEqual(nvda.input, stored.input);
  assert.ok(Array.isArray((nvda.output as { claims?: unknown[] }).claims));
  assert.ok((nvda.output as { source?: unknown }).source, "the transcript source survives");

  // The table has one line per requested video, missing ones included.
  assert.deepEqual(
    result.table.map((r) => [r.videoId, r.runId]),
    [
      ["aB1cD2eF3gH", seeded.runs["mike-nvda-earnings-rerun"]],
      ["zY9xW8vU7tS", seeded.runs["laowang-ai-capex"]],
      ["mIsSiNgViD0", null],
    ],
  );
  assert.deepEqual(result.totals, {
    requested: 3,
    exported: 2,
    missing: ["mIsSiNgViD0"],
    costUsd: 0.625,
  });
  const text = formatReport(result);
  assert.match(text, /aB1cD2eF3gH/);
  assert.match(text, /MISSING/);
  assert.match(text, /mIsSiNgViD0/);
  assert.match(text, /evidence-first\.web\.v5-rerun/);
  assert.doesNotMatch(text, new RegExp(seeded.runs["mike-nvda-earnings"]));
  await d.prepare("SELECT 1 AS ok").get();
});

test("--cases takes its videos from a gold cases file and the default --out names the count", async () => {
  await freshDatabase();
  const seeded = await seedFixture(twoRunSpec());
  const dir = tempDir();
  const casesPath = join(dir, "cases.json");
  writeFileSync(
    casesPath,
    JSON.stringify({
      version: GOLD_SET_VERSION,
      cases: [
        {
          id: "case-nvda",
          videoId: "aB1cD2eF3gH",
          language: "en",
          split: "development",
          status: "pending",
          review: null,
          expectedClaims: [],
          expectedRejections: [{ id: "case-nvda-none", reason: "Pending review." }],
        },
        {
          id: "case-missing",
          videoId: "mIsSiNgViD0",
          language: "zh",
          split: "held_out",
          status: "pending",
          review: null,
          expectedClaims: [],
          expectedRejections: [{ id: "case-missing-none", reason: "No run yet." }],
        },
      ],
    }),
  );
  const out = join(dir, "cases-runs.json");
  const result = await exportRuns(["--cases", casesPath, "--out", out]);
  assert.equal(result.source.casesPath, casesPath);
  assert.equal(result.count, 1);
  assert.deepEqual(result.totals.missing, ["mIsSiNgViD0"]);
  const rows = z.array(RunRow).parse(JSON.parse(readFileSync(out, "utf8")));
  assert.deepEqual(
    rows.map((r) => r.id),
    [seeded.runs["mike-nvda-earnings-rerun"]],
  );
  assert.equal(result.defaultOut, defaultOutPath(1));

  writeFileSync(join(dir, "broken.json"), JSON.stringify({ version: "other", cases: [] }));
  await assert.rejects(
    exportRuns(["--cases", join(dir, "broken.json"), "--out", out]),
    (e: unknown) => e instanceof FlagError && /version/.test((e as Error).message),
  );
  await assert.rejects(
    exportRuns(["--cases", join(dir, "absent.json"), "--out", out]),
    (e: unknown) => e instanceof FlagError && /absent\.json/.test((e as Error).message),
  );
});

test("--all exports every canonical run and --include-experiments adds the experiment runs", async () => {
  const d = await freshDatabase();
  await seedFixture(twoRunSpec());
  await insertRun(d, {
    id: "experiment-run",
    videoId: "eXpErImEnT0",
    createdAt: "2026-08-01T00:00:00.000Z",
    input: { experiment: true },
    cost: 0.01,
  });
  await insertRun(d, {
    id: "task-run",
    videoId: "tAsKrUnId00",
    createdAt: "2026-08-02T00:00:00.000Z",
    input: { task: "settle" },
  });
  await insertRun(d, {
    id: "queued-run",
    videoId: "qUeUeDrUn00",
    createdAt: "2026-08-03T00:00:00.000Z",
    status: "queued",
    stage: "metadata",
  });
  const dir = tempDir();
  const plain = await exportRuns(["--all", "--out", join(dir, "all.json")]);
  assert.deepEqual(
    plain.table.map((r) => r.videoId).sort(),
    ["aB1cD2eF3gH", "hG4fE5dC6bA", "zY9xW8vU7tS"],
  );
  assert.equal(plain.count, 3);
  assert.deepEqual(plain.totals.missing, []);
  assert.equal(plain.totals.requested, null);
  assert.equal(plain.source.includeExperiments, false);

  const withExperiments = await exportRuns([
    "--all",
    "--include-experiments",
    "--out",
    join(dir, "all-experiments.json"),
  ]);
  assert.equal(withExperiments.count, 4);
  assert.ok(withExperiments.table.some((r) => r.runId === "experiment-run"));
  // A task run and a queued run are never canonical, with or without the flag.
  for (const result of [plain, withExperiments]) {
    assert.ok(!result.table.some((r) => r.runId === "task-run"));
    assert.ok(!result.table.some((r) => r.runId === "queued-run"));
  }
});

test("the command prints a table, exits 0 with a missing video and exits 2 on a bad flag", async () => {
  const dir = tempDir();
  const out = join(dir, "cli.json");
  const env = { ...process.env, YTI_DB: "pglite" };
  const { stdout } = await cli(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/export-runs.ts",
      "--videos",
      "mIsSiNgViD0",
      "--out",
      out,
    ],
    { cwd: ROOT, env },
  );
  assert.match(stdout, /mIsSiNgViD0/);
  assert.match(stdout, /MISSING/);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), []);
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.equal(summary.out, out);
  assert.equal(summary.count, 0);
  assert.deepEqual(summary.missing, ["mIsSiNgViD0"]);

  const bad = await cli(
    process.execPath,
    ["--experimental-strip-types", "scripts/export-runs.ts", "--videos", "nope"],
    { cwd: ROOT, env },
  ).catch((e: { code?: number; stderr?: string }) => e);
  assert.equal((bad as { code?: number }).code, 2);
  assert.match((bad as { stderr?: string }).stderr ?? "", /video id/);
  assert.match((bad as { stderr?: string }).stderr ?? "", /--videos/);
});
