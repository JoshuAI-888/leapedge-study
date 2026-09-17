import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  YtiStance,
  YtiConviction,
  VcAction,
  VcConvictionScore,
  canonicalDatasetAction,
  datasetActionToStance,
  stanceToAction,
  scoreToConviction,
  normalizeVcTicker,
  type VcDatasetAction,
  type VcConvictionLabel,
} from "../../features/youtube-intelligence/conviction-mapping.ts";
import type { ClaimData } from "../../features/youtube-intelligence/contracts.ts";
import { put } from "./research-store.ts";
/**
 * VideoConviction benchmark harness (spec 4.9, handoff-videocviction.md
 * workstream A). Scores an extraction result (claims per labelled segment)
 * against the expert labels in the committed fixture and reports ticker,
 * stance, coarse action, conviction and no-recommendation agreement with
 * expected-by-predicted confusion matrices.
 *
 * The harness measures the extractor, not the auditor: raw claims are
 * compared, `passed` and critique verdicts are ignored. Rows absent from
 * the extraction are reported as missing and excluded from every
 * denominator, so an incomplete run can never look better than a complete
 * one. The fixture is a derived sample of a CC BY-NC 4.0 dataset and is an
 * evaluation input only; it never appears as product data.
 */
export const VC_BENCHMARK_VERSION = "vc-benchmark.v1";
export const FIXTURE_PATH = "evaluations/vc-benchmark-fixture.json";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const VcFixtureRow = z
  .object({
    id: z.string().min(1),
    datasetId: z.string().optional(),
    videoId: z.string().min(1),
    start: z.number().nullable(),
    end: z.number().nullable(),
    actionSource: z.string().nullable(),
    expected: z.object({
      isRecPresent: z.enum(["Yes", "No"]),
      action: z
        .string()
        .nullable()
        .transform((v, ctx): VcDatasetAction | null => {
          if (v === null) return null;
          try {
            return canonicalDatasetAction(v);
          } catch (e) {
            ctx.addIssue({ code: "custom", message: (e as Error).message });
            return z.NEVER;
          }
        }),
      convictionScore: VcConvictionScore.nullable(),
      ticker: z.string().nullable(),
    }),
    transcript: z.string(),
  })
  .superRefine((r, ctx) => {
    if (r.expected.isRecPresent === "Yes" && r.expected.action === null)
      ctx.addIssue({
        code: "custom",
        message: `Row ${r.id} is a recommendation without an action label`,
      });
  });
export const VcFixture = z.object({
  dataset: z.string().min(1),
  split: z.string().min(1),
  license: z.string().min(1),
  attribution: z.string().min(1),
  source: z.string().min(1),
  fetchedAt: z.string().min(1),
  datasetRows: z.number().int().nullable().optional(),
  columns: z.array(z.string()).optional(),
  placeholder: z.boolean().default(false),
  rows: z.array(VcFixtureRow).min(1),
});
export type VcFixtureRowData = z.infer<typeof VcFixtureRow>;
export type VcFixtureData = z.infer<typeof VcFixture>;

export function parseFixture(raw: unknown): VcFixtureData {
  return VcFixture.parse(raw);
}
/** Reads and validates a fixture; a relative path resolves against the repo root. */
export function loadFixture(path: string = FIXTURE_PATH): VcFixtureData {
  const file = isAbsolute(path) ? path : resolve(ROOT, path);
  return parseFixture(JSON.parse(readFileSync(file, "utf8")));
}

export const VcPrediction = z.object({
  ticker: z.string().nullable(),
  tickerExplicit: z.boolean(),
  stance: YtiStance,
  conviction: YtiConviction,
});
export type VcPredictionData = z.infer<typeof VcPrediction>;
export type VcPredictionInput = {
  ticker: string | null;
  tickerExplicit: boolean;
  stance: string;
  conviction: string;
};
/** Row id to the claims extracted for that segment; an absent key means the row was not run. */
export type VcExtraction = Record<string, VcPredictionInput[]>;

export function predictionsFromClaims(claims: ClaimData[]): VcPredictionData[] {
  return claims.map((c) => ({
    ticker: c.ticker,
    tickerExplicit: c.ticker_explicit,
    stance: c.stance,
    conviction: c.creator_conviction,
  }));
}

export const VcBenchmarkConfig = z.object({
  model: z.string().nullable().default(null),
  promptVersion: z.string().nullable().default(null),
  arm: z.enum(["text", "video"]),
  label: z.string().optional(),
});
export type VcBenchmarkConfigInput = z.input<typeof VcBenchmarkConfig>;

