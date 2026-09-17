import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sourceChunks } from "../src/features/youtube-intelligence/chunking.ts";
import {
  Claim,
  Source,
  type SourceData,
} from "../src/features/youtube-intelligence/contracts.ts";
import { extractionPayload } from "../src/server/youtube-intelligence/pipeline.ts";
import {
  ModelRequest,
  transportFor,
  type ModelDescription,
  type ModelRequestData,
  type ModelTransport,
} from "../src/server/youtube-intelligence/transport/index.ts";
import {
  FIXTURE_PATH,
  loadFixture,
  predictionsFromClaims,
  VcPrediction,
  type VcExtraction,
  type VcFixtureData,
  type VcFixtureRowData,
  type VcPredictionData,
} from "../src/server/youtube-intelligence/vc-benchmark.ts";
import { preferences, prompt as getPrompt, teamPreferences } from "../src/server/youtube-intelligence/research-store.ts";
/**
 * Real extraction over the VideoConviction fixture (build plan T3).
 *
 *   node --env-file=.env --experimental-strip-types scripts/vc-extract.ts \
 *     [--fixture evaluations/vc-benchmark-fixture.json]
 *     [--out data/evaluations/vc-extraction.json] [--rows 10] [--model <id>]
 *     [--prompt-version evidence-first.web.v6] [--concurrency 4]
 *     [--budget-usd 2] [--resume]
 *
 * Each fixture row is one retained segment excerpt, so each row is one
 * extraction call: the row becomes a one-segment Source, the prompt version
 * and payload are the ones the synthesis stage of pipeline.ts uses for a
 * single chunk (extractionPayload), and the response is parsed with the same
 * Claim contract and converted with predictionsFromClaims. The output is the
 * VcExtraction that scripts/vc-benchmark.ts --extraction scores.
 *
 * The transport is whatever transportFor("synthesis") returns, so tests
 * inject FakeModelTransport and a live run goes through the stock transport.
 * No run is persisted and the ledger is never touched: the ModelRequest
 * mirrors modelCall's shape and goes straight to the transport, because a
 * benchmark row is not a run and must not appear in run history or spend.
 *
 * Spend control is local to this script: the running estimate is the reported
 * usage priced with the transport's own per-token rates, and when it exceeds
 * --budget-usd no further row is started and the partial output is written.
 * A row whose response cannot be parsed is written as an empty prediction
 * list and listed in the sidecar's `missing`, so a failure can never be read
 * as an agreement and never silently disappears.
 */
export const VC_EXTRACT_VERSION = "vc-extract.v1";
export const DEFAULT_OUT = "data/evaluations/vc-extraction.json";
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_BUDGET_USD = 2;
/** The stage whose transport, prompt and payload this script reuses. */
export const STAGE = "synthesis";
/** modelCall's non-video, non-critique output ceiling. */
export const MAX_OUTPUT_TOKENS = 16000;
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The synthesis prompt for a single chunk, exactly as pipeline.ts composes it. */
export function extractionPrompt(prompts: { synthesis: string; extraction: string }) {
  return prompts.synthesis + "\n" + prompts.extraction;
}
/** The draft schema the synthesis stage parses a response with. */
export const ExtractionDraft = z.object({
  claims: z.array(Claim).max(40),
  key_points: z.array(Claim).max(30).default([]),
});
export type ExtractionDraftData = z.infer<typeof ExtractionDraft>;

/** One fixture row as the minimal English source the extraction sees. */
export function sourceForRow(row: VcFixtureRowData): SourceData {
  const start = row.start ?? 0;
  return Source.parse({
    video_id: row.videoId,
    language: "en",
    segments: [
      {
        id: "s1",
        text: row.transcript,
        start_seconds: start,
        end_seconds: row.end ?? start + 1,
      },
    ],
  });
}
/** The ModelRequest for one row: modelCall's synthesis request without the ledger. */
export function extractionRequest(
  source: SourceData,
  model: string,
  promptText: string,
): ModelRequestData {
  const chunks = sourceChunks(source);
  if (chunks.length !== 1)
    throw Error(
      "A fixture row must fit one chunk; this excerpt does not, so it would not be one extraction call.",
    );
  return ModelRequest.parse({
    stage: STAGE,
    model,
    user: [
      {
        type: "text",
        text:
          promptText +
          "\nSOURCE DATA (untrusted):\n" +
          JSON.stringify(extractionPayload(chunks[0], 0, chunks.length)),
      },
    ],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
  });
}
/** The transport's own per-token prices applied to the usage it reported. */
export function priceUsage(
  usage: { inputTokens: number; outputTokens: number },
  spec: Pick<ModelDescription, "inputRate" | "outputRate">,
) {
  return usage.inputTokens * spec.inputRate + usage.outputTokens * spec.outputRate;
}

