import { z } from "zod";
import { CostContext, costProjection, budgetMeter } from "./cost.ts";
import { summarizeScores, type scoreCall } from "../performance.ts";
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
  cost: CostContext.optional(),
  board: z
    .object({
      label: z.string(),
      rank: z.number().nullable(),
      n: z.number(),
      winRate: z.number().nullable(),
      medianExcess: z.number().nullable(),
      status: z.string(),
    })
    .optional(),
  ticker: z
    .object({
      ticker: z.string(),
      consensus: z.string(),
      creators: z.number().int().nonnegative(),
      mostReliableCreator: z
        .object({
          label: z.string(),
          n: z.number().int().nonnegative(),
          winRate: z.number().nullable(),
          status: z.string(),
        })
        .nullable(),
    })
    .optional(),
  change: z
    .object({
      kind: z.string(),
      label: z.string(),
      beforeRank: z.number().nullable(),
      afterRank: z.number().nullable(),
      callsAdded: z.number(),
      reason: z.string(),
    })
    .optional(),
  sentiment: z
    .object({ direction: z.enum(["bullish", "bearish", "unchanged"]) })
    .optional(),
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
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.959964,
) {
  if (!(trials > 0)) return null;
  const p = successes / trials,
    z2 = z * z,
    denominator = 1 + z2 / trials,
    centre = (p + z2 / (2 * trials)) / denominator,
    half =
      (z / denominator) *
      Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
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
  return summarizeScores(
    ctx.settlements as unknown as ReturnType<typeof scoreCall>[],
  );
}
function pricedRows(ctx: MetricContext) {
  return ctx.settlements.filter((r) => typeof r.stockReturn === "number");
}
function trustCount(
  level: TrustLevelName,
  name: string,
  meaning: string,
): MetricEntry {
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
        columns: [
          "status",
          "input.experiment",
          "output.claims[].passed",
          "output.claims[].audit.verdict",
          "output.claims[].trust",
        ],
      },
      {
        table: "yi_documents (kind = publication)",
        columns: ["payload.videoId", "payload.runId"],
      },
    ],
    settingsUsed: ["trust.minimumLevelForToday", "trust.showExtractedInLab"],
    implementation: (ctx) => ctx.claims.filter((c) => c.trust === level).length,
  };
}
const costFigures = [
  [
    "cost.projectedMonthlyUsd",
    "Projected monthly cost",
    "The estimated monthly processing cost of the selected channels, or unknown when discovery or measured costs are incomplete.",
    (c: z.infer<typeof CostContext>) => costProjection(c).projectedMonthlyUsd,
  ],
  [
    "cost.measuredPerVideoUsd",
    "Measured cost per video",
    "The mean settled cost of completed analysis samples, including videos with zero accepted claims.",
    (c: z.infer<typeof CostContext>) =>
      costProjection(c).measuredCostPerVideoUsd,
  ],
  [
    "cost.sampleCount",
    "Measured video samples",
    "The number of completed analysis samples with fully settled measured costs.",
    (c: z.infer<typeof CostContext>) => costProjection(c).sampleCount,
  ],
  [
    "cost.sampleCoverage",
    "Cost sample coverage",
    "The fraction of completed analysis samples with fully settled costs, or unknown when there are no samples.",
    (c: z.infer<typeof CostContext>) => costProjection(c).sampleCoverage,
  ],
  [
    "cost.monthToDateSpentUsd",
    "Month-to-date spend",
    "The settled spend dated within the current UTC calendar month.",
    (c: z.infer<typeof CostContext>) => budgetMeter(c).monthToDateSpentUsd,
  ],
  [
    "cost.openHoldsUsd",
    "Open cost holds",
    "The amount still reserved across all months, including calls with unknown outcomes.",
    (c: z.infer<typeof CostContext>) => budgetMeter(c).openHoldsUsd,
  ],
  [
    "cost.unknownOutcomeHoldsUsd",
    "Unknown outcome holds",
    "The amount reserved for calls whose billing outcome is still unknown.",
    (c: z.infer<typeof CostContext>) => budgetMeter(c).unknownOutcomeHoldsUsd,
  ],
  [
    "cost.unallocatedSpentUsd",
    "Undated spend",
    "The settled spend without a settlement timestamp, held conservatively against available budget.",
    (c: z.infer<typeof CostContext>) => budgetMeter(c).unallocatedSpentUsd,
  ],
  [
    "cost.committedUsd",
    "Month spend and holds",
    "The current UTC month's settled spend plus all open reservations.",
    (c: z.infer<typeof CostContext>) => budgetMeter(c).committedUsd,
  ],
  [
    "cost.monthlyBudgetUsd",
    "Team monthly budget",
    "The configured team monthly spending budget in US dollars.",
    (c: z.infer<typeof CostContext>) => c.monthlyUsd,
  ],
  [
    "cost.hardCeilingUsd",
    "Environment hard ceiling",
    "The environment's monthly spending ceiling, or unknown when it is not configured.",
    (c: z.infer<typeof CostContext>) => c.hardCeilingUsd,
  ],
  [
    "cost.remainingUsd",
    "Available budget",
    "The lower of team budget and environment ceiling minus dated spend, open holds and undated spend, floored at zero.",
    (c: z.infer<typeof CostContext>) => budgetMeter(c).remainingUsd,
  ],
] as const;
const costEntries: MetricEntry[] = costFigures.map(
  ([id, label, definition, compute]) => ({
    id,
    label,
    definition,
    steps:
      id.startsWith("cost.projected") ||
      id === "cost.measuredPerVideoUsd" ||
      id.startsWith("cost.sample")
        ? [
            "Count distinct discovered uploads published within the last 90 days through the as-of instant; require complete metadata coverage for each selected channel.",
            "Divide uploads by three to estimate a 30-day month; incomplete discovery remains unknown, not zero.",
            "Average fully settled completed analysis costs, including videos that accepted no claims; disclose sample count and coverage.",
            "Multiply each channel's upload rate by measured cost per video and sum the selected channels; a missing rate or cost makes the total unknown unless there are no uploads.",
          ]
        : [
            "Sum completed calls settled between UTC month start and the as-of instant.",
            "Add reserved and unknown-outcome holds from all months; exclude released attempts.",
            "Disclose undated completed calls separately and conservatively subtract them from available headroom.",
            "Compare against the team budget, alert percentage and environment hard ceiling; a projection warning does not block channel selection.",
          ],
    inputs: [
      { table: "yi_calls", columns: ["status", "amount", "metrics.settledAt"] },
      {
        table: "yi_discoveries",
        columns: ["video_id", "channel_id", "payload.publishedAt"],
      },
      {
        table: "yi_runs",
        columns: ["status", "input.experiment", "output.claims"],
      },
    ],
    settingsUsed: [
      "budget.monthlyUsd",
      "budget.alertAtPercent",
      "channels.selection",
      "YTI_HARD_BUDGET_USD_MONTH",
    ],
    implementation: (ctx) => (ctx.cost ? compute(ctx.cost) : null),
  }),
);
export const registry: MetricEntry[] = [
  ...(
    [
      [
        "symbol",
        "Ticker",
        "The resolved instrument symbol whose eligible calls are grouped in this row.",
      ],
      [
        "consensus",
        "Consensus now",
        "Agreement among the latest open directional call from each eligible creator: agree, lean or split.",
      ],
      [
        "creators",
        "Creators",
        "The number of distinct creators with eligible calls on this ticker under the selected record, market and trust filters.",
      ],
      [
        "reliableCreator",
        "Most reliable creator",
        "The creator with the highest directional win rate on this ticker after at least ten settled calls; its badge uses the creator-level statistical status.",
      ],
    ] as const
  ).map(([key, label, definition]): MetricEntry => ({
    id: `ticker.${key}`,
    label,
    definition,
    steps: [
      "Apply the selected horizon, record, market, conviction and trust filters to stored claims and settlements.",
      key === "consensus"
        ? "Keep each creator's latest open call, count longs and shorts, and label unanimity as agree, equal disagreement as split, and a majority as lean."
        : key === "reliableCreator"
          ? "Keep creators with at least the configured minimum of ten settled calls on this ticker, sort by win rate then sample size, and carry the creator-level significance badge."
          : "Group eligible claims by resolved ticker and count distinct creator identifiers.",
      definition,
    ],
    inputs: [
      {
        table: "claims",
        columns: [
          "ticker",
          "channel_id",
          "stance",
          "trust_level",
          "published_at",
        ],
      },
      { table: "settlements", columns: ["claim_id", "return_pct", "status"] },
    ],
    settingsUsed: [
      "accountDefaults.benchmark",
      "accountDefaults.defaultHorizonDays",
      "leaderboard.minSettledPerTicker",
      "leaderboard.minimumTrust",
    ],
    implementation: (ctx) =>
      !ctx.ticker
        ? null
        : key === "symbol"
          ? ctx.ticker.ticker
          : key === "consensus"
            ? ctx.ticker.consensus
            : key === "creators"
              ? ctx.ticker.creators
              : ctx.ticker.mostReliableCreator &&
                  ctx.ticker.mostReliableCreator.n >= 10
                ? ctx.ticker.mostReliableCreator.label
                : null,
  })),
  ...(
    [
      [
        "kind",
        "Board",
        "Whether this change belongs to the creator or ticker board.",
      ],
      [
        "label",
        "Name",
        "The creator or ticker whose two dated boards are compared.",
      ],
      [
        "beforeRank",
        "Earlier rank",
        "Rank computed at the earlier cutoff; fewer than twenty settled calls remains unranked.",
      ],
      [
        "afterRank",
        "Current rank",
        "Rank computed at the later cutoff; fewer than twenty settled calls remains unranked.",
      ],
      [
        "callsAdded",
        "Calls added",
        "Eligible settled count at the later cutoff minus the earlier count; a correction or filter can reduce it.",
      ],
      [
        "reason",
        "What changed",
        "Whether the group entered, left, crossed the sample gate, changed statistical status or moved after new settlements.",
      ],
    ] as const
  ).map(([key, label, definition]): MetricEntry => ({
    id: `changes.${key}`,
    label,
    definition,
    steps: [
      "Compute both boards from settlements and price revisions known at their cutoff using identical filters.",
      "Compare each creator or ticker's row by stable identifier.",
      definition,
    ],
    inputs: [
      { table: "settlements", columns: ["claim_id", "created_at", "revision"] },
      { table: "price_history", columns: ["date", "fetched_at"] },
    ],
    settingsUsed: [
      "accountDefaults.changeWindowDays",
      "accountDefaults.benchmark",
      "leaderboard.minimumTrust",
    ],
    implementation: (ctx) => ctx.change?.[key] ?? null,
  })),
  {
    id: "sentiment.direction",
    label: "Sentiment shift",
    definition:
      "Direction of the change in bullish minus bearish distinct creators between adjacent periods; each creator's latest stance counts once per period.",
    steps: [
      "Apply the trust filter and divide mentions into two adjacent equal periods.",
      "Count every mention and each creator's latest stance per period.",
      "Subtract prior bullish-minus-bearish creators from the current figure.",
    ],
    inputs: [
      {
        table: "mentions",
        columns: [
          "ticker",
          "channel_id",
          "sentiment",
          "published_at",
          "trust_level",
        ],
      },
    ],
    settingsUsed: [
      "accountDefaults.sentimentPeriodDays",
      "sentiment.minimumTrust",
    ],
    implementation: (ctx) => ctx.sentiment?.direction ?? null,
  },
  ...(
    [
      [
        "label",
        "Name",
        "The creator or ticker whose stored eligible calls are grouped in this row.",
      ],
      [
        "rank",
        "Rank",
        "Position after sorting eligible groups by median excess return, with groups below twenty settled calls placed last.",
      ],
      [
        "settledCount",
        "Settled calls",
        "Number of audio-agreed medium or high conviction directional calls settled at the selected horizon.",
      ],
      [
        "winRate",
        "Win rate",
        "Fraction of settled calls with positive directional return; short returns are sign-flipped.",
      ],
      [
        "medianExcess",
        "Median excess",
        "Middle directional return minus the chosen benchmark return over identical entry and exit dates.",
      ],
      [
        "status",
        "Evidence",
        "Supported or negative requires at least twenty settled calls and a Benjamini–Hochberg adjusted two-sided p-value below the configured threshold.",
      ],
    ] as const
  ).map(([key, label, definition]): MetricEntry => ({
    id: `board.${key}`,
    label,
    definition,
    steps: [
      "Read the latest append-only settlement for each claim at the selected cutoff.",
      "Apply record, horizon, market, conviction and trust filters.",
      definition,
    ],
    inputs: [
      {
        table: "settlements",
        columns: ["claim_id", "return_pct", "created_at"],
      },
      {
        table: "price_history",
        columns: ["ticker", "date", "adjusted_close", "fetched_at"],
      },
    ],
    settingsUsed: [
      "accountDefaults.benchmark",
      "accountDefaults.defaultHorizonDays",
      "leaderboard.minimumTrust",
      "leaderboard.fdrQ",
    ],
    implementation: (ctx) =>
      ctx.board ? ctx.board[key === "settledCount" ? "n" : key] : null,
  })),
  ...costEntries,
  {
    id: "channel.title",
    label: "Channel",
    definition:
      "The creator channel whose calls a row summarises, as recorded on the analysis run.",
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
      [
        ...new Set(
          ctx.settlements
            .map((r) => r.channel)
            .filter((c): c is string => typeof c === "string"),
        ),
      ].sort(),
  },
  {
    id: "calls.count",
    label: "Calls",
    definition:
      "The number of accepted claims that name a ticker, whether or not they could be priced.",
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
    definition:
      "The number of calls that have an entry session, an exit session and a benchmark price on both, so a return exists.",
    steps: [...pricedSteps, "Count those rows."],
    inputs: settlementInputs("payload.status", "payload.stockReturn"),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).priced,
  },
  {
    id: "calls.completed",
    label: "Completed calls",
    definition:
      "The number of priced calls whose horizon date is on or before the as-of date, so their return is final.",
    steps: [...pricedSteps, "Count the rows whose status is completed."],
    inputs: settlementInputs(
      "payload.status",
      "payload.targetDate",
      "payload.asOf",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).completed,
  },
  {
    id: "calls.ongoing",
    label: "Ongoing calls",
    definition:
      "The number of priced calls whose horizon date is still ahead of the as-of date, so their return is provisional.",
    steps: [...pricedSteps, "Count the rows whose status is ongoing."],
    inputs: settlementInputs(
      "payload.status",
      "payload.targetDate",
      "payload.asOf",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).ongoing,
  },
  {
    id: "calls.meanReturn",
    label: "Mean return",
    definition:
      "The simple average of each priced call's own return from its entry close to its exit close, with shorts sign-flipped.",
    steps: [
      ...pricedSteps,
      "For each row take exit close divided by entry close minus one, using dividend-adjusted closes from the same provider.",
      "Multiply by minus one when the call is a short.",
      "Add the returns and divide by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs(
      "payload.status",
      "payload.entryPrice",
      "payload.exitPrice",
      "payload.stance",
      "payload.stockReturn",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).meanReturn,
  },
  {
    id: "calls.meanBenchmarkReturn",
    label: "Benchmark return",
    definition:
      "The simple average of the benchmark's return over exactly the same entry and exit sessions as each priced call.",
    steps: [
      ...pricedSteps,
      "For each row take the benchmark close on the exit session divided by its close on the entry session, minus one.",
      "Add those returns and divide by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs(
      "payload.status",
      "payload.spyEntry",
      "payload.spyExit",
      "payload.spyReturn",
      "payload.benchmark",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).meanSpy,
  },
  {
    id: "calls.meanExcessReturn",
    label: "Excess return",
    definition:
      "The simple average of each priced call's return minus the benchmark's return over the same sessions.",
    steps: [
      ...pricedSteps,
      "For each row subtract the benchmark return from the call's return over the same entry and exit sessions.",
      "Add those differences and divide by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs(
      "payload.status",
      "payload.stockReturn",
      "payload.spyReturn",
      "payload.excessReturn",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).meanExcess,
  },
  {
    id: "calls.winRate",
    label: "Win rate",
    definition:
      "The share of priced calls whose own return, sign-flipped for shorts, is above zero.",
    steps: [
      ...pricedSteps,
      "Mark a row as a win when its return is greater than zero; exactly zero is not a win.",
      "Divide the number of wins by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs(
      "payload.status",
      "payload.stockReturn",
      "payload.win",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).winRate,
  },
  {
    id: "calls.winRateInterval",
    label: "Win rate 95% interval",
    definition:
      "The Wilson score interval that contains the true win rate with 95% confidence given how many calls were priced.",
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
      return wilsonInterval(
        rows.filter((r) => r.win === true).length,
        rows.length,
      );
    },
  },
  {
    id: "calls.beatsBenchmarkRate",
    label: "Beats benchmark",
    definition:
      "The share of priced calls whose own return is above the benchmark's return over the same sessions.",
    steps: [
      ...pricedSteps,
      "Mark a row when its return is strictly greater than the benchmark return; equal returns do not count.",
      "Divide the number of marked rows by the number of priced rows; show nothing when there are none.",
    ],
    inputs: settlementInputs(
      "payload.status",
      "payload.stockReturn",
      "payload.spyReturn",
      "payload.beatsSpy",
    ),
    settingsUsed: recordSettings,
    implementation: (ctx) => summary(ctx).beatsSpyRate,
  },
  trustCount(
    "L0",
    "Extracted",
    "meaning they passed the schema and deterministic checks only",
  ),
  trustCount(
    "L1",
    "Text-checked",
    "meaning pointer evidence, price and ticker checks passed and the critic accepted them",
  ),
  trustCount(
    "L2",
    "Audio-agreed",
    "meaning caption and audio transcripts agree on the cited span above the configured threshold",
  ),
  trustCount(
    "L3",
    "Human-verified",
    "meaning a named reviewer listened to the cited span and signed the claim",
  ),
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
