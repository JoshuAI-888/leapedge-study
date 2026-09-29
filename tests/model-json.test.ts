import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "../src/server/youtube-intelligence/pipeline.ts";

test("model JSON is accepted plain, fenced or wrapped in prose, and nothing else", () => {
  assert.deepEqual(parseModelJson('{"claims":[]}'), { claims: [] });
  assert.deepEqual(parseModelJson('```json\n{"claims":[1]}\n```'), { claims: [1] });
  assert.deepEqual(parseModelJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here is the result:\n{"a":{"b":2}}\nDone.'), { a: { b: 2 } });
  assert.throws(() => parseModelJson('```json\n{"claims": [\n```'), /not valid JSON/);
  assert.throws(() => parseModelJson("no json here"), /not valid JSON/);
});
