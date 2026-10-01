import { test } from "node:test";
import assert from "node:assert/strict";
import { sentimentShift } from "../src/features/youtube-intelligence/metrics/sentiment-shift.ts";
const mention = (
  id: string,
  channelId: string,
  sentiment: string,
  publishedAt: string,
) => ({
  id,
  runId: id,
  videoId: id,
  channelId,
  ticker: "NVDA",
  stance: "long",
  sentiment,
  isCall: true,
  claimId: null,
  trustLevel: "L1" as const,
  spanId: "s",
  publishedAt,
});
test("Sentiment compares adjacent nonoverlapping windows and distinct creators without counting L0", () => {
  const rows = [
    mention("1", "a", "bullish", "2026-09-18T00:00:00Z"),
    mention("2", "a", "bullish", "2026-09-17T00:00:00Z"),
    mention("3", "b", "bearish", "2026-09-09T00:00:00Z"),
    {
      ...mention("4", "c", "bearish", "2026-09-18T00:00:00Z"),
      trustLevel: "L0" as const,
    },
  ];
  const result = sentimentShift(rows, {
    asOf: "2026-09-19T00:00:00Z",
    periodDays: 7,
  })[0];
  assert.equal(result.current.bullish.mentions, 2);
  assert.equal(result.current.bullish.creators, 1);
  assert.equal(result.previous.bearish.mentions, 1);
  assert.equal(result.current.bearish.mentions, 0);
  assert.equal(result.direction, "bullish");
});
