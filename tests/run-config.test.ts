import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch } from "./helpers/fetch-stub.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import {
  queue,
  saveTeamPreferences,
  teamPreferences,
} from "../src/server/youtube-intelligence/research-store.ts";
import {
  modelCall,
  step,
} from "../src/server/youtube-intelligence/pipeline.ts";
import { injectTransport } from "../src/server/youtube-intelligence/transport/index.ts";
import { FakeModelTransport } from "../src/server/youtube-intelligence/transport/fake.ts";

test("queued run freezes source policy and model routing against later team edits", async () => {
  const db = await freshDatabase();
  const settings = teamDefaults();
  settings.sources.captionProvider = "none";
  settings.sources.standby = "none";
  settings.sources.asr = "off";
  const stub = stubFetch([]);
  let routeModel = "";
  const fake = new FakeModelTransport({
    responses: {
      extraction: { json: { claims: [] }, usage: { costUsd: 0.001 } },
    },
  });
  const restore = injectTransport((_stage, route) => {
    routeModel = route.models?.extraction?.id ?? "";
    return fake;
  });
  try {
    await saveTeamPreferences(settings);
    const run = await queue("frozen-config");
    const changed = teamDefaults();
    changed.models.extraction.id = "gemini-3.1-pro-preview";
    changed.models.extraction.transport = "openrouter";
    await saveTeamPreferences(changed);
    run.stage = "source";
    run.output.metadata = { duration: 600 };
    await step(run);
    assert.equal(run.status, "needs_review");
    assert.equal(
      stub.log.length,
      0,
      "frozen disabled source cannot start fetching after settings edit",
    );
    await modelCall(run, "extraction", undefined, "prompt", {}, false, {
      settings: changed,
    });
    assert.equal(routeModel, settings.models.extraction.id);
    assert.equal(fake.requests[0].model, settings.models.extraction.id);
  } finally {
    restore();
    stub.restore();
    await db.close();
  }
});

test("snapshot preserves the original per-video cap and experiment overrides must keep an independent critic", async () => {
  const db = await freshDatabase();
  const fake = new FakeModelTransport({
    responses: { extraction: { json: {} } },
  });
  const restore = injectTransport(fake);
  try {
    const settings = teamDefaults();
    settings.budget.perVideoMaxUsd = 0.00001;
    await saveTeamPreferences(settings);
    const run = await queue("frozen-budget");
    await saveTeamPreferences(teamDefaults());
    await assert.rejects(
      () => modelCall(run, "extraction", undefined, "prompt", {}),
      /per-video/,
    );
    assert.equal(fake.requests.length, 0);
    await assert.rejects(
      () =>
        queue(
          "bad-lab",
          undefined,
          {
            model: "google/gemini-3.8-flash",
            criticModel: "google/gemini-3.1-pro-preview",
          },
          true,
        ),
      /same family/,
    );
    const relaxed = await teamPreferences();
    relaxed.models.critique.requireDifferentFamily = false;
    await saveTeamPreferences(relaxed);
    await assert.rejects(
      () =>
        queue(
          "bad-relaxed-lab",
          undefined,
          {
            model: "google/gemini-3.8-flash",
            criticModel: "google/gemini-3.1-pro-preview",
          },
          true,
        ),
      /same family/,
    );
  } finally {
    restore();
    await db.close();
  }
});

test("experiment creation rejects a same-family override atomically before any new run is queued", async () => {
  const { create, list } =
    await import("../src/server/youtube-intelligence/store.ts");
  const { startExperiment } =
    await import("../src/server/youtube-intelligence/experiments.ts");
  const db = await freshDatabase();
  try {
    const baseline = await create(
      "experiment-base",
      "gemini-3.8-flash",
      {},
      "v1",
    );
    await db
      .prepare("UPDATE yi_runs SET status='completed',output=$1 WHERE id=$2")
      .run(
        JSON.stringify({
          source: {
            segments: [
              {
                id: "s1",
                text: "Apple is discussed.",
                start_seconds: 0,
                end_seconds: 5,
              },
            ],
          },
        }),
        baseline.id,
      );
    const team = teamDefaults();
    await assert.rejects(
      () =>
        startExperiment({
          baselineId: baseline.id,
          hypothesis: "Compare independent model configurations",
          variants: [
            {
              model: team.models.extraction.id,
              criticModel: team.models.critique.id,
              promptVersion: team.prompts.version,
            },
            {
              model: "google/gemini-3.1-pro-preview",
              criticModel: "google/gemini-3.8-flash",
              promptVersion: team.prompts.version,
            },
          ],
        }),
      /same family/,
    );
    assert.equal((await list()).length, 1);
  } finally {
    await db.close();
  }
});

test("explicit audio request freezes its own ASR settings without changing extraction settings", async () => {
  const { requestAudioTrust } =
    await import("../src/server/youtube-intelligence/actions/trust.ts");
  const { runTeamPreferences } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const db = await freshDatabase();
  let selected = "";
  const fake = new FakeModelTransport({
    responses: {
      "transcribe-asr-0-300": {
        json: {
          language: "en",
          segments: [
            { text: "Independent speech", start_seconds: 0, end_seconds: 300 },
          ],
        },
        usage: { costUsd: 0.001 },
      },
    },
  });
  const restore = injectTransport((_stage, route) => {
    selected = route.models?.transcription?.id ?? "";
    return fake;
  });
  try {
    const original = teamDefaults();
    original.sources.asr = "off";
    await saveTeamPreferences(original);
    const run = await queue("explicit-audio-snapshot");
    await db
      .prepare(
        "UPDATE yi_runs SET status='needs_review',stage='source',output=$1 WHERE id=$2",
      )
      .run(JSON.stringify({ metadata: { duration: 300 } }), run.id);
    const enabled = teamDefaults();
    enabled.sources.asr = "gemini-windowed";
    enabled.models.transcription.id = "gemini-3.1-flash-lite";
    await saveTeamPreferences(enabled);
    const resumed = (await requestAudioTrust(run.id))!;
    enabled.sources.asr = "off";
    enabled.models.transcription.id = "gemini-3.1-pro-preview";
    await saveTeamPreferences(enabled);
    await step(resumed);
    assert.equal(resumed.stage, "synthesis");
    assert.equal(fake.requests.length, 1);
    assert.equal(selected, "gemini-3.1-flash-lite");
    assert.equal((await runTeamPreferences(resumed)).sources.asr, "off");
    assert.equal(
      (await runTeamPreferences(resumed)).models.extraction.id,
      original.models.extraction.id,
    );
  } finally {
    restore();
    await db.close();
  }
});
