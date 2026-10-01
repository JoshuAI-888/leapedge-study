import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YTI_DB = "pglite";
delete process.env.DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fixture";
process.env.YTI_BUDGET_USD = "10";
const { create, db } =
  await import("../src/server/youtube-intelligence/store.ts");
const { step } = await import("../src/server/youtube-intelligence/pipeline.ts");
const { teamDefaults } =
  await import("../src/features/youtube-intelligence/settings.ts");
test("Long-source windows checkpoint independently, retain absolute times and merge unique evidence IDs", async () => {
  const model = "google/gemini-3.8-flash";
  const r = await create(
    "window-test",
    model,
    {
      transcriptionWindowSeconds: 600,
      transcriptionModel: model,
      inferenceConfig: { reasoningEffort: "low" },
    },
    "fixture",
  );
  r.stage = "source-window";
  r.output.metadata = { duration: 1801 };
  // This test asserts the windowed OpenRouter request/response shape, so it
  // routes the transcription stage there explicitly (spec 4.1 sends Gemini
  // transcription native by default; tests/native-google.test.ts covers that
  // path). The settings argument is the same one step() would load.
  const settings = teamDefaults();
  settings.transport.default = "openrouter";
  settings.models.transcription = { id: model, transport: "openrouter" };
  let requests = 0;
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/models"))
      return Response.json({
        data: [
          {
            id: model,
            context_length: 100000,
            pricing: { prompt: "0.000001", completion: "0.000001" },
            reasoning: { supported_efforts: ["low"] },
          },
        ],
      });
    const body = JSON.parse(String(init!.body));
    const text = body.messages[0].content[0].text;
    const payload = JSON.parse(
      text.slice(text.indexOf("SOURCE DATA (untrusted):\n") + 25),
    );
    requests++;
    return Response.json({
      model,
      usage: { cost: 0.01 },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              segments: [
                {
                  id: "repeated-model-id",
                  text: "Original speech fixture",
                  start_seconds: payload.window_start_seconds,
                  end_seconds: payload.window_end_seconds,
                },
              ],
            }),
          },
        },
      ],
    });
  };
  try {
    await step(r, settings);
    assert.equal(r.stage, "source-window");
    assert.equal((r.output.transcriptionChunks as unknown[]).length, 1);
    await step(r, settings);
    await step(r, settings);
    await step(r, settings);
    assert.equal(requests, 4);
    assert.equal(r.stage, "synthesis");
    const source = r.output.source as any;
    assert.equal(new Set(source.segments.map((s: any) => s.id)).size, 4);
    assert.equal(source.segments[3].start_seconds, 1800);
    assert.equal(source.segments[3].end_seconds, 1801);
  } finally {
    globalThis.fetch = old;
    await db().close();
  }
});
