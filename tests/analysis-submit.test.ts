import test from "node:test";
import assert from "node:assert/strict";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { analyseRun } from "../src/features/youtube-intelligence/ui/api.ts";

test("rerun navigation receives the run id inside the mutation response envelope", async () => {
  const id = "ca8bd03a-daf8-4aff-b6d0-7ce869e39aae";
  const stub = stubFetch([{ method: "POST", url: "/runs/analyse", respond: json({ result: { runId: id, reused: false } }) }]);
  try {
    const result = await analyseRun({ url: "https://www.youtube.com/watch?v=vrTbCxUzRw4", force: true });
    assert.equal(result.runId, id);
    assert.equal(JSON.parse(stub.log[0].body!).force, true);
  } finally { stub.restore(); }
});

test("an invalid submission response fails before navigation", async () => {
  const stub = stubFetch([{ url: "/runs/analyse", respond: json({ result: {} }) }]);
  try { await assert.rejects(analyseRun({ url: "https://youtu.be/vrTbCxUzRw4", force: true })); }
  finally { stub.restore(); }
});
