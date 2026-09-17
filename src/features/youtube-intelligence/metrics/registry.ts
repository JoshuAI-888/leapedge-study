import { z } from "zod";
import {
  summarizeScores,
  type scoreCall,
} from "../performance.ts";
/**
 * Metrics registry (spec section 4.11). One entry per figure the product shows.
 * The hover text, the Methodology page and the CI test all read these entries,
 * so the words and the arithmetic cannot drift apart. Entries are pure
 * functions over a MetricContext (stored rows plus the viewer's settings);
 * nothing here touches the database, so client components may import it.
 */
export const TrustLevel = z.enum(["L0", "L1", "L2", "L3"]);
export type TrustLevelName = z.infer<typeof TrustLevel>;
/** One settlement row: scoreCall output plus the identity fields the store adds. */
export const SettlementRow = z.looseObject({
  id: z.string().min(1),
  runId: z.string().optional(),
  claimId: z.string().optional(),
  channel: z.string().optional(),
  ticker: z.string().optional(),
  stance: z.string().optional(),
  conviction: z.string().optional(),
  status: z.string().min(1),
  reason: z.string().optional(),
  stockReturn: z.number().optional(),
  spyReturn: z.number().optional(),
  excessReturn: z.number().optional(),
  win: z.boolean().optional(),
  beatsSpy: z.boolean().optional(),
  horizonDays: z.number().int().positive().optional(),
  benchmark: z.string().optional(),
  mode: z.string().optional(),
});
export type SettlementRowData = z.infer<typeof SettlementRow>;
/** One claim as the trust ladder sees it. trust is null for claims the critic rejected. */
export const ClaimRow = z.object({
  runId: z.string().min(1),
  claimId: z.string().min(1),
  channel: z.string(),
  ticker: z.string().nullable(),
  stance: z.string(),
  conviction: z.string(),
  passed: z.boolean(),
  trust: TrustLevel.nullable(),
});
export type ClaimRowData = z.infer<typeof ClaimRow>;
export const MetricContext = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horizonDays: z.number().int().positive(),
  benchmark: z.string().min(1),
  mode: z.enum(["leapedge", "forward", "historical"]),
  settlements: z.array(SettlementRow),
  claims: z.array(ClaimRow),
});
export type MetricContext = z.infer<typeof MetricContext>;
export type MetricValue =
  | number
  | string
  | boolean
  | null
  | MetricValue[]
  | { [key: string]: MetricValue };
