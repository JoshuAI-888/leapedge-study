import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planWindows,
  parseWindow,
  windowedAsrStep,
  agreeRun,
} from "../src/server/youtube-intelligence/windowed-asr.ts";
import {
  Source,
  Claim,
  deriveEvidence,
} from "../src/features/youtube-intelligence/contracts.ts";
import {
  rowsForRun,
  writeRunRows,
} from "../src/server/youtube-intelligence/repos/publish.ts";
import { claimsForRun } from "../src/server/youtube-intelligence/repos/claims.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import { freshDatabase } from "./helpers/db.ts";
import { listTranscripts } from "../src/server/youtube-intelligence/repos/transcripts.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
test("Windows bound the full video and only request distinct windows for cited spans", () => {
  assert.deepEqual(planWindows(601, 300), [
    { startSeconds: 0, endSeconds: 300 },
    { startSeconds: 300, endSeconds: 600 },
    { startSeconds: 600, endSeconds: 601 },
  ]);
  assert.deepEqual(
    planWindows(601, 300, [{ startSeconds: 310, endSeconds: 315 }]),
    [{ startSeconds: 300, endSeconds: 600 }],
  );
  assert.throws(() => planWindows(0, 300));
  assert.throws(() =>
    parseWindow(
      { segments: [{ text: "bad", start_seconds: 0, end_seconds: 3 }] },
      { startSeconds: 300, endSeconds: 600 },
      0,
    ),
  );
});
test("Window checkpoints retain independently acquired speech without providing caption text to ASR", async () => {
  await freshDatabase();
  const run: Run = {
    id: "asr-test",
    videoId: "abcdefghijk",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    model: "fixture",
    promptVersion: "fixture",
    title: "Fixture",
    status: "running",
    stage: "asr-source",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    input: {},
    output: { metadata: { duration: 301 } },
    cost: 0,
  };
  const calls: unknown[] = [];
  const call = async (...args: unknown[]) => {
    calls.push(args);
    const payload = args[4] as {
      window_start_seconds: number;
      window_end_seconds: number;
    };
    return {
      language: "en",
      segments: [
        {
          text: "Independent speech",
          start_seconds: payload.window_start_seconds,
          end_seconds: payload.window_end_seconds,
        },
      ],
    };
  };
  await windowedAsrStep(run, teamDefaults(), true, call);
  assert.equal(run.stage, "asr-source");
  await windowedAsrStep(run, teamDefaults(), true, call);
  assert.equal(run.stage, "synthesis");
  assert.equal(calls.length, 2);
  assert.equal((await listTranscripts(10, run.videoId)).length, 2);
  assert.doesNotMatch(String((calls[0] as unknown[])[3]), /Independent speech/);
});

test("Disagreeing spans use a single independent tie-break and publish measured L2 evidence", async () => {
  await freshDatabase();
  const source = Source.parse({
    language: "en",
    source_kind: "native_captions",
    segments: [
      {
        id: "s1",
        text: "Buy NVDA under 120",
        start_seconds: 10,
        end_seconds: 14,
      },
    ],
  });
  const copied = deriveEvidence(source, { start_id: "s1", end_id: "s1" });
  const claim = Claim.parse({
    thesis_en: "Buy NVDA below 120",
    instrument_as_spoken: "NVDA",
    ticker: "NVDA",
    ticker_explicit: true,
    stance: "long",
    horizon_en: null,
    conditions_en: [],
    risks_en: [],
    creator_conviction: "high",
    levels: [],
    evidence: [
      {
        segment_id: "s1",
        quote_original: copied.quote_original,
        quote_translation_en: copied.quote_original,
        source_span: { start_id: "s1", end_id: "s1", ...copied },
      },
    ],
  });
  const run: Run = {
    id: "agreement-run",
    videoId: "abcdefghijk",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    model: "fixture",
    promptVersion: "fixture",
    title: "Fixture",
    status: "running",
    stage: "agree",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    input: {},
    output: {
      metadata: { duration: 300 },
      source,
      claims: [1, 2].map((i) => ({
        id: `c${i}`,
        claim,
        passed: true,
        reasons: [],
        audit: { verdict: "accept", reason_en: "Accepted" },
      })),
      asrWindows: [
        {
          startSeconds: 0,
          endSeconds: 300,
          transcriptId: "fixture-audio",
          segments: [
            {
              id: "g1",
              text: "Sell NVDA over 120",
              start_seconds: 10,
              end_seconds: 14,
            },
          ],
        },
      ],
    },
    cost: 0,
  };
  let generated = 0;
  await agreeRun(run, teamDefaults(), async (_id, provider, options) => {
    generated++;
    assert.equal(provider, "supadata");
    assert.equal(options?.generate, true);
    return { ...source, source_kind: "generated_transcript_supadata" };
  });
  assert.equal(generated, 1);
  const rows = rowsForRun(run);
  assert.equal(rows.claims[0].trustLevel, "L2");
  assert.equal(rows.spans[0].tieBreakSource, "supadata-generate");
  await writeRunRows(rows);
  assert.equal((await claimsForRun(run.id))[0].trustLevel, "L2");
  const self = structuredClone(run);
  (self.output.source as { source_kind: string }).source_kind =
    "google_windowed_asr";
  await agreeRun(self, teamDefaults(), async () => {
    throw Error("Must not tie-break self-reference");
  });
  assert.equal(rowsForRun(self).claims[0].trustLevel, "L1");
});

