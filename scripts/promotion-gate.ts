import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  TeamPreferences,
  GateThresholds,
  teamDefaults,
  configHash,
  hashedConfiguration,
  type TeamPreferencesData,
  type GateThresholdsData,
} from "../src/features/youtube-intelligence/settings.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
import {
  loadGoldSet,
  DEFAULT_CASES_PATH,
} from "../evaluations/gold-set/schema.ts";
import { goldReport, type GoldReport } from "../evaluations/gold-set/report.ts";
import {
  loadFixture,
  benchmark,
  fakeExtraction,
  FIXTURE_PATH,
  type VcBenchmarkReport,
  type VcExtraction,
} from "../src/server/youtube-intelligence/vc-benchmark.ts";
/**
 * Promotion gate (spec 4.9 and 9; build plan F08).
 *
 *   node --experimental-strip-types scripts/promotion-gate.ts --offline
 *     [--config <team-preferences.json>]      default: teamDefaults()
 *     [--cases evaluations/gold-set/cases.json] [--runs <runs.json>]
 *     [--fixture evaluations/vc-benchmark-fixture.json] [--extraction <extraction.json>]
 *     [--out data/gates/gate-<configHash>.json]
 *
 * One command for one team configuration: compute its configuration hash,
 * run the gold-set report (evaluations/gold-set) and the VideoConviction
 * benchmark (vc-benchmark.ts), compare both with the thresholds in
 * `lab.gates`, and write a dated JSON report with configHash, thresholds,
 * results, advisory and pass. Exit status 1 when the gate fails.
 *
 * --offline needs no key and spends nothing: every model call is routed
 * through FakeModelTransport, the gold set replays stored runs (or --runs),
 * and VideoConviction scores the deterministic fake extraction unless
 * --extraction supplies a real one. Advisory results (gold set below its
 * minimum of verified cases, fake extraction, placeholder fixture) are
 * reported but never fail the gate, per lab.gates.advisoryPolicy.
 * --live (extraction through the transports with keys) arrives with the
 * phase-1 gate (F21).
 */
export const GATE_REPORT_VERSION = "promotion-gate.v1";
export const GATE_CHECK_IDS = [
  "goldPrecision",
  "goldRecall",
  "anchorWithin2s",
  "vcStanceAgreement",
  "costPerAcceptedClaim",
] as const;
export type GateCheckId = (typeof GATE_CHECK_IDS)[number];

/** The slice of the two harness reports the gate reads; both real reports satisfy it. */
export type GateMeasurements = {
  gold: {
    advisory: boolean;
    advisoryReason?: string | null;
    claims: { precision: number | null; recall: number | null };
    anchors: { accuracy: number | null; toleranceSeconds?: number };
    cost: { perAcceptedClaimUsd: number | null };
  };
  vc: {
    advisory: boolean;
    advisoryReason?: string | null;
    agreement: { stance: { rate: number | null } };
  };
};

const GateCheckIdSchema = z.enum(GATE_CHECK_IDS);
export const GateCheck = z.object({
  id: GateCheckIdSchema,
  source: z.enum(["gold-set", "vc-benchmark"]),
  metric: z.string().min(1),
  comparison: z.enum(["min", "max"]),
  threshold: z.number(),
  value: z.number().nullable(),
  // null when the metric was not measured (no denominator).
  meetsThreshold: z.boolean().nullable(),
  advisory: z.boolean(),
  // True only for a binding check that did not meet its threshold or was not measured.
  blocking: z.boolean(),
  reason: z.string().min(1),
});
export type GateCheckData = z.infer<typeof GateCheck>;
export const GateAdvisory = z.object({
  id: GateCheckIdSchema,
  value: z.number().nullable(),
  threshold: z.number(),
  meetsThreshold: z.boolean().nullable(),
  reason: z.string().min(1),
});
export const GateVerdict = z.enum(["pass", "fail", "advisory-only"]);
export const GateEvaluation = z.object({
  results: z.object({
    goldPrecision: GateCheck,
    goldRecall: GateCheck,
    anchorWithin2s: GateCheck,
    vcStanceAgreement: GateCheck,
    costPerAcceptedClaim: GateCheck,
  }),
  advisory: z.array(GateAdvisory),
  binding: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  pass: z.boolean(),
  verdict: GateVerdict,
});
export type GateEvaluationData = z.infer<typeof GateEvaluation>;