export type VcRowScore = {
  rowId: string;
  status: "scored" | "missing";
  expected: {
    isRecPresent: "Yes" | "No";
    label: VcDatasetAction | null;
    action: VcAction;
    stance: YtiStance | null;
    conviction: VcConvictionLabel | null;
    ticker: string | null;
  };
  predicted: VcPredictionData | null;
  predictionCount: number | null;
  tickerMatch: boolean | null;
  stanceMatch: boolean | null;
  actionMatch: boolean | null;
  convictionMatch: boolean | null;
  noRecRespected: boolean | null;
};
export type VcRate = { agree: number; total: number; rate: number | null };
export type VcMatrix = {
  labels: string[];
  counts: Record<string, Record<string, number>>;
  note: string;
};
export type VcBenchmarkReport = {
  id: string;
  at: string;
  version: string;
  fixture: {
    dataset: string;
    split: string;
    fetchedAt: string;
    placeholder: boolean;
    rowCount: number;
    hash: string;
  };
  config: z.infer<typeof VcBenchmarkConfig>;
  counts: {
    rows: number;
    scored: number;
    missing: number;
    rec: number;
    noRec: number;
    predictions: number;
  };
  agreement: {
    ticker: VcRate;
    stance: VcRate;
    action: VcRate;
    conviction: VcRate;
    noRec: VcRate;
  };
  confusion: { action: VcMatrix; stance: VcMatrix; conviction: VcMatrix };
  rows: VcRowScore[];
  limitation: string;
  attribution: string;
};

const CONVICTION_LABELS = ["low", "medium", "high", "unspecified", "none"];
const STANCE_LABELS = [...YtiStance.options, "none"];
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

function expectedOf(row: VcFixtureRowData): VcRowScore["expected"] {
  const rec = row.expected.isRecPresent === "Yes" && row.expected.action !== null;
  const stance = rec ? datasetActionToStance(row.expected.action) : null;
  return {
    isRecPresent: row.expected.isRecPresent,
    label: rec ? row.expected.action : null,
    action: stance ? stanceToAction(stance) : "none",
    stance,
    conviction: rec ? scoreToConviction(row.expected.convictionScore) : null,
    ticker: rec ? normalizeVcTicker(row.expected.ticker) : null,
  };
}
function parsePredictions(rowId: string, input: VcPredictionInput[]): VcPredictionData[] {
  const r = z.array(VcPrediction).safeParse(input);
  if (r.success) return r.data;
  throw Error(
    `Invalid prediction for row ${rowId}: ${r.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`,
  );
}
export function scoreRow(
  row: VcFixtureRowData,
  input: VcPredictionInput[] | undefined,
): VcRowScore {
  const expected = expectedOf(row);
  const none = {
    rowId: row.id,
    expected,
    predicted: null,
    predictionCount: null,
    tickerMatch: null,
    stanceMatch: null,
    actionMatch: null,
    convictionMatch: null,
    noRecRespected: null,
  };
  if (input === undefined) return { ...none, status: "missing" };
  const predictions = parsePredictions(row.id, input);
  const want = expected.ticker;
  const best =
    (want &&
      predictions.find((p) => normalizeVcTicker(p.ticker) === want)) ||
    predictions[0] ||
    null;
  const predictedAction = best ? stanceToAction(best.stance) : "none";
  if (expected.stance === null)
    return {
      ...none,
      status: "scored",
      predicted: best,
      predictionCount: predictions.length,
      actionMatch: predictedAction === "none",
      noRecRespected: predictions.length === 0,
    };
  return {
    ...none,
    status: "scored",
    predicted: best,
    predictionCount: predictions.length,
    tickerMatch: want
      ? !!best && best.tickerExplicit && normalizeVcTicker(best.ticker) === want
      : null,
    stanceMatch: !!best && best.stance === expected.stance,
    actionMatch: predictedAction === expected.action,
    convictionMatch: expected.conviction
      ? !!best && best.conviction === expected.conviction
      : null,
  };
}

function rate(rows: VcRowScore[], field: keyof VcRowScore): VcRate {
  const applicable = rows.filter((r) => r[field] !== null);
  const agree = applicable.filter((r) => r[field] === true).length;
  return {
    agree,
    total: applicable.length,
    rate: applicable.length ? agree / applicable.length : null,
  };
}
function matrix(
  labels: string[],
  pairs: { expected: string; predicted: string }[],
  note: string,
): VcMatrix {
  const counts: Record<string, Record<string, number>> = {};
  for (const e of labels) {
    counts[e] = {};
    for (const p of labels) counts[e][p] = 0;
  }
  for (const { expected, predicted } of pairs) {
    if (!(expected in counts) || !(predicted in counts[expected]))
      throw Error(`Confusion label outside the space: ${expected} -> ${predicted}`);
    counts[expected][predicted] += 1;
  }
  return { labels: [...labels], counts, note };
}