test("Bad window timestamps subdivide only that window and preserve earlier paid work", async () => {
  await freshDatabase();
  const run: Run = {
    id: "recover-asr",
    videoId: "abcdefghijk",
    url: "https://youtube.com/watch?v=abcdefghijk",
    model: "fixture",
    promptVersion: "fixture",
    title: "Recovery",
    status: "running",
    stage: "asr-source",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    input: {},
    output: {
      metadata: { duration: 600 },
      asrWindows: [
        {
          startSeconds: 0,
          endSeconds: 300,
          transcriptId: "retained",
          segments: [
            {
              id: "retained",
              text: "Retained speech",
              start_seconds: 0,
              end_seconds: 300,
            },
          ],
        },
      ],
    },
    cost: 0,
  };
  await windowedAsrStep(run, teamDefaults(), true, async () => ({
    segments: [
      { text: "Invalid relative timestamp", start_seconds: 0, end_seconds: 3 },
    ],
  }));
  assert.equal(run.status, "running");
  assert.deepEqual(run.output.asrPlan, [
    { startSeconds: 0, endSeconds: 300 },
    { startSeconds: 300, endSeconds: 450 },
    { startSeconds: 450, endSeconds: 600 },
  ]);
  assert.equal((run.output.asrWindows as unknown[]).length, 1);
});

test("Explicitly inspected silence is recorded without claiming speech covered the whole video", async () => {
  await freshDatabase();
  const run: Run = {
    id: "silence-asr",
    videoId: "abcdefghijk",
    url: "https://youtube.com/watch?v=abcdefghijk",
    model: "fixture",
    promptVersion: "fixture",
    title: "Pauses",
    status: "running",
    stage: "asr-source",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    input: {},
    output: {
      metadata: { duration: 300 },
      asrPlan: [{ startSeconds: 0, endSeconds: 300 }],
      asrWindows: [
        {
          startSeconds: 0,
          endSeconds: 300,
          transcriptId: "retained",
          segments: [
            { id: "s1", text: "Opening", start_seconds: 0, end_seconds: 100 },
            { id: "s2", text: "Closing", start_seconds: 160, end_seconds: 300 },
          ],
        },
      ],
    },
    cost: 0,
  };
  let calls = 0;
  const call = async () => {
    calls++;
    return { audio_status: "complete", segments: [] };
  };
  await windowedAsrStep(run, teamDefaults(), true, call);
  await windowedAsrStep(run, teamDefaults(), true, call);
  assert.equal(calls, 1);
  assert.equal(run.stage, "synthesis");
  assert.equal(
    (run.output.coverage as { status: string }).status,
    "incomplete_or_unknown",
  );
  assert.ok(run.output.asrGapChecks);
});

test("A malformed gap check subdivides without resubmitting the surrounding good audio", async () => {
  await freshDatabase();
  const run: Run = {
    id: "gap-repair",
    videoId: "abcdefghijk",
    url: "https://youtube.com/watch?v=abcdefghijk",
    model: "fixture",
    promptVersion: "fixture",
    title: "Gap",
    status: "running",
    stage: "asr-source",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    input: {},
    output: {
      metadata: { duration: 300 },
      asrPlan: [{ startSeconds: 0, endSeconds: 300 }],
      asrWindows: [
        {
          startSeconds: 0,
          endSeconds: 300,
          transcriptId: "retained",
          segments: [
            { id: "s1", text: "Before", start_seconds: 0, end_seconds: 100 },
            { id: "s2", text: "After", start_seconds: 160, end_seconds: 300 },
          ],
        },
      ],
    },
    cost: 0,
  };
  await windowedAsrStep(run, teamDefaults(), true, async () => ({
    segments: [
      { text: "Bad time units", start_seconds: 100000, end_seconds: 105000 },
    ],
  }));
  assert.deepEqual(run.output.asrGapPlan, [
    { startSeconds: 100, endSeconds: 130 },
    { startSeconds: 130, endSeconds: 160 },
  ]);
  assert.equal((run.output.asrWindows as unknown[]).length, 1);
});

test("A partially filled gap is checked again until remaining silence is explicit", async () => {
  await freshDatabase();
  const run: Run = {
    id: "partial-gap",
    videoId: "abcdefghijk",
    url: "https://youtube.com/watch?v=abcdefghijk",
    model: "fixture",
    promptVersion: "fixture",
    title: "Gap",
    status: "running",
    stage: "asr-source",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    input: {},
    output: {
      metadata: { duration: 300 },
      asrPlan: [{ startSeconds: 0, endSeconds: 300 }],
      asrWindows: [
        {
          startSeconds: 0,
          endSeconds: 300,
          transcriptId: "retained",
          segments: [
            { id: "s1", text: "Before", start_seconds: 0, end_seconds: 100 },
            { id: "s2", text: "After", start_seconds: 160, end_seconds: 300 },
          ],
        },
      ],
    },
    cost: 0,
  };
  const calls: unknown[] = [];
  const call = async (...args: unknown[]) => {
    calls.push(args[4]);
    return calls.length === 1
      ? {
          audio_status: "complete",
          segments: [
            { text: "Recovered part", start_seconds: 100, end_seconds: 120 },
          ],
        }
      : { audio_status: "complete", segments: [] };
  };
  await windowedAsrStep(run, teamDefaults(), true, call);
  await windowedAsrStep(run, teamDefaults(), true, call);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    window_start_seconds: 120,
    window_end_seconds: 160,
  });
  await windowedAsrStep(run, teamDefaults(), true, call);
  assert.equal(run.stage, "synthesis");
});