type CheckSpec = {
  id: GateCheckId;
  source: "gold-set" | "vc-benchmark";
  metric: string;
  comparison: "min" | "max";
  threshold: (t: GateThresholdsData) => number;
  value: (m: GateMeasurements) => number | null;
};
const CHECKS: CheckSpec[] = [
  {
    id: "goldPrecision",
    source: "gold-set",
    metric: "claims.precision",
    comparison: "min",
    threshold: (t) => t.goldPrecisionMin,
    value: (m) => m.gold.claims.precision,
  },
  {
    id: "goldRecall",
    source: "gold-set",
    metric: "claims.recall",
    comparison: "min",
    threshold: (t) => t.goldRecallMin,
    value: (m) => m.gold.claims.recall,
  },
  {
    id: "anchorWithin2s",
    source: "gold-set",
    metric: "anchors.accuracy",
    comparison: "min",
    threshold: (t) => t.anchorWithin2sMin,
    value: (m) => m.gold.anchors.accuracy,
  },
  {
    id: "vcStanceAgreement",
    source: "vc-benchmark",
    metric: "agreement.stance.rate",
    comparison: "min",
    threshold: (t) => t.vcStanceAgreementMin,
    value: (m) => m.vc.agreement.stance.rate,
  },
  {
    id: "costPerAcceptedClaim",
    source: "gold-set",
    metric: "cost.perAcceptedClaimUsd",
    comparison: "max",
    threshold: (t) => t.costPerAcceptedClaimMaxUsd,
    value: (m) => m.gold.cost.perAcceptedClaimUsd,
  },
];

