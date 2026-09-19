import { create } from "../src/server/youtube-intelligence/store.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmedPublication,
  retrieveResearchSources,
} from "../src/server/youtube-intelligence/research-sources.ts";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
test("search publication metadata and dates in body text alone never establish historical availability", () => {
  assert.equal(
    confirmedPublication("Reported period September 17, 2026", "2026-09-17"),
    null,
  );
  assert.equal(
    confirmedPublication(
      "Published on: September 17, 2026\nResults",
      "2026-09-17",
    ),
    "2026-09-17T23:59:59.999Z",
  );
  assert.equal(
    confirmedPublication("Published on: September 18, 2026", "2026-09-17"),
    null,
  );
});
test("external retrieval retains responses/cost and never repeats an unknown paid request", async () => {
  const db = await freshDatabase();
  const old = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture";
  const stub = stubFetch([
    {
      url: "https://api.exa.ai/search",
      responses: [
        json({
          costDollars: { total: 0.008 },
          results: [
            {
              url: "https://www.sec.gov/Archives/example",
              title: "Filing",
              text: "Published on: September 17, 2026\nRevenue 10 billion",
              publishedDate: "2026-09-17",
            },
          ],
        }),
        () => {
          throw Error("network outcome unknown");
        },
      ],
    },
  ]);
  try {
    const run = await create("search-fixture", "fixture", {}, "fixture");
    const input = {
      runId: run.id,
      query: "Revenue",
      timeMode: "video_date" as const,
      cutoff: "2026-09-20T00:00:00Z",
      primaryDomains: ["sec.gov"],
    };
    const a = await retrieveResearchSources(input);
    const b = await retrieveResearchSources(input);
    assert.deepEqual(a, b);
    assert.equal(stub.log.length, 1);
    assert.equal(a.costUsd, 0.008);
    assert.equal(a.sources[0].sourceClass, "primary");
    const c = await retrieveResearchSources({ ...input, query: "Other" });
    const d = await retrieveResearchSources({ ...input, query: "Other" });
    assert.equal(c.state, "unknown");
    assert.equal(d.state, "unknown");
    assert.equal(stub.log.length, 2);
    const attempts = await db
      .prepare("SELECT status,amount FROM yi_calls WHERE run_id=$1")
      .all(run.id);
    assert.equal(attempts.length, 2);
    assert.ok(
      attempts.some((a) => a.status === "completed" && a.amount === 0.008),
    );
    assert.ok(attempts.some((a) => a.status === "unknown"));
  } finally {
    stub.restore();
    if (old === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = old;
    await db.close();
  }
});
