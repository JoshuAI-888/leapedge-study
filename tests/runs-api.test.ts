import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { create } from "../src/server/youtube-intelligence/store.ts";
import { GET } from "../src/app/api/intelligence/runs/route.ts";

test("runs API retains validated recovery links without exposing private inputs", async () => {
  const db = await freshDatabase();
  try {
    const parent = "ddf09184-f988-44f5-bd3e-8608e5576c47";
    await create(
      "SPIRV9UjNYU",
      "gemini-3.1-flash-lite-preview",
      {
        recoveryOf: parent,
        secret: "private",
        source: { text: "private transcript" },
      },
      "test",
    );
    await create(
      "J_VpfkM74Wk",
      "gemini-3.1-flash-lite-preview",
      { recoveryOf: "not-a-run-id", secret: "private" },
      "test",
    );
    const response = await GET(
      new Request("http://127.0.0.1/api/intelligence/runs"),
    );
    assert.equal(response.status, 200);
    const { runs } = await response.json();
    assert.deepEqual(
      runs.find((r: { videoId: string }) => r.videoId === "SPIRV9UjNYU").input,
      { recoveryOf: parent },
    );
    assert.deepEqual(
      runs.find((r: { videoId: string }) => r.videoId === "J_VpfkM74Wk").input,
      {},
    );
    assert.equal(JSON.stringify(runs).includes("private"), false);
  } finally {
    await db.close();
  }
});
