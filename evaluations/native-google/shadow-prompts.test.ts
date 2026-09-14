import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { shadowPrompts, QUOTE_GUIDANCE } from "./shadow-prompts.ts";
test("Reconstructed shadow prompts match hashes from both actual live runs", () => {
  const baseline = shadowPrompts(false),
    candidate = shadowPrompts(true);
  const hash = (v: unknown) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex");
  assert.equal(
    hash(baseline),
    "c99156cf37f0d66ea6fb2b61bc2340328875402bccdbd4277cbc36a4addd499c",
  );
  assert.equal(
    hash(candidate),
    "2576b580ff6cb8c4a4620705e473f4b1ed40911540d22e39ef4bcb6d263d4d4c",
  );
  assert.equal(candidate.extraction, baseline.extraction + QUOTE_GUIDANCE);
  assert.equal(candidate.synthesis, baseline.synthesis);
  assert.equal(candidate.critique, baseline.critique);
});
