import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assess,
  execute,
  requestFor,
  estimateUsd,
  type TestInput,
} from "./core.ts";
import { FinishReason, type GenerateContentResponse } from "@google/genai";
const input: TestInput = {
  videoId: "CMjt6f4eVdA",
  durationSeconds: 100,
  startSeconds: 0,
  endSeconds: 100,
  mode: "STATIC",
};
const payload = {
  video_id: input.videoId,
  language: "en",
  segments: [
    {
      start_seconds: 0,
      end_seconds: 100,
      text: "Do not buy QQQ at 155.",
      uncertainty: null,
    },
  ],
  model_reported_omissions: [],
};
function response(p: unknown = payload): GenerateContentResponse {
  return {
    candidates: [
      {
        finishReason: FinishReason.STOP,
        content: { parts: [{ text: JSON.stringify(p) }] },
      },
    ],
  } as GenerateContentResponse;
}
test("Native request uses structured video, default static mode, interval and connected abort with no SDK retries", () => {
  const c = new AbortController();
  const r = requestFor(input, c.signal);
  assert.equal(r.config?.abortSignal, c.signal);
  assert.equal(r.config?.httpOptions?.retryOptions?.attempts, 1);
  assert.equal(JSON.stringify(r).includes("fileUri"), true);
  assert.equal(JSON.stringify(r).includes("mediaProcessing"), false);
    assert.ok(r.config?.responseSchema);
    assert.equal(r.config?.responseJsonSchema, undefined);
});
test("Deadline aborts actual signal and never invokes a retry", async () => {
  let n = 0;
  let signal: AbortSignal | undefined;
  const result = await execute(
    input,
    async (r) => {
      n++;
      signal = r.config?.abortSignal;
      return await new Promise(() => {});
    },
    10,
  );
  assert.equal(n, 1);
  assert.equal(signal?.aborted, true);
  assert.equal(result.assessment.outcome, "transport_uncertain_timeout");
  assert.equal(result.billing, "potentially_billable");
});
test("STOP or token counts cannot turn empty, truncated or blocked output into a source", () => {
  assert.equal(
    assess(response({ ...payload, segments: [] }), input).outcome,
    "empty_transcript",
  );
  const r = response();
  r.candidates![0].finishReason = FinishReason.MAX_TOKENS;
  assert.equal(assess(r, input).outcome, "output_truncated");
  assert.equal(
    assess(
      { promptFeedback: { blockReason: "SAFETY" } } as GenerateContentResponse,
      input,
    ).outcome,
    "prompt_blocked",
  );
  assert.equal(
    assess({} as GenerateContentResponse, input).outcome,
    "missing_candidates",
  );
});
test("Retains exact speech but rejects wrong video, out-of-duration and clip-relative timestamps", () => {
  const r = assess(response(), input);
  assert.equal(r.outcome, "structurally_valid_unverified");
  assert.equal(r.data?.segments[0].text, payload.segments[0].text);
  assert.equal(r.audioVerified, false);
  assert.equal(
    assess(response({ ...payload, video_id: "SHMPiWbbR6E" }), input).outcome,
    "wrong_video",
  );
  assert.equal(
    assess(
      response({
        ...payload,
        segments: [{ ...payload.segments[0], end_seconds: 101 }],
      }),
      input,
    ).outcome,
    "invalid_timing_or_coordinate_system",
  );
  assert.equal(
    assess(response(), { ...input, startSeconds: 50 }).outcome,
    "invalid_timing_or_coordinate_system",
  );
});
test("Gaps are explicit review candidates, not automatically called silence or missing speech", () => {
  const r = assess(
    response({
      ...payload,
      segments: [
        { ...payload.segments[0], start_seconds: 40, end_seconds: 50 },
      ],
    }),
    input,
  );
  assert.equal(r.outcome, "source_needs_review");
  assert.equal(r.warnings?.length, 2);
  assert.equal(r.coverageFraction, 0.1);
});
test("Unknown thinking or missing usage does not become a zero cost", () => {
  assert.equal(estimateUsd(undefined), null);
  assert.equal(
    estimateUsd({ promptTokenCount: 10, candidatesTokenCount: 2 }),
    null,
  );
  assert.equal(
    estimateUsd({
      promptTokenCount: 1e6,
      candidatesTokenCount: 1000,
      thoughtsTokenCount: 1000,
    }),
    0.7575,
  );
});
