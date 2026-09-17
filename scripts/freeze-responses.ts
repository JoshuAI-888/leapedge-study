import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FROZEN_DIR,
  frozenPath,
  hasFrozen,
  loadFrozen,
  requestHash,
} from "../tests/helpers/frozen.ts";
import {
  injectTransport,
  transportFor,
  type ModelDescription,
  type ModelRequestData,
  type ModelResponseData,
  type ModelTransport,
  type TransportFactory,
} from "../src/server/youtube-intelligence/transport/index.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
/**
 * Freeze one real model response per pipeline stage (build plan T2).
 *
 *   node --env-file=.env --experimental-strip-types scripts/freeze-responses.ts \
 *     --url <youtube url> | --run <runId>
 *     [--stages synthesis,critique] [--out tests/fixtures/model]
 *     [--max-steps 60] [--note "what this case exercises"] [--dry-run]
 *
 * The recorder wraps, and never replaces, the transport each stage would
 * really use: injectTransport() installs a factory that asks transportFor()
 * for the stock transport and returns a RecordingTransport around it, so the
 * run is a genuine live run and the captures are genuine provider output.
 *
 * Every successful call is written once to <out>/<stage>-<hash>.json in the
 * envelope tests/helpers/frozen.ts defines, where hash is requestHash() over
 * the ModelRequest exactly as the transport received it. An existing file is
 * never overwritten (SKIP), the request copy is scrubbed of anything
 * key-shaped, and each new file is loaded back through loadFrozen() before
 * the run continues, so a fixture that cannot be replayed fails here rather
 * than in the test suite that depends on it.
 */
/** What a scrubbed value is replaced with, so a redaction is visible in the fixture. */
export const REDACTED = "[redacted]";
/** Field names that carry transport credentials rather than model input. */
const HEADER_LIKE =
  /^(headers?|authorization|auth|cookies?|set-cookie|bearer|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|secrets?|credentials?|x-[\w-]+)$/i;
/** Provider key shapes: OpenRouter/OpenAI (sk-), Google (AIza) and bearer tokens. */
const SECRET = /(sk-|AIza|Bearer )[A-Za-z0-9_-]{8,}/g;
/** A copy of the request with header-like fields dropped and key-shaped strings redacted. */
export function scrubRequest(request: unknown): unknown {
  if (typeof request === "string") return request.replace(SECRET, REDACTED);
  if (Array.isArray(request)) return request.map(scrubRequest);
  if (request && typeof request === "object")
    return Object.fromEntries(
      Object.entries(request as Record<string, unknown>)
        .filter(([key]) => !HEADER_LIKE.test(key))
        .map(([key, value]) => [key, scrubRequest(value)]),
    );
  return request;
}
/** --stages names a stage exactly ("critique-0") or its family ("critique" takes critique-0, critique-1, ...). */
export function stageSelected(stage: string, stages?: string[]) {
  if (!stages || !stages.length) return true;
  return stages.some((s) => stage === s || stage.startsWith(`${s}-`));
}
export type FreezeRecord = {
  stage: string;
  hash: string;
  model: string;
  file: string;
  bytes: number;
  /** false when the file already existed and was left untouched. */
  written: boolean;
};
export type RecordingOptions = {
  /** Where envelopes are written; defaults to tests/fixtures/model. */
  dir?: string;
  stages?: string[];
  note?: string;
  log?: (line: string) => void;
  /** Shared list every RecordingTransport of one capture appends to. */
  records?: FreezeRecord[];
};
/**
 * A ModelTransport that delegates describe() and call() to another transport
 * and freezes each successful response on the way back.
 */
