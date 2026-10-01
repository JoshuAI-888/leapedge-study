import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreCall,
  summarizeScores,
  type PriceSeries,
} from "../src/features/youtube-intelligence/performance.ts";
import { channelQuery } from "../src/server/youtube-intelligence/channels.ts";
import { digestDue } from "../src/server/youtube-intelligence/briefings.ts";
const series = (symbol: string, values: [string, number][]): PriceSeries => ({
  symbol,
  provider: "fixture",
  adjustment: "total-return fixture",
  fetchedAt: "2026-04-01",
  prices: values.map(([date, close]) => ({ date, close })),
});
const call = {
  id: "one",
  ticker: "AAPL",
  channel: "Test",
  stance: "long",
  conviction: "high",
  analysisAt: "2026-01-02T12:00:00Z",
};
const stock = series("AAPL", [
    ["2026-01-02", 100],
    ["2026-01-05", 110],
    ["2026-04-02", 120],
  ]),
  spy = series("SPY", [
    ["2026-01-02", 200],
    ["2026-01-05", 205],
    ["2026-04-02", 220],
  ]);
test("Matched adjusted prices calculate signed returns, excess and win rate independently", () => {
  const r = scoreCall(call, stock, spy, "2026-04-02");
  assert.equal(r.status, "completed");
  assert.ok(Math.abs(r.stockReturn! - 0.2) < 1e-9);
  assert.ok(Math.abs(r.excessReturn! - 0.1) < 1e-9);
  const short = scoreCall(
    { ...call, stance: "short" },
    stock,
    spy,
    "2026-04-02",
  );
  assert.ok(Math.abs(short.stockReturn! + 0.2) < 1e-9);
  assert.equal(short.win, false);
  assert.equal(summarizeScores([r, short]).winRate, 0.5);
});
test("Forward scoring cannot enter at same-day close and unmatched sessions are excluded", () => {
  const r = scoreCall(call, stock, spy, "2026-04-02", "forward");
  assert.equal(r.entryDate, "2026-01-05");
  const incomplete = scoreCall(
    call,
    stock,
    series("SPY", [["2026-01-05", 205]]),
    "2026-01-06",
  );
  assert.equal(incomplete.entryDate, "2026-01-05");
  assert.equal(incomplete.exitDate, "2026-01-05");
  assert.equal(incomplete.status, "ongoing");
});
test("Conditional/low-confidence calls and unpriced sessions never become zero-return wins", () => {
  assert.equal(
    scoreCall({ ...call, stance: "conditional" }, stock, spy, "2026-04-02")
      .status,
    "ineligible",
  );
  assert.equal(scoreCall(call, stock, spy, "2025-12-31").status, "unpriced");
  assert.equal(summarizeScores([]).winRate, null);
  assert.throws(() =>
    scoreCall(call, stock, { ...spy, provider: "other" }, "2026-04-02"),
  );
});
test("Channel input resolves multilingual handles and rejects lookalike or credential URLs", () => {
  assert.deepEqual(
    channelQuery("https://www.youtube.com/@美股Alpha姐/videos"),
    { forHandle: "@美股Alpha姐" },
  );
  assert.throws(() => channelQuery("https://youtube.com.evil.test/@x"));
  assert.throws(() => channelQuery("https://user:pass@youtube.com/@foo"));
  assert.deepEqual(channelQuery("UCFhJ8ZFg9W4kLwFTBBNIjOw"), {
    id: "UCFhJ8ZFg9W4kLwFTBBNIjOw",
  });
});
test("Digest scheduling uses local timezone, does not repeat a day, and respects disabled state", () => {
  const p = {
    timezone: "Pacific/Auckland",
    digestHour: 8,
    digestEnabled: true,
  };
  assert.equal(
    digestDue(new Date("2026-09-12T21:00:00Z"), p, []),
    "2026-09-13",
  );
  assert.equal(
    digestDue(new Date("2026-09-12T21:00:00Z"), p, ["2026-09-13"]),
    null,
  );
  assert.equal(digestDue(new Date("2026-09-12T17:00:00Z"), p, []), null);
  assert.equal(digestDue(new Date(), { ...p, digestEnabled: false }, []), null);
});
test("Immutable prompt registry, snapshot comparisons, append-only reviews and share revocation persist", async () => {
  process.env.YTI_DB = "pglite";
  const R =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const S = await import("../src/server/youtube-intelligence/store.ts");
  const B = await import("../src/server/youtube-intelligence/briefings.ts");
  const base = (await R.promptVersions())[0];
  await assert.rejects(async () => await R.addPrompt(base));
  const next = {
    ...base,
    id: "test.v2",
    rationale: "Test conditional language preservation",
    critique: base.critique + " Reject wrong price roles.",
  };
  await R.addPrompt(next);
  const run = await R.queue("3u24qyWjSVM", undefined, {
    promptVersion: "test.v2",
  });
  assert.equal(
    (
      run.input.promptSnapshot as {
        id: string;
      }
    ).id,
    "test.v2",
  );
  await assert.rejects(
    async () =>
      await R.review({
        comparisonId: "missing",
        winner: "tie",
        accuracy: 5,
        completeness: 5,
        evidence: 5,
        notes: "No evidence available for missing comparison",
        reviewer: "test",
      }),
  );
  const b = await B.buildBriefing("2026-09-13");
  const share = await B.shareBriefing(b.id),
    token = share.path.split("/").at(-1)!;
  assert.equal((await B.readShare(token))?.id, b.id);
  await B.revokeShare(share.id);
  assert.equal(await B.readShare(token), null);
  await assert.rejects(async () => await R.saveIdea(run.id, "c1"));
  await (await S.db()).close();
});
