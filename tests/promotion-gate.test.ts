import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TeamPreferences,
  teamDefaults,
  configHash,
  GateThresholds,
} from "../src/features/youtube-intelligence/settings.ts";
import {
  evaluateGate,
  gateReport,
  GateReport,
  GATE_CHECK_IDS,
  GATE_REPORT_VERSION,
  vcAdvisory,
  type GateMeasurements,
} from "../scripts/promotion-gate.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);

function measurements(over: {
  gold?: Partial<GateMeasurements["gold"]>;
  vc?: Partial<GateMeasurements["vc"]>;
} = {}): GateMeasurements {
  return {
    gold: {
      advisory: false,
      advisoryReason: null,
      claims: { precision: 0.95, recall: 0.9 },
      anchors: { accuracy: 0.97, toleranceSeconds: 2 },
      cost: { perAcceptedClaimUsd: 0.1 },
      ...over.gold,
    },
    vc: {
      advisory: false,
      advisoryReason: null,
      agreement: { stance: { rate: 0.85 } },
      ...over.vc,
    },
  };
}

test("lab.gates defaults match the spec thresholds and stay outside the configuration hash", () => {
  const team = teamDefaults();
  assert.deepEqual(team.lab.gates, {
    goldPrecisionMin: 0.9,
    goldRecallMin: 0.8,
    anchorWithin2sMin: 0.95,
    vcStanceAgreementMin: 0.8,
    costPerAcceptedClaimMaxUsd: 0.25,
    advisoryPolicy: "report-only",
  });
  assert.deepEqual(GateThresholds.parse({}), team.lab.gates);
  assert.throws(() => GateThresholds.parse({ goldPrecisionMin: 1.2 }));
  assert.throws(() => GateThresholds.parse({ costPerAcceptedClaimMaxUsd: -1 }));
  assert.throws(() => GateThresholds.parse({ advisoryPolicy: "fail" }));
  const stricter = TeamPreferences.parse({
    lab: { gates: { goldPrecisionMin: 0.99, costPerAcceptedClaimMaxUsd: 0.05 } },
  });
  assert.equal(stricter.lab.gates.goldPrecisionMin, 0.99);
  assert.equal(stricter.lab.gates.goldRecallMin, 0.8);
  assert.equal(configHash(stricter), configHash(team));
});

test("every binding check above threshold passes the gate with nothing advisory", () => {
  const gate = evaluateGate(measurements(), teamDefaults().lab.gates);
  assert.equal(gate.pass, true);
  assert.equal(gate.verdict, "pass");
  assert.deepEqual(gate.advisory, []);
  assert.deepEqual(Object.keys(gate.results).sort(), [...GATE_CHECK_IDS].sort());
  for (const id of GATE_CHECK_IDS) {
    const r = gate.results[id];
    assert.equal(r.id, id);
    assert.equal(r.advisory, false);
    assert.equal(r.meetsThreshold, true, id);
    assert.equal(r.blocking, false, id);
  }
  assert.equal(gate.results.goldPrecision.value, 0.95);
  assert.equal(gate.results.goldPrecision.threshold, 0.9);
  assert.equal(gate.results.goldPrecision.comparison, "min");
  assert.equal(gate.results.costPerAcceptedClaim.comparison, "max");
  assert.equal(gate.results.costPerAcceptedClaim.threshold, 0.25);
  assert.equal(gate.binding.total, 5);
  assert.equal(gate.binding.failed, 0);
});

test("a binding metric below its threshold fails the gate; a value at the threshold passes", () => {
  const thresholds = teamDefaults().lab.gates;
  const low = evaluateGate(
    measurements({
      gold: { claims: { precision: 0.85, recall: 0.9 }, cost: { perAcceptedClaimUsd: 0.3 } },
    }),
    thresholds,
  );
  assert.equal(low.pass, false);
  assert.equal(low.verdict, "fail");
  assert.equal(low.results.goldPrecision.meetsThreshold, false);
  assert.equal(low.results.goldPrecision.blocking, true);
  assert.equal(low.results.costPerAcceptedClaim.meetsThreshold, false);
  assert.equal(low.results.costPerAcceptedClaim.blocking, true);
  assert.equal(low.results.goldRecall.blocking, false);
  assert.equal(low.binding.failed, 2);
  assert.match(low.results.goldPrecision.reason, /0\.85/);
  assert.match(low.results.goldPrecision.reason, /0\.9/);

  const exact = evaluateGate(
    measurements({
      gold: {
        claims: { precision: 0.9, recall: 0.8 },
        anchors: { accuracy: 0.95, toleranceSeconds: 2 },
        cost: { perAcceptedClaimUsd: 0.25 },
      },
      vc: { agreement: { stance: { rate: 0.8 } } },
    }),
    thresholds,
  );
  assert.equal(exact.pass, true);
  assert.equal(exact.binding.failed, 0);

  const stricter = evaluateGate(
    measurements(),
    GateThresholds.parse({ vcStanceAgreementMin: 0.9 }),
  );
  assert.equal(stricter.pass, false);
  assert.equal(stricter.results.vcStanceAgreement.blocking, true);
});

