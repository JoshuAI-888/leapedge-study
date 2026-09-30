import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISMISS_DAYS,
  dismissKey,
  dismissUntil,
  followPlan,
  isDismissed,
  isFollowed,
  uploadsText,
} from "../src/features/youtube-intelligence/follow-prompt.ts";

const NOW = "2026-09-29T12:00:00.000Z";
const day = 86_400_000;
const at = (daysAgo: number) =>
  new Date(Date.parse(NOW) - daysAgo * day).toISOString();

/** A cost context where channel "new" uploaded `uploads` videos in 90 days. */
function context(o: {
  uploads?: number;
  complete?: boolean;
  measured?: number[];
  monthlyUsd?: number;
  selected?: string[];
}) {
  return {
    now: NOW,
    selectedChannelIds: o.selected ?? [],
    uploads: Array.from({ length: o.uploads ?? 0 }, (_, i) => ({
      channelId: "new",
      videoId: `v${i}`,
      publishedAt: at(0.5 + (i * 89) / (o.uploads ?? 1)),
    })),
    observations:
      o.complete === false ? [] : [{ channelId: "new", complete: true }],
    samples: (o.measured ?? [0.1]).map((usd, i) => ({
      videoId: `s${i}`,
      measuredUsd: usd,
      acceptedClaims: 1,
    })),
    calls: [],
    monthlyUsd: o.monthlyUsd ?? 50,
    hardCeilingUsd: null,
    alertAtPercent: 80,
  };
}

test("a channel is followed only when listed with discovery on and uploads known", () => {
  const channels = [
    { id: "a", active: true, uploads: "UUa" },
    { id: "b", active: false, uploads: "UUb" },
    { id: "c", active: true, uploads: "" },
  ];
  assert.equal(isFollowed("a", channels), true);
  assert.equal(isFollowed("b", channels), false);
  assert.equal(isFollowed("c", channels), false);
  assert.equal(isFollowed("missing", channels), false);
});

test("within budget: uploads a week and monthly cost come from the Channels projection, and Follow processes", () => {
  // 26 uploads in 90 days is 8.67 a month, about 2 a week; at $0.10 a video, $0.87 a month.
  const plan = followPlan({
    channelId: "new",
    context: context({ uploads: 26 }),
    remainingUsd: 40,
  });
  assert.equal(plan.reason, "within-budget");
  assert.equal(plan.processByDefault, true);
  assert.ok(Math.abs(plan.monthlyUsd! - (26 / 3) * 0.1) < 1e-9);
  assert.ok(Math.abs(plan.uploadsPerWeek! - (26 / 3) / (52 / 12)) < 1e-9);
  assert.equal(uploadsText(plan), "About 2 uploads a week");
});

test("over budget: Follow defaults to discovery only", () => {
  const plan = followPlan({
    channelId: "new",
    context: context({ uploads: 90, measured: [1] }),
    remainingUsd: 5,
  });
  assert.equal(plan.monthlyUsd, 30);
  assert.equal(plan.overBudget, true);
  assert.equal(plan.reason, "over-budget");
  assert.equal(plan.processByDefault, false);
});

test("the whole selection passing the monthly budget also counts as over budget", () => {
  const plan = followPlan({
    channelId: "new",
    context: context({ uploads: 30, measured: [1], monthlyUsd: 5 }),
    remainingUsd: 20,
  });
  assert.equal(plan.monthlyUsd, 10);
  assert.equal(plan.reason, "over-budget");
});

test("an unknown projection states no number and defaults to discovery only", () => {
  const unobserved = followPlan({
    channelId: "new",
    context: context({ uploads: 4, complete: false }),
    remainingUsd: 40,
  });
  assert.equal(unobserved.monthlyUsd, null);
  assert.equal(unobserved.uploadsPerWeek, null);
  assert.equal(unobserved.reason, "cost-unknown");
  assert.equal(unobserved.processByDefault, false);
  assert.equal(uploadsText(unobserved), "At least 4 uploads in 90 days");
  const nothing = followPlan({
    channelId: "new",
    context: context({ complete: false }),
    remainingUsd: 40,
  });
  assert.equal(
    uploadsText(nothing),
    "Upload rate is known once the channel is followed",
  );
  // No measured video cost: the rate is known, the money is not.
  const unmeasured = followPlan({
    channelId: "new",
    context: context({ uploads: 12, measured: [] }),
    remainingUsd: 40,
  });
  assert.equal(unmeasured.monthlyUsd, null);
  assert.equal(unmeasured.reason, "cost-unknown");
});

test("a negative remaining budget reads as none left", () => {
  const plan = followPlan({
    channelId: "new",
    context: context({ uploads: 3 }),
    remainingUsd: -2,
  });
  assert.equal(plan.remainingUsd, 0);
  assert.equal(plan.reason, "over-budget");
});

test("Not now hides the prompt for thirty days on this browser, per channel", () => {
  const now = Date.parse(NOW);
  const stored = dismissUntil(now);
  assert.equal(DISMISS_DAYS, 30);
  assert.equal(isDismissed(stored, now), true);
  assert.equal(isDismissed(stored, now + 29 * day), true);
  assert.equal(isDismissed(stored, now + 30 * day + 1), false);
  assert.equal(isDismissed(null, now), false);
  assert.equal(isDismissed("garbage", now), false);
  assert.notEqual(dismissKey("a"), dismissKey("b"));
});