export function benchmark(
  fixture: VcFixtureData,
  extraction: VcExtraction,
  config: VcBenchmarkConfigInput,
): VcBenchmarkReport {
  const cfg = VcBenchmarkConfig.parse(config);
  const rows = fixture.rows.map((row) => scoreRow(row, extraction[row.id]));
  const scored = rows.filter((r) => r.status === "scored");
  const fixtureHash = hash(fixture.rows).slice(0, 16);
  const id = `vcBenchmark:${hash({ v: VC_BENCHMARK_VERSION, fixtureHash, cfg, extraction }).slice(0, 16)}`;
  return {
    id,
    at: new Date().toISOString(),
    version: VC_BENCHMARK_VERSION,
    fixture: {
      dataset: fixture.dataset,
      split: fixture.split,
      fetchedAt: fixture.fetchedAt,
      placeholder: fixture.placeholder,
      rowCount: fixture.rows.length,
      hash: fixtureHash,
    },
    config: cfg,
    counts: {
      rows: rows.length,
      scored: scored.length,
      missing: rows.length - scored.length,
      rec: scored.filter((r) => r.expected.stance !== null).length,
      noRec: scored.filter((r) => r.expected.stance === null).length,
      predictions: scored.reduce((n, r) => n + (r.predictionCount ?? 0), 0),
    },
    agreement: {
      ticker: rate(scored, "tickerMatch"),
      stance: rate(scored, "stanceMatch"),
      action: rate(scored, "actionMatch"),
      conviction: rate(scored, "convictionMatch"),
      noRec: rate(scored, "noRecRespected"),
    },
    confusion: {
      action: matrix(
        [...VcAction.options],
        scored.map((r) => ({
          expected: r.expected.action,
          predicted: r.predicted ? stanceToAction(r.predicted.stance) : "none",
        })),
        "Expected label (rows) by predicted claim (columns) in the coarse buy|sell|hold|none space; no-rec rows expect none and a missing claim predicts none.",
      ),
      stance: matrix(
        STANCE_LABELS,
        scored.map((r) => ({
          expected: r.expected.stance ?? "none",
          predicted: r.predicted?.stance ?? "none",
        })),
        "Expected stance (dataset label translated to our 7-way stance) by predicted stance; none marks no recommendation or no claim.",
      ),
      conviction: matrix(
        CONVICTION_LABELS,
        scored
          .filter((r) => r.expected.conviction !== null)
          .map((r) => ({
            expected: r.expected.conviction as string,
            predicted: r.predicted?.conviction ?? "none",
          })),
        "Expected conviction (dataset score 1-3 as low|medium|high) by predicted creator_conviction over recommendation rows; none marks no claim.",
      ),
    },
    rows,
    limitation:
      "Scores compare raw extracted claims with expert labels on retained segment excerpts; critique verdicts, evidence anchoring and full-video coverage are out of scope. The committed fixture is the first rows of the train split, not a stratified sample, so label mix is skewed toward Buy.",
    attribution: fixture.attribution,
  };
}

/** Echoes the labels back as predictions: every agreement is 1. Used to prove the harness, never as a result. */
export function oracleExtraction(fixture: VcFixtureData): VcExtraction {
  const out: VcExtraction = {};
  for (const row of fixture.rows) {
    const e = expectedOf(row);
    out[row.id] = e.stance
      ? [
          {
            ticker: e.ticker,
            tickerExplicit: true,
            stance: e.stance,
            conviction: e.conviction ?? "unspecified",
          },
        ]
      : [];
  }
  return out;
}
/**
 * Deterministic, deliberately imperfect extraction for --offline runs: the
 * oracle with position-based perturbations (dropped claims, wrong tickers,
 * shifted stances and convictions, spurious claims on no-rec rows) so every
 * matrix cell and metric path is exercised without a model call.
 */
export function fakeExtraction(fixture: VcFixtureData): VcExtraction {
  const out = oracleExtraction(fixture);
  const stances = YtiStance.options;
  const convictions: VcConvictionLabel[] = ["low", "medium", "high"];
  fixture.rows.forEach((row, i) => {
    const preds = out[row.id];
    if (!preds.length) {
      if (i % 2 === 1)
        out[row.id] = [{ ticker: "SPY", tickerExplicit: true, stance: "long", conviction: "low" }];
      return;
    }
    const p = { ...preds[0] };
    if (i % 5 === 4) {
      out[row.id] = [];
      return;
    }
    if (i % 4 === 3) p.ticker = "WRONG";
    if (i % 3 === 2)
      p.stance = stances[(stances.indexOf(p.stance as YtiStance) + 1) % stances.length];
    if (i % 7 === 6)
      p.conviction =
        convictions[(convictions.indexOf(p.conviction as VcConvictionLabel) + 1) % 3];
    out[row.id] = [p];
  });
  return out;
}

/** Persists the report as a workspace-internal vcBenchmark document (never a public share snapshot). */
export async function writeVcBenchmark(report: VcBenchmarkReport) {
  await put("vcBenchmark", report.id, report);
  return report;
}