test("an unmeasured binding metric blocks; an unmeasured advisory metric is only reported", () => {
  const thresholds = teamDefaults().lab.gates;
  const binding = evaluateGate(
    measurements({ gold: { claims: { precision: null, recall: 0.9 } } }),
    thresholds,
  );
  assert.equal(binding.pass, false);
  assert.equal(binding.results.goldPrecision.value, null);
  assert.equal(binding.results.goldPrecision.meetsThreshold, null);
  assert.equal(binding.results.goldPrecision.blocking, true);
  assert.match(binding.results.goldPrecision.reason, /not measured/i);

  const advisory = evaluateGate(
    measurements({
      gold: {
        advisory: true,
        advisoryReason: "Only 0 of 50 required verified cases",
        claims: { precision: null, recall: null },
        anchors: { accuracy: null, toleranceSeconds: 2 },
        cost: { perAcceptedClaimUsd: null },
      },
    }),
    thresholds,
  );
  assert.equal(advisory.pass, true);
  assert.equal(advisory.results.goldPrecision.blocking, false);
  assert.equal(advisory.results.goldPrecision.meetsThreshold, null);
  assert.equal(advisory.advisory.length, 4);
});

test("advisory results never fail the gate but are reported with their reason", () => {
  const thresholds = teamDefaults().lab.gates;
  const gate = evaluateGate(
    measurements({
      gold: {
        advisory: true,
        advisoryReason: "Only 12 of 50 required verified cases; metrics are advisory, not a gate.",
        claims: { precision: 0.5, recall: 0.4 },
        anchors: { accuracy: 0.2, toleranceSeconds: 2 },
        cost: { perAcceptedClaimUsd: 0.9 },
      },
      vc: {
        advisory: true,
        advisoryReason: "offline fake extraction",
        agreement: { stance: { rate: 0.53 } },
      },
    }),
    thresholds,
  );
  assert.equal(gate.pass, true);
  assert.equal(gate.verdict, "advisory-only");
  assert.equal(gate.binding.total, 0);
  assert.equal(gate.advisory.length, 5);
  const ids = gate.advisory.map((a) => a.id).sort();
  assert.deepEqual(ids, [...GATE_CHECK_IDS].sort());
  for (const a of gate.advisory) {
    assert.equal(a.meetsThreshold, false, a.id);
    assert.equal(gate.results[a.id].advisory, true);
    assert.equal(gate.results[a.id].blocking, false);
    assert.equal(gate.results[a.id].meetsThreshold, false);
  }
  const precision = gate.advisory.find((a) => a.id === "goldPrecision")!;
  assert.match(precision.reason, /12 of 50/);
  const stance = gate.advisory.find((a) => a.id === "vcStanceAgreement")!;
  assert.match(stance.reason, /fake extraction/);

  // Mixed: gold advisory and failing, VideoConviction binding and passing.
  const mixed = evaluateGate(
    measurements({
      gold: {
        advisory: true,
        advisoryReason: "pending review",
        claims: { precision: 0.1, recall: 0.1 },
      },
    }),
    thresholds,
  );
  assert.equal(mixed.pass, true);
  assert.equal(mixed.verdict, "pass");
  assert.equal(mixed.binding.total, 1);
  assert.equal(mixed.advisory.length, 4);
  // ...and the reverse: a failing binding check is not rescued by the advisory ones.
  const failing = evaluateGate(
    measurements({
      gold: { advisory: true, advisoryReason: "pending review" },
      vc: { agreement: { stance: { rate: 0.1 } } },
    }),
    thresholds,
  );
  assert.equal(failing.pass, false);
  assert.equal(failing.verdict, "fail");
});

