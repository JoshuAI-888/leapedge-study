import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelTiles,
  leanText,
  liveStatus,
  significanceText,
} from "../src/features/youtube-intelligence/channel-page.ts";

const base = {
  videos: 38,
  videosLast7: 6,
  calls: 112,
  split: { bullish: 94, neutral: 10, bearish: 8 },
  minimumSettled: 20,
  benchmark: "SPY",
  horizonDays: 90,
};

test("Tiles: videos with the last 7 days, calls per video, lean and a scored record", () => {
  const tiles = channelTiles({
    ...base,
    record: { n: 31, medianExcess: 0.021, q: 0.1234, status: "not-yet" },
  });
  assert.deepEqual(
    tiles.map((t) => [t.label, t.value, t.note]),
    [
      ["Videos analysed", "38", "6 in the last 7 days"],
      ["Calls", "112", "2.9 per video"],
      ["Lean", "84% bullish · usually bullish", "Share of this creator's calls"],
      ["Record vs SPY, 90d", "+2.1% median excess", "n=31 · q=0.123 · not significant"],
    ],
  );
});

test("Below the leaderboard minimum the record says too few settled calls, with the count", () => {
  const few = channelTiles({ ...base, minimumSettled: 5, record: { n: 3, medianExcess: 0.5, q: null, status: "not-yet" } });
  assert.equal(few[3].value, "Too few settled calls to score");
  assert.equal(few[3].note, "(3 of 5)");
  const none = channelTiles({ ...base, record: null });
  assert.equal(none[3].value, "Too few settled calls to score");
  assert.equal(none[3].note, "(0 of 20)");
  // No settled median at all is never shown as a number.
  const unmeasured = channelTiles({ ...base, record: { n: 40, medianExcess: null, q: null, status: "not-yet" } });
  assert.equal(unmeasured[3].value, "Too few settled calls to score");
});

test("Significance wording follows the leaderboard statuses", () => {
  assert.equal(significanceText({ n: 25, medianExcess: 0.03, q: 0.01, status: "supported" }), "n=25 · q=0.010 · significant, above the benchmark");
  assert.equal(significanceText({ n: 25, medianExcess: -0.03, q: 0.02, status: "negative" }), "n=25 · q=0.020 · significant, below the benchmark");
  assert.equal(significanceText({ n: 25, medianExcess: 0.03, q: null, status: "not-yet" }), "n=25 · q not measured · not significant");
  assert.equal(
    channelTiles({ ...base, record: { n: 25, medianExcess: -0.004, q: 0.02, status: "negative" } })[3].value,
    "−0.4% median excess",
  );
});

test("Lean and empty states", () => {
  assert.equal(leanText({ bullish: 0, neutral: 0, bearish: 0 }).text, "No calls yet");
  assert.equal(leanText({ bullish: 5, neutral: 1, bearish: 4 }).text, "50% bullish · leans bullish");
  assert.equal(leanText({ bullish: 3, neutral: 0, bearish: 3 }).text, "50% bullish · mixed");
  const empty = channelTiles({ ...base, videos: 0, videosLast7: 0, calls: 0, split: { bullish: 0, neutral: 0, bearish: 0 }, record: null });
  assert.equal(empty[1].note, "No videos analysed");
  assert.equal(empty[2].value, "No calls yet");
});

test("Live status counts only this channel's queued or running videos", () => {
  const mine = new Set(["v1", "v2", "v3"]);
  assert.equal(liveStatus([{ videoId: "v1", status: "completed" }, { videoId: "x", status: "running" }], mine), null);
  assert.equal(liveStatus([{ videoId: "v1", status: "running" }, { videoId: "v2", status: "queued" }], mine), "Analysing 1 video now");
  assert.equal(liveStatus([{ videoId: "v2", status: "queued" }, { videoId: "v3", status: "queued" }], mine), "2 videos queued");
});
