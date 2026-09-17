import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { requestHash, loadFrozen } from "./helpers/frozen.ts";
import { freshDatabase } from "./helpers/db.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import {
  REDACTED,
  parseFreezeArgs,
  recordTransports,
  scrubRequest,
  stageSelected,
  videoIdFrom,
} from "../scripts/freeze-responses.ts";

const MODEL = "google/gemini-3.8-flash";
const VIDEO = "freezevideo";
/** A key-shaped string planted in the source so the scrubber has something real to remove. */
const PLANTED = "sk-liveSECRET0123456789abcd";
const QUOTE = "I am buying this name and holding it into next year.";
const source = {
  source_kind: "imported_transcript",
  segment_separator: " " as const,
  segments: [
    { id: "s1", text: QUOTE, start_seconds: 0, end_seconds: 30 },
    {
      id: "s2",
      text: `Sponsor read, the key ${PLANTED} must never reach a fixture.`,
      start_seconds: 30,
      end_seconds: 60,
    },
  ],
};
const claim = {
  thesis_en: "The creator is buying this name and holding it into next year.",
  instrument_as_spoken: "this name",
  ticker: null,
  ticker_explicit: false,
  stance: "long",
  horizon_en: "into next year",
  conditions_en: [],
  creator_conviction: "high",
  risks_en: [],
  levels: [],
  evidence: [
    { segment_id: "s1", quote_original: QUOTE, quote_translation_en: QUOTE },
  ],
};
const keyPoint = {
  ...claim,
  thesis_en: "The creator states a personal position in this name.",
  stance: "neutral",
  creator_conviction: "unspecified",
};
/**
 * Since F15 the critic is asked once per run and answers by id, so one reply
 * covers the claim and the key point this fixture extracts.
 */
const accept = {
  json: {
    verdicts: [
      { id: "c1", verdict: "accept", reason_en: "The quoted evidence supports the thesis." },
      { id: "k1", verdict: "accept", reason_en: "The quoted evidence supports the key point." },
    ],
  },
};
const metadata = () =>
  json({
    items: [
      {
        snippet: {
          title: "Fixture video",
          channelTitle: "Fixture channel",
          channelId: "UCfixture",
          publishedAt: "2026-09-01T00:00:00Z",
          description: "fixture description",
          defaultAudioLanguage: "en",
        },
        contentDetails: { duration: "PT1M" },
      },
    ],
  });

test("RecordingTransport freezes one envelope per model stage, scrubs keys and refuses to overwrite", async () => {
  await freshDatabase();
  process.env.YOUTUBE_API_KEY = "fixture";
  process.env.YTI_BUDGET_USD = "10";
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
  const dir = mkdtempSync(join(tmpdir(), "yti-freeze-"));
  const fake = new FakeModelTransport({
    responses: {
      synthesis: { json: { claims: [claim], key_points: [keyPoint] } },
      critique: accept,
    },
  });
  const stub = stubFetch([
    { url: "googleapis.com/youtube/v3/videos", respond: metadata },
  ]);
  const restoreFake = injectTransport(fake);
  // Two passes over the same video and source build byte-identical requests, so
  // the second pass must find the first pass's files. `attempt` only keeps
  // store.create() from de-duplicating onto the still-queued first row; no
  // stage reads it, so it cannot change a request or a hash.
  const run = async (attempt: number) => {
    const r = await create(
      VIDEO,
      MODEL,
      {
        source,
        attempt,
        inferenceConfig: { reasoningEffort: "low", critiqueMaxTokens: 3000 },
      },
      "fixture",
    );
    for (let i = 0; i < 12 && r.status !== "completed"; i++) await step(r);
    assert.equal(r.status, "completed", r.error || "run did not complete");
    return r;
  };
  try {
    const first = recordTransports({ dir, note: "unit fixture" });
    let recorded;
    try {
      await run(1);
      recorded = first.records;
    } finally {
      first.restore();
    }
    // Every model stage of the run produced exactly one envelope.
    assert.deepEqual(
      recorded.map((r) => r.stage),
      ["synthesis", "critique"],
      "one extraction and one batched critique per run",
    );
    assert.ok(recorded.every((r) => r.written));
    assert.deepEqual(
      readdirSync(dir).sort(),
      recorded.map((r) => basename(r.file)).sort(),
    );
    const critic = teamDefaults().models.critique.id;
    const EXPECTED_MODEL: Record<string, string> = {
      synthesis: MODEL,
      critique: critic,
    };
    for (const record of recorded) {
      // The file is named for the hash of the request the transport received.
      const request = fake.requestsFor(record.stage)[0];
      assert.equal(record.hash, requestHash(request));
      assert.equal(basename(record.file), `${record.stage}-${record.hash}.json`);
      assert.equal(record.bytes, statSync(record.file).size);
      const envelope = loadFrozen(record.stage, record.hash, dir);
      // The envelope records the model the request ran on. Since F11 that is
      // the stage's configured model: this run pins no criticModel, so the
      // critique stage runs the team's configured critic while synthesis runs
      // the run's own extraction model.
      const expected = EXPECTED_MODEL[record.stage];
      assert.equal(request.model, expected, `${record.stage} ran on ${expected}`);
      assert.equal(envelope.model, expected);
      assert.equal(envelope.note, "unit fixture");
      assert.ok(Date.parse(envelope.capturedAt) > 0);
      assert.ok(envelope.response, "the provider's raw response is retained");
    }
    // The planted key reached the transport but never the fixture on disk.
    const synthesis = recorded[0];
    assert.ok(
      JSON.stringify(fake.requestsFor("synthesis")[0]).includes(PLANTED),
      "the live request carried the planted key",
    );
    const text = readFileSync(synthesis.file, "utf8");
    assert.ok(!text.includes(PLANTED), "the planted key was scrubbed");
    assert.ok(text.includes(REDACTED));
    // A second identical run rebuilds the same requests: SKIP, no overwrite.
    const before = recorded.map((r) => readFileSync(r.file, "utf8"));
    const lines: string[] = [];
    const second = recordTransports({
      dir,
      note: "second pass",
      log: (line) => lines.push(line),
    });
    try {
      await run(2);
    } finally {
      second.restore();
    }
    assert.deepEqual(
      second.records.map((r) => r.hash),
      recorded.map((r) => r.hash),
    );
    assert.ok(second.records.every((r) => !r.written));
    assert.equal(lines.filter((l) => l.startsWith("SKIP")).length, 2);
    assert.deepEqual(
      recorded.map((r) => readFileSync(r.file, "utf8")),
      before,
      "an existing envelope is never rewritten",
    );
    assert.equal(readdirSync(dir).length, 2);
  } finally {
    stub.restore();
    restoreFake();
  }
});

