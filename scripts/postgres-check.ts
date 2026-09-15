import assert from "node:assert/strict";
import {
  db,
  create,
  claimNext,
  reserve,
  settle,
  health,
  save,
} from "../src/server/youtube-intelligence/store.ts";
import { put, doc } from "../src/server/youtube-intelligence/research-store.ts";
if (!process.env.DATABASE_URL || process.env.YTI_ISOLATED_DB !== "true")
  throw Error("Use a dedicated isolated database and YTI_ISOLATED_DB=true.");
const r = await create(
  "pg-test-001",
  "fixture",
  { nonce: crypto.randomUUID() },
  "v1",
);
const copies = await Promise.all(
  Array.from({ length: 8 }, () =>
    create(r.videoId, r.model, r.input, r.promptVersion),
  ),
);
assert.ok(copies.every((x) => x.id === r.id));
const claims = await Promise.all(Array.from({ length: 8 }, () => claimNext()));
assert.equal(claims.filter(Boolean).length, 1);
const claimed = claims.find(Boolean)!;
await put("test", "unicode", { text: "原文不应被改写" });
assert.equal((await doc("test", "unicode"))?.text, "原文不应被改写");
await assert.rejects(
  db().transaction(async () => {
    await put("test", "rollback", { bad: true });
    throw Error("abort");
  }),
);
assert.equal(await doc("test", "rollback"), null);
process.env.YTI_BUDGET_USD = "1";
const attempts = await Promise.allSettled(
  Array.from({ length: 8 }, (_, i) => reserve(r.id, `stage-${i}`, 0.6)),
);
assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
const paid = attempts.find(
  (x) => x.status === "fulfilled",
) as PromiseFulfilledResult<string>;
await settle(paid.value, 0.1, {});
assert.equal((await health()).spentOrReservedUsd, 0.1);
await assert.rejects(save(claimed.run, "wrong-token"), /Stale/);
claimed.run.status = "completed";
await save(claimed.run, claimed.token);
console.log(
  "Postgres: Unicode, rollback, concurrent deduplication, exclusive claims, budget reservation and lease fencing passed.",
);
await db().close();
