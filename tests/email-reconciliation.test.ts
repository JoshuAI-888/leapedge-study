import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put, doc } from "../src/server/youtube-intelligence/research-store.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
import { reconcileDeliveryEvents } from "../src/server/youtube-intelligence/webhooks.ts";
test("An event arriving before the send response is reconciled and older events cannot regress status", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yti-mail-"));
  delete process.env.DATABASE_URL;
  process.env.YTI_DB_PATH = join(directory, "db.sqlite");
  try {
    await put("emailEvent", "early", {
      emailId: "provider-1",
      type: "email.delivered",
      at: "2026-09-15T00:00:02Z",
    });
    await put("delivery", "d", {
      id: "d",
      providerId: "provider-1",
      status: "provider_accepted",
    });
    await reconcileDeliveryEvents("d");
    assert.equal((await doc<any>("delivery", "d")).status, "delivered");
    await put("emailEvent", "late-arrival", {
      emailId: "provider-1",
      type: "email.delivery_delayed",
      at: "2026-09-15T00:00:01Z",
    });
    await reconcileDeliveryEvents("d");
    assert.equal((await doc<any>("delivery", "d")).status, "delivered");
    await put("emailEvent", "unrelated", {
      emailId: "provider-2",
      type: "email.bounced",
      at: "2026-09-15T00:00:03Z",
    });
    await reconcileDeliveryEvents("d");
    assert.equal((await doc<any>("delivery", "d")).status, "delivered");
  } finally {
    await db().close();
    rmSync(directory, { recursive: true, force: true });
  }
});
