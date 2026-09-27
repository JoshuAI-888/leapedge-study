import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const path = "evaluations/targeted-audit/source-review-manifest.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
test("focused review preserves all twenty cases and never claims sampled source checks are completed", () => {
  assert.equal(manifest.version, "targeted-audit-source-review.v1");
  assert.equal(manifest.denominator, 20);
  assert.equal(manifest.cases.length, 20);
  assert.equal(new Set(manifest.cases.map((c: any) => c.videoId)).size, 20);
  const checks = manifest.cases.flatMap((c: any) => c.knownChecks);
  for (const id of ["gold-to-silver-direction", "hypothetical-nim", "idiq-ceiling-not-funded-order", "moving-average-caption-ambiguity", "growth-margin-moat-ownership", "hypothetical-short-and-speaker", "strike-versus-delta", "expiry-premium-and-breakeven"]) assert.ok(checks.some((c: any) => c.id === id), id);
  for (const c of manifest.cases) {
    assert.equal(c.reviewStatus, "pending");
    assert.equal(c.sourceSentinels.length, 3);
    assert.ok(c.segmentCount > 0);
    for (const s of c.sourceSentinels) { assert.equal(s.reviewStatus, "unreviewed"); assert.equal(s.historicallyUnreviewedClaim, false); }
    for (const check of c.knownChecks) { assert.equal(check.reviewStatus, "pending-paired-output-review"); assert.equal(check.audioChartVerified, false); assert.ok(check.anchors.length > 0); }
    for (const a of [...c.knownChecks.flatMap((k: any) => k.anchors), ...c.sourceSentinels.map((s: any) => s.anchor)]) {
      assert.equal(sha(a.text), a.textSha256);
      assert.equal(a.segmentIds[0], a.startId);
      assert.equal(a.segmentIds.at(-1), a.endId);
      assert.equal(a.segmentIds.length, a.endIndexInclusive - a.startIndex + 1);
    }
  }
  assert.equal(manifest.cases.find((c: any) => c.case === 11).leapedgeUsable, false);
});
test("available private sources match frozen hashes and every selected quote is an exact source span", t => {
  if (!manifest.cases.every((c: any) => existsSync(c.sourceArtifact.path) && existsSync(c.inventoryArtifact.path))) {
    t.skip("Private source snapshots absent; quote-to-source verification must run before cloud evaluation."); return;
  }
  const artifacts = new Map<string, any>();
  for (const c of manifest.cases) {
    for (const ref of [c.sourceArtifact, c.inventoryArtifact]) {
      const bytes = readFileSync(ref.path); assert.equal(sha(bytes), ref.sha256);
      if (!artifacts.has(ref.path)) artifacts.set(ref.path, JSON.parse(bytes.toString()));
    }
    const source = artifacts.get(c.sourceArtifact.path).runs.find((r: any) => r.id === c.sourceRunId).output.source;
    assert.equal(sha(JSON.stringify(source)), c.sourceContentSha256);
    assert.equal(source.segments.length, c.segmentCount);
    const inventory = artifacts.get(c.inventoryArtifact.path).runs.find((r: any) => r.id === c.inventoryResearchRunId).input.snapshot.evidence;
    const covered = new Set<number>();
    for (const e of inventory) for (const q of e.quotes) {
      const start = source.segments.findIndex((s: any) => s.id === q.startId), end = source.segments.findIndex((s: any) => s.id === q.endId);
      if (start >= 0 && end >= start) for (let i = start; i <= end; i++) covered.add(i);
    }
    assert.equal(source.segments.length - covered.size, c.segmentsOutsideInventory);
    for (const a of [...c.knownChecks.flatMap((k: any) => k.anchors), ...c.sourceSentinels.map((s: any) => s.anchor)]) {
      const segments = source.segments.slice(a.startIndex, a.endIndexInclusive + 1);
      assert.deepEqual(segments.map((s: any) => s.id), a.segmentIds);
      assert.equal(segments.map((s: any) => s.text).join(source.segment_separator ?? "\n"), a.text);
      assert.equal(segments[0].start_seconds ?? null, a.startSeconds);
      assert.equal(segments.at(-1).end_seconds ?? null, a.endSeconds);
    }
    for (const s of c.sourceSentinels.filter((s: any) => s.selection === "outside-retained-evidence-inventory")) for (let i = s.anchor.startIndex; i <= s.anchor.endIndexInclusive; i++) assert.equal(covered.has(i), false);
  }
});
