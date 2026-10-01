import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareSpan,
  twoOfThree,
  units,
  editCounts,
} from "../src/features/youtube-intelligence/agreement.ts";
const span = { text: "Buy NVDA under 120", startSeconds: 10, endSeconds: 14 };
const audio = (text = span.text, offset = 0) => [
  { id: "a", text, start_seconds: 10 + offset, end_seconds: 14 + offset },
];
test("Independent span agreement supports matching English and Chinese but preserves financial punctuation", () => {
  assert.equal(compareSpan(span, audio()).agreed, true);
  assert.equal(
    compareSpan(
      { ...span, text: "不买高于120元" },
      audio("不买高于120元"),
      0.92,
      "zh",
    ).agreed,
    true,
  );
  assert.notDeepEqual(units("1.5", "en"), units("15", "en"));
  assert.equal(editCounts(["a", "b"], ["a", "c"]).substitutions, 1);
});
test("Disagreement, stale anchors, absent speech and changed prices cannot promote trust", () => {
  assert.equal(compareSpan(span, audio("Sell NVDA above 120")).agreed, false);
  assert.equal(compareSpan(span, audio(span.text, 3)).agreed, false);
  assert.equal(compareSpan(span, []).agreed, false);
  const long =
    "A long discussion before the explicit price target of 120 and some more words about risk";
  assert.equal(
    compareSpan({ ...span, text: long }, audio(long.replace("120", "121")), 0.8)
      .agreed,
    false,
  );
  assert.equal(
    compareSpan({ ...span, text: "不要买入" }, audio("要买入"), 0.7, "zh")
      .agreed,
    false,
  );
});
test("Two audio sources agreeing against the published caption never validate the wrong quote", () => {
  const mismatch = audio("Sell NVDA above 120");
  const result = twoOfThree(span, mismatch, mismatch);
  assert.equal(result.agreed, false);
  assert.equal(twoOfThree(span, mismatch, audio()).agreed, true);
  assert.equal(
    twoOfThree(span, mismatch, audio()).tieBreakSource,
    "supadata-generate",
  );
});
