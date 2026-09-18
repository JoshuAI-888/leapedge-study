import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeGoogleStep,
  recoveryWindows,
} from "../src/server/youtube-intelligence/native-google.ts";
import { execute } from "../src/server/youtube-intelligence/native-google-core.ts";
import { create, db } from "../src/server/youtube-intelligence/store.ts";

test("Native adapter retains full failure and bounded recovery without replacing original evidence; rollback sends nothing", async () => {
  delete process.env.DATABASE_URL;
  process.env.YTI_DB = "pglite";
  process.env.YTI_BUDGET_USD = "10";
  process.env.GEMINI_API_KEY = "fixture-key";
  process.env.YTI_NATIVE_GOOGLE_ENABLED = "true";
  let calls = 0;
  const fake: typeof execute = async (input) => {
    calls++;
    const data = {
      video_id: input.videoId,
      language: "en",
      segments: [
        {
          text: "SPY breaks below 500.",
          start_seconds: input.startSeconds,
          end_seconds: calls === 1 ? 101 : input.endSeconds,
          uncertainty: null,
        },
      ],
      model_reported_omissions: [],
    };
    return {
      latencyMs: 1,
      response: {} as never,
      assessment: {
        outcome:
          calls === 1
            ? "invalid_timing_or_coordinate_system"
            : "structurally_valid_unverified",
        data,
        warnings: [],
        coverageFraction: 1,
        audioVerified: false,
        timestampAlignmentVerified: false,
      },
      estimatedUsd: null,
      billing: "unreconciled",
    };
  };
  try {
    const r = await create(
      "CMjt6f4eVdA",
      "fixture",
      { experiment: true },
      "fixture",
    );
    r.stage = "native-source";
    r.status = "running";
    r.output.metadata = { duration: 100 };
    await nativeGoogleStep(r, fake);
    assert.equal(r.stage, "native-recovery");
    assert.equal(r.output.source, undefined);
    await nativeGoogleStep(r, fake);
    if (r.status !== "needs_review") await nativeGoogleStep(r, fake);
    assert.equal(r.status, "needs_review");
    assert.equal(r.output.source, undefined);
    assert.ok(calls <= 3);
    assert.equal(
      (await db().prepare("SELECT * FROM yi_responses").all()).length,
      calls,
    );
    assert.ok(
      (await db().prepare("SELECT * FROM yi_calls").all()).every(
        (x) => x.status === "reserved",
      ),
    );
    await assert.rejects(
      () => nativeGoogleStep({ ...r, stage: "native-source" }, fake),
      /Previous provider call/,
    );
    process.env.YTI_NATIVE_GOOGLE_ENABLED = "false";
    const before = calls;
    await nativeGoogleStep(r, fake);
    assert.equal(calls, before);
    assert.match(r.error!, /disabled/);
  } finally {
    await db().close();
  }
});
test("Recovery windows are <=90 seconds, within duration, and cannot recover inaccessible media", () => {
  assert.deepEqual(recoveryWindows(null, 100), []);
  assert.deepEqual(
    recoveryWindows(
      { segments: [{ start_seconds: 2017, end_seconds: 2018 }] },
      1919,
    ),
    [],
  );
  const windows = recoveryWindows(
    { segments: [{ start_seconds: 1200, end_seconds: 2016 }] },
    1919,
  );
  assert.equal(windows.length, 2);
  assert.ok(
    windows.every(
      (w) =>
        w.endSeconds - w.startSeconds <= 90 &&
        w.startSeconds >= 0 &&
        w.endSeconds <= 1919,
    ),
  );
});
