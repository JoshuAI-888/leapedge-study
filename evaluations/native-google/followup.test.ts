import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCase } from "./followup-cases.ts";
test("Schema ablations change only maxItems from the frozen failing request", () => {
  const original = JSON.parse(
    readFileSync(
      new URL("./fixtures/rejected-schema-request.json", import.meta.url),
      "utf8",
    ),
  );
  for (const name of ["schema-no-max", "schema-small-max"] as const) {
    const actual = JSON.parse(
      JSON.stringify(buildCase(name, new AbortController().signal).request),
    );
    delete actual.config.abortSignal;
    const expected = structuredClone(original);
    if (name === "schema-no-max")
      delete expected.config.responseJsonSchema.properties.segments.maxItems;
    else expected.config.responseJsonSchema.properties.segments.maxItems = 500;
    assert.deepEqual(actual, expected);
  }
});
test("Macro windows overlap without inheriting any full-video transcript answer", () => {
  const a = buildCase("macro-window-a", new AbortController().signal);
  const b = buildCase("macro-window-b", new AbortController().signal);
  assert.equal(a.input.endSeconds - b.input.startSeconds, 60);
  assert.equal(a.input.endSeconds - a.input.startSeconds, 90);
  assert.equal(JSON.stringify(a.request).includes("2016.14"), false);
});
