import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
import { parseGoldSet } from "../evaluations/gold-set/schema.ts";
import { db, list } from "../src/server/youtube-intelligence/store.ts";
import { driverName } from "../src/server/youtube-intelligence/database.ts";
/**
 * Export stored runs for offline replay (build plan T1).
 *
 *   node --experimental-strip-types scripts/export-runs.ts
 *     (--videos <id,id,...> | --cases <cases.json> | --all)
 *     [--out <file>] [--include-experiments]
 *
 * The output is a JSON array in exactly the row shape scripts/gold-set.ts
 * accepts for --runs, so a run exported here replays there unchanged:
 *
 *   node --experimental-strip-types scripts/export-runs.ts --cases evaluations/gold-set/cases.json
 *   node --experimental-strip-types scripts/gold-set.ts --offline --runs data/exports/runs-5.json
 *
 * Runs come from store.list() against whatever database the environment
 * selects: DATABASE_URL (Postgres, add --env-file=.env), else YTI_DB_PATH
 * (SQLite, default data/intelligence.sqlite), or YTI_DB=pglite in tests.
 * The rows are filtered exactly as gold-set.ts filters them (canonicalRuns):
 * completed, no input.task, input.experiment !== true unless
 * --include-experiments, newest createdAt per video. Nothing inside `output`
 * is stripped or rewritten; a replay sees the stored run byte for byte.
 *
 * A requested video with no canonical run is printed as MISSING and does not
 * fail the command: the human needs the whole list to decide what to re-run.
 * Bad flags exit 2.
 */
export const EXPORT_RUNS_VERSION = "export-runs.v1";
export const USAGE = [
  "Usage:",
  "  node --experimental-strip-types scripts/export-runs.ts (--videos <id,id,...> | --cases <cases.json> | --all)",
  "    [--out <file>] [--include-experiments]",
  "",
  "  --videos <id,id,...>    export these YouTube video ids (11 characters each)",
  "  --cases <cases.json>    export the videos named by a gold-set cases file",
  "  --all                   export every canonical run in the database",
  "  --out <file>            default data/exports/runs-<count>.json",
  "  --include-experiments   also export runs whose input.experiment is true",
  "",
  "  Add --env-file=.env before --experimental-strip-types to read a live DATABASE_URL.",
].join("\n");

/** A bad command line: the caller exits 2 and prints USAGE. */
export class FlagError extends Error {
  override name = "FlagError";
}

/** The row shape scripts/gold-set.ts accepts for --runs. */
export const RunRow = z.object({
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
export type RunRowData = z.infer<typeof RunRow>;

export type ExportOptions = {
  /** The requested video ids, or null for --cases (read later) and --all. */
  videos: string[] | null;
  casesPath: string | null;
  all: boolean;
  out: string | null;
  includeExperiments: boolean;
};
export type ExportTableRow = {
  videoId: string;
  runId: string | null;
  createdAt: string | null;
  promptVersion: string | null;
  cost: number | null;
};
export type ExportTotals = {
  /** How many videos were asked for, or null for --all. */
  requested: number | null;
  exported: number;
  missing: string[];
  costUsd: number;
};
export type ExportResult = {
  version: string;
  at: string;
  out: string;
  defaultOut: string;
  count: number;
  rows: RunRowData[];
  table: ExportTableRow[];
  totals: ExportTotals;
  source: {
    driver: string;
    runs: number;
    videos: number | null;
    casesPath: string | null;
    includeExperiments: boolean;
  };
};

const VIDEO_ID = /^[\w-]{11}$/;

/** Parse the command line. Pure: no file is read and no database is touched. */
export function parseOptions(argv: string[]): ExportOptions {
  let videos: string[] | null = null;
  let casesPath: string | null = null;
  let all = false;
  let out: string | null = null;
  let includeExperiments = false;
  const value = (flag: string, i: number) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--"))
      throw new FlagError(`${flag} needs a value.`);
    return next;
  };
  const once = (flag: string, seen: boolean) => {
    if (seen) throw new FlagError(`${flag} was given twice.`);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--videos") {
      once(arg, videos !== null);
      const ids = [
        ...new Set(
          value(arg, i++)
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        ),
      ];
      if (!ids.length) throw new FlagError("--videos needs at least one video id.");
      for (const id of ids)
        if (!VIDEO_ID.test(id))
          throw new FlagError(
            `--videos: ${id} is not an 11-character YouTube video id.`,
          );
      videos = ids;
    } else if (arg === "--cases") {
      once(arg, casesPath !== null);
      casesPath = value(arg, i++);
    } else if (arg === "--all") {
      once(arg, all);
      all = true;
    } else if (arg === "--out") {
      once(arg, out !== null);
      out = value(arg, i++);
    } else if (arg === "--include-experiments") {
      once(arg, includeExperiments);
      includeExperiments = true;
    } else if (arg.startsWith("-")) {
      throw new FlagError(`unknown flag: ${arg}`);
    } else {
      throw new FlagError(`unexpected argument: ${arg}`);
    }
  }
  const selectors = [videos !== null, casesPath !== null, all].filter(Boolean);
  if (selectors.length !== 1)
    throw new FlagError("pass exactly one of --videos, --cases or --all.");
  return { videos, casesPath, all, out, includeExperiments };
}

/** The videos named by a gold-set cases file, in file order and deduplicated. */
export function videosFromCases(path: string): string[] {
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch (e) {
    throw new FlagError(`--cases ${path}: ${(e as Error).message}`);
  }
  try {
    return [...new Set(parseGoldSet(JSON.parse(text)).cases.map((c) => c.videoId))];
  } catch (e) {
    throw new FlagError(`--cases ${path}: ${(e as Error).message}`);
  }
}