export class RecordingTransport implements ModelTransport {
  readonly inner: ModelTransport;
  readonly name: string;
  readonly family: ModelTransport["family"];
  readonly records: FreezeRecord[];
  private dir: string;
  private stages: string[] | undefined;
  private note: string | undefined;
  private log: (line: string) => void;
  constructor(inner: ModelTransport, options: RecordingOptions = {}) {
    this.inner = inner;
    this.name = inner.name;
    this.family = inner.family;
    this.records = options.records ?? [];
    this.dir = options.dir ?? FROZEN_DIR;
    this.stages = options.stages;
    this.note = options.note;
    this.log = options.log ?? ((line: string) => console.log(line));
    // Optional capabilities are forwarded only where the wrapped transport has
    // them, so a capture records the request production would send — a critique
    // that reads an explicit context cache, not one with the transcript inlined.
    if (inner.createCache)
      this.createCache = (model, parts, ttl) =>
        inner.createCache!(model, parts, ttl);
    if (inner.deleteCache)
      this.deleteCache = (name) => inner.deleteCache!(name);
    if (inner.countTokens)
      this.countTokens = (request) => inner.countTokens!(request);
  }
  createCache?: ModelTransport["createCache"];
  deleteCache?: ModelTransport["deleteCache"];
  countTokens?: ModelTransport["countTokens"];
  describe(model: string): Promise<ModelDescription> {
    return this.inner.describe(model);
  }
  async call(request: ModelRequestData): Promise<ModelResponseData> {
    const response = await this.inner.call(request);
    this.freeze(request, response);
    return response;
  }
  /** Write one envelope for a successful call, or record the SKIP. */
  private freeze(request: ModelRequestData, response: ModelResponseData) {
    const stage = request.stage;
    if (!stageSelected(stage, this.stages)) return null;
    // The name is the hash of the request as received, before scrubbing, so a
    // test that rebuilds the request finds the file.
    const hash = requestHash(request);
    const file = frozenPath(stage, hash, this.dir);
    if (hasFrozen(stage, hash, this.dir)) {
      this.log(`SKIP ${basename(file)} exists; captured earlier, not overwritten.`);
      return this.record({
        stage,
        hash,
        model: request.model,
        file,
        bytes: statSync(file).size,
        written: false,
      });
    }
    const envelope = {
      stage,
      hash,
      model: request.model,
      capturedAt: new Date().toISOString(),
      request: scrubRequest(request),
      response: response.raw,
      ...(this.note ? { note: this.note } : {}),
    };
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(envelope, null, 2) + "\n", { flag: "wx" });
    // A fixture that cannot be replayed is worse than none: prove it now.
    const loaded = loadFrozen(stage, hash, this.dir);
    if (requestHash(loaded) !== requestHash(envelope))
      throw Error(
        `Frozen envelope ${file} did not round-trip through loadFrozen; the capture is unusable.`,
      );
    return this.record({
      stage,
      hash,
      model: request.model,
      file,
      bytes: statSync(file).size,
      written: true,
    });
  }
  private record(record: FreezeRecord) {
    this.records.push(record);
    return record;
  }
}
export type Recorder = { records: FreezeRecord[]; restore: () => void };
/**
 * Route every stage through a RecordingTransport wrapped around the transport
 * transportFor() would have chosen. The factory steps out of its own override
 * while it resolves that transport, so the real routing (or a transport a test
 * injected underneath) decides what is wrapped.
 */
export function recordTransports(options: RecordingOptions = {}): Recorder {
  const records = options.records ?? [];
  let undo: () => void = () => {};
  const factory: TransportFactory = (stage, settings) => {
    undo();
    try {
      return new RecordingTransport(transportFor(stage, settings), {
        ...options,
        records,
      });
    } finally {
      undo = injectTransport(factory);
    }
  };
  undo = injectTransport(factory);
  return { records, restore: () => undo() };
}
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** The video id in a watch, youtu.be, shorts or embed URL, or a bare id. */
export function videoIdFrom(input: string) {
  const trimmed = input.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;
  const candidates: string[] = [];
  try {
    const url = new URL(trimmed);
    const v = url.searchParams.get("v");
    if (v) candidates.push(v);
    candidates.push(...url.pathname.split("/").filter(Boolean).reverse());
  } catch {
    /* not a URL: only the bare-id form above can match */
  }
  const found = candidates.find((c) => VIDEO_ID.test(c));
  if (!found) throw Error(`Could not read a YouTube video id from "${input}".`);
  return found;
}
export const USAGE = `Usage:
  node --env-file=.env --experimental-strip-types scripts/freeze-responses.ts --url <youtube url>
  node --env-file=.env --experimental-strip-types scripts/freeze-responses.ts --run <runId>
Options:
  --stages <a,b>    only these stages or stage families (default: every stage)
  --out <dir>       where envelopes are written (default: tests/fixtures/model)
  --max-steps <n>   pipeline steps before giving up (default: 60)
  --note <text>     note stored in each envelope
  --dry-run         capture into a temporary directory and print what would be written`;