function finite(v: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Compares the measurements with the thresholds. A binding check blocks when
 * it misses its threshold or was not measured; an advisory check is reported
 * with its reason and never blocks (lab.gates.advisoryPolicy = report-only).
 */
export function evaluateGate(
  measurements: GateMeasurements,
  thresholds: GateThresholdsData,
): GateEvaluationData {
  const t = GateThresholds.parse(thresholds);
  const results = {} as GateEvaluationData["results"];
  const advisory: z.infer<typeof GateAdvisory>[] = [];
  let bindingTotal = 0,
    bindingPassed = 0;
  for (const spec of CHECKS) {
    const side = spec.source === "gold-set" ? measurements.gold : measurements.vc;
    const isAdvisory = side.advisory === true;
    const threshold = spec.threshold(t);
    const value = finite(spec.value(measurements));
    const meetsThreshold =
      value === null
        ? null
        : spec.comparison === "min"
          ? value >= threshold
          : value <= threshold;
    const bound = spec.comparison === "min" ? "at least" : "at most";
    const measured =
      value === null
        ? `${spec.metric} not measured (no denominator)`
        : `${spec.metric} = ${value} (${bound} ${threshold} required)`;
    let reason: string;
    if (isAdvisory) {
      const why = (side.advisoryReason?.trim() || "advisory result").replace(/\.$/, "");
      reason = `Advisory, not a gate: ${why}. ${measured}.`;
    } else if (meetsThreshold === null) reason = `Blocking: ${measured}.`;
    else reason = `${meetsThreshold ? "Met" : "Missed"}: ${measured}.`;
    const blocking = !isAdvisory && meetsThreshold !== true;
    if (!isAdvisory) {
      bindingTotal++;
      if (meetsThreshold === true) bindingPassed++;
    }
    const check: GateCheckData = {
      id: spec.id,
      source: spec.source,
      metric: spec.metric,
      comparison: spec.comparison,
      threshold,
      value,
      meetsThreshold,
      advisory: isAdvisory,
      blocking,
      reason,
    };
    results[spec.id] = check;
    if (isAdvisory)
      advisory.push({ id: spec.id, value, threshold, meetsThreshold, reason });
  }
  const failed = bindingTotal - bindingPassed;
  const pass = failed === 0;
  return GateEvaluation.parse({
    results,
    advisory,
    binding: { total: bindingTotal, passed: bindingPassed, failed },
    pass,
    verdict: !pass ? "fail" : bindingTotal === 0 ? "advisory-only" : "pass",
  });
}

/** Why a VideoConviction result is advisory: its extraction was fake or its fixture a placeholder. */
export function vcAdvisory(input: { fake: boolean; placeholder: boolean }): {
  advisory: boolean;
  reason: string | null;
} {
  const reasons: string[] = [];
  if (input.fake)
    reasons.push("offline fake extraction scored, not a model result");
  if (input.placeholder)
    reasons.push("placeholder fixture, not dataset rows");
  return reasons.length
    ? { advisory: true, reason: reasons.join("; ") }
    : { advisory: false, reason: null };
}

/** The measurements slice of the real harness reports, with the VideoConviction advisory rule applied. */
export function measurementsFrom(
  gold: GoldReport,
  vc: VcBenchmarkReport,
  vcMode: { fake: boolean },
): GateMeasurements {
  const a = vcAdvisory({ fake: vcMode.fake, placeholder: vc.fixture.placeholder });
  return {
    gold: {
      advisory: gold.advisory,
      advisoryReason: gold.advisoryReason,
      claims: { precision: gold.claims.precision, recall: gold.claims.recall },
      anchors: {
        accuracy: gold.anchors.accuracy,
        toleranceSeconds: gold.anchors.toleranceSeconds,
      },
      cost: { perAcceptedClaimUsd: gold.cost.perAcceptedClaimUsd },
    },
    vc: {
      advisory: a.advisory,
      advisoryReason: a.reason,
      agreement: { stance: { rate: vc.agreement.stance.rate } },
    },
  };
}

const GateSources = z.object({
  goldSet: z
    .looseObject({
      casesPath: z.string(),
      casesHash: z.string(),
      runs: z.number().int().min(0),
    }),
  vcBenchmark: z
    .looseObject({
      id: z.string(),
      fixtureHash: z.string(),
      rows: z.number().int().min(0),
    }),
});
export const GateReport = z.object({
  version: z.literal(GATE_REPORT_VERSION),
  id: z.string().regex(/^gate-[0-9a-f]{16}$/),
  at: z.string().refine((s) => Number.isFinite(Date.parse(s)), "at must be a date"),
  date: z.iso.date(),
  mode: z.enum(["offline", "live"]),
  configHash: z.string().regex(/^[0-9a-f]{64}$/),
  configuration: z.looseObject({
    models: z.looseObject({
      extraction: z.looseObject({ id: z.string() }),
      critique: z.looseObject({ id: z.string() }),
    }),
    prompts: z.looseObject({ version: z.string() }),
  }),
  thresholds: GateThresholds,
  ...GateEvaluation.shape,
  measurements: z.looseObject({}),
  sources: GateSources,
  limitation: z.string(),
});
export type GateReportData = z.infer<typeof GateReport>;

export function gateReport(input: {
  team: TeamPreferencesData;
  mode: "offline" | "live";
  measurements: GateMeasurements;
  sources: z.input<typeof GateSources>;
  at?: Date;
}): GateReportData {
  const team = TeamPreferences.parse(input.team);
  const hash = configHash(team);
  const at = input.at ?? new Date();
  const evaluation = evaluateGate(input.measurements, team.lab.gates);
  return GateReport.parse({
    version: GATE_REPORT_VERSION,
    id: `gate-${hash.slice(0, 16)}`,
    at: at.toISOString(),
    date: at.toISOString().slice(0, 10),
    mode: input.mode,
    configHash: hash,
    configuration: hashedConfiguration(team),
    thresholds: team.lab.gates,
    ...evaluation,
    measurements: input.measurements,
    sources: input.sources,
    limitation:
      input.mode === "offline"
        ? "Offline: the gold set replays stored runs and VideoConviction scores a fake or supplied extraction; prompt, model or transport changes need fresh runs or a live extraction before the numbers reflect them. Advisory checks are reported, never enforced."
        : "Live: extraction ran through the configured transports with keys. Advisory checks are reported, never enforced.",
  });
}

// ---------------------------------------------------------------- command

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

/** Newest completed, non-task, non-experiment run per gold video (as scripts/gold-set.ts). */
function canonical(runs: Run[], goldVideos: Set<string>): Run[] {
  const seen = new Set<string>();
  return runs
    .filter((r) => goldVideos.has(r.videoId))
    .filter(
      (r) => r.status === "completed" && !r.input.task && r.input.experiment !== true,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .filter((r) => (seen.has(r.videoId) ? false : (seen.add(r.videoId), true)));
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const option = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith("--")
      ? args[i + 1]
      : undefined;
  };
  if (flag("live")) {
    console.error(
      "scripts/promotion-gate.ts: --live (extraction through the transports with keys) is not implemented yet; run --offline.",
    );
    process.exit(2);
  }
  if (!flag("offline")) {
    console.error(
      "scripts/promotion-gate.ts: pass --offline (no keys, no spend). See the header comment for options.",
    );
    process.exit(2);
  }

  const configPath = option("config");
  const team = configPath
    ? TeamPreferences.parse(JSON.parse(readFileSync(resolve(configPath), "utf8")))
    : teamDefaults();
  const hash = configHash(team);

  // No spend, no key: any model call in this process hits the fake transport.
  const [{ FakeModelTransport }, { injectTransport }] = await Promise.all([
    import("../src/server/youtube-intelligence/transport/fake.ts"),
    import("../src/server/youtube-intelligence/transport/index.ts"),
  ]);
  const restoreTransport = injectTransport(new FakeModelTransport());

  // Gold set: replay stored runs (or --runs) against the cases.
  const casesPath = option("cases") ?? DEFAULT_CASES_PATH;
  const set = loadGoldSet(casesPath);
  const goldVideos = new Set(set.cases.map((c) => c.videoId));
  const runsPath = option("runs");
  let runs: Run[];
  let runSource: string;
  try {
    if (runsPath) {
      runs = canonical(
        z.array(RunRow).parse(JSON.parse(readFileSync(resolve(runsPath), "utf8"))),
        goldVideos,
      );
      runSource = `replay of ${runsPath}`;
    } else {
      const store = await import("../src/server/youtube-intelligence/store.ts");
      try {
        runs = canonical(await store.list(), goldVideos);
      } finally {
        await store.db().close();
      }
      runSource = "replay of stored runs";
    }
  } finally {
    restoreTransport();
  }
  const gold = goldReport(set, runs);
  const casesHash = createHash("sha256")
    .update(readFileSync(resolve(casesPath), "utf8"))
    .digest("hex");

  // VideoConviction: the deterministic fake extraction unless one is supplied.
  const fixture = loadFixture(option("fixture") ?? FIXTURE_PATH);
  const extractionPath = option("extraction");
  const extraction: VcExtraction = extractionPath
    ? Extraction.parse(JSON.parse(readFileSync(resolve(extractionPath), "utf8")))
    : fakeExtraction(fixture);
  const fake = !extractionPath;
  const vc = benchmark(fixture, extraction, {
    model: fake ? "fake" : team.models.extraction.id,
    promptVersion: team.prompts.version,
    arm: "text",
    label: fake ? "offline fake extraction" : `offline replay of ${extractionPath}`,
  });

  const report = gateReport({
    team,
    mode: "offline",
    measurements: measurementsFrom(gold, vc, { fake }),
    sources: {
      goldSet: {
        casesPath,
        casesHash,
        runs: runs.length,
        runSource,
        transport: "fake",
        goldSetVersion: gold.goldSetVersion,
        reportVersion: gold.version,
        cases: gold.cases,
        claims: gold.claims,
        critic: gold.critic,
        anchors: gold.anchors,
        sentiment: gold.sentiment,
        cost: gold.cost,
        validity: { graded: gold.validity.graded, passed: gold.validity.passed },
      },
      vcBenchmark: {
        id: vc.id,
        fixtureHash: vc.fixture.hash,
        rows: vc.fixture.rowCount,
        extraction: fake ? "fake" : extractionPath,
        version: vc.version,
        fixture: vc.fixture,
        config: vc.config,
        counts: vc.counts,
        agreement: vc.agreement,
        attribution: vc.attribution,
      },
    },
  });

  const out = resolve(option("out") ?? `data/gates/gate-${hash}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  const summary = {
    out,
    configHash: report.configHash,
    mode: report.mode,
    pass: report.pass,
    verdict: report.verdict,
    binding: report.binding,
    results: Object.fromEntries(
      Object.values(report.results).map((r) => [
        r.id,
        {
          value: r.value,
          threshold: r.threshold,
          meetsThreshold: r.meetsThreshold,
          advisory: r.advisory,
          blocking: r.blocking,
        },
      ]),
    ),
    advisory: report.advisory.map((a) => `${a.id}: ${a.reason}`),
  };
  console.log(JSON.stringify(summary));
  if (!report.pass) process.exitCode = 1;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
