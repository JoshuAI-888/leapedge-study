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
