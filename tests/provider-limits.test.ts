import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { withProviderSlot } from "../src/server/youtube-intelligence/provider-limits.ts";
test("shared provider permits bound concurrency and release after failures", async () => {
  const db = await freshDatabase();
  process.env.YTI_PROVIDER_CONCURRENCY = "2";
  let active = 0,
    peak = 0;
  try {
    await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        withProviderSlot("fixture", async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 20));
          active--;
          if (i === 0) throw Error("fixture failure");
        }),
      ),
    );
    assert.equal(peak, 2);
    assert.equal(
      (await db.prepare("SELECT * FROM yi_provider_slots").all()).length,
      0,
    );
    await db
      .prepare(
        "INSERT INTO yi_provider_slots VALUES('dead','fixture','2000-01-01')",
      )
      .run();
    assert.equal(await withProviderSlot("fixture", async () => 42), 42);
  } finally {
    delete process.env.YTI_PROVIDER_CONCURRENCY;
    await db.close();
  }
});