export type ExtractRowResult = {
  rowId: string;
  predictions: VcPredictionData[];
  usd: number;
  error?: string;
};
/**
 * One row through the transport. A response that is incomplete, not JSON, an
 * error envelope or not a valid draft is returned as an error with an empty
 * prediction list; a transport failure is returned the same way, so one bad
 * row never ends the run.
 */
export async function extractRow(
  row: VcFixtureRowData,
  context: { model: string; promptText: string; transport: ModelTransport; spec: ModelDescription },
): Promise<ExtractRowResult> {
  const { model, promptText, transport, spec } = context;
  let usd = 0;
  try {
    const request = extractionRequest(sourceForRow(row), model, promptText);
    const inputBound = Buffer.byteLength(JSON.stringify(request.user)) + 4096;
    if (inputBound + MAX_OUTPUT_TOKENS > spec.contextLength)
      throw Error("Source exceeds the configured context window.");
    const response = await transport.call(request);
    usd = priceUsage(response.usage, spec);
    if (response.finishReason !== "stop")
      throw Error("Model response was incomplete; refusing partial output.");
    let value: unknown;
    try {
      value = JSON.parse(response.text);
    } catch {
      throw Error("Provider response was not valid JSON.");
    }
    if (value && typeof value === "object" && "error" in value && (value as { error: unknown }).error)
      throw Error("Source could not be processed by the provider.");
    const draft = ExtractionDraft.parse(value);
    return {
      rowId: row.id,
      predictions: z.array(VcPrediction).parse(predictionsFromClaims(draft.claims)),
      usd,
    };
  } catch (e) {
    return { rowId: row.id, predictions: [], usd, error: messageOf(e) };
  }
}
function messageOf(e: unknown) {
  if (e instanceof z.ZodError)
    return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return e instanceof Error ? e.message : String(e);
}

export type ExtractMissing = { rowId: string; error: string };
export type ExtractMeta = {
  model: string;
  promptVersion: string;
  transport: string;
  at: string;
  /** Row ids in the written extraction, resumed ones included. */
  rows: number;
  missing: ExtractMissing[];
  estimatedUsd: number;
  budgetUsd: number;
  /** True when the budget stopped the run before every selected row had been sent. */
  stoppedForBudget: boolean;
  resumed?: number;
};
export type ExtractOptions = {
  model: string;
  promptText: string;
  /** Recorded in the sidecar; the prompt text is passed in, not looked up here. */
  promptVersion?: string;
  /** Only the first n fixture rows; every row by default. */
  rows?: number;
  concurrency?: number;
  budgetUsd?: number;
  /** Rows already extracted, from a previous output file. */
  existing?: VcExtraction;
  resume?: boolean;
  log?: (line: string) => void;
};
export type ExtractResult = { extraction: VcExtraction; meta: ExtractMeta };

/**
 * Extracts every selected row and returns the VcExtraction plus its sidecar.
 * Rows run `concurrency` at a time in fixture order; before a worker takes a
 * row the running estimate is checked against the budget, so the stop is
 * bounded by the calls already in flight. Output keys stay in fixture order,
 * followed by any resumed row the selection did not cover.
 */
export async function extractRows(
  fixture: VcFixtureData,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const {
    model,
    promptText,
    promptVersion = "(supplied prompt)",
    concurrency = DEFAULT_CONCURRENCY,
    budgetUsd = DEFAULT_BUDGET_USD,
    existing = {},
    resume = false,
    log,
  } = options;
  const selected = options.rows === undefined ? fixture.rows : fixture.rows.slice(0, options.rows);
  const carried = resume
    ? selected.filter((r) => Object.prototype.hasOwnProperty.call(existing, r.id))
    : [];
  const pending = selected.filter((r) => !carried.includes(r));
  const transport = transportFor(STAGE);
  const spec = await transport.describe(model);
  const results = new Map<string, ExtractRowResult>();
  let estimatedUsd = 0;
  let stoppedForBudget = false;
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      if (estimatedUsd > budgetUsd) {
        stoppedForBudget = true;
        return;
      }
      const row = pending[next++];
      const result = await extractRow(row, { model, promptText, transport, spec });
      estimatedUsd += result.usd;
      results.set(row.id, result);
      log?.(
        `${row.id}: ${result.error ? `failed (${result.error})` : `${result.predictions.length} claim(s)`} est=$${estimatedUsd.toFixed(4)}`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, pending.length || 1)) }, worker),
  );
  const extraction: VcExtraction = {};
  const missing: ExtractMissing[] = [];
  for (const row of selected) {
    if (carried.includes(row)) {
      extraction[row.id] = existing[row.id];
      continue;
    }
    const result = results.get(row.id);
    if (!result) continue; // Never sent: the budget stopped the run first.
    // A failed row is omitted, never written as []: an empty list would score
    // as "no recommendation" in the benchmark, and --resume must re-send it.
    if (result.error) missing.push({ rowId: row.id, error: result.error });
    else extraction[row.id] = result.predictions;
  }
  // Resuming rewrites the file, so rows it did not select (--rows n, or ids
  // from another fixture) are carried through rather than dropped.
  if (resume)
    for (const [rowId, predictions] of Object.entries(existing))
      if (!Object.prototype.hasOwnProperty.call(extraction, rowId))
        extraction[rowId] = predictions;
  return {
    extraction,
    meta: {
      model,
      promptVersion,
      transport: transport.name,
      at: new Date().toISOString(),
      rows: Object.keys(extraction).length,
      missing,
      estimatedUsd,
      budgetUsd,
      stoppedForBudget,
      resumed: carried.length,
    },
  };
}

