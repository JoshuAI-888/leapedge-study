import { test } from "node:test";
import assert from "node:assert/strict";
import { textReservation } from "./text-budget.ts";
import { reserve } from "./journal.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("Text reservations include input bytes, output/thought allowance, FX and margin", () => {
  const x = textReservation("gemini-3.5-flash", "汉".repeat(1000), 3000);
  assert.equal(x.inputUpperBound, 7096);
  assert.ok(x.reservedNzd > 0.16);
  assert.throws(() => textReservation("unknown", "x", 100), /Unsupported/);
  assert.throws(
    () => textReservation("gemini-3.5-flash", "x", 0),
    /Unsupported/,
  );
});
test("Variable reservations cannot bypass the cumulative campaign cap", () => {
  const d = mkdtempSync(join(tmpdir(), "native-text-budget-"));
  try {
    reserve(d, "a", 0.5, undefined, 0.3);
    assert.throws(() => reserve(d, "b", 0.5, undefined, 0.3), /cap/);
    assert.throws(() => reserve(d, "c", 50, undefined, -1), /Invalid/);
    assert.throws(() => reserve(d, "d", 50, undefined, NaN), /Invalid/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
