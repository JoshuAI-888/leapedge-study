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
