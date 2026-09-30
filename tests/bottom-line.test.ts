import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YTI_DB = "pglite";
delete process.env.DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fixture";
process.env.YTI_BUDGET_USD = "10";
const { checkBottomLine, bottomLineStatements } = await import("../src/server/youtube-intelligence/bottom-line.ts");

const statements = [
  { id: "s1", text: "The creator expects Micron to benefit from HBM demand through 2027." },
  { id: "s2", text: "Rates are the key macro risk." },
  { id: "idea:c1", text: "The creator on Uber / UBER: Bought a January $70 call on Uber. (action bought, stance long, conviction high)" },
];

test("a bottom line keeps sentences whose numbers and names are in the statements they cite", () => {
  const { kept, rejected } = checkBottomLine(
    {
      sentences: [
        { text: "The creator is bullish on Micron and HBM demand through 2027.", statementIds: ["s1"] },
        { text: "They bought a $70 Uber call; rates are the main risk.", statementIds: ["idea:c1", "s2"] },
        { text: "Micron could reach $200 by 2027.", statementIds: ["s1"] },
        { text: "The creator also likes Nvidia.", statementIds: ["s1"] },
        { text: "Rates matter.", statementIds: ["nope"] },
        { text: "Uber is the top pick.", statementIds: ["s1"] },
      ],
    },
    statements,
  );
  assert.deepEqual(kept.map((k) => k.text), [
    "The creator is bullish on Micron and HBM demand through 2027.",
    "They bought a $70 Uber call; rates are the main risk.",
  ]);
  assert.deepEqual(rejected.map((r) => r.reason), [
    "Not in its cited statements: 200.",
    "Not in its cited statements: Nvidia.",
    "Cites no supplied statement.",
    "Not in its cited statements: Uber.",
  ], "a name must be in the statements the sentence cites, not merely somewhere in the video");
});

test("the statements are the audited sentences and only the accepted ideas, with their owner", () => {
  const claim = (id: string, passed: boolean, owner: string, owner_name: string | null) => ({
    id,
    passed,
    reasons: [],
    claim: { thesis_en: `Thesis ${id}.`, instrument_as_spoken: "Tesla", ticker: "TSLA", action: "view", owner, owner_name, stance: "long", creator_conviction: "medium" },
  });
  const out = bottomLineStatements(
    { sentences: [{ id: "s1", text: "Rates are the key macro risk.", kind: "analysis", topic: "Macro", materiality: 2, speaker: "creator" }] as never },
    [claim("c1", true, "third_party", "Morgan Stanley"), claim("c2", false, "creator", null)] as never,
  );
  assert.deepEqual(out.map((s) => s.id), ["s1", "idea:c1"]);
  assert.match(out[1].text, /^Morgan Stanley \(not the creator\) on Tesla \/ TSLA: Thesis c1\./);
});

test("writing a bottom line stores the kept sentences, records the rejected ones, and reads back by source run", async () => {
  const { FakeModelTransport } = await import("../src/server/youtube-intelligence/transport/fake.ts");
  const { injectTransport } = await import("../src/server/youtube-intelligence/transport/index.ts");
  const { create } = await import("../src/server/youtube-intelligence/store.ts");
  const { writeBottomLine, bottomLineFor } = await import("../src/server/youtube-intelligence/bottom-line.ts");
  const run = await create("bottom-line-fixture", "google/gemini-3.8-flash", {}, "fixture.v1");
  const brief = {
    id: run.id,
    runId: run.id,
    sourceRunId: "source-run-without-claims",
    title: "Fixture",
    mainTopics: ["Micron"],
    sentences: [{ id: "s1", text: "The creator expects Micron to benefit from HBM demand through 2027.", kind: "creator_view", topic: "Micron", materiality: 3, speaker: "creator" }],
  };
  const fake = new FakeModelTransport({
    responses: {
      "synthesis-bottom-line": {
        json: {
          sentences: [
            { text: "The creator's thesis is Micron on HBM demand through 2027.", statementIds: ["s1"] },
            { text: "Micron could double.", statementIds: ["s1"] },
            { text: "Nvidia is the second pick.", statementIds: ["s1"] },
          ],
        },
      },
    },
  });
  const restore = injectTransport(fake);
  try {
    const line = await writeBottomLine(run, brief as never);
    assert.deepEqual(line.sentences.map((s) => s.text), ["The creator's thesis is Micron on HBM demand through 2027."]);
    assert.deepEqual(line.rejected.map((r) => r.reason), ["Not in its cited statements: double.", "Not in its cited statements: Nvidia."]);
    const request = fake.requestsFor("synthesis-bottom-line")[0] as { payload?: unknown };
    assert.ok(JSON.stringify(request).includes("HBM demand"), "the call sees only the audited statements");
    assert.deepEqual((await bottomLineFor("source-run-without-claims"))?.sentences, line.sentences);
  } finally {
    restore();
  }
});

test("possessives, common opening words and quantity words in digits do not reject a supported sentence", () => {
  const { kept, rejected } = checkBottomLine(
    {
      sentences: [
        { text: "Key point: JPMorgan's view is that rates stay high for two more quarters.", statementIds: ["s9"] },
        { text: "Accordingly the creator waits.", statementIds: ["s9"] },
        { text: "Key risk: Nvidia's margins halve.", statementIds: ["s9"] },
      ],
    },
    [{ id: "s9", text: "JPMorgan expects rates to stay high for 2 more quarters; the creator waits." }],
  );
  assert.deepEqual(kept.map((k) => k.text), [
    "Key point: JPMorgan's view is that rates stay high for two more quarters.",
    "Accordingly the creator waits.",
  ]);
  assert.deepEqual(rejected.map((r) => r.reason), ["Not in its cited statements: halve."], "an added quantity is still refused, before the name");
});
