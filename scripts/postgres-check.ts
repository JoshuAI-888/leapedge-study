import assert from "node:assert/strict";
import { useDirectConnection } from "../src/server/youtube-intelligence/database.ts";
import {
  db,
  create,
  claimNext,
  get,
  reserve,
  settle,
  health,
  save,
} from "../src/server/youtube-intelligence/store.ts";
import {
  put,
  doc,
  claimLease,
  putIfAbsent,
} from "../src/server/youtube-intelligence/research-store.ts";
// The DIRECT (unpooled) endpoint, chosen here and not by the npm alias, so that
// running this file straight with node opens the same connection. See
// useDirectConnection(): a transaction-mode pooler discards session-scoped work
// and mostly does so without erroring.
useDirectConnection();
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
// One open attempt per stage, decided by the yi_calls_open_attempt index rather
// than by the read that precedes the insert.
process.env.YTI_BUDGET_USD = "50";
const sameStage = await Promise.allSettled(
  Array.from({ length: 8 }, () => reserve(claimed.run.id, "contended", 0.01)),
);
assert.equal(sameStage.filter((x) => x.status === "fulfilled").length, 1);
// A settled call rewrites its own run's cost and no other.
const other = await create(
  "pg-test-002",
  "fixture",
  { nonce: crypto.randomUUID() },
  "v1",
);
await reserve(other.id, "synthesis", 0.25);
const settled = sameStage.find(
  (x) => x.status === "fulfilled",
) as PromiseFulfilledResult<string>;
await settle(settled.value, 0.02, {});
assert.equal((await get(other.id))!.cost, 0.25);
// One lease holder, and a freeze that no later writer can overwrite.
const now = Date.now();
const leases = await Promise.all(
  Array.from({ length: 4 }, () =>
    claimLease("scheduler", "pg-check", now + 60000, now),
  ),
);
assert.equal(leases.filter(Boolean).length, 1);
assert.equal(await putIfAbsent("test", "freeze", { n: 1 }), true);
assert.equal(await putIfAbsent("test", "freeze", { n: 2 }), false);
assert.equal((await doc<{ n: number }>("test", "freeze"))?.n, 1);
await assert.rejects(save(claimed.run, "wrong-token"), /Stale/);
claimed.run.status = "completed";
await save(claimed.run, claimed.token);
console.log(
  "Postgres: Unicode, rollback, concurrent deduplication, exclusive claims, one open attempt per stage, per-run cost scoping, single lease holder, frozen documents, budget reservation and lease fencing passed.",
);
await db().close();