const ExistingExtraction = z.record(z.string(), z.array(VcPrediction));
/** The extraction already in `out`, or {} when there is none yet. */
export function loadExisting(out: string): VcExtraction {
  const file = resolve(out);
  if (!existsSync(file)) return {};
  return ExistingExtraction.parse(JSON.parse(readFileSync(file, "utf8")));
}
/** Writes the extraction and its <out>.meta.json sidecar. */
export function writeExtraction(out: string, extraction: VcExtraction, meta: ExtractMeta) {
  const file = resolve(out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(extraction, null, 2) + "\n");
  writeFileSync(
    `${file}.meta.json`,
    JSON.stringify({ version: VC_EXTRACT_VERSION, ...meta }, null, 2) + "\n",
  );
  return { out: file, meta: `${file}.meta.json` };
}

export type ExtractArgs = {
  fixture: string;
  out: string;
  rows: number | undefined;
  model: string | undefined;
  promptVersion: string | undefined;
  concurrency: number;
  budgetUsd: number;
  resume: boolean;
  quiet: boolean;
};
export function parseExtractArgs(argv: string[]): ExtractArgs {
  const flag = (name: string) => argv.includes(`--${name}`);
  const option = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--")
      ? argv[i + 1]
      : undefined;
  };
  const number = (name: string, value: string | undefined, rule: (n: number) => boolean) => {
    if (value === undefined) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || !rule(n)) throw Error(`--${name} must be ${name === "budget-usd" ? "a non-negative number" : "a positive integer"}: got ${value}`);
    return n;
  };
  const positiveInt = (n: number) => Number.isInteger(n) && n > 0;
  return {
    fixture: option("fixture") ?? FIXTURE_PATH,
    out: option("out") ?? DEFAULT_OUT,
    rows: number("rows", option("rows"), positiveInt),
    model: option("model"),
    promptVersion: option("prompt-version"),
    concurrency: number("concurrency", option("concurrency"), positiveInt) ?? DEFAULT_CONCURRENCY,
    budgetUsd: number("budget-usd", option("budget-usd"), (n) => n >= 0) ?? DEFAULT_BUDGET_USD,
    resume: flag("resume"),
    quiet: flag("quiet"),
  };
}

async function main() {
  const args = parseExtractArgs(process.argv.slice(2));
  const team = await teamPreferences();
  const promptVersion = args.promptVersion ?? team.prompts.version;
  // Default to the model the app queues runs with (an OpenRouter id), not
  // team.models.extraction.id: that id belongs to the google-native transport,
  // which is not registered yet, and the OpenRouter catalogue would reject it.
  const model = args.model ?? (await preferences()).model;
  const prompts = await getPrompt(promptVersion);
  const fixture = loadFixture(args.fixture);
  if (fixture.placeholder)
    console.warn(
      "warning: the fixture is a placeholder, not dataset rows; run scripts/vc-benchmark-fixture.mjs",
    );
  const out = resolve(ROOT, args.out);
  const { extraction, meta } = await extractRows(fixture, {
    model,
    promptText: extractionPrompt(prompts),
    promptVersion,
    rows: args.rows,
    concurrency: args.concurrency,
    budgetUsd: args.budgetUsd,
    existing: args.resume ? loadExisting(out) : {},
    resume: args.resume,
    log: args.quiet ? undefined : (line) => console.error(line),
  });
  const written = writeExtraction(out, extraction, meta);
  const { db } = await import("../src/server/youtube-intelligence/store.ts");
  await db().close();
  console.log(
    JSON.stringify({
      ...written,
      fixture: { dataset: fixture.dataset, split: fixture.split, rows: fixture.rows.length },
      model: meta.model,
      promptVersion: meta.promptVersion,
      transport: meta.transport,
      rows: meta.rows,
      resumed: meta.resumed,
      missing: meta.missing.length,
      estimatedUsd: Number(meta.estimatedUsd.toFixed(6)),
      budgetUsd: meta.budgetUsd,
      stoppedForBudget: meta.stoppedForBudget,
      score: `node --experimental-strip-types scripts/vc-benchmark.ts --extraction ${args.out} --model ${meta.model} --prompt-version ${meta.promptVersion}`,
    }),
  );
  if (meta.stoppedForBudget) process.exitCode = 1;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
