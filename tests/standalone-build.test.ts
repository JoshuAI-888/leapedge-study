import { test } from "node:test";
import assert from "node:assert/strict";
import { selectWork, verificationPlan, runVerification, type Feature } from "../scripts/standalone-build.ts";

const feature = (id: string, phase: number, status: Feature["status"] = "todo", prereqs: string[] = []): Feature => ({ id, phase, status, prereqs, title: id });

test("Only dependency-ready work in the earliest unfinished standalone phase is selected", () => {
  const features = [feature("F23", 2, "merged"), feature("F26", 2, "todo", ["F23"]), feature("F27", 2, "todo", ["F26"]), feature("F32", 3), feature("F50", 4)];
  const before = JSON.stringify(features);
  assert.deepEqual(selectWork(features).ready.map(f => f.id), ["F26"]);
  assert.equal(JSON.stringify(features), before);
  features[1].status = "in-review";
  assert.deepEqual(selectWork(features).ready, []);
  assert.equal(selectWork(features).phase, 2);
});

test("Phase 3 opens after phase 2 completes and phase 4 is never selected", () => {
  assert.deepEqual(selectWork([feature("F26", 2, "merged"), feature("F32", 3)]).ready.map(f => f.id), ["F32"]);
  assert.deepEqual(selectWork([feature("F32", 3, "merged"), feature("F50", 4)]), { phase: null, ready: [], blocked: [] });
  assert.deepEqual(selectWork([{ ...feature("G01", 0), phase: null }]), { phase: null, ready: [], blocked: [] });
  assert.deepEqual(selectWork([feature("F26", 2, "todo", ["missing"])]).ready, []);
});

test("Failed mandatory checks stop execution without advancing the ledger", async () => {
  const calls: string[] = [];
  const report = await runVerification(verificationPlan(true), async check => {
    calls.push(check.id);
    return { exitCode: check.id === "typecheck" ? 1 : 0, signal: null };
  });
  assert.equal(report.commandChecksPassed, false);
  assert.deepEqual(calls, ["tests", "pglite-tests", "typecheck"]);
  assert.equal(report.featureCompletion, "not-assessed");
  assert.equal(report.browser, "not-run");
  assert.equal(report.realPostgres, "not-run");
});

test("Successful command checks and advisory diagnostics never claim product completion", async () => {
  const report = await runVerification(verificationPlan(false), async () => ({ exitCode: 0, signal: null }));
  assert.equal(report.commandChecksPassed, true);
  assert.equal(report.featureCompletion, "not-assessed");
  assert.equal(report.checks.at(-1)?.category, "legacy-diagnostic");
  assert.ok(report.checks.some(c => c.id === "audit"));
  assert.ok(!verificationPlan(true).some(c => c.id === "audit"));
});

test("Spawn errors and signal termination are failures, even without an exit code", async () => {
  const thrown = await runVerification(verificationPlan(true), async () => { throw new Error("spawn failed"); });
  assert.equal(thrown.commandChecksPassed, false);
  assert.match(thrown.checks[0].error!, /spawn failed/);
  const killed = await runVerification(verificationPlan(true), async () => ({ exitCode: null, signal: "SIGTERM" }));
  assert.equal(killed.commandChecksPassed, false);
});

test("Legacy promotion diagnostics are recorded separately from build checks", async () => {
  const report = await runVerification(verificationPlan(true), async check => ({
    exitCode: check.category === "legacy-diagnostic" ? 1 : 0, signal: null,
  }));
  assert.equal(report.commandChecksPassed, true);
  assert.equal(report.checks.at(-1)?.exitCode, 1);
  assert.equal(report.featureCompletion, "not-assessed");
});