test("VideoConviction results are advisory for a fake extraction or a placeholder fixture", () => {
  assert.equal(vcAdvisory({ fake: true, placeholder: false }).advisory, true);
  assert.match(vcAdvisory({ fake: true, placeholder: false }).reason!, /fake extraction/i);
  assert.equal(vcAdvisory({ fake: false, placeholder: true }).advisory, true);
  assert.match(vcAdvisory({ fake: false, placeholder: true }).reason!, /placeholder/i);
  assert.deepEqual(vcAdvisory({ fake: false, placeholder: false }), {
    advisory: false,
    reason: null,
  });
});

test("gateReport carries configHash, thresholds, results, advisory and pass, and validates", () => {
  const team = TeamPreferences.parse({
    models: { extraction: { id: "gemini-3.8-pro", transport: "google-native" } },
  });
  const report = gateReport({
    team,
    mode: "offline",
    measurements: measurements({
      vc: { advisory: true, advisoryReason: "offline fake extraction" },
    }),
    sources: {
      goldSet: { casesPath: "evaluations/gold-set/cases.json", casesHash: "abc", runs: 0 },
      vcBenchmark: { id: "vcBenchmark:0123", fixtureHash: "def", rows: 60 },
    },
  });
  assert.equal(report.version, GATE_REPORT_VERSION);
  assert.equal(report.configHash, configHash(team));
  assert.match(report.configHash, /^[0-9a-f]{64}$/);
  assert.equal(report.id, `gate-${configHash(team).slice(0, 16)}`);
  assert.ok(Number.isFinite(Date.parse(report.at)));
  assert.match(report.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(report.thresholds, team.lab.gates);
  assert.equal(report.configuration.models.extraction.id, "gemini-3.8-pro");
  assert.equal(report.configuration.prompts.version, "evidence-first.web.v5");
  assert.equal(report.pass, true);
  assert.equal(report.advisory.length, 1);
  assert.equal(report.advisory[0].id, "vcStanceAgreement");
  assert.equal(report.results.vcStanceAgreement.advisory, true);
  assert.equal(report.results.goldPrecision.meetsThreshold, true);
  const parsed = GateReport.parse(JSON.parse(JSON.stringify(report)));
  assert.equal(parsed.configHash, report.configHash);
  assert.throws(() => GateReport.parse({ ...report, pass: "yes" }));
});

test("the committed phase-0 baseline is a valid, passing gate report for the v5 configuration", () => {
  const path = join(ROOT, "docs/gates/phase-0-baseline.json");
  assert.ok(existsSync(path), "docs/gates/phase-0-baseline.json is committed");
  const baseline = GateReport.parse(JSON.parse(readFileSync(path, "utf8")));
  assert.equal(baseline.mode, "offline");
  assert.equal(baseline.pass, true);
  assert.equal(baseline.configuration.prompts.version, "evidence-first.web.v5");
  assert.equal(baseline.thresholds.advisoryPolicy, "report-only");
  // Phase 0 has no verified gold cases and no live extraction: everything is advisory.
  assert.equal(baseline.verdict, "advisory-only");
  assert.equal(baseline.advisory.length, GATE_CHECK_IDS.length);
});

test("the command runs offline without keys and writes the report to --out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yti-gate-"));
  const configPath = join(dir, "team.json");
  const out = join(dir, "nested", "gate.json");
  const team = TeamPreferences.parse({
    prompts: { version: "evidence-first.web.v5-test" },
    lab: { gates: { goldRecallMin: 0.7 } },
  });
  writeFileSync(configPath, JSON.stringify(team));
  const { stdout } = await run(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/promotion-gate.ts",
      "--offline",
      "--config",
      configPath,
      "--out",
      out,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        YTI_DB: "pglite",
        OPENROUTER_API_KEY: "",
        GOOGLE_API_KEY: "",
        GEMINI_API_KEY: "",
      },
    },
  );
  assert.ok(existsSync(out), "report written to --out");
  const report = GateReport.parse(JSON.parse(readFileSync(out, "utf8")));
  assert.equal(report.configHash, configHash(team));
  assert.equal(report.thresholds.goldRecallMin, 0.7);
  assert.equal(report.mode, "offline");
  assert.equal(report.pass, true);
  assert.equal(report.sources.vcBenchmark.extraction, "fake");
  assert.equal(report.results.vcStanceAgreement.advisory, true);
  assert.equal(report.results.goldPrecision.advisory, true);
  assert.ok(typeof report.results.vcStanceAgreement.value === "number");
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.equal(summary.out, out);
  assert.equal(summary.pass, true);
  assert.equal(summary.configHash, configHash(team));
});
