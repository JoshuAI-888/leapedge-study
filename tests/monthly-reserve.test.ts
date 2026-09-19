import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import {
  queue,
  saveTeamPreferences,
} from "../src/server/youtube-intelligence/research-store.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";

test("monthly admission excludes previous settled spend, includes old holds and undated charges, and respects current lowered cap", async () => {
  const db = await freshDatabase();
  const prior = process.env.YTI_BUDGET_USD;
  process.env.YTI_BUDGET_USD = "100";
  try {
    const settings = teamDefaults();
    settings.budget.monthlyUsd = 1;
    await saveTeamPreferences(settings);
    const run = await queue("monthly-budget");
    const old = await store.reserve(run.id, "old", 0.6);
    await store.settle(old, 0.6, {});
    await db
      .prepare("UPDATE yi_calls SET metrics=$1 WHERE id=$2")
      .run(JSON.stringify({ settledAt: "2020-01-01T00:00:00.000Z" }), old);
    const hold = await store.reserve(run.id, "hold", 0.7);
    await db
      .prepare("UPDATE yi_calls SET metrics=$1 WHERE id=$2")
      .run(JSON.stringify({ reservedAt: "2020-01-01T00:00:00.000Z" }), hold);
    await assert.rejects(
      () => store.reserve(run.id, "blocked", 0.4),
      /monthly budget/i,
    );
    await store.settle(hold, 0.7, {});
    await db
      .prepare("UPDATE yi_calls SET metrics=$1 WHERE id=$2")
      .run("{}", hold);
    await assert.rejects(
      () => store.reserve(run.id, "undated", 0.4),
      /monthly budget/i,
    );
    settings.budget.monthlyUsd = 0.75;
    await saveTeamPreferences(settings);
    await assert.rejects(
      () => store.reserve(run.id, "lowered", 0.1),
      /monthly budget/i,
    );
  } finally {
    if (prior === undefined) delete process.env.YTI_BUDGET_USD;
    else process.env.YTI_BUDGET_USD = prior;
    await db.close();
  }
});

test("server monthly ceiling cannot be raised by team configuration and cumulative guard remains", async () => {
  const db = await freshDatabase();
  const prior = process.env.YTI_BUDGET_USD;
  const hard = process.env.YTI_HARD_BUDGET_USD_MONTH;
  process.env.YTI_BUDGET_USD = "100";
  process.env.YTI_HARD_BUDGET_USD_MONTH = "0.2";
  try {
    await saveTeamPreferences(teamDefaults());
    const run = await queue("hard-monthly-budget");
    await assert.rejects(
      () => store.reserve(run.id, "hard", 0.3),
      /monthly budget/i,
    );
    process.env.YTI_BUDGET_USD = "0.05";
    await assert.rejects(
      () => store.reserve(run.id, "cumulative", 0.1),
      /experiment budget/i,
    );
  } finally {
    if (prior === undefined) delete process.env.YTI_BUDGET_USD;
    else process.env.YTI_BUDGET_USD = prior;
    if (hard === undefined) delete process.env.YTI_HARD_BUDGET_USD_MONTH;
    else process.env.YTI_HARD_BUDGET_USD_MONTH = hard;
    await db.close();
  }
});