export type CanonicalOptions = {
  /** Keep only these videos; omit or pass null for every video. */
  videos?: Iterable<string> | null;
  /** Keep runs whose input.experiment is true (default false). */
  includeExperiments?: boolean;
};
/**
 * The newest completed, non-task run per video: the same filter
 * scripts/gold-set.ts applies to --runs and to the stored runs, exported so
 * that script (and the promotion gate behind it) can share this one copy.
 * The input array is neither reordered nor mutated.
 */
export function canonicalRuns(runs: Run[], options: CanonicalOptions = {}): Run[] {
  const wanted = options.videos == null ? null : new Set(options.videos);
  const seen = new Set<string>();
  return runs
    .filter((r) => (wanted ? wanted.has(r.videoId) : true))
    .filter(
      (r) =>
        r.status === "completed" &&
        !r.input.task &&
        (options.includeExperiments === true || r.input.experiment !== true),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .filter((r) => (seen.has(r.videoId) ? false : (seen.add(r.videoId), true)));
}

/** Exactly the RunRow fields, with input and output passed through untouched. */
export function runRow(run: Run): RunRowData {
  return {
    id: run.id,
    videoId: run.videoId,
    url: run.url,
    model: run.model,
    promptVersion: run.promptVersion,
    title: run.title,
    status: run.status,
    stage: run.stage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    error: run.error,
    input: run.input,
    output: run.output,
    cost: run.cost,
  };
}

export function defaultOutPath(count: number) {
  return `data/exports/runs-${count}.json`;
}

/** One line per requested video (MISSING included), or per exported run for --all. */
export function exportTable(
  rows: RunRowData[],
  requested: string[] | null,
): ExportTableRow[] {
  const byVideo = new Map(rows.map((r) => [r.videoId, r]));
  const videos = requested ?? rows.map((r) => r.videoId);
  return videos.map((videoId) => {
    const row = byVideo.get(videoId);
    return {
      videoId,
      runId: row?.id ?? null,
      createdAt: row?.createdAt ?? null,
      promptVersion: row?.promptVersion ?? null,
      cost: row?.cost ?? null,
    };
  });
}

export function exportTotals(
  rows: RunRowData[],
  requested: string[] | null,
): ExportTotals {
  const found = new Set(rows.map((r) => r.videoId));
  return {
    requested: requested ? requested.length : null,
    exported: rows.length,
    missing: requested ? requested.filter((v) => !found.has(v)) : [],
    // Six decimals: a sum of provider costs, not an accounting figure.
    costUsd: Number(rows.reduce((sum, r) => sum + r.cost, 0).toFixed(6)),
  };
}

/** The per-video table and the totals, as the command prints them. */
export function formatReport(result: ExportResult): string {
  const header = ["videoId", "run", "createdAt", "promptVersion", "cost"];
  const body = result.table.map((r) => [
    r.videoId,
    r.runId ?? "MISSING",
    r.createdAt ?? "-",
    r.promptVersion ?? "-",
    r.cost === null ? "-" : r.cost.toFixed(4),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length), 1),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const totals = result.totals;
  return [
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...body.map(line),
    "",
    `${totals.exported} run(s) from ${result.source.runs} stored, ${
      totals.requested === null ? "all videos" : `${totals.requested} video(s) requested`
    }, ${totals.missing.length} missing, $${totals.costUsd.toFixed(4)} total cost`,
    totals.missing.length ? `missing: ${totals.missing.join(", ")}` : "missing: none",
    `wrote ${result.out}`,
  ].join("\n");
}

/**
 * Read the runs, filter them, write the export and describe what happened.
 * `loadRuns` defaults to store.list(); the file is written before returning.
 */
export async function exportRuns(
  argv: string[],
  deps: { loadRuns?: () => Promise<Run[]> } = {},
): Promise<ExportResult> {
  const options = parseOptions(argv);
  const requested = options.all
    ? null
    : options.casesPath
      ? videosFromCases(options.casesPath)
      : options.videos;
  const stored = await (deps.loadRuns ?? list)();
  const canonical = canonicalRuns(stored, {
    videos: requested,
    includeExperiments: options.includeExperiments,
  });
  // Requested order first, so the same request always yields the same file.
  const order = new Map((requested ?? []).map((v, i) => [v, i]));
  const rows = (
    requested
      ? [...canonical].sort(
          (a, b) => (order.get(a.videoId) ?? 0) - (order.get(b.videoId) ?? 0),
        )
      : canonical
  ).map(runRow);
  const defaultOut = defaultOutPath(rows.length);
  const out = options.out ?? defaultOut;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(rows, null, 2) + "\n");
  return {
    version: EXPORT_RUNS_VERSION,
    at: new Date().toISOString(),
    out,
    defaultOut,
    count: rows.length,
    rows,
    table: exportTable(rows, requested),
    totals: exportTotals(rows, requested),
    source: {
      driver: driverName() ?? "none",
      runs: stored.length,
      videos: requested ? requested.length : null,
      casesPath: options.casesPath,
      includeExperiments: options.includeExperiments,
    },
  };
}

async function main() {
  try {
    const result = await exportRuns(process.argv.slice(2));
    console.log(formatReport(result));
    console.log(
      JSON.stringify({
        out: result.out,
        count: result.count,
        requested: result.totals.requested,
        missing: result.totals.missing,
        costUsd: result.totals.costUsd,
        driver: result.source.driver,
        includeExperiments: result.source.includeExperiments,
      }),
    );
  } catch (e) {
    if (e instanceof FlagError) {
      console.error(`scripts/export-runs.ts: ${e.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw e;
  } finally {
    await db().close();
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