export type FreezeArgs = {
  url: string | undefined;
  runId: string | undefined;
  stages: string[] | undefined;
  out: string | undefined;
  note: string | undefined;
  maxSteps: number;
  dryRun: boolean;
};
export function parseFreezeArgs(argv: string[]): FreezeArgs {
  const option = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--")
      ? argv[i + 1]
      : undefined;
  };
  const url = option("url"),
    runId = option("run");
  if (url && runId) throw Error(`Pass --url or --run, not both.\n${USAGE}`);
  if (!url && !runId)
    throw Error(`Pass --url <youtube url> or --run <runId>.\n${USAGE}`);
  const stages = option("stages")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const steps = option("max-steps");
  const maxSteps = steps === undefined ? 60 : Number(steps);
  if (!Number.isInteger(maxSteps) || maxSteps < 1)
    throw Error("--max-steps must be a positive whole number.");
  return {
    url,
    runId,
    stages: stages && stages.length ? stages : undefined,
    out: option("out"),
    note: option("note"),
    maxSteps,
    dryRun: argv.includes("--dry-run"),
  };
}
/** Step a queued run through the worker loop until it leaves the queue or runs out of steps. */
export async function driveRun(
  runId: string,
  maxSteps: number,
  log: (line: string) => void = console.log,
): Promise<Run | null> {
  const { get } = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext } = await import(
    "../src/server/youtube-intelligence/runner.ts"
  );
  for (let i = 0; i < maxSteps; i++) {
    const current = await get(runId);
    if (!current) throw Error(`Run ${runId} is not in this database.`);
    if (current.status !== "queued") return current;
    const job = await processNext();
    if (!job) break;
    const whose = job.id === runId ? "" : `(other run ${job.id}) `;
    log(`  step ${i + 1}: ${whose}${job.stage} ${job.status}`);
  }
  const final = await get(runId);
  if (final?.status === "queued")
    log(`Run ${runId} is still queued after ${maxSteps} steps; raise --max-steps.`);
  return final;
}
/** stage, hash, file and bytes, one row per capture. */
export function summaryTable(records: FreezeRecord[]) {
  const rows = [
    ["STAGE", "HASH", "FILE", "BYTES"],
    ...records.map((r) => [r.stage, r.hash, basename(r.file), String(r.bytes)]),
  ];
  const widths = rows[0].map((_, c) =>
    Math.max(...rows.map((row) => row[c].length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, c) =>
          c === 3 ? cell.padStart(widths[c]) : cell.padEnd(widths[c]),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
async function main() {
  let args: FreezeArgs;
  try {
    args = parseFreezeArgs(process.argv.slice(2));
  } catch (e) {
    console.error(
      `scripts/freeze-responses.ts: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
  }
  const out = resolve(args.out ?? FROZEN_DIR);
  const dir = args.dryRun
    ? mkdtempSync(join(tmpdir(), "freeze-responses-"))
    : out;
  mkdirSync(dir, { recursive: true });
  const recorder = recordTransports({
    dir,
    stages: args.stages,
    note: args.note ?? "captured by scripts/freeze-responses.ts",
  });
  try {
    let runId = args.runId;
    if (!runId) {
      const { queue } = await import(
        "../src/server/youtube-intelligence/research-store.ts"
      );
      const queued = await queue(videoIdFrom(args.url!));
      runId = queued.id;
      console.log(`Queued run ${runId} for video ${queued.videoId}.`);
    }
    const { get } = await import("../src/server/youtube-intelligence/store.ts");
    const start = await get(runId);
    if (!start) throw Error(`No run ${runId} in this database.`);
    if (start.status !== "queued")
      throw Error(
        `Run ${runId} is ${start.status}; only a queued run can be stepped. Queue a new run with --url.`,
      );
    const final = await driveRun(runId, args.maxSteps);
    console.log(
      `Run ${runId}: stage ${final?.stage}, status ${final?.status}.` +
        (final?.error ? ` Error: ${final.error}` : ""),
    );
  } finally {
    recorder.restore();
  }
  if (!recorder.records.length) {
    console.error(
      "No model call was captured. Check --stages, or that the run actually reached a model stage.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(summaryTable(recorder.records));
  const written = recorder.records.filter((r) => r.written).length;
  console.log(
    args.dryRun
      ? `Dry run: ${written} envelope(s) written to ${dir}; ${out} was not touched.`
      : `${written} envelope(s) written to ${dir}; ${recorder.records.length - written} skipped.`,
  );
}
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
