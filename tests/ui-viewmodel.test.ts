import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleClaims,
  processingState,
  csv,
  localClaimId,
} from "../src/features/youtube-intelligence/ui/viewmodel.ts";
test("public processing status hides stages and does not call failures ready", () => {
  assert.equal(processingState("queued"), "Queued");
  assert.equal(processingState("running"), "Analysing");
  assert.equal(processingState("completed"), "Ready");
  assert.equal(processingState("failed"), "Needs review");
});
test("claim filters apply trust before ranking, retain neutral stances, and search Chinese", () => {
  const rows = [
    {
      id: "a",
      trustLevel: "L1",
      creatorConviction: "high",
      ticker: "A",
      thesisEn: "甲",
    },
    {
      id: "b",
      trustLevel: "L2",
      creatorConviction: "medium",
      ticker: "B",
      thesisEn: "乙",
    },
    {
      id: "c",
      trustLevel: "L3",
      creatorConviction: "low",
      ticker: "C",
      thesisEn: "丙",
    },
  ];
  assert.deepEqual(
    visibleClaims(rows, "", "L2").map((x) => x.id),
    ["c", "b"],
  );
  assert.deepEqual(
    visibleClaims(rows, "甲", "L0").map((x) => x.id),
    ["a"],
  );
});
test("CSV escapes quotes/newlines and spreadsheet formulas", () => {
  assert.equal(
    csv(["Name"], [['=IMPORTXML("x")'], ["line\nbreak"]]),
    '"Name"\r\n"\'=IMPORTXML(""x"")"\r\n"line\nbreak"',
  );
});
test("saved call action strips only the exact run prefix", () => {
  assert.equal(localClaimId("run:claim:extra", "run"), "claim:extra");
  assert.equal(localClaimId("claim", "run"), "claim");
});

test("ticker columns sort sentiment, creator counts and reliable creators with unknowns last", async () => {
  const { sortTickerRows } =
    await import("../src/features/youtube-intelligence/ui/viewmodel.ts");
  const rows = [
    {
      id: "A",
      label: "A",
      consensus: "split",
      creators: 3,
      n: 8,
      medianExcess: 0.1,
      mostReliableCreator: null,
    },
    {
      id: "B",
      label: "B",
      consensus: "agree long",
      creators: 5,
      n: 25,
      medianExcess: 0.2,
      mostReliableCreator: { winRate: 0.8, n: 12 },
    },
    {
      id: "C",
      label: "C",
      consensus: "lean short",
      creators: 1,
      n: 30,
      medianExcess: 0.05,
      mostReliableCreator: { winRate: 0.7, n: 20 },
    },
  ];
  const sentiments = new Map([
    ["A", "unchanged"],
    ["B", "bullish"],
    ["C", "bearish"],
  ]);
  assert.deepEqual(
    sortTickerRows(rows, "sentiment", true, sentiments).map((r) => r.id),
    ["B", "A", "C"],
  );
  assert.deepEqual(
    sortTickerRows(rows, "creators", false, sentiments).map((r) => r.id),
    ["C", "A", "B"],
  );
  assert.deepEqual(
    sortTickerRows(rows, "reliable", true, sentiments).map((r) => r.id),
    ["B", "C", "A"],
  );
  assert.deepEqual(
    sortTickerRows(rows, "reliable", false, sentiments).map((r) => r.id),
    ["C", "B", "A"],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["A", "B", "C"],
  );
});

test("creator stance summary counts each known creator once and uses their latest dated stance", async () => {
  const { creatorStances } =
    await import("../src/features/youtube-intelligence/ui/viewmodel.ts");
  const base = {
    ticker: "NVDA",
    trustBasis: {},
    stance: "long",
    publishedAt: "2026-09-01",
  };
  const rows = [
    { ...base, id: "a", channelId: "one" },
    {
      ...base,
      id: "b",
      channelId: "one",
      stance: "short",
      publishedAt: "2026-09-02",
    },
    { ...base, id: "c", channelId: "two" },
    { ...base, id: "d", channelId: null },
    {
      ...base,
      id: "e",
      channelId: "three",
      trustBasis: { latestReviewVerdict: "rejected" },
    },
  ];
  assert.deepEqual(creatorStances(rows), [
    { ticker: "NVDA", creators: 2, stances: { short: 1, long: 1 } },
  ]);
  assert.deepEqual(creatorStances([...rows].reverse()), creatorStances(rows));
});
