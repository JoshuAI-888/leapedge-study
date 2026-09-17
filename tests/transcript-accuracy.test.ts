import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreAccuracy,
  units,
  editCounts,
} from "../evaluations/transcript-accuracy.ts";
const fixture = () => ({
  id: "fixture",
  videoId: "fixture-only",
  language: "en",
  split: "held_out",
  startSeconds: 0,
  endSeconds: 30,
  reference: {
    status: "audio_verified",
    text: "Do not buy at 1.5 percent",
    reviewer: "test fixture",
    reviewedAt: "2026-09-14T00:00:00Z",
    criticalFacts: [{ id: "n", kind: "negation", expected: "not" }],
    anchors: [
      { id: "a", seconds: 10 },
      { id: "b", seconds: 20 },
    ],
  },
  candidates: [
    {
      provider: "synthetic",
      sourceHash: "fixture",
      text: "Do buy at 15 percent",
      boundariesReviewed: true,
      facts: [],
      anchors: [{ id: "a", seconds: 14 }],
    },
  ],
});
test("Accuracy scoring exposes omitted negation, decimal error and missing timestamps", () => {
  const r = scoreAccuracy(fixture())[0];
  assert.equal(r.status, "scored");
  assert.equal(r.metrics?.errors, 2);
  assert.equal(r.metrics?.deletions, 1);
  assert.equal(r.metrics?.substitutions, 1);
  assert.equal(r.metrics?.criticalFacts.exact, 0);
  assert.equal(r.metrics?.timestamps.total, 2);
  assert.equal(r.metrics?.timestamps.measured, 1);
  assert.equal(r.metrics?.timestamps.withinTwoSeconds, 0);
});
test("Unverified audio and unreviewed excerpt boundaries cannot produce accuracy scores", () => {
  const c = fixture();
  c.reference.status = "pending_audio_review";
  assert.equal(scoreAccuracy(c)[0].metrics, null);
  c.reference.status = "audio_verified";
  c.candidates[0].boundariesReviewed = false;
  assert.equal(scoreAccuracy(c)[0].metrics, null);
  c.reference.reviewer = "";
  assert.throws(() => scoreAccuracy(c), /reviewer/);
});
test("Chinese CER retains negation and decimal significance; error rates can exceed one", () => {
  assert.equal(
    editCounts(units("不要买1.5%", "zh"), units("要买15%", "zh")).errors,
    2,
  );
  assert.equal(editCounts(["one"], ["one", "two", "three"]).errors, 2);
  assert.notDeepEqual(units("1.5", "en"), units("15", "en"));
  assert.notDeepEqual(units("-5%", "en"), units("5%", "en"));
});