export type MetricInput = { table: string; columns: string[] };
export type MetricEntry = {
  /** Dotted, stable id; CSV headers and UI columns cite it. */
  id: string;
  label: string;
  /** One plain sentence saying what the figure means. */
  definition: string;
  /** Plain-language calculation steps, in order. */
  steps: string[];
  /** Tables and columns the calculation reads. */
  inputs: MetricInput[];
  /** Settings paths (spec section 6) that change the result. */
  settingsUsed: string[];
  implementation: (ctx: MetricContext) => MetricValue;
};
/** Wilson score interval for a proportion; null when there are no trials. */
export function wilsonInterval(successes: number, trials: number, z = 1.959964) {
  if (!(trials > 0)) return null;
  const p = successes / trials,
    z2 = z * z,
    denominator = 1 + z2 / trials,
    centre = (p + z2 / (2 * trials)) / denominator,
    half = (z / denominator) * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  // With no successes the lower bound is exactly 0 and with all successes the
  // upper bound is exactly 1; floating point would otherwise land a hair off.
  return {
    low: successes === 0 ? 0 : Math.max(0, centre - half),
    high: successes === trials ? 1 : Math.min(1, centre + half),
    n: trials,
    z,
  };
}
const SETTLEMENT = "yi_documents (kind = settlement)";
const RUNS = "yi_runs";
const settlementInputs = (...columns: string[]): MetricInput[] => [
  { table: SETTLEMENT, columns: ["payload.id", ...columns] },
];
const recordSettings = [
  "accountDefaults.benchmark",
  "accountDefaults.defaultHorizonDays",
  "leaderboard.convictionIncluded",
];
const scopeSteps = [
  "Take every settlement row for the chosen record (comparison, forward or historical), horizon and benchmark.",
];
const pricedSteps = [
  ...scopeSteps,
  "Keep the rows whose status is completed or ongoing; these have an entry price, an exit price and a benchmark return on matching sessions.",
];
/** summarizeScores reads only status and the return fields, which SettlementRow guarantees. */
function summary(ctx: MetricContext) {
  return summarizeScores(ctx.settlements as unknown as ReturnType<typeof scoreCall>[]);
}
function pricedRows(ctx: MetricContext) {
  return ctx.settlements.filter((r) => typeof r.stockReturn === "number");
}
function trustCount(level: TrustLevelName, name: string, meaning: string): MetricEntry {
  return {
    id: `trust.${level.toLowerCase()}Count`,
    label: `${name} claims`,
    definition: `The number of claims on the current canonical analyses whose trust level is ${level}, ${meaning}.`,
    steps: [
      "Take the canonical analysis of every video: the published run when one is chosen, otherwise the newest completed non-experiment run.",
      "Take every claim on those analyses that the deterministic checks accepted; claims the critic rejected are not on the ladder.",
      "Read each claim's stored trust level; when none is stored yet, use L1 when the critic accepted the claim and L0 otherwise.",
      `Count the claims whose level is exactly ${level}.`,
    ],
    inputs: [
      {
        table: RUNS,
        columns: ["status", "input.experiment", "output.claims[].passed", "output.claims[].audit.verdict", "output.claims[].trust"],
      },
      { table: "yi_documents (kind = publication)", columns: ["payload.videoId", "payload.runId"] },
    ],
    settingsUsed: ["trust.minimumLevelForToday", "trust.showExtractedInLab"],
    implementation: (ctx) => ctx.claims.filter((c) => c.trust === level).length,
  };
}
export const registry: MetricEntry[] = [
  {
    id: "channel.title",
    label: "Channel",
    definition: "The creator channel whose calls a row summarises, as recorded on the analysis run.",
    steps: [
      "Read the channel title stored in the run's metadata when the video was analysed.",
      "Group the settlement rows by that title; each distinct title is one row of the table.",
    ],
    inputs: [
      { table: RUNS, columns: ["output.metadata.channel"] },
      { table: SETTLEMENT, columns: ["payload.channel"] },
    ],
    settingsUsed: [],
    implementation: (ctx) =>
      [...new Set(ctx.settlements.map((r) => r.channel).filter((c): c is string => typeof c === "string"))].sort(),
  },
  {
    id: "calls.count",
    label: "Calls",
    definition: "The number of accepted claims that name a ticker, whether or not they could be priced.",
    steps: [
      ...scopeSteps,
      "Count the rows; each accepted claim with a ticker produces exactly one row per record, horizon and benchmark.",
    ],
    inputs: settlementInputs("payload.runId", "payload.claimId"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).total,
  },
  {
    id: "calls.priced",
    label: "Priced calls",
    definition: "The number of calls that have an entry session, an exit session and a benchmark price on both, so a return exists.",
    steps: [...pricedSteps, "Count those rows."],
    inputs: settlementInputs("payload.status", "payload.stockReturn"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).priced,
  },
  {
    id: "calls.completed",
    label: "Completed calls",
    definition: "The number of priced calls whose horizon date is on or before the as-of date, so their return is final.",
    steps: [...pricedSteps, "Count the rows whose status is completed."],
    inputs: settlementInputs("payload.status", "payload.targetDate", "payload.asOf"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).completed,
  },
  {
    id: "calls.ongoing",
    label: "Ongoing calls",
    definition: "The number of priced calls whose horizon date is still ahead of the as-of date, so their return is provisional.",
    steps: [...pricedSteps, "Count the rows whose status is ongoing."],
    inputs: settlementInputs("payload.status", "payload.targetDate", "payload.asOf"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).ongoing,
  },
  {
    id: "calls.meanReturn",
    label: "Mean return",
    definition: "The simple average of each priced call's own return from its entry close to its exit close, with shorts sign-flipped.",
    steps: [
      ...pricedSteps,
      "For each row take exit close divided by entry close minus one, using dividend-adjusted closes from the same provider.",
      "Multiply by minus one when the call is a short.",
      "Add the returns and divide by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs("payload.status", "payload.entryPrice", "payload.exitPrice", "payload.stance", "payload.stockReturn"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).meanReturn,
  },
  {
    id: "calls.meanBenchmarkReturn",
    label: "Benchmark return",
    definition: "The simple average of the benchmark's return over exactly the same entry and exit sessions as each priced call.",
    steps: [
      ...pricedSteps,
      "For each row take the benchmark close on the exit session divided by its close on the entry session, minus one.",
      "Add those returns and divide by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs("payload.status", "payload.spyEntry", "payload.spyExit", "payload.spyReturn", "payload.benchmark"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).meanSpy,
  },
  {
    id: "calls.meanExcessReturn",
    label: "Excess return",
    definition: "The simple average of each priced call's return minus the benchmark's return over the same sessions.",
    steps: [
      ...pricedSteps,
      "For each row subtract the benchmark return from the call's return over the same entry and exit sessions.",
      "Add those differences and divide by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs("payload.status", "payload.stockReturn", "payload.spyReturn", "payload.excessReturn"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).meanExcess,
  },
  {
    id: "calls.winRate",
    label: "Win rate",
    definition: "The share of priced calls whose own return, sign-flipped for shorts, is above zero.",
    steps: [
      ...pricedSteps,
      "Mark a row as a win when its return is greater than zero; exactly zero is not a win.",
      "Divide the number of wins by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs("payload.status", "payload.stockReturn", "payload.win"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).winRate,
  },
  {
    id: "calls.winRateInterval",
    label: "Win rate 95% interval",
    definition: "The Wilson score interval that contains the true win rate with 95% confidence given how many calls were priced.",
    steps: [
      ...pricedSteps,
      "Count the wins and the priced rows, as for the win rate.",
      "Apply the Wilson score formula with z = 1.96: centre on (wins + z²/2) / (n + z²) and widen by z × √(p(1−p)/n + z²/4n²) / (1 + z²/n).",
      "Clamp the result to the range 0 to 1; show nothing when no call was priced.",
    ],
    inputs: settlementInputs("payload.status", "payload.win"),
    settingsUsed: recordSettings,
    implementation: (ctx) => {
      const rows = pricedRows(ctx);
      return wilsonInterval(rows.filter((r) => r.win === true).length, rows.length);
    },
  },
  {
    id: "calls.beatsBenchmarkRate",
    label: "Beats benchmark",
    definition: "The share of priced calls whose own return is above the benchmark's return over the same sessions.",
    steps: [
      ...pricedSteps,
      "Mark a row when its return is strictly greater than the benchmark return; equal returns do not count.",
      "Divide the number of marked rows by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs("payload.status", "payload.stockReturn", "payload.spyReturn", "payload.beatsSpy"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).beatsSpyRate,
  },
  trustCount("L0", "Extracted", "meaning they passed the schema and deterministic checks only"),
  trustCount("L1", "Text-checked", "meaning pointer evidence, price and ticker checks passed and the critic accepted them"),
  trustCount("L2", "Audio-agreed", "meaning caption and audio transcripts agree on the cited span above the configured threshold"),
  trustCount("L3", "Human-verified", "meaning a named reviewer listened to the cited span and signed the claim"),
];
const byId = new Map(registry.map((m) => [m.id, m]));
export function metric(id: string): MetricEntry {
  const entry = byId.get(id);
  if (!entry) throw Error(`Unknown metric: ${id}`);
  return entry;
}
export function renderSteps(entry: MetricEntry) {
  return entry.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}
/** Hover text: the definition, then the numbered steps. */
export function renderHover(id: string) {
  const entry = metric(id);
  return `${entry.definition}\n\nHow it is calculated:\n${renderSteps(entry)}`;
}
export function evaluate(id: string, ctx: MetricContext): MetricValue {
  return metric(id).implementation(MetricContext.parse(ctx));
}
