import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ResearchDraft, parseResearchDraft } from "../src/features/youtube-intelligence/research-brief.ts";
import { CheaperInferenceTransport } from "../src/server/youtube-intelligence/transport/cheaper-inference.ts";

const sentence = {
  id: "point", text: "The creator holds shares.", evidenceIds: ["c1"], externalIds: [],
  kind: "holding", horizon: "fundamental", topic: "Company", materiality: 2,
  importanceReason: "Existing position", speaker: "unknown", timeMode: "video_date", calculation: null,
};
const draft = (materiality: unknown) => ({ sentences: [{ ...sentence, materiality }], mainTopics: ["Company"], omissions: [] });

test("Cheaper Inference enumerates materiality without changing the research replay schema or parser domain", () => {
  const schema = z.toJSONSchema(ResearchDraft);
  const original = structuredClone(schema);
  const body = new CheaperInferenceTransport().body({ stage: "synthesis-research", model: "gemini-3.8-flash", user: [{ type: "text", text: "Source" }], maxOutputTokens: 16000, temperature: 0, responseSchema: schema });
  const sent = body.response_format!.json_schema.schema as { properties: { sentences: { items: { properties: { materiality: { enum?: number[]; minimum: number; maximum: number } } } } } };
  const materiality = sent.properties.sentences.items.properties.materiality;
  assert.deepEqual(materiality.enum, [0, 1, 2, 3]);
  assert.equal(materiality.minimum, 0); assert.equal(materiality.maximum, 3);
  assert.deepEqual(schema, original, "all existing providers and paid replay retain the original min/max schema");
  assert.equal((schema.properties!.sentences as any).items.properties.materiality.enum, undefined);
  for (const score of [0, 1, 2, 3]) assert.equal(parseResearchDraft(draft(score)).sentences[0].materiality, score);
  for (const score of [-1, 4, 5, 0.5, "3", null]) {
    const raw = draft(score);
    assert.throws(() => parseResearchDraft(raw));
    assert.equal(raw.sentences[0].materiality, score, "invalid scores must never be clamped or coerced");
  }
});