test("Scrubbing drops header-like fields and provider keys but keeps the request readable", () => {
  const scrubbed = scrubRequest({
    stage: "synthesis",
    model: MODEL,
    headers: { authorization: `Bearer ${PLANTED}` },
    "x-goog-api-key": "AIzaSyFAKE0123456789",
    Authorization: `Bearer abcdefgh12345678`,
    nested: [
      { apiKey: "sk-nested0123456789", text: `inline ${PLANTED} inline` },
    ],
    user: [{ type: "text", text: "plain prompt text" }],
  }) as Record<string, unknown>;
  assert.equal(scrubbed.headers, undefined);
  assert.equal(scrubbed["x-goog-api-key"], undefined);
  assert.equal(scrubbed.Authorization, undefined);
  assert.equal((scrubbed.nested as Record<string, unknown>[])[0].apiKey, undefined);
  assert.equal(
    (scrubbed.nested as Record<string, unknown>[])[0].text,
    `inline ${REDACTED} inline`,
  );
  assert.equal(scrubbed.stage, "synthesis");
  assert.deepEqual(scrubbed.user, [{ type: "text", text: "plain prompt text" }]);
  const json = JSON.stringify(scrubbed);
  assert.ok(!json.includes(PLANTED));
  assert.ok(!json.includes("AIzaSy"));
  assert.ok(!json.includes("sk-nested"));
});

test("The CLI reads video ids, stage filters and its own flags", () => {
  assert.equal(videoIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdFrom("https://youtu.be/dQw4w9WgXcQ?t=42"), "dQw4w9WgXcQ");
  assert.equal(videoIdFrom("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdFrom("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.throws(() => videoIdFrom("https://example.com/watch"), /video id/i);

  assert.equal(stageSelected("synthesis", undefined), true);
  assert.equal(stageSelected("critique-0", ["critique"]), true);
  assert.equal(stageSelected("critique-0", ["critique-0"]), true);
  assert.equal(stageSelected("synthesis-chunk-2", ["synthesis"]), true);
  assert.equal(stageSelected("synthesis", ["critique"]), false);
  assert.equal(stageSelected("critique-0", ["critiq"]), false);

  const args = parseFreezeArgs([
    "--url",
    "https://youtu.be/dQw4w9WgXcQ",
    "--stages",
    "synthesis, critique",
    "--out",
    "/tmp/frozen",
    "--max-steps",
    "9",
    "--dry-run",
  ]);
  assert.equal(args.url, "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(args.runId, undefined);
  assert.deepEqual(args.stages, ["synthesis", "critique"]);
  assert.equal(args.out, "/tmp/frozen");
  assert.equal(args.maxSteps, 9);
  assert.equal(args.dryRun, true);
  const defaults = parseFreezeArgs(["--run", "run-1"]);
  assert.equal(defaults.runId, "run-1");
  assert.equal(defaults.stages, undefined);
  assert.equal(defaults.maxSteps, 60);
  assert.equal(defaults.dryRun, false);
  assert.throws(() => parseFreezeArgs([]), /--url|--run/);
  assert.throws(() => parseFreezeArgs(["--url", "x", "--run", "y"]), /not both/i);
});
